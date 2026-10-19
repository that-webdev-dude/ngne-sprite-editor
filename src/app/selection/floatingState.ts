import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { FloatingSelection } from "../../core/floating";
import type { FlipAxis, FloatingContent, FreeTransform } from "../../core/floating";
import { AllocationError } from "../../core/history";
import type { Command } from "../../core/history";
import type { DocSession } from "../../core/model";
import { setKeyContext } from "../keymap/contextState";
import { notices } from "../notices/notices";
import { activeComposites } from "../state/composites";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import { startLiveComposite } from "../tools/liveComposite";
import type { LiveComposite, LiveCompositeSources } from "../tools/liveComposite";
import { strokeEcho } from "../tools/strokeEcho";
import { viewportLink } from "../viewport/viewportLink";

// The floating selection of the app (SPEC §5.2, §7.2; SE-032): at most one, in the active
// document. The float itself is `core/floating`'s; this module shows it and keeps the editor
// in step with it:
//
//   lift or paste → the float's transaction is open, the keymap's `floating` context is on
//     (Enter, Escape, the arrows; SPEC §7.8), and the frame is shown through the live-stroke
//     path of SE-014 (`liveComposite.ts`): each move is composited into the live buffer by its
//     rectangle, handed to the composite cache and echoed on the overlay (SPEC §6.6) as a
//     stroke's dabs are, for as long as the float lasts, over any number of gestures
//   apply (Enter, a press outside it, `applyFloating`, the triggers of SPEC §5.2) → one
//     history step; cancel (Escape, undo) → nothing recorded, the cel as it was; discard
//     (Delete, Cut) → one step: what lies under the float, nothing selected
//   a failure → the float is taken back (or, after its step was recorded, kept), `onError`
//     reports it (a toast in the app) and the call returns "failed"
//
// The float writes into the cel's own image, so a composite made from the document while it
// floats (the cache composites the frame again after an eviction; the preview; the
// eyedropper) shows it as well. The selection follows the float; the session store is told
// once an animation frame, so the ants and the status bar follow it without a render per
// pointer sample. When the document stops being the active one the float is applied. Close,
// Open, Revert and New Sprite apply it before they ask (SPEC §10); a document closed some
// other way takes its float with it.
//
// Transforms (SE-033): flips, quarter turns and the free transform change the float in place,
// inside the same transaction, so they stay one undo step with its lift, and a cancel takes
// them back with it. A lifted float that was transformed is recorded as "Transform" (a pasted
// one stays "Paste"). `shown` tells the context bar and the overlay where the float's box is.

/** The label of the undo step of a lifted float that was transformed (SE-033). */
export const TRANSFORM_LABEL = "Transform";

/** What the interface shows of the float (SE-033): its box and angle, or null without one. */
export interface FloatShown {
    /** The session of the document that holds the float. */
    readonly session: DocSession | null;
    /** Its free transform; null without a float. */
    readonly transform: FreeTransform | null;
    /** The float's selection follows it (false for a whole cel lifted with no selection). */
    readonly selects: boolean;
}

const NOTHING_SHOWN: FloatShown = { session: null, transform: null, selects: false };

export interface FloatingSources extends LiveCompositeSources {
    sessions: StoreApi<SessionsState>;
    /** Switches the keymap's `floating` context (SPEC §7.8). */
    context(active: boolean): void;
    /** Receives what failed while a float was applied; the default logs it. */
    onError?(error: unknown): void;
}

/**
 * What `apply` or `discard` did: there was no float; it landed (one history step, or none
 * when nothing changed); it failed, was reported through `onError`, and the pixels are those
 * before the float (an entry that could not be stored) or those of its recorded step (a
 * listener of the history threw).
 */
export type LandOutcome = "none" | "landed" | "failed";

export interface LiftRequest {
    /** Lift the whole cel and leave the selection alone, instead of the selection's pixels. */
    whole?: boolean;
    /** The label of the undo step; the default is "Move". */
    label?: string;
}

export interface FloatingState {
    /** The float of the active document, or null. */
    readonly float: FloatingSelection | null;
    /** Whether `document` (by default the active one) holds the float. */
    floats(document?: OpenDocument | null): boolean;
    /**
     * Lifts the selected pixels (or with `whole` the whole cel) of the active cel of
     * `document` into a float. The caller checks that the document is the active one, its
     * history is idle and its active layer can be edited. Throws what lifting throws.
     */
    lift(document: OpenDocument, request?: LiftRequest): FloatingSelection;
    /**
     * Pastes `content` over the active cel of `document` with its top-left pixel at `x`, `y`.
     * The same conditions as `lift`.
     */
    paste(
        document: OpenDocument,
        content: FloatingContent,
        x: number,
        y: number,
        label?: string,
    ): FloatingSelection;
    /** Moves the float's top-left pixel to `x`, `y`; nothing without a float. */
    moveTo(x: number, y: number): void;
    /** Moves the float by `dx`, `dy` pixels; nothing without a float. */
    moveBy(dx: number, dy: number): void;
    /**
     * Sets the float's free transform (SE-033; `FloatingSelection.setTransform`); nothing
     * without a float. Throws `RangeError` for a box it cannot take, the float unchanged.
     */
    setTransform(transform: FreeTransform): void;
    /** Mirrors the float within its box (SE-033); nothing without a float. */
    flip(axis: FlipAxis): void;
    /** Turns the float by quarter turns clockwise about its box's centre (SE-033). */
    rotate(turns: number): void;
    /** The float's box as the interface shows it, and its changes (SE-033). */
    readonly shown: StoreApi<FloatShown>;
    /** Applies the float (SPEC §5.2): one history step, or none when nothing changed. */
    apply(): LandOutcome;
    /**
     * Discards the float's content (Delete and Cut while pixels float, SPEC §7.2): one step
     * labelled `label` that keeps what lies under the float and selects nothing, or none when
     * that changes nothing.
     */
    discard(label: string): LandOutcome;
    /** Cancels the float: the cel and the selection as before it. Returns whether there was one. */
    cancel(): boolean;
    /** Stops following the session store; a float is dropped. */
    dispose(): void;
}

interface Current {
    readonly session: DocSession;
    readonly float: FloatingSelection;
    readonly live: LiveComposite;
    /** Cancels telling the session store of the selection in the next animation frame. */
    cancelTouch: (() => void) | null;
}

export function createFloatingState(sources: FloatingSources): FloatingState {
    const { sessions } = sources;
    const onError =
        sources.onError ?? ((error: unknown) => console.error("Floating selection:", error));
    let current: Current | null = null;
    const shown = createStore<FloatShown>(() => NOTHING_SHOWN);

    /** Tells `shown` where the float of `now` is (or that there is none). */
    const show = (now: Current | null) => {
        shown.setState(
            now
                ? {
                      session: now.session,
                      transform: now.float.transform,
                      selects: now.float.selects,
                  }
                : NOTHING_SHOWN,
            true,
        );
    };

    /** Tells the session store that the session changed (its selection), if it is still open. */
    const touch = (session: DocSession) => {
        const document = sessions.getState().documents.find((entry) => entry.session === session);
        if (document) sessions.getState().touch(document.id);
    };

    /** Ends `current`: its scheduled touch is dropped and the context is off. */
    const end = (): Current | null => {
        const ended = current;
        if (!ended) return null;
        current = null;
        ended.cancelTouch?.();
        ended.cancelTouch = null;
        sources.context(false);
        show(null);
        return ended;
    };

    const begin = (document: OpenDocument, float: FloatingSelection) => {
        const { transaction } = float;
        let live: LiveComposite;
        try {
            live = startLiveComposite(
                document.session,
                {
                    layerId: transaction.layerId,
                    frameId: transaction.frameId,
                    imageId: transaction.imageId,
                    image: transaction.image,
                },
                sources,
            );
        } catch (error) {
            float.cancel();
            throw error;
        }
        current = { session: document.session, float, live, cancelTouch: null };
        sources.context(true);
        show(current);
        // What a paste wrote is on screen at once.
        const placed = float.placed;
        if (placed && transaction.dirty) live.dirty(placed);
    };

    const moved = (changed: ReturnType<FloatingSelection["moveTo"]>) => {
        const now = current;
        if (!now) return;
        if (changed) now.live.dirty(changed);
        show(now);
        if (!now.float.selects || now.cancelTouch) return;
        now.cancelTouch = sources.nextFrame(() => {
            now.cancelTouch = null;
            if (current === now) touch(now.session);
        });
    };

    /** Transforms the float with `change` (SE-033), shown as a move is; nothing without one. */
    const transformed = (
        change: (float: FloatingSelection) => ReturnType<FloatingSelection["moveTo"]>,
    ) => {
        const now = current;
        if (!now) return;
        const changed = change(now.float);
        if (now.float.label === "Move") now.float.label = TRANSFORM_LABEL;
        moved(changed);
    };

    /**
     * Ends the float with `settle`, its apply or its discard, shown and reported. `rewrites`:
     * `settle` writes pixels where the content is (a discard writes what lies under it).
     */
    const land = (
        settle: (float: FloatingSelection) => Command | null,
        rewrites: boolean,
    ): LandOutcome => {
        const ended = end();
        if (!ended) return "none";
        const { float, live } = ended;
        try {
            live.flush();
        } catch (error) {
            // The frame cannot be composited as it is (its layers changed): the float is
            // taken back rather than left open, as a stroke is (SE-014).
            float.cancel();
            live.aborted();
            touch(ended.session);
            onError(error);
            return "failed";
        }
        const placed = rewrites ? float.placed : null;
        let command: Command | null;
        try {
            command = settle(float);
        } catch (error) {
            if (error instanceof AllocationError) {
                // The entry could not be stored: pixels and selection are as before the float.
                live.aborted();
            } else {
                // The step was recorded, then a listener of the history threw: the frame is
                // shown as the step left it, in case the listener that tells the viewport
                // did not run.
                if (placed) live.dirty(placed);
                live.committed(false);
            }
            touch(ended.session);
            onError(error);
            return "failed";
        }
        if (placed) live.dirty(placed);
        // A step of the selection alone touches no frame, so nothing tells the viewport: the
        // live buffer is shown anew, as for no step (an upload of the float may be on screen).
        live.committed(command !== null && command.touched.frameIds.length > 0);
        // No step to tell the store, but the selection the float showed is gone.
        if (!command) touch(ended.session);
        return "landed";
    };

    const apply = () => land((float) => float.apply(), false);

    const cancel = (): boolean => {
        const ended = end();
        if (!ended) return false;
        ended.float.cancel();
        ended.live.aborted();
        touch(ended.session);
        return true;
    };

    // The float belongs to the active document: it is applied when another one becomes active
    // and dropped with a document that closes.
    const stopSessions = sessions.subscribe((state) => {
        const now = current;
        if (!now || activeDocument(state)?.session === now.session) return;
        if (state.documents.some((entry) => entry.session === now.session)) apply();
        else cancel();
    });

    return {
        get float() {
            const now = current;
            if (!now) return null;
            return activeDocument(sessions.getState())?.session === now.session ? now.float : null;
        },
        floats(document) {
            const target = document === undefined ? activeDocument(sessions.getState()) : document;
            return current !== null && target?.session === current.session;
        },
        lift(document, request = {}) {
            const { session, history } = document;
            const float = FloatingSelection.lift(history, {
                layerId: session.activeLayerId,
                frameId: session.activeFrameId,
                selection: request.whole ? null : session.selection,
                label: request.label,
            });
            begin(document, float);
            return float;
        },
        paste(document, content, x, y, label) {
            const { session, history } = document;
            const float = FloatingSelection.paste(history, {
                layerId: session.activeLayerId,
                frameId: session.activeFrameId,
                content,
                x,
                y,
                label,
            });
            begin(document, float);
            // The selection is the pasted image's: shown now.
            touch(session);
            return float;
        },
        moveTo(x, y) {
            if (current) moved(current.float.moveTo(x, y));
        },
        moveBy(dx, dy) {
            if (current) moved(current.float.moveBy(dx, dy));
        },
        setTransform(transform) {
            transformed((float) => float.setTransform(transform));
        },
        flip(axis) {
            transformed((float) => float.flip(axis));
        },
        rotate(turns) {
            transformed((float) => float.rotate(turns));
        },
        shown,
        apply,
        discard: (label) => land((float) => float.discard(label), true),
        cancel,
        dispose() {
            stopSessions();
            cancel();
        },
    };
}

/** The floating selection of the app, on its stores, composites, viewport and echo. */
export const floatingState: FloatingState = createFloatingState({
    sessions: sessionsStore,
    composites: activeComposites,
    viewport: viewportLink,
    echo: strokeEcho,
    nextFrame(callback) {
        const request = requestAnimationFrame(() => callback());
        return () => cancelAnimationFrame(request);
    },
    context: (active) => setKeyContext("floating", active),
    // SPEC §5.2: a failure is reported by a toast.
    onError: (error) =>
        notices.error(
            `Could not apply the floating selection. ${
                error instanceof Error && error.message !== "" ? error.message : String(error)
            }`,
        ),
});
