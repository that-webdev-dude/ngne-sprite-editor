import { Hexagon } from "lucide-react";
import { clonePixelBuffer } from "../../../core/pixels";
import { paintInk, ShapeStroke } from "../../../core/raster";
import type { PixelPoint } from "../../../core/raster";
import {
    BRUSH_SHAPE,
    BRUSH_SIZE,
    brushOf,
    INK,
    inkOf,
    OPACITY,
    opacityOf,
    paintCursor,
} from "../brush/brushOptions";
import { FILLED } from "../shapes/shapeTool";
import type { ToolContext, ToolPointer, ToolSpec } from "../types";

// The polygon (SPEC §7.1, SE-065): a closed polygon through vertices the user clicks, outline
// or filled, one gesture of several presses (`ToolContext.openGesture`; the keymap's `gesture`
// context, SPEC §7.8) and one undo step. As the polygon lasso's (SE-031), every press and every
// release adds the pixel under the pointer as a vertex unless it is the last vertex already,
// so a click adds one and a drag two. Until it is closed the polygon runs through the vertices
// and the pointer, drawn as a rubber band (`ShapeStroke`, as the rectangle's) from the image
// as the first press found it: the preview is the result. Enter or a double click closes it
// through the vertices; Escape, a change of tool or document takes it back. The brush is
// stamped along the sides (`core/raster/polygon.ts`); Filled adds the pixels whose centres lie
// inside by the even-odd rule, the polygon lasso's shape. Fewer than 3 vertices draw their
// line or their pixel. A variant of the rectangle's rail slot (Shift+D; D and Shift+D switch
// between the polygon and the contour, DESIGN §5.1).

/** The status-bar hint of the polygon. */
export const POLYGON_HINT = "Click the vertices · Enter or double-click: close";

interface Trace {
    readonly stroke: ShapeStroke;
    readonly filled: boolean;
    readonly vertices: PixelPoint[];
}

/** The polygon in progress, by the context of its stroke. */
const traces = new WeakMap<ToolContext, Trace>();

/** `points`, with `pixel` after them unless it is the last one. */
export function withVertex(points: readonly PixelPoint[], pixel: PixelPoint | null): PixelPoint[] {
    const last = points[points.length - 1];
    if (!pixel || (last && last.x === pixel.x && last.y === pixel.y)) return [...points];
    return [...points, { x: pixel.x, y: pixel.y }];
}

function draw(context: ToolContext, trace: Trace, points: readonly PixelPoint[]): void {
    const changed = trace.stroke.draw({ kind: "polygon", points, filled: trace.filled });
    if (changed) context.paint?.markDirty(changed);
}

/**
 * Follows the pointer, the polygon's pending vertex until it is closed; with `vertex`, its
 * pixel becomes a vertex.
 */
function at(context: ToolContext, pointer: ToolPointer, vertex: boolean): void {
    const trace = traces.get(context);
    if (!trace) return;
    const pixel = { x: pointer.pixel.x, y: pointer.pixel.y };
    const last = trace.vertices[trace.vertices.length - 1];
    if (vertex && !(last && last.x === pixel.x && last.y === pixel.y)) trace.vertices.push(pixel);
    draw(context, trace, withVertex(trace.vertices, pixel));
}

export const polygonTool: ToolSpec = {
    id: "polygon",
    label: "Polygon",
    icon: Hexagon,
    shortcut: "Shift+D",
    variantOf: "rectangle",
    railOrder: 212,
    paints: true,
    hint: POLYGON_HINT,
    options: [BRUSH_SIZE, BRUSH_SHAPE, FILLED, INK, OPACITY],
    cursor: paintCursor,
    onDown(context, pointer) {
        const { paint, options: values } = context;
        if (!paint) return;
        if (!traces.has(context)) {
            // The first press opens the gesture; the image as it found it is what the ink
            // reads and what each draw puts back.
            traces.set(context, {
                stroke: new ShapeStroke(paint.image, clonePixelBuffer(paint.image), {
                    brush: brushOf(values),
                    ink: paintInk(inkOf(values), context.colour, opacityOf(values)),
                }),
                filled: values[FILLED.key] === true,
                vertices: [],
            });
            context.openGesture();
        }
        at(context, pointer, true);
    },
    onMove: (context, pointer) => at(context, pointer, false),
    onUp: (context, pointer) => at(context, pointer, true),
    onHover: (context, pointer) => at(context, pointer, false),
    onClose(context) {
        const trace = traces.get(context);
        traces.delete(context);
        // Through the vertices: the pointer's pending vertex goes.
        if (trace) draw(context, trace, trace.vertices);
    },
    onCancel(context) {
        traces.delete(context);
    },
};

export const tools: ToolSpec[] = [polygonTool];
