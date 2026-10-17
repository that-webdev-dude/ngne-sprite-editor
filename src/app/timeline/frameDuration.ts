import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { effectiveSelection, targetFrameIds } from "./selection";
import { startDurationEdit, timelineStore } from "./timelineState";
import type { TimelineState } from "./timelineState";

// The frames the duration field of the timeline acts on, and what it shows of them (SPEC §7.4,
// SE-022). Apply Frame Duration and the panel read them from here.

/**
 * The frames the duration field acts on, in playback order: those fixed when the field took
 * the focus (`durationEdit`), or else the selected frames, or the active frame when none is
 * selected. Frames the document no longer has are left out.
 */
export function durationFrameIds(document: OpenDocument, state: TimelineState): string[] {
    const { durationEdit } = state;
    if (durationEdit && durationEdit.documentId === document.id) {
        const chosen = new Set(durationEdit.frameIds);
        return document.session.doc.frames
            .filter((frame) => chosen.has(frame.id))
            .map((frame) => frame.id);
    }
    const { session } = document;
    return targetFrameIds(session, effectiveSelection(state.selection, document.id, session));
}

/** What the duration field shows. */
export interface ShownDuration {
    /**
     * The active frame's duration when it is among the frames, otherwise the first one's: what
     * the arrow keys step from.
     */
    readonly durationMs: number;
    /** The frames' durations differ: the field shows no number, and any value applies. */
    readonly mixed: boolean;
}

/** What the duration field shows of `document`; null when it acts on no frame. */
export function shownDuration(document: OpenDocument, state: TimelineState): ShownDuration | null {
    const ids = new Set(durationFrameIds(document, state));
    const { doc, activeFrameId } = document.session;
    const frames = doc.frames.filter((frame) => ids.has(frame.id));
    const base = frames.find((frame) => frame.id === activeFrameId) ?? frames[0];
    if (!base) return null;
    const mixed = frames.some((frame) => frame.durationMs !== base.durationMs);
    return { durationMs: base.durationMs, mixed };
}

/**
 * The duration field took the focus: the frames it acts on now are fixed until it loses it
 * (`endDurationEdit`), so what is typed there lands on them even when the selection changes
 * before it is applied.
 */
export function beginDurationEdit(): void {
    const document = activeDocument(sessionsStore.getState());
    if (!document) return;
    const state = { ...timelineStore.getState(), durationEdit: null };
    startDurationEdit({ documentId: document.id, frameIds: durationFrameIds(document, state) });
}
