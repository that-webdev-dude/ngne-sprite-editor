import { Bean } from "lucide-react";
import { clonePixelBuffer } from "../../../core/pixels";
import { ContourStroke } from "../../../core/raster";
import type { Rect } from "../../../core/model";
import { BRUSH_SHAPE, BRUSH_SIZE, INK, OPACITY, paintCursor } from "../brush/brushOptions";
import { paintStrokeOptions } from "../brush/strokeOptions";
import type { ToolContext, ToolSpec } from "../types";

// The contour (SPEC §7.1, SE-065): a freehand closed shape, filled. While the button is held
// the brush draws the pointer's path as the pencil's does (a point for the press and for each
// sample on another pixel than the point before, joined by lines); the release closes the path
// and fills it (`core/raster/contour.ts`): the polygon tool's filled polygon through the same
// points. One undo step; Escape during the drag takes it back. A variant of the rectangle's
// rail slot (D; D and Shift+D switch between the contour and the polygon, DESIGN §5.1).

/** The contour in progress, by the context of its stroke. */
const strokes = new WeakMap<ToolContext, ContourStroke>();

function report(context: ToolContext, changed: Rect | null): void {
    if (changed) context.paint?.markDirty(changed);
}

export const contourTool: ToolSpec = {
    id: "contour",
    label: "Contour",
    icon: Bean,
    shortcut: "D",
    variantOf: "rectangle",
    railOrder: 211,
    paints: true,
    options: [BRUSH_SIZE, BRUSH_SHAPE, INK, OPACITY],
    cursor: paintCursor,
    onDown(context, pointer) {
        const { paint } = context;
        if (!paint) return;
        // The image as the stroke found it, which the ink reads.
        const stroke = new ContourStroke(
            paint.image,
            clonePixelBuffer(paint.image),
            paintStrokeOptions(context),
        );
        strokes.set(context, stroke);
        report(context, stroke.to(pointer.pixel));
    },
    onMove(context, pointer) {
        const stroke = strokes.get(context);
        if (stroke) report(context, stroke.to(pointer.pixel));
    },
    onUp(context, pointer) {
        const stroke = strokes.get(context);
        if (!stroke) return;
        strokes.delete(context);
        report(context, stroke.to(pointer.pixel));
        report(context, stroke.close());
    },
    onCancel(context) {
        strokes.delete(context);
    },
};

export const tools: ToolSpec[] = [contourTool];
