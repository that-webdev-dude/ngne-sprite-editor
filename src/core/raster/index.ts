// Raster operations of the paint tools (SPEC §7.1): Bresenham lines, brush stamps, the
// pixel-perfect filter, inks, and brush strokes that join pointer samples with lines (SE-015).

export {
    BRUSH_MAX_SIZE,
    BRUSH_MIN_SIZE,
    brushBounds,
    brushCovers,
    brushRuns,
    createBrush,
} from "./brush";
export type { Brush, BrushShape } from "./brush";
export { eraseInk, inkPixel, paintInk } from "./ink";
export type { Ink, InkKind } from "./ink";
export { forEachLinePixel, linePixels } from "./line";
export type { PixelPoint } from "./line";
export { isLCorner, PixelPerfectFilter, pixelPerfectPath } from "./pixelPerfect";
export type { PixelPerfectStep } from "./pixelPerfect";
export { FreehandStroke, StraightStroke } from "./stroke";
export type { BrushStrokeOptions } from "./stroke";
