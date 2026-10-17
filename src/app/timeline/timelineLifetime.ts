import type { History } from "../../core/history";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { SessionsState } from "../state/sessions";
import { effectiveSelection } from "./selection";
import { timelineStore } from "./timelineState";

// What ends the timeline's editor state (DESIGN §5.6, SE-022), watched here for every open
// document from the moment this module loads (the timeline's commands load it with the
// registry):
// - the selection, once it stops holding (another cel became the active one, or another
//   document), so it does not come back when the active cel returns where it was made; and at
//   an undo or a redo of its document, which end it even when they leave the active cel where
//   it is;
// - the edits open in the panel (rename, layer properties, the duration field) of a document
//   that was closed: what they would change is gone.

/** Ends the selection when it no longer holds in the active document (`effectiveSelection`). */
export function endStaleSelection(): void {
    const { selection } = timelineStore.getState();
    if (!selection) return;
    const document = activeDocument(sessionsStore.getState());
    if (document && effectiveSelection(selection, document.id, document.session)) return;
    timelineStore.setState({ selection: null });
}

/** Ends the selection made in `documentId`. */
function endSelectionOf(documentId: string): void {
    if (timelineStore.getState().selection?.documentId === documentId) {
        timelineStore.setState({ selection: null });
    }
}

/** Drops the edits of documents that are no longer open. */
function dropClosedEdits(state: SessionsState): void {
    const open = (documentId: string) => state.documents.some((entry) => entry.id === documentId);
    const { rename, properties, durationEdit } = timelineStore.getState();
    const dropped: Partial<ReturnType<typeof timelineStore.getState>> = {};
    if (rename && !open(rename.documentId)) dropped.rename = null;
    if (properties && !open(properties.documentId)) dropped.properties = null;
    if (durationEdit && !open(durationEdit.documentId)) dropped.durationEdit = null;
    if (Object.keys(dropped).length > 0) timelineStore.setState(dropped);
}

/** The histories watched for undo and redo, each with the function that stops watching it. */
const watched = new Map<History, () => void>();

function watchHistories(state: SessionsState): void {
    const histories = new Set(state.documents.map((document) => document.history));
    for (const [history, stop] of watched) {
        if (histories.has(history)) continue;
        stop();
        watched.delete(history);
    }
    for (const document of state.documents) {
        if (watched.has(document.history)) continue;
        const { id } = document;
        const stop = document.history.subscribe((change) => {
            if (change.kind !== "do") endSelectionOf(id);
        });
        watched.set(document.history, stop);
    }
}

function follow(state: SessionsState): void {
    watchHistories(state);
    endStaleSelection();
    dropClosedEdits(state);
}

sessionsStore.subscribe(follow);
follow(sessionsStore.getState());
