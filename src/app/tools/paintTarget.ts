import type { OpenDocument } from "../state/sessions";

// Where a paint stroke goes (SPEC §7.1, SE-014): the cel of the active layer at the active
// frame, when that layer can take paint. Otherwise the status bar says why and no stroke
// begins.

/** The messages of a refused paint stroke, shown as status-bar feedback (DESIGN §4). */
export const PAINT_REFUSED = {
    missing: "No layer to paint on",
    reference: "Reference layers cannot be painted on",
    hidden: "Layer is hidden",
    locked: "Layer is locked",
    /**
     * Below 1× a device pixel shows one of several texels, picked by NGNE's nearest sampling,
     * and the pointer cannot name the one shown: the overview steps are for looking only.
     */
    overview: "Zoom in to 1× or more to paint",
} as const;

export type PaintTarget = { layerId: string; frameId: string } | { refused: string };

/**
 * The target of a paint stroke in `document`: the active layer, which must be a visible,
 * unlocked pixel layer, at the active frame, with the view at a zoom of 1× or more.
 */
export function resolvePaintTarget(document: OpenDocument): PaintTarget {
    const { session, view } = document;
    const layer = session.doc.layers.find((candidate) => candidate.id === session.activeLayerId);
    if (!layer) return { refused: PAINT_REFUSED.missing };
    if (layer.kind !== "pixel") return { refused: PAINT_REFUSED.reference };
    if (!layer.visible) return { refused: PAINT_REFUSED.hidden };
    if (layer.locked) return { refused: PAINT_REFUSED.locked };
    if (view.scale < 1) return { refused: PAINT_REFUSED.overview };
    return { layerId: layer.id, frameId: session.activeFrameId };
}
