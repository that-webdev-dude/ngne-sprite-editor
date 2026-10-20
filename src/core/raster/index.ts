// Raster operations of the paint tools (SPEC §7.1): Bresenham lines, brush stamps, the
// pixel-perfect filter, inks, and brush strokes that join pointer samples with lines (SE-015);
// ellipses, the shapes of the shape tools drawn as rubber bands, and flood fill (SE-017);
// curves, polygons, the contour and the spray (SE-065); symmetry and tiled wrap (SE-062).

export {
    BRUSH_MAX_SIZE,
    BRUSH_MIN_SIZE,
    brushBounds,
    brushCovers,
    brushRuns,
    createBrush,
} from "./brush";
export type { Brush, BrushShape } from "./brush";
export { ContourStroke } from "./contour";
export type { ContourStrokeOptions } from "./contour";
export {
    CURVE_MAX_COORDINATE,
    CURVE_MAX_POINTS,
    CURVE_MIN_POINTS,
    curveSampleCount,
    curveSamples,
    forEachCurvePixel,
} from "./curve";
export { ELLIPSE_MAX_SIDE, ellipsePixels, ellipseSpans, forEachEllipsePixel } from "./ellipse";
export { FLOOD_MAX_TOLERANCE, floodMask, paintMask } from "./flood";
export type { FloodOptions } from "./flood";
export { eraseInk, inkPixel, paintInk } from "./ink";
export type { Ink, InkKind } from "./ink";
export { forEachLinePixel, linePixels } from "./line";
export type { PixelPoint } from "./line";
export { isLCorner, PixelPerfectFilter, pixelPerfectPath } from "./pixelPerfect";
export type { PixelPerfectStep } from "./pixelPerfect";
export { forEachPolygonOutlinePixel, forEachPolygonRun, POLYGON_MAX_COORDINATE } from "./polygon";
export { copyShape, forEachFilledRun, forEachOutlinePixel, sameShape } from "./shape";
export type { CurveShape, PathShape, PolygonShape, Shape, ShapeKind } from "./shape";
export { ShapeStroke } from "./shapeStroke";
export type { ShapeStrokeOptions } from "./shapeStroke";
export {
    brushArea,
    createRandom,
    SPRAY_MAX_DENSITY,
    SPRAY_MAX_RADIUS,
    SPRAY_MIN_DENSITY,
    SPRAY_MIN_RADIUS,
    sprayDiskArea,
    SprayStroke,
} from "./spray";
export type { SprayStrokeOptions } from "./spray";
export { FreehandStroke, Stamper, StraightStroke } from "./stroke";
export {
    forEachSymmetricRun,
    strokeSymmetry,
    symmetricFloodMask,
    symmetricPoints,
    symmetricRows,
} from "./symmetry";
export type { RunVisitor, StrokeSymmetry } from "./symmetry";
export type { BrushStrokeOptions } from "./stroke";
