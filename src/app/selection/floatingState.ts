import type { StoreApi } from "zustand/vanilla";
import { FloatingSelection } from "../../core/floating";
import type { FloatingContent } from "../../core/floating";
import type { DocSession } from "../../core/model";
import { setKeyContext } from "../keymap/contextState";
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
//     history step; cancel (Escape, undo) → nothing recorded, the cel as it was
//
// The float writes into the cel's own image, so a composite made from the document while it
// floats (the cache composites the frame again after an eviction; the preview; the
// eyedropper) shows it as well. The selection follows the float; the session store is told
// once an animation frame, so the ants and the status bar follow it without a render per
// pointer sample. When the document stops being the active one the float is applied, and
// when it is closed the float is dropped.

export interface FloatingSources extends LiveCompositeSources {
    sessions: StoreApi<SessionsState>;
    /** Switches the keymap's `floating` context (SPEC §7.8). */
    context(active: boolean): void;
    /** Receives what failed while a float was applied; the default logs it. */
    onError?(error: unknown): void;
}

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
     * Applies the float (SPEC §5.2): one history step, or none when nothing changed. Returns
     * whether there was a float. A failure is reported and the cel is left as before it.
     */
    apply(): boolean;
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
        // What a paste wrote is on screen at once.
        const placed = float.placed;
        if (placed && transaction.dirty) live.dirty(placed);
    };

    const moved = (changed: ReturnType<FloatingSelection["moveTo"]>) => {
        const now = current;
        if (!now) return;
        if (changed) now.live.dirty(changed);
        if (!now.float.selects || now.cancelTouch) return;
        now.cancelTouch = sources.nextFrame(() => {
            now.cancelTouch = null;
            if (current === now) touch(now.session);
        });
    };

    const apply = (): boolean => {
        const ended = end();
        if (!ended) return false;
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
            return true;
        }
        let recorded: boolean;
        try {
            recorded = float.apply() !== null;
        } catch (error) {
            // The entry could not be stored: pixels and selection are as before the float.
            live.aborted();
            touch(ended.session);
            onError(error);
            return true;
        }
        live.committed(recorded);
        // No step to tell the store, but the selection the float showed is gone.
        if (!recorded) touch(ended.session);
        return true;
    };

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
        apply,
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
});
