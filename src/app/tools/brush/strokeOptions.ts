import { paintInk } from "../../../core/raster";
import type { Brush, Ink } from "../../../core/raster";
import type { ToolContext } from "../types";
import { brushOf, inkOf, opacityOf } from "./brushOptions";

// The options of a paint stroke as the curve, the polygon, the contour and the spray take them
// from their stroke's context (SE-065): the brush of the tool's size and shape, and its ink in
// the colour of the button at the tool's opacity. Each of those tools spreads this whole set
// into its stroke (`ShapeStroke`, `ContourStroke`, `SprayStroke`), so an option a later ticket
// adds here (SE-062's symmetry) reaches all four without an edit to them.

export interface PaintStrokeOptions {
    brush: Brush;
    ink: Ink;
}

/** The options of a paint stroke of `context`'s tool. */
export function paintStrokeOptions(context: ToolContext): PaintStrokeOptions {
    const values = context.options;
    return {
        brush: brushOf(values),
        ink: paintInk(inkOf(values), context.colour, opacityOf(values)),
    };
}
