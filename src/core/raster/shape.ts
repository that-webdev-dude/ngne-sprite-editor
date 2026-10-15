import { ellipseSpans, forEachEllipsePixel } from "./ellipse";
import { forEachLinePixel } from "./line";
import type { PixelPoint } from "./line";

// The shapes of the shape tools (SPEC §7.1, SE-017): a line between two pixels, and the
// rectangle and the ellipse that fit the rectangle of two opposite corners, both corners
// included, as outlines or filled. A shape is drawn by stamping a brush along its outline
// (`ShapeStroke`); a filled one also covers every pixel inside the outline. Pure geometry.

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

/** Whether two shapes cover the same pixels in the same way. */
export function sameShape(a: Shape, b: Shape): boolean {
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
 * the ellipse (`ellipse.ts`). A pixel may be visited more than once.
 */
export function forEachOutlinePixel(shape: Shape, visit: (x: number, y: number) => void): void {
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
            throw new RangeError(`Unknown shape "${String(shape.kind)}".`);
    }
}

/**
 * Calls `visit` with each row of the inside of a filled rectangle or ellipse, outline
 * included: row `y`, pixels `[x, end)`. Nothing for a line or a shape that is not filled.
 */
export function forEachFilledRun(
    shape: Shape,
    visit: (y: number, x: number, end: number) => void,
): void {
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
