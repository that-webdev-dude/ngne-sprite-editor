import type { StoreApi } from "zustand/vanilla";
import type { DocSession } from "../../core/model";
import { fileWorkflows } from "../file/workflows";
import { paletteStore } from "../palette/paletteState";
import type { PaletteState } from "../palette/paletteState";
import { referenceImages } from "../references/referenceImages";
import type { ReferenceImages } from "../references/referenceImages";
import { applyFloating, isFloating } from "../selection/floating";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { SessionsState } from "../state/sessions";

// Document tabs (SE-047): one tab per open document, in the order of the session store's
// `documents`. Each document keeps its own session (selection, active layer and frame),
// history, view and reference sources in the store; switching tabs switches all of them,
// and the composite cache follows the active document (`state/composites.ts`).
//
// What the editor keeps outside the documents and per document is kept here: the palette's
// current swatch (SE-060) is remembered for each document and comes back with its tab.

/**
 * Whether the active document may stop being the active one now: not during its stroke. A
 * floating selection is no reason to wait: it is applied as the document is left.
 */
function mayLeaveActive(sessions: StoreApi<SessionsState>): boolean {
    const active = activeDocument(sessions.getState());
    return !active?.history.transaction || isFloating();
}

/**
 * Makes the open document `id` the active one: its tab is selected and the editor shows its
 * session, view and history. A floating selection of the document left is applied first
 * (SPEC §5.2; a failure is reported and keeps the active document). Nothing changes during a
 * stroke or while a file operation runs. Returns whether `id` is the active document now.
 */
export function activateDocument(id: string): boolean {
    const state = sessionsStore.getState();
    if (state.activeId === id) return true;
    if (!state.documents.some((entry) => entry.id === id)) return false;
    if (fileWorkflows.busy || !mayLeaveActive(sessionsStore)) return false;
    try {
        applyFloating();
    } catch {
        // Reported by `applyFloating`'s own toast.
        return false;
    }
    if (activeDocument(sessionsStore.getState())?.history.transaction) return false;
    sessionsStore.getState().activate(id);
    return true;
}

/** The document `step` tabs after the active one, wrapping around; null with fewer than two. */
export function neighbourOf(state: SessionsState, step: number): string | null {
    const { documents, activeId } = state;
    if (documents.length < 2) return null;
    const index = documents.findIndex((entry) => entry.id === activeId);
    const next = (((index + step) % documents.length) + documents.length) % documents.length;
    return documents[next]?.id ?? null;
}

/** Moves the tab of document `id` to `index` (pointer drag or keyboard reorder). */
export function moveDocument(id: string, index: number): void {
    if (sessionsStore.getState().documents.some((entry) => entry.id === id)) {
        sessionsStore.getState().move(id, index);
    }
}

/** Closes the tab of document `id`, asking first when it has unsaved changes (SPEC §10). */
export function closeDocument(id: string): Promise<boolean> {
    return fileWorkflows.close(id);
}

/** Whether tabs can be switched and closed now: no file operation and no stroke. */
export function tabsAvailable(): boolean {
    return !fileWorkflows.busy && mayLeaveActive(sessionsStore);
}

/**
 * Keeps the palette's current swatch per document (SE-047): the swatch of the document left
 * is remembered, the arriving document gets its own back (the first swatch at first), and a
 * Move Colour target is dropped. Returns the function that stops it.
 */
export function followPaletteSwatch(
    sessions: StoreApi<SessionsState>,
    palette: StoreApi<PaletteState>,
): () => void {
    // By session: a document whose id changes (Save As) keeps its swatch.
    const swatches = new Map<DocSession, number>();
    const open = (state: SessionsState, session: DocSession) =>
        state.documents.some((entry) => entry.session === session);
    let shown = activeDocument(sessions.getState())?.session ?? null;
    return sessions.subscribe((state) => {
        for (const session of [...swatches.keys()]) {
            if (!open(state, session)) swatches.delete(session);
        }
        const active = activeDocument(state)?.session ?? null;
        if (active === shown) return;
        if (shown !== null && open(state, shown)) swatches.set(shown, palette.getState().current);
        shown = active;
        const current = (shown !== null ? swatches.get(shown) : undefined) ?? 0;
        palette.setState({ current, target: null });
    });
}

/**
 * Lets the decoded reference images of a document go when it stops being the active one
 * (SE-047 review), so decoded sources are not kept for every tab. Its source bytes stay in
 * the store; they are decoded again when the document is active once more, and the viewport
 * draws a reference only once it is decoded (SE-045). Returns the function that stops it.
 */
export function followReferenceImages(
    sessions: StoreApi<SessionsState>,
    images: Pick<ReferenceImages, "forget">,
): () => void {
    let shown = activeDocument(sessions.getState());
    return sessions.subscribe((state) => {
        const active = activeDocument(state);
        if (active?.session === shown?.session) {
            shown = active;
            return;
        }
        if (shown) {
            // The record as it was last seen: a source removed meanwhile went with its step.
            const left = state.documents.find((entry) => entry.session === shown!.session);
            for (const bytes of (left ?? shown).referenceSources.values()) images.forget(bytes);
        }
        shown = active;
    });
}

followPaletteSwatch(sessionsStore, paletteStore);
followReferenceImages(sessionsStore, referenceImages);
