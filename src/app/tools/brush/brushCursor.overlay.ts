import { brushRuns } from "../../../core/raster";
import type { Brush, PixelPoint } from "../../../core/raster";
import type { DeviceRect } from "../../../engine/viewport/geometry";
import { fillRects } from "../../overlay/draw";
import type { OverlayLayer } from "../../overlay/types";
import type { ViewMapping } from "../../view/coordinates";
import { toolState } from "../activeTool";
import { brushOf, hasBrush } from "./brushOptions";

// The brush cursor (DESIGN §6, SE-015): under the pointer, the outline of the pixels the
// active tool's brush would paint there, snapped to the document's pixels. The overlay does
// not hold NGNE's pixels, so it cannot invert them; the outline is two-tone instead, visible
// on any content: a 1 device pixel black ring just outside the footprint and a 1 device pixel
// white ring outside that one. The footprint itself is left clear, so its pixels show. Drawn
// over every other layer of SE-013; a paint tool that draws this outline hides the system
// cursor over the document (`paintCursor`).

/** Order of the layer in the overlay's stack: over the grids (SE-013 uses 100 to 300). */
export const BRUSH_CURSOR_ORDER = 900;
/** The ring next to the footprint, and the ring outside it (0xRRGGBB). */
export const BRUSH_CURSOR_INNER = 0x000000;
export const BRUSH_CURSOR_OUTER = 0xffffff;

/** The footprint of `brush` at `pixel`, one device rectangle per row of the brush. */
export function footprintRects(
    brush: Brush,
    pixel: PixelPoint,
    mapping: Pick<ViewMapping, "docToDevice">,
): DeviceRect[] {
    const rects: DeviceRect[] = [];
    for (const run of brushRuns(brush, pixel.x, pixel.y)) {
        const start = mapping.docToDevice(run.x, run.y);
        const end = mapping.docToDevice(run.end, run.y + 1);
        const x = Math.round(start.x);
        const y = Math.round(start.y);
        const width = Math.round(end.x) - x;
        const height = Math.round(end.y) - y;
        if (width > 0 && height > 0) rects.push({ x, y, width, height });
    }
    return rects;
}

function grown(rects: readonly DeviceRect[], by: number): DeviceRect[] {
    return rects.map(({ x, y, width, height }) => ({
        x: x - by,
        y: y - by,
        width: width + 2 * by,
        height: height + 2 * by,
    }));
}

export const overlayLayers: OverlayLayer[] = [
    {
        id: "brush-cursor",
        order: BRUSH_CURSOR_ORDER,
        draw({ context, cursor, mapping, size }) {
            if (!cursor) return;
            const tool = toolState.active();
            if (!tool || !hasBrush(tool)) return;
            const footprint = footprintRects(
                brushOf(toolState.options(tool)),
                cursor.pixel,
                mapping,
            );
            if (footprint.length === 0) return;
            // Everything but the footprint: the rows do not overlap, so with the even-odd rule
            // the canvas less the rows remains.
            context.beginPath();
            context.rect(0, 0, size.width, size.height);
            for (const row of footprint) context.rect(row.x, row.y, row.width, row.height);
            context.clip("evenodd");
            fillRects(context, grown(footprint, 2), BRUSH_CURSOR_OUTER);
            fillRects(context, grown(footprint, 1), BRUSH_CURSOR_INNER);
        },
        // The outline follows the active tool and its brush options.
        watch: (redraw) => toolState.subscribe(redraw),
    },
];
