import { stopPlaybackForEdit } from "../playback/playbackState";
import { clickSelection, effectiveSelection, gridOrder } from "./selection";
import type { ClickModifiers, ClickTarget } from "./selection";
import { activateCel, availableDocument } from "./timelineDocument";
import { setSelection, timelineStore } from "./timelineState";

/**
 * A click in the timeline grid (DESIGN §5.6): on a cel, on a frame of the header or on a
 * layer row. It makes the clicked cel, frame or layer the active one (applying a floating
 * selection first) and updates the selection: one item, the range from the anchor with
 * Shift, one added or removed with Ctrl. Returns false when nothing could be done (no
 * document, or a stroke in progress).
 */
export function clickTimeline(target: ClickTarget, modifiers: ClickModifiers): boolean {
    // A click in the grid stops editor playback first, on the frame on screen (SE-024).
    stopPlaybackForEdit();
    const document = availableDocument();
    if (!document) return false;
    const { id, session } = document;
    const current = effectiveSelection(timelineStore.getState().selection, id, session);
    const at = activateCel(
        target.kind === "cels"
            ? target.cel
            : target.kind === "frames"
              ? { frameId: target.frameId }
              : { layerId: target.layerId },
    );
    if (!at) return false;
    setSelection(clickSelection(current, target, modifiers, gridOrder(session.doc), id, at));
    return true;
}
