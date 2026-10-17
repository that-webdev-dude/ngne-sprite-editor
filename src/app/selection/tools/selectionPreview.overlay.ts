import type { Rect } from "../../../core/model";
import type { SelectionBoundary } from "../../../core/selection";
import type { OverlayLayer } from "../../overlay/types";
import { createRingPainter } from "../ringPainter";
import type { SurfaceFactory } from "../ringPainter";
import { pendingBoundary, pendingBounds, pendingSelection } from "./pendingShape";
import type { Pending, PendingStore } from "./pendingShape";

// The live preview of a selection tool's gesture (SE-031, DESIGN §6): while a gesture is in
// progress the overlay shows the pixels it would select as the ants show a selection — a ring
// of 1 device pixel just outside them, black and white dashes by x + y — standing still at
// phase 0, over the ants of the selection there is (order 600; the ants are 500, the brush
// cursor 900). It is the ants' painter (`ringPainter.ts`): painted once per shape, zoom and
// canvas size, moved with a pan, one `drawImage` per redraw. A magic-wand pick's boundary is
// the one the ants find for the selection it becomes (`boundaryCache.ts`).

/** Order of the layer: over the selection's ants, under the brush cursor. */
export const SELECTION_PREVIEW_ORDER = 600;

/** The phase the preview's dashes stand at. */
export const PREVIEW_PHASE = 0;

/** The surfaces of the app: OffscreenCanvas. */
const offscreen: SurfaceFactory = (width, height) => {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The selection preview has no 2D context.");
    return { width, height, image: canvas, context };
};

/** The preview layer of the pending shapes of `store`, on surfaces from `surface`. */
export function createSelectionPreviewLayer(
    store: PendingStore,
    surface: SurfaceFactory = offscreen,
): OverlayLayer {
    const painter = createRingPainter(surface);
    /** The pending shape shown last, where it lies, and its boundary once worked out. */
    let known: {
        pending: Pending;
        bounds: Rect | null;
        boundary: SelectionBoundary | null;
    } | null = null;

    return {
        id: "selection-preview",
        order: SELECTION_PREVIEW_ORDER,
        draw({ context, document, mapping, size }) {
            const pending = store.get();
            if (!pending || pending.session !== document.session) {
                known = null;
                painter.release();
                return;
            }
            const { doc } = document.session;
            if (known?.pending !== pending) {
                known = {
                    pending,
                    bounds: pendingBounds(pending.shape, doc.width, doc.height),
                    boundary: null,
                };
            }
            const shown = known;
            if (!shown.bounds) {
                painter.release();
                return;
            }
            painter.draw(
                context,
                {
                    key: pending,
                    bounds: shown.bounds,
                    boundary: () =>
                        (shown.boundary ??= pendingBoundary(pending.shape, doc.width, doc.height)),
                },
                { rect: mapping.rect, doc, size },
                PREVIEW_PHASE,
            );
        },
        watch: (redraw) => store.subscribe(redraw),
    };
}

export const overlayLayers: OverlayLayer[] = [createSelectionPreviewLayer(pendingSelection)];
