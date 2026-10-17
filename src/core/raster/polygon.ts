import { forEachLinePixel } from "./line";
import type { PixelPoint } from "./line";

// Polygons (SPEC §7.1, SE-065): the closed shape of the polygon and the contour tools through
// their points (document pixels, in order). The outline is the Bresenham line of each side,
// from each point to the next and from the last back to the first; the inside is every pixel
// whose centre lies inside the polygon by the even-odd rule, as `polygonMask` of
// `core/selection` selects it (SE-030), so a filled polygon and the polygon lasso cover one
// shape. Two points are one line and one point a pixel: they enclose nothing.

/** How far from 0 a polygon's point may lie, so that the crossing arithmetic stays exact. */
export const POLYGON_MAX_COORDINATE = 2 ** 24;

function assertPoints(points: readonly PixelPoint[]): void {
    for (const { x, y } of points) {
        if (
            !Number.isSafeInteger(x) ||
            !Number.isSafeInteger(y) ||
            Math.abs(x) > POLYGON_MAX_COORDINATE ||
            Math.abs(y) > POLYGON_MAX_COORDINATE
        ) {
            throw new RangeError(
                `A polygon's points are whole numbers within ${POLYGON_MAX_COORDINATE} of 0, ` +
                    `got ${x}, ${y}.`,
            );
        }
    }
}

/**
 * Calls `visit` for every pixel of the outline of the closed polygon through `points`: the
 * line from each point to the next and, for 3 points or more, from the last to the first.
 * A pixel may be visited more than once.
 */
export function forEachPolygonOutlinePixel(
    points: readonly PixelPoint[],
    visit: (x: number, y: number) => void,
): void {
    assertPoints(points);
    const count = points.length;
    if (count === 0) return;
    if (count === 1) {
        visit(points[0].x, points[0].y);
        return;
    }
    const sides = count === 2 ? 1 : count;
    for (let index = 0; index < sides; index++) {
        const from = points[index];
        const to = points[(index + 1) % count];
        forEachLinePixel(from.x, from.y, to.x, to.y, visit);
    }
}

/**
 * Calls `visit` with each run of the inside of the closed polygon through `points`, row `y`,
 * pixels `[x, end)`: the pixels whose centres lie inside it by the even-odd rule. A side
 * counts on a row from its upper end up to, not including, its lower end. Only the rows
 * `top..bottom` (both included) are looked at. Nothing for fewer than 3 points.
 */
export function forEachPolygonRun(
    points: readonly PixelPoint[],
    visit: (y: number, x: number, end: number) => void,
    top = -POLYGON_MAX_COORDINATE,
    bottom = POLYGON_MAX_COORDINATE,
): void {
    assertPoints(points);
    const count = points.length;
    if (count < 3) return;
    let first = Infinity;
    let last = -Infinity;
    for (const point of points) {
        first = Math.min(first, point.y);
        last = Math.max(last, point.y);
    }
    const crossings: number[] = [];
    for (let y = Math.max(top, first); y <= Math.min(bottom, last); y++) {
        crossings.length = 0;
        for (let index = 0; index < count; index++) {
            const a = points[index];
            const b = points[(index + 1) % count];
            if (a.y > y === b.y > y) continue;
            crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
        crossings.sort((p, q) => p - q);
        for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
            const x = Math.ceil(crossings[pair]);
            const end = Math.floor(crossings[pair + 1]) + 1;
            if (end > x) visit(y, x, end);
        }
    }
}
