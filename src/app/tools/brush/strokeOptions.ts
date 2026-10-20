import { paintInk, strokeSymmetry } from "../../../core/raster";
import type { Brush, Ink, StrokeSymmetry } from "../../../core/raster";
import type { ToolContext } from "../types";
import { brushOf, inkOf, opacityOf } from "./brushOptions";

// The options of a paint stroke as the curve, the polygon, the contour and the spray take them
// from their stroke's context (SE-065): the brush of the tool's size and shape, its ink in the
// colour of the button at the tool's opacity, and the document's symmetry and tiled mode
// (SE-062). Each of those tools spreads this whole set into its stroke (`ShapeStroke`,
// `ContourStroke`, `SprayStroke`), so the symmetry reaches all four without an edit to them;
// the shape tools take the same set, and the pencil and the eraser add `strokeSymmetryOf`.

export interface PaintStrokeOptions {
    brush: Brush;
    ink: Ink;
    /** The document's symmetry and tiled wrap at the press; null for none. */
    symmetry: StrokeSymmetry | null;
}

/**
 * The symmetry and tiled wrap a stroke of `context` paints with (SE-062): those of its
 * document's settings, read at the press, so a change during a stroke applies from the next.
 */
export function strokeSymmetryOf(context: ToolContext): StrokeSymmetry | null {
    return strokeSymmetry(context.session.doc.settings);
}

/** The options of a paint stroke of `context`'s tool. */
export function paintStrokeOptions(context: ToolContext): PaintStrokeOptions {
    const values = context.options;
    return {
        brush: brushOf(values),
        ink: paintInk(inkOf(values), context.colour, opacityOf(values)),
        symmetry: strokeSymmetryOf(context),
    };
}
