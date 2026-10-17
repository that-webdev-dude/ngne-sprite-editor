import { forEachCurvePixel } from "./curve";
import { ellipseSpans, forEachEllipsePixel } from "./ellipse";
import { forEachLinePixel } from "./line";
import type { PixelPoint } from "./line";
import { forEachPolygonOutlinePixel, forEachPolygonRun } from "./polygon";

// The shapes of the shape tools (SPEC §7.1, SE-017): a line between two pixels, and the
// rectangle and the ellipse that fit the rectangle of two opposite corners, both corners
// included, as outlines or filled. A shape is drawn by stamping a brush along its outline
// (`ShapeStroke`); a filled one also covers every pixel inside the outline. Pure geometry.
//
// SE-065 adds the shapes through points (`PathShape`): the curve tool's cubic Bézier
// (`curve.ts`) and the polygon tool's closed polygon (`polygon.ts`), outline or filled.

export type ShapeKind = "line" | "rectangle" | "ellipse";

export interface Shape {
    readonly kind: ShapeKind;
    /** The line's first end, or a corner of the shape's rectangle. */
    readonly from: PixelPoint;
    /** The line's last end, or the corner opposite `from`. */
    readonly to: PixelPoint;
    /** Rectangle and ellipse: the pixels inside the outline as well. A line has no inside. */
    readonly filled: boolean;
}

/** The curve tool's cubic Bézier (SE-065): start, first control, second control, end. */
export interface CurveShape {
    readonly kind: "curve";
    /** Exactly 4 points. */
    readonly points: readonly PixelPoint[];
}

/** The polygon tool's closed polygon through its points (SE-065), outline or filled. */
export interface PolygonShape {
    readonly kind: "polygon";
    readonly points: readonly PixelPoint[];
    /** The pixels inside the outline as well (3 points or more). */
    readonly filled: boolean;
}

/** A shape through points (SE-065). */
export type PathShape = CurveShape | PolygonShape;

const isPath = (shape: Shape | PathShape): shape is PathShape =>
    shape.kind === "curve" || shape.kind === "polygon";

function samePoints(a: readonly PixelPoint[], b: readonly PixelPoint[]): boolean {
    return (
        a.length === b.length &&
        a.every((point, index) => point.x === b[index].x && point.y === b[index].y)
    );
}

/** A copy of `shape` that keeps no reference to the caller's objects. */
export function copyShape(shape: Shape | PathShape): Shape | PathShape {
    switch (shape.kind) {
        case "curve":
            return { kind: "curve", points: shape.points.map(({ x, y }) => ({ x, y })) };
        case "polygon":
            return {
                kind: "polygon",
                points: shape.points.map(({ x, y }) => ({ x, y })),
                filled: shape.filled,
            };
        default:
            return {
                kind: shape.kind,
                from: { x: shape.from.x, y: shape.from.y },
                to: { x: shape.to.x, y: shape.to.y },
                filled: shape.filled,
            };
    }
}

/** Whether two shapes cover the same pixels in the same way. */
export function sameShape(a: Shape | PathShape, b: Shape | PathShape): boolean {
    if (isPath(a) || isPath(b)) {
        if (!isPath(a) || !isPath(b) || a.kind !== b.kind) return false;
        if (a.kind === "polygon" && b.kind === "polygon" && a.filled !== b.filled) return false;
        return samePoints(a.points, b.points);
    }
    return (
        a.kind === b.kind &&
        a.from.x === b.from.x &&
        a.from.y === b.from.y &&
        a.to.x === b.to.x &&
        a.to.y === b.to.y &&
        (a.kind === "line" || a.filled === b.filled)
    );
}

function assertWhole(shape: Shape): void {
    const values = [shape.from.x, shape.from.y, shape.to.x, shape.to.y];
    if (!values.every(Number.isSafeInteger)) {
        throw new RangeError(`A shape's points must be whole numbers, got ${values.join(", ")}.`);
    }
}

/**
 * Calls `visit` for every pixel of the shape's outline, the path its brush is stamped along:
 * the Bresenham line from `from` to `to`, the four sides of the rectangle, or the outline of
 * the ellipse (`ellipse.ts`); the lines of a curve (`curve.ts`); the sides of a polygon
 * (`polygon.ts`). A pixel may be visited more than once.
 */
export function forEachOutlinePixel(
    shape: Shape | PathShape,
    visit: (x: number, y: number) => void,
): void {
    if (shape.kind === "curve") {
        forEachCurvePixel(shape.points, visit);
        return;
    }
    if (shape.kind === "polygon") {
        forEachPolygonOutlinePixel(shape.points, visit);
        return;
    }
    assertWhole(shape);
    const { from, to } = shape;
    switch (shape.kind) {
        case "line":
            forEachLinePixel(from.x, from.y, to.x, to.y, visit);
            return;
        case "rectangle": {
            const left = Math.min(from.x, to.x);
            const right = Math.max(from.x, to.x);
            const top = Math.min(from.y, to.y);
            const bottom = Math.max(from.y, to.y);
            for (let x = left; x <= right; x++) {
                visit(x, top);
                if (bottom !== top) visit(x, bottom);
            }
            for (let y = top + 1; y < bottom; y++) {
                visit(left, y);
                if (right !== left) visit(right, y);
            }
            return;
        }
        case "ellipse":
            forEachEllipsePixel(from.x, from.y, to.x, to.y, visit);
            return;
        default:
            throw new RangeError(`Unknown shape "${String((shape as { kind: unknown }).kind)}".`);
    }
}

/**
 * Calls `visit` with each row of the inside of a filled rectangle or ellipse, outline
 * included, or of a filled polygon (the pixels whose centres lie inside it, `polygon.ts`):
 * row `y`, pixels `[x, end)`. Nothing for a line, a curve or a shape that is not filled. With
 * `firstRow` and `lastRow`, a polygon's rows outside them are not looked at.
 */
export function forEachFilledRun(
    shape: Shape | PathShape,
    visit: (y: number, x: number, end: number) => void,
    firstRow?: number,
    lastRow?: number,
): void {
    if (shape.kind === "curve") return;
    if (shape.kind === "polygon") {
        if (shape.filled) forEachPolygonRun(shape.points, visit, firstRow, lastRow);
        return;
    }
    assertWhole(shape);
    if (!shape.filled || shape.kind === "line") return;
    const left = Math.min(shape.from.x, shape.to.x);
    const top = Math.min(shape.from.y, shape.to.y);
    const width = Math.abs(shape.to.x - shape.from.x) + 1;
    const height = Math.abs(shape.to.y - shape.from.y) + 1;
    if (shape.kind === "rectangle") {
        for (let row = 0; row < height; row++) visit(top + row, left, left + width);
        return;
    }
    const { starts, ends } = ellipseSpans(width, height);
    for (let row = 0; row < height; row++) {
        if (ends[row] > starts[row]) visit(top + row, left + starts[row], left + ends[row]);
    }
}
