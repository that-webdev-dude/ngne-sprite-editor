import type { FreeTransform } from "../../core/floating";
import type { ReferenceLayer } from "../../core/model";
import type { OverlayLayer } from "../overlay/types";
import { MOVE_TOOL_ID } from "../selection/move/moveTool";
import { drawTransformBox } from "../selection/transform/transformBox.overlay";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { toolState } from "../tools/activeTool";
import { referenceImages } from "./referenceImages";
import { previews, referencePreview, shownGeometry } from "./referencePreview";
import type { ReferencePreviewStore } from "./referencePreview";
import { referenceSourceSize } from "./references";
import { REFERENCE_CORNERS, referenceBox } from "./referenceTransform";
import type { SourceSize } from "./referenceTransform";

// The box of the active reference layer (SE-046; DESIGN §6): while the Move tool is the active
// tool and the active layer is a visible, unlocked reference layer whose source is decoded,
// its outline and the four corner handles that scale it, drawn as the transform box of a
// floating selection is (DESIGN §5.2) and where a drag shows the layer meanwhile, also while
// a held key or a tool key has made another tool active before the drag's release. Over the
// ants and the pending selection (500, 600), under a float's transform box (700), which the
// Move tool never shows together with this one. The layer asks for a redraw only when the box
// it draws changes, not at every change of the stores it reads (SE-013: an idle overlay, and
// a history step NGNE draws, redraw nothing).

/** Order of the layer in the overlay's stack. */
export const REFERENCE_BOX_ORDER = 650;

export interface ReferenceBoxSources {
    preview: ReferencePreviewStore;
    /** The id of the active tool, or null. */
    activeTool(): string | null;
    sourceSize(document: OpenDocument, layer: ReferenceLayer): SourceSize | null;
    /** The active document, or null. */
    document(): OpenDocument | null;
    /**
     * Calls `listener` when any of the above may have changed (the tool, the documents, the
     * preview, a decoded source); returns the function that stops it.
     */
    subscribe(listener: () => void): () => void;
}

/** The box drawn over `document`, or null for none. */
function shownBox(sources: ReferenceBoxSources, document: OpenDocument): FreeTransform | null {
    const { session } = document;
    const preview = sources.preview.getState();
    // A drag in progress keeps its box when a held key (Space) or a tool key changes the
    // active tool before its release (SE-046 review D).
    const dragging = previews(preview, session, session.activeLayerId);
    if (sources.activeTool() !== MOVE_TOOL_ID && !dragging) return null;
    const layer = session.doc.layers.find((entry) => entry.id === session.activeLayerId);
    if (layer?.kind !== "reference" || !layer.visible || layer.locked) return null;
    const size = sources.sourceSize(document, layer);
    if (!size) return null;
    return referenceBox(shownGeometry(preview, session, layer), size);
}

function sameBox(a: FreeTransform | null, b: FreeTransform | null): boolean {
    if (!a || !b) return a === b;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** The reference-box layer on `sources`. */
export function createReferenceBoxLayer(sources: ReferenceBoxSources): OverlayLayer {
    return {
        id: "reference-box",
        order: REFERENCE_BOX_ORDER,
        draw({ context, document, mapping }) {
            const box = shownBox(sources, document);
            if (box)
                drawTransformBox(context, mapping, box, mapping.frame.ratio, REFERENCE_CORNERS);
        },
        watch(redraw) {
            const current = () => {
                const document = sources.document();
                return {
                    session: document?.session ?? null,
                    box: document && shownBox(sources, document),
                };
            };
            let last = current();
            return sources.subscribe(() => {
                const next = current();
                if (next.session === last.session && sameBox(next.box, last.box)) return;
                const visible = next.box !== null || last.box !== null;
                last = next;
                if (visible) redraw();
            });
        },
    };
}

export const overlayLayers: OverlayLayer[] = [
    createReferenceBoxLayer({
        preview: referencePreview,
        activeTool: () => toolState.active()?.id ?? null,
        sourceSize: referenceSourceSize,
        document: () => activeDocument(sessionsStore.getState()),
        subscribe(listener) {
            const stops = [
                toolState.subscribe(listener),
                sessionsStore.subscribe(listener),
                referencePreview.subscribe(listener),
                referenceImages.subscribe(listener),
            ];
            return () => {
                for (const stop of stops) stop();
            };
        },
    }),
];
