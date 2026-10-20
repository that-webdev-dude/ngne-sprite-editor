import type { StoreApi } from "zustand/vanilla";
import type { DocSettings, SymmetrySettings } from "../../core/model";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";

// Symmetry and tiled mode in the app (SPEC §2.3 View, §5.1 `DocSettings`; SE-062): the
// settings of the active document, changed by plain setters. Like the grid and onion toggles
// they are view preferences: saved with the document, no history entry, and the document does
// not become dirty (SPEC §5.2). The paint tools read them at each press
// (`tools/brush/strokeOptions.ts`), the viewport draws the tiled copies
// (`viewport/viewportController.ts`) and the overlay draws the axes (`axes.overlay.ts`).
// Each function works on the app's session store unless it is given another (tests).

export type SymmetryMode = SymmetrySettings["mode"];
export type TiledMode = DocSettings["tiled"];

/** The symmetry and tiled mode of the active document, with its size; null while none is open. */
export function activeSymmetry(sessions: StoreApi<SessionsState> = sessionsStore): {
    symmetry: Readonly<SymmetrySettings>;
    tiled: TiledMode;
    width: number;
    height: number;
} | null {
    const document = activeDocument(sessions.getState());
    if (!document) return null;
    const { settings, width, height } = document.session.doc;
    return { symmetry: settings.symmetry, tiled: settings.tiled, width, height };
}

/** The axis in half pixels `value` snaps to on a side of `size` pixels: 0 to 2 × `size`. */
export function clampAxis(value: number, size: number): number {
    return Math.min(2 * size, Math.max(0, Math.round(value)));
}

function documentOf(state: SessionsState, documentId: string | undefined): OpenDocument | null {
    if (documentId === undefined) return activeDocument(state);
    return state.documents.find((open) => open.id === documentId) ?? null;
}

/**
 * Changes the symmetry of the active document, or of the open document `documentId`: its
 * mode, and an axis in half pixels (clamped to the canvas, 0 to twice its side). No history
 * entry, never dirty. Does nothing while no such document is open or when nothing would
 * change. Never waits for the history: a stroke or a floating selection may be open.
 */
export function setSymmetry(
    patch: Partial<SymmetrySettings>,
    documentId?: string,
    sessions: StoreApi<SessionsState> = sessionsStore,
): void {
    const state = sessions.getState();
    const document = documentOf(state, documentId);
    if (!document) return;
    const { doc } = document.session;
    const now = doc.settings.symmetry;
    const next: SymmetrySettings = {
        mode: patch.mode ?? now.mode,
        axisX: patch.axisX === undefined ? now.axisX : clampAxis(patch.axisX, doc.width),
        axisY: patch.axisY === undefined ? now.axisY : clampAxis(patch.axisY, doc.height),
    };
    if (next.mode === now.mode && next.axisX === now.axisX && next.axisY === now.axisY) return;
    state.updateDocSettings(document.id, (settings) => {
        settings.symmetry = next;
    });
}

/** Changes the tiled mode of the active document, as `setSymmetry` does. */
export function setTiledMode(
    tiled: TiledMode,
    sessions: StoreApi<SessionsState> = sessionsStore,
): void {
    const state = sessions.getState();
    const document = activeDocument(state);
    if (!document || document.session.doc.settings.tiled === tiled) return;
    state.updateDocSettings(document.id, (settings) => {
        settings.tiled = tiled;
    });
}
