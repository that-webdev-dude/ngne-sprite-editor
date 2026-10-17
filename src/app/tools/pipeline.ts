import type { StoreApi } from "zustand/vanilla";
import type { Transaction } from "../../core/history";
import type { Rect } from "../../core/model";
import type { EditorState } from "../state/editor";
import { activeDocument } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import type { StatusState } from "../state/status";
import type { ViewMapping } from "../view/coordinates";
import type { ToolState } from "./activeTool";
import { startLiveComposite } from "./liveComposite";
import type { LiveComposite, LiveCompositeSources } from "./liveComposite";
import { resolvePaintTarget } from "./paintTarget";
import type { Tool, ToolButton, ToolContext, ToolModifiers, ToolPointer } from "./types";

// The pointer pipeline of the viewport (SPEC §7.1, SE-014): pointer input on the overlay,
// mapped to the document, drives the active tool. No DOM here: `attachToolPointer` turns
// pointer and key events into the inputs below, so the policy is unit-tested in Node with
// synthetic sequences.
//
//   pointer down (left or right) → active tool; a paint tool's target resolved and its
//     transaction begun → onDown → onMove per sample → onUp → commit (one history entry,
//     or none when nothing changed) → onCommit
//   Escape, pointer cancel, the document left → onCancel → abort (pixels as before)
//
// One stroke at a time: other pointers and other buttons are ignored while one is in
// progress, and the middle button is never taken (it pans, SE-012). The tool of a stroke is
// the tool active at its pointer down; a held key that changes the active tool acts from the
// next pointer down.
//
// A gesture (SE-031: the polygon lasso; SPEC §7.8, the `gesture` context) is a stroke its
// tool keeps open past the release (`ToolContext.openGesture`):
//
//   first press → onDown … onUp → (open) hover moves → onHover → next press → onDown … onUp
//     → … → Enter, a double click or the tool itself (`ToolContext.closeGesture`, SE-065)
//     → onClose → commit → onCommit
//   Escape, a pointer cancel during a press, the document left, the active tool changed
//     → onCancel → abort
//
// Between its presses every press over the viewport is the gesture's, and the moves with no
// button held reach its tool; `sources.gesture` is told when one opens and when it ends.

/** `PointerEvent.button` values. */
const LEFT = 0;
const RIGHT = 2;
/** `PointerEvent.buttons` bits of the left and right buttons. */
const PRESSED: Readonly<Record<ToolButton, number>> = { primary: 1, secondary: 2 };
/** How long transient feedback stays in the status bar: as long as a toast (DESIGN §4). */
export const FEEDBACK_MS = 4000;

/** The fields of a pointer event the pipeline reads. */
export interface PointerInput {
    pointerId: number;
    /** `PointerEvent.button`: 0 left, 1 middle, 2 right; -1 for a move. */
    button: number;
    /** `PointerEvent.buttons`: the buttons held. */
    buttons: number;
    clientX: number;
    clientY: number;
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    timeStamp: number;
}

/** The fields of a key event the pipeline reads. */
export interface KeyInput {
    type: "down" | "up";
    /** The key as chords name it (`eventKey` of commands/chord.ts); null for none. */
    key: string | null;
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    repeat: boolean;
}

export interface PipelineSources extends LiveCompositeSources {
    sessions: StoreApi<SessionsState>;
    status: StoreApi<StatusState>;
    /** The foreground and background colours. */
    editor: StoreApi<EditorState>;
    /** The active tool; a gesture ends when it changes (`subscribe`). */
    tools: Pick<ToolState, "active" | "options"> & Partial<Pick<ToolState, "subscribe">>;
    /**
     * The mapping of the image on screen: the overlay's, which maps the pointer through
     * NGNE's stretch after a resize (SPEC §6.3); null while no viewport is on the page.
     */
    mapping(): ViewMapping | null;
    /** Calls `callback` after `ms` milliseconds; returns the function that cancels it. */
    later(callback: () => void, ms: number): () => void;
    /** Receives what a tool threw or a transaction refused; the default logs it. */
    onError?(error: unknown): void;
    /**
     * A gesture opened (true) or ended (false): the app switches the keymap's `gesture`
     * context with it (SPEC §7.8).
     */
    gesture?(open: boolean): void;
}

export interface ToolPipeline {
    /** True while a stroke is in progress, an open gesture included. */
    readonly stroking: boolean;
    /** The tool of the stroke in progress, or null. */
    readonly strokeTool: Tool | null;
    /** The pointer of the stroke in progress while its button is held, or null. */
    readonly strokePointer: number | null;
    /** True while a gesture is open (`ToolContext.openGesture`). */
    readonly gesture: boolean;
    /**
     * True while the pipeline takes moves with no button held (`move`): a gesture is open
     * between its presses.
     */
    readonly hovering: boolean;
    /**
     * A button went down over the viewport. Returns true when it began a stroke, or a press of
     * the open gesture: the caller captures the pointer and prevents the event's default.
     */
    down(input: PointerInput): boolean;
    /**
     * The pointer moved: its samples, oldest first (the coalesced events of one event). While
     * `hovering`, samples with no button held go to the gesture's tool.
     */
    move(inputs: readonly PointerInput[]): void;
    /** A button came up: the stroke of that pointer ends, or the press of a gesture. */
    up(input: PointerInput): void;
    /**
     * Cancels the stroke in progress (Escape, pointer cancel), an open gesture included.
     * Returns whether there was one.
     */
    cancel(): boolean;
    /**
     * Closes the open gesture and keeps it (Enter, a double click). Returns whether there was
     * one.
     */
    closeGesture(): boolean;
    /** A key went down or up; returns true when the stroke's tool used it. */
    key(input: KeyInput): boolean;
    /** Stops following the stores; a stroke in progress is cancelled. */
    dispose(): void;
}

interface Stroke {
    readonly tool: Tool;
    /** The pointer and the button of the press in progress (of a gesture, its latest). */
    pointerId: number;
    button: ToolButton;
    readonly context: ToolContext;
    readonly document: OpenDocument;
    readonly transaction: Transaction | null;
    readonly live: LiveComposite | null;
    /** The mapping of the last sample, used while none can be read. */
    mapping: ViewMapping;
    /** The tool made the stroke a gesture: it stays open past its release. */
    gesture: boolean;
    /** The button of the press is held; false between the presses of a gesture. */
    pressed: boolean;
}

/** The part of `rect` inside `bounds`, or null when there is none. */
function intersection(rect: Rect, bounds: Rect): Rect | null {
    const x = Math.max(rect.x, bounds.x);
    const y = Math.max(rect.y, bounds.y);
    const right = Math.min(rect.x + rect.width, bounds.x + bounds.width);
    const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function modifiersOf(input: Omit<KeyInput, "type" | "key" | "repeat">): ToolModifiers {
    return {
        shift: input.shiftKey,
        ctrl: input.ctrlKey,
        alt: input.altKey,
        meta: input.metaKey,
    };
}

/** A pointer sample in the coordinates of `mapping`. */
export function toolPointer(
    input: PointerInput,
    mapping: ViewMapping,
    button: ToolButton,
): ToolPointer {
    const { clientX: x, clientY: y } = input;
    const pixel = mapping.clientToDoc(x, y);
    return {
        client: { x, y },
        device: mapping.clientToDevice(x, y),
        pixel,
        position: mapping.clientToDocExact(x, y),
        inside: mapping.contains(pixel),
        button,
        modifiers: modifiersOf(input),
        time: input.timeStamp,
    };
}

export function createToolPipeline(sources: PipelineSources): ToolPipeline {
    const { sessions, status } = sources;
    const onError =
        sources.onError ?? ((error: unknown) => console.error("Tool stroke failed:", error));
    let stroke: Stroke | null = null;
    /** The feedback this pipeline put in the status bar, while it is there. */
    let shown: string | null = null;
    let cancelFeedback: (() => void) | null = null;

    const clearFeedback = () => {
        cancelFeedback?.();
        cancelFeedback = null;
        if (shown !== null && status.getState().feedback === shown) {
            status.getState().setFeedback(null);
        }
        shown = null;
    };

    const showFeedback = (message: string) => {
        clearFeedback();
        shown = message;
        status.getState().setFeedback(message);
        cancelFeedback = sources.later(clearFeedback, FEEDBACK_MS);
    };

    /**
     * Ends `ended`, which is no longer the stroke in progress: commits or aborts its pixels.
     * Returns what became of them: a history entry, no change, or taken back.
     */
    const close = (ended: Stroke, commit: boolean): "recorded" | "unchanged" | "aborted" => {
        const { transaction, live } = ended;
        if (!transaction?.open) return commit ? "unchanged" : "aborted";
        if (!commit) {
            transaction.abort();
            live?.aborted();
            return "aborted";
        }
        try {
            live?.flush();
        } catch (error) {
            // The frame cannot be composited as it is now (its layers changed under the
            // stroke): the stroke is taken back rather than left open.
            transaction.abort();
            live?.aborted();
            onError(error);
            return "aborted";
        }
        let recorded: boolean;
        try {
            recorded = transaction.commit(ended.tool.label) !== null;
        } catch (error) {
            // The commit could not allocate its entry: it put the pixels back itself.
            live?.aborted();
            onError(error);
            return "aborted";
        }
        live?.committed(recorded);
        return recorded ? "recorded" : "unchanged";
    };

    /** `ended` is no longer the stroke in progress; an open gesture ends with it. */
    const release = (ended: Stroke) => {
        if (stroke === ended) stroke = null;
        if (ended.gesture) {
            ended.gesture = false;
            sources.gesture?.(false);
        }
    };

    const cancelStroke = (): boolean => {
        const ended = stroke;
        if (!ended) return false;
        release(ended);
        try {
            ended.tool.onCancel?.(ended.context);
        } catch (error) {
            onError(error);
        }
        close(ended, false);
        return true;
    };

    /** Keeps `ended` as at a release: committed, then `onCommit`. */
    const keep = (ended: Stroke) => {
        release(ended);
        const outcome = close(ended, true);
        if (outcome === "aborted") return;
        try {
            ended.tool.onCommit?.(ended.context, outcome === "recorded");
        } catch (error) {
            onError(error);
        }
    };

    /** Runs a handler of the stroke's tool; a handler that throws cancels the stroke. */
    const run = <Result>(current: Stroke, handler: () => Result): Result | undefined => {
        try {
            return handler();
        } catch (error) {
            onError(error);
            if (stroke === current) cancelStroke();
            return undefined;
        }
    };

    const finish = (current: Stroke, input: PointerInput) => {
        const pointer = toolPointer(input, sources.mapping() ?? current.mapping, current.button);
        let failed = false;
        try {
            current.tool.onUp?.(current.context, pointer);
        } catch (error) {
            failed = true;
            onError(error);
        }
        if (stroke !== current) return;
        if (failed) {
            cancelStroke();
            return;
        }
        // A gesture waits for its next press.
        if (current.gesture) {
            current.pressed = false;
            return;
        }
        keep(current);
    };

    /** The stroke ends with the document it works on: closed, or no longer the active one. */
    const stopSessions = sessions.subscribe((state) => {
        if (stroke && activeDocument(state)?.session !== stroke.context.session) cancelStroke();
    });

    /** A gesture ends when another tool becomes the active one (SE-031). */
    const stopTools =
        sources.tools.subscribe?.(() => {
            if (stroke?.gesture && sources.tools.active() !== stroke.tool) cancelStroke();
        }) ?? (() => {});

    /** Closes the open gesture `current` and keeps it (Enter, a double click, its tool). */
    const closeOpenGesture = (current: Stroke) => {
        let failed = false;
        try {
            current.tool.onClose?.(current.context);
        } catch (error) {
            failed = true;
            onError(error);
        }
        if (stroke !== current) return;
        if (failed) cancelStroke();
        // A press in progress ends with the gesture: its release finds no stroke.
        else keep(current);
    };

    /** A press of the open gesture `current`: its next `onDown`. */
    const pressGesture = (current: Stroke, input: PointerInput, button: ToolButton): boolean => {
        clearFeedback();
        const mapping = sources.mapping() ?? current.mapping;
        current.mapping = mapping;
        current.pointerId = input.pointerId;
        current.button = button;
        current.pressed = true;
        const pointer = toolPointer(input, mapping, button);
        run(current, () => current.tool.onDown?.(current.context, pointer));
        return stroke === current;
    };

    return {
        get stroking() {
            return stroke !== null;
        },
        get strokeTool() {
            return stroke?.tool ?? null;
        },
        get strokePointer() {
            return stroke?.pressed ? stroke.pointerId : null;
        },
        get gesture() {
            return stroke?.gesture ?? false;
        },
        get hovering() {
            return stroke !== null && stroke.gesture && !stroke.pressed;
        },

        down(input) {
            const button: ToolButton | null =
                input.button === LEFT ? "primary" : input.button === RIGHT ? "secondary" : null;
            if (stroke) {
                // Between its presses, a press is the open gesture's next one.
                if (!button || !stroke.gesture || stroke.pressed) return false;
                return pressGesture(stroke, input, button);
            }
            if (!button) return false;
            // A new press over the canvas takes the place of the last refusal's message.
            clearFeedback();
            const tool = sources.tools.active();
            const document = activeDocument(sessions.getState());
            const mapping = sources.mapping();
            if (!tool || !document || !mapping) return false;
            const pointer = toolPointer(input, mapping, button);
            const { foreground, background } = sources.editor.getState();

            let transaction: Transaction | null = null;
            let live: LiveComposite | null = null;
            if (tool.paints) {
                const target = resolvePaintTarget(document);
                if ("refused" in target) {
                    showFeedback(target.refused);
                    return false;
                }
                try {
                    // Paint is clipped to the selection (SPEC §7.1, SE-030): its mask is the
                    // transaction's clip, so a pixel outside it gets its value back at each
                    // `markDirty`, before the live composite reads it. The selection cannot
                    // change while the transaction is open (the history takes no command).
                    const clip = document.session.selection?.mask;
                    transaction = document.history.begin(clip ? { ...target, clip } : target);
                    const { image, imageId } = transaction;
                    live = startLiveComposite(
                        document.session,
                        { ...target, imageId, image },
                        sources,
                    );
                } catch (error) {
                    if (transaction?.open) transaction.abort();
                    onError(error);
                    return false;
                }
            }
            const opened = transaction;
            const display = live;
            // Outside the selection's bounds the clip changed nothing: only the part inside
            // is composited and echoed (the opaque echo would hide onion skins and references
            // over pixels that did not change).
            const shownBounds = opened ? (document.session.selection?.bounds ?? null) : null;
            /** The stroke this context is of, once it is made. */
            let own: Stroke | null = null;
            const context: ToolContext = {
                document,
                session: document.session,
                history: document.history,
                button,
                colour: button === "primary" ? foreground : background,
                options: sources.tools.options(tool),
                paint: opened && {
                    layerId: opened.layerId,
                    frameId: opened.frameId,
                    image: opened.image,
                    markDirty(rect) {
                        if (!opened.open) return;
                        opened.markDirty(rect);
                        const shown = shownBounds ? intersection(rect, shownBounds) : rect;
                        if (shown) display?.dirty(shown);
                    },
                },
                feedback: showFeedback,
                openGesture() {
                    if (!own || stroke !== own || own.gesture) return;
                    own.gesture = true;
                    sources.gesture?.(true);
                },
                closeGesture() {
                    if (!own || stroke !== own || !own.gesture) return;
                    closeOpenGesture(own);
                },
            };
            const current: Stroke = {
                tool,
                pointerId: input.pointerId,
                button,
                context,
                document,
                transaction,
                live,
                mapping,
                gesture: false,
                pressed: true,
            };
            own = current;
            stroke = current;
            run(current, () => tool.onDown?.(context, pointer));
            return stroke === current;
        },

        move(inputs) {
            const current = stroke;
            if (!current) return;
            const mapping = sources.mapping() ?? current.mapping;
            current.mapping = mapping;
            for (const input of inputs) {
                if (stroke !== current) return;
                // Between the presses of a gesture: the pointer hovers.
                if (!current.pressed) {
                    const pointer = toolPointer(input, mapping, current.button);
                    run(current, () => current.tool.onHover?.(current.context, pointer));
                    continue;
                }
                if (input.pointerId !== current.pointerId) continue;
                // Released with no `pointerup` (another button stayed down): the stroke ends.
                if ((input.buttons & PRESSED[current.button]) === 0) {
                    finish(current, input);
                    return;
                }
                const pointer = toolPointer(input, mapping, current.button);
                run(current, () => current.tool.onMove?.(current.context, pointer));
            }
        },

        up(input) {
            const current = stroke;
            if (!current?.pressed || input.pointerId !== current.pointerId) return;
            // Another button came up while the stroke's own is still held.
            if ((input.buttons & PRESSED[current.button]) !== 0) return;
            finish(current, input);
        },

        cancel: cancelStroke,

        closeGesture() {
            const current = stroke;
            if (!current?.gesture) return false;
            closeOpenGesture(current);
            return true;
        },

        key(input) {
            const current = stroke;
            if (!current?.tool.onKey || input.key === null || input.key === "Escape") return false;
            const used = run(current, () =>
                current.tool.onKey?.(current.context, {
                    type: input.type,
                    key: input.key ?? "",
                    modifiers: modifiersOf(input),
                    repeat: input.repeat,
                }),
            );
            return used === true;
        },

        dispose() {
            stopSessions();
            stopTools();
            cancelStroke();
            clearFeedback();
        },
    };
}
