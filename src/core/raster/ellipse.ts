// Ellipses (SPEC §7.1, SE-017): the ellipse that fits a rectangle exactly, for odd and even
// sides alike. A midpoint algorithm with integer error terms on the rectangle's corners, Alois
// Zingl's `plotEllipseRect` ("A Rasterizing Algorithm for Drawing Curves", 2012): the outline
// pixels nearest the ideal curve, which touch all four sides of the rectangle and no pixel
// outside it, symmetric about both axes. A centre and radii, as the textbook midpoint
// algorithm takes them, would allow odd sides only. The tips of flat ellipses are finished
// while y0 − y1 ≤ b (Zingl's `<=`), so every row of the rectangle has pixels.
//
// The filled ellipse is every pixel between a row's outline pixels: the same pixels as the
// ellipse mask of the selection (`core/selection`, `ellipseRows`, SE-030), so the ellipse tool
// and the elliptical marquee cover one shape. SE-015's circle brush keeps its own code.

import type { PixelPoint } from "./line";

/** The largest side of an ellipse's rectangle for which its arithmetic stays exact. */
export const ELLIPSE_MAX_SIDE = 65536;

/** The rectangle with corners `x0, y0` and `x1, y1` (both included), checked. */
function corners(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): { left: number; top: number; right: number; bottom: number } {
    if (![x0, y0, x1, y1].every(Number.isSafeInteger)) {
        throw new RangeError(
            `Ellipse corners must be whole numbers, got ${x0}, ${y0}, ${x1}, ${y1}.`,
        );
    }
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    if (right - left + 1 > ELLIPSE_MAX_SIDE || bottom - top + 1 > ELLIPSE_MAX_SIDE) {
        throw new RangeError(
            `An ellipse's side is at most ${ELLIPSE_MAX_SIDE} pixels, got ` +
                `${right - left + 1} × ${bottom - top + 1}.`,
        );
    }
    return { left, top, right, bottom };
}

/**
 * Calls `visit` for every pixel of the outline of the ellipse that fits the rectangle with
 * corners `x0, y0` and `x1, y1` (both included, in either order). A pixel may be visited more
 * than once. Throws `RangeError` for a corner that is not a whole number or a side above
 * `ELLIPSE_MAX_SIDE`; every value then stays below 2^53, so the doubles hold them exactly.
 */
export function forEachEllipsePixel(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    visit: (x: number, y: number) => void,
): void {
    const { left, top, right, bottom } = corners(x0, y0, x1, y1);
    let a = right - left;
    const b = bottom - top;
    let b1 = b & 1;
    let dx = 4 * (1 - a) * b * b;
    let dy = 4 * (b1 + 1) * a * a;
    let error = dx + dy + b1 * a * a;
    let xl = left;
    let xr = right;
    // The two middle rows: the same row for an odd height.
    let yd = top + Math.floor((b + 1) / 2);
    let yu = yd - b1;
    a *= 8 * a;
    b1 = 8 * b * b;
    do {
        visit(xr, yd);
        visit(xl, yd);
        visit(xl, yu);
        visit(xr, yu);
        const doubled = 2 * error;
        if (doubled <= dy) {
            yd++;
            yu--;
            dy += a;
            error += dy;
        }
        if (doubled >= dx || 2 * error > dy) {
            xl++;
            xr--;
            dx += b1;
            error += dx;
        }
    } while (xl <= xr);
    // Flat ellipses stop early: their tips are finished here, down to the top and bottom rows.
    while (yd - yu <= b) {
        visit(xl - 1, yd);
        visit(xr + 1, yd++);
        visit(xl - 1, yu);
        visit(xr + 1, yu--);
    }
}

/**
 * The outline pixels of the ellipse that fits the rectangle with corners `from` and `to` (both
 * included), each once, row by row.
 */
export function ellipsePixels(from: PixelPoint, to: PixelPoint): PixelPoint[] {
    const seen = new Set<string>();
    const pixels: PixelPoint[] = [];
    forEachEllipsePixel(from.x, from.y, to.x, to.y, (x, y) => {
        const key = `${x},${y}`;
        if (seen.has(key)) return;
        seen.add(key);
        pixels.push({ x, y });
    });
    return pixels.sort((p, q) => p.y - q.y || p.x - q.x);
}

/**
 * The first column and the column after the last of each row of the filled ellipse that fits
 * a `width` × `height` rectangle, rows top first, columns from the rectangle's left: every
 * pixel between the outline's two pixels of a row.
 */
export function ellipseSpans(
    width: number,
    height: number,
): { starts: Int32Array; ends: Int32Array } {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new RangeError(
            `An ellipse is at least 1 × 1 whole pixels, got ${width} × ${height}.`,
        );
    }
    const starts = new Int32Array(height).fill(width);
    const ends = new Int32Array(height).fill(0);
    forEachEllipsePixel(0, 0, width - 1, height - 1, (x, y) => {
        if (x < starts[y]) starts[y] = x;
        if (x + 1 > ends[y]) ends[y] = x + 1;
    });
    return { starts, ends };
}
