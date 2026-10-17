import { forEachLinePixel } from "./line";
import type { PixelPoint } from "./line";

// Curves (SPEC §7.1, SE-065): the cubic Bézier of the curve tool, from its start through two
// control points to its end, drawn as Aseprite draws it (`doc::algo_spline`, after Allegro's
// `calc_spline`; checked in its source): the curve is sampled at `n` points evenly spaced in
// its parameter, where n = ⌊1.2 · √(|P0P1| + |P1P2| + |P2P3|)⌋ held to 4..64, and the samples
// are joined by Bresenham lines. Each sample is rounded to the nearest pixel, halves up.
// Aseprite reaches its samples by forward differencing and truncates `x + 0.5`; here each one
// is evaluated directly, so the first is exactly the start and the last exactly the end, and
// a sample within rounding error of a half may fall on the other pixel.

/** The fewest and the most points a curve is sampled at (Aseprite's `MAX_POINTS`). */
export const CURVE_MIN_POINTS = 4;
export const CURVE_MAX_POINTS = 64;

/** How far from 0 a curve's point may lie, so that its arithmetic stays exact enough. */
export const CURVE_MAX_COORDINATE = 2 ** 24;

function assertPoints(points: readonly PixelPoint[]): void {
    if (points.length !== 4) {
        throw new RangeError(`A curve has 4 points, got ${points.length}.`);
    }
    for (const { x, y } of points) {
        if (
            !Number.isSafeInteger(x) ||
            !Number.isSafeInteger(y) ||
            Math.abs(x) > CURVE_MAX_COORDINATE ||
            Math.abs(y) > CURVE_MAX_COORDINATE
        ) {
            throw new RangeError(
                `A curve's points are whole numbers within ${CURVE_MAX_COORDINATE} of 0, ` +
                    `got ${x}, ${y}.`,
            );
        }
    }
}

const distance = (a: PixelPoint, b: PixelPoint) =>
    Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));

/**
 * How many samples the curve through `points` (start, control, control, end) takes:
 * ⌊1.2 · √(length of its control polygon)⌋, held to `CURVE_MIN_POINTS..CURVE_MAX_POINTS`.
 */
export function curveSampleCount(points: readonly PixelPoint[]): number {
    assertPoints(points);
    const [p0, p1, p2, p3] = points as [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
    const length = distance(p0, p1) + distance(p1, p2) + distance(p2, p3);
    const count = Math.trunc(Math.sqrt(length) * 1.2);
    return Math.min(CURVE_MAX_POINTS, Math.max(CURVE_MIN_POINTS, count));
}

/**
 * The samples of the cubic Bézier through `points` (start, first control, second control,
 * end), in order, each rounded to its pixel; the first is the start and the last the end.
 */
export function curveSamples(points: readonly PixelPoint[]): PixelPoint[] {
    const count = curveSampleCount(points);
    const [p0, p1, p2, p3] = points as [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
    const samples: PixelPoint[] = [];
    for (let index = 0; index < count; index++) {
        const t = index / (count - 1);
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        samples.push({
            x: Math.floor(a * p0.x + b * p1.x + c * p2.x + d * p3.x + 0.5),
            y: Math.floor(a * p0.y + b * p1.y + c * p2.y + d * p3.y + 0.5),
        });
    }
    return samples;
}

/**
 * Calls `visit` for every pixel of the curve through `points`: the Bresenham lines that join
 * its samples, in order, each pixel where two lines meet once.
 */
export function forEachCurvePixel(
    points: readonly PixelPoint[],
    visit: (x: number, y: number) => void,
): void {
    const samples = curveSamples(points);
    const [first] = samples;
    if (!first) return;
    visit(first.x, first.y);
    for (let index = 1; index < samples.length; index++) {
        const from = samples[index - 1];
        const to = samples[index];
        if (from.x === to.x && from.y === to.y) continue;
        let skip = true;
        forEachLinePixel(from.x, from.y, to.x, to.y, (x, y) => {
            // The line's first pixel is the last one visited.
            if (skip) {
                skip = false;
                return;
            }
            visit(x, y);
        });
    }
}
