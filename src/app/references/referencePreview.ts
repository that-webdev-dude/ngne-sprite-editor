import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { DocSession, ReferenceLayer } from "../../core/model";

// Where a reference layer is shown while the Move tool drags or scales it (SE-046). The drag
// changes the document only at its release, in one undo step (SPEC §7.6); until then the
// position and scale it would give live here, outside the document, so nothing else that
// acts meanwhile (an undo, a layer command) meets a layer in a state no step recorded. The
// viewport and the reference box on the overlay draw the layer from here while it names it.

/** A reference layer's geometry during a drag. */
export interface ReferencePreview {
    /** The session of the document dragged in. */
    readonly session: DocSession;
    readonly layerId: string;
    readonly x: number;
    readonly y: number;
    readonly scale: number;
}

/** The preview of the drag in progress, or null. */
export type ReferencePreviewStore = StoreApi<ReferencePreview | null>;

export function createReferencePreview(): ReferencePreviewStore {
    return createStore<ReferencePreview | null>(() => null);
}

/** The app's preview, which the Move tool writes and the viewport and overlay read. */
export const referencePreview: ReferencePreviewStore = createReferencePreview();

/**
 * The position and scale `layer` of `session` is shown at: those of `preview` while it names
 * that layer of that session, the layer's own otherwise.
 */
export function shownGeometry(
    preview: ReferencePreview | null,
    session: DocSession,
    layer: Pick<ReferenceLayer, "id" | "x" | "y" | "scale">,
): { x: number; y: number; scale: number } {
    if (preview && preview.session === session && preview.layerId === layer.id) {
        return { x: preview.x, y: preview.y, scale: preview.scale };
    }
    return { x: layer.x, y: layer.y, scale: layer.scale };
}
