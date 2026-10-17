import type { Command } from "../../core/history";
import { keyContextStore } from "../keymap/contextState";
import { applyFloating } from "../selection/floating";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import type { CelRef } from "./selection";

// The active document as the timeline's commands and clicks use it (SE-022).

/**
 * The active document when the timeline may act on it: its history is idle, or the transaction
 * open in it holds a floating selection, which `applyFloating` commits first (SPEC §5.2).
 * During a stroke the timeline does nothing. What `enabled` of the commands reads.
 */
export function availableDocument(): OpenDocument | null {
    const document = activeDocument(sessionsStore.getState());
    if (!document) return null;
    return !document.history.transaction || keyContextStore.getState().floating ? document : null;
}

/**
 * Applies a floating selection (SPEC §5.2), then returns the active document if its history
 * can take a command now. What a command calls before it changes the document or the active
 * cel.
 */
export function settledDocument(): OpenDocument | null {
    applyFloating();
    const document = activeDocument(sessionsStore.getState());
    return document && !document.history.transaction ? document : null;
}

/** Executes a command made from the settled document; returns whether a step was recorded. */
export function executeOnActive(make: (document: OpenDocument) => Command | null): boolean {
    const document = settledDocument();
    if (!document) return false;
    const command = make(document);
    if (!command) return false;
    document.history.execute(command);
    return true;
}

/**
 * Makes a layer, a frame or both the active ones: session state, outside the history (SPEC
 * §5.2). A real switch applies a floating selection first; the viewport then shows the frame
 * from the composite cache (`viewportController`). An id the document does not have is
 * ignored. Returns the cel that is active afterwards, or null when nothing could be switched
 * (no document, or a stroke in progress).
 */
export function activateCel(target: Partial<CelRef>): CelRef | null {
    const before = availableDocument();
    if (!before) return null;
    const pick = (id: string | undefined, ids: readonly { id: string }[], current: string) =>
        id !== undefined && ids.some((entry) => entry.id === id) ? id : current;
    const wanted = (document: OpenDocument): CelRef => {
        const { session } = document;
        return {
            layerId: pick(target.layerId, session.doc.layers, session.activeLayerId),
            frameId: pick(target.frameId, session.doc.frames, session.activeFrameId),
        };
    };
    const first = wanted(before);
    const { session } = before;
    if (first.layerId === session.activeLayerId && first.frameId === session.activeFrameId) {
        return first;
    }
    const document = settledDocument();
    if (!document) return null;
    // Applying the floating selection may have changed the document.
    const cel = wanted(document);
    document.session.activeLayerId = cel.layerId;
    document.session.activeFrameId = cel.frameId;
    sessionsStore.getState().touch(document.id);
    return cel;
}
