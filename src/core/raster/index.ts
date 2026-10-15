// Raster operations of the paint tools (SPEC §7.1): Bresenham lines, brush stamps, the
// pixel-perfect filter, inks, and brush strokes that join pointer samples with lines (SE-015);
// ellipses, the shapes of the shape tools drawn as rubber bands, and flood fill (SE-017).

export {
    BRUSH_MAX_SIZE,
    BRUSH_MIN_SIZE,
    brushBounds,
    brushCovers,
    brushRuns,
    createBrush,
} from "./brush";
export type { Brush, BrushShape } from "./brush";
export { ELLIPSE_MAX_SIDE, ellipsePixels, ellipseSpans, forEachEllipsePixel } from "./ellipse";
export { FLOOD_MAX_TOLERANCE, floodMask, paintMask } from "./flood";
export type { FloodOptions } from "./flood";
export { eraseInk, inkPixel, paintInk } from "./ink";
export type { Ink, InkKind } from "./ink";
export { forEachLinePixel, linePixels } from "./line";
export type { PixelPoint } from "./line";
export { isLCorner, PixelPerfectFilter, pixelPerfectPath } from "./pixelPerfect";
export type { PixelPerfectStep } from "./pixelPerfect";
export { forEachFilledRun, forEachOutlinePixel, sameShape } from "./shape";
export type { Shape, ShapeKind } from "./shape";
export { ShapeStroke } from "./shapeStroke";
export type { ShapeStrokeOptions } from "./shapeStroke";
export { FreehandStroke, StraightStroke } from "./stroke";
export type { BrushStrokeOptions } from "./stroke";
