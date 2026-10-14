import type { StoreApi } from "zustand/vanilla";
import type { Transaction } from "../../core/history";
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
//     transaction begun → onDown → onMove per sample → onUp → commit (one history entry)
//   Escape, pointer cancel, the document left → onCancel → abort (pixels as before)
//
// One stroke at a time: other pointers and other buttons are ignored while one is in
// progress, and the middle button is never taken (it pans, SE-012). The tool of a stroke is
// the tool active at its pointer down; a held key that changes the active tool acts from the
// next pointer down.

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
    tools: Pick<ToolState, "active" | "options">;
    /**
     * The mapping of the image on screen: the overlay's, which maps the pointer through
     * NGNE's stretch after a resize (SPEC §6.3); null while no viewport is on the page.
     */
    mapping(): ViewMapping | null;
    /** Calls `callback` after `ms` milliseconds; returns the function that cancels it. */
    later(callback: () => void, ms: number): () => void;
    /** Receives what a tool threw or a transaction refused; the default logs it. */
    onError?(error: unknown): void;
}

export interface ToolPipeline {
    /** True while a stroke is in progress. */
    readonly stroking: boolean;
    /** The tool of the stroke in progress, or null. */
    readonly strokeTool: Tool | null;
    /** The pointer of the stroke in progress, or null. */
    readonly strokePointer: number | null;
    /**
     * A button went down over the viewport. Returns true when it began a stroke: the caller
     * captures the pointer and prevents the event's default.
     */
    down(input: PointerInput): boolean;
    /** The pointer moved: its samples, oldest first (the coalesced events of one event). */
    move(inputs: readonly PointerInput[]): void;
    /** A button came up: the stroke of that pointer ends. */
    up(input: PointerInput): void;
    /** Cancels the stroke in progress (Escape, pointer cancel). Returns whether there was one. */
    cancel(): boolean;
    /** A key went down or up; returns true when the stroke's tool used it. */
    key(input: KeyInput): boolean;
    /** Stops following the stores; a stroke in progress is cancelled. */
    dispose(): void;
}

interface Stroke {
    readonly tool: Tool;
    readonly pointerId: number;
    readonly button: ToolButton;
    readonly context: ToolContext;
    readonly document: OpenDocument;
    readonly transaction: Transaction | null;
    readonly live: LiveComposite | null;
    /** The mapping of the last sample, used while none can be read. */
    mapping: ViewMapping;
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

    /** Ends `ended`, which is no longer the stroke in progress: commits or aborts its pixels. */
    const close = (ended: Stroke, commit: boolean) => {
        const { transaction, live } = ended;
        if (!transaction?.open) return;
        if (!commit) {
            transaction.abort();
            live?.aborted();
            return;
        }
        try {
            live?.flush();
        } catch (error) {
            // The frame cannot be composited as it is now (its layers changed under the
            // stroke): the stroke is taken back rather than left open.
            transaction.abort();
            live?.aborted();
            onError(error);
            return;
        }
        let recorded: boolean;
        try {
            recorded = transaction.commit(ended.tool.label) !== null;
        } catch (error) {
            // The commit could not allocate its entry: it put the pixels back itself.
            live?.aborted();
            onError(error);
            return;
        }
        live?.committed(recorded);
    };

    const cancelStroke = (): boolean => {
        const ended = stroke;
        if (!ended) return false;
        stroke = null;
        try {
            ended.tool.onCancel?.(ended.context);
        } catch (error) {
            onError(error);
        }
        close(ended, false);
        return true;
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
        stroke = null;
        close(current, true);
    };

    /** The stroke ends with the document it works on: closed, or no longer the active one. */
    const stopSessions = sessions.subscribe((state) => {
        if (stroke && activeDocument(state)?.session !== stroke.context.session) cancelStroke();
    });

    return {
        get stroking() {
            return stroke !== null;
        },
        get strokeTool() {
            return stroke?.tool ?? null;
        },
        get strokePointer() {
            return stroke?.pointerId ?? null;
        },

        down(input) {
            if (stroke) return false;
            const button: ToolButton | null =
                input.button === LEFT ? "primary" : input.button === RIGHT ? "secondary" : null;
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
                    // The selection becomes the clip mask here with SE-030 (SPEC §7.1).
                    transaction = document.history.begin(target);
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
                        display?.dirty(rect);
                    },
                },
                feedback: showFeedback,
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
            };
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
            if (!current || input.pointerId !== current.pointerId) return;
            // Another button came up while the stroke's own is still held.
            if ((input.buttons & PRESSED[current.button]) !== 0) return;
            finish(current, input);
        },

        cancel: cancelStroke,

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
            cancelStroke();
            clearFeedback();
        },
    };
}
