import type { BitMask, Rect } from "../model";
import { forEachLinePixel } from "../raster";
import type { PixelPoint } from "../raster";
import { createMask, setMaskPixel, setMaskRun } from "./mask";

// Masks of the shapes the selection tools make (SE-030; the tools are SE-031's): a
// rectangle, an ellipse and a polygon, each on a canvas of `width` × `height` and clipped to
// it. A flood mask needs no conversion: it is a mask already (`selectionOf`).

/** The largest side of an ellipse's rectangle for which its arithmetic stays exact. */
export const MAX_ELLIPSE_SIDE = 65536;

function assertRect(rect: Rect, caller: string): void {
    const values = [rect.x, rect.y, rect.width, rect.height];
    if (!values.every(Number.isSafeInteger) || rect.width < 0 || rect.height < 0) {
        throw new RangeError(
            `${caller}: a rectangle has whole coordinates and a size of 0 or more, got ` +
                `${values.join(", ")}.`,
        );
    }
}

/** The pixels of `rect` (document pixels, whole numbers) that lie on the canvas. */
export function rectMask(width: number, height: number, rect: Rect): BitMask {
    assertRect(rect, "rectMask");
    const mask = createMask(width, height);
    const top = Math.max(0, rect.y);
    const bottom = Math.min(height, rect.y + rect.height);
    for (let y = top; y < bottom; y++) setMaskRun(mask, y, rect.x, rect.x + rect.width);
    return mask;
}

/**
 * The first column and the column after the last of each row of the filled ellipse that fits
 * a `w` × `h` rectangle, rows top first, columns from the rectangle's left. Alois Zingl's
 * `plotEllipseRect` ("A Rasterizing Algorithm for Drawing Curves", 2012) for the corners
 * (0, 0) and (w − 1, h − 1), with every pixel between the outline's two pixels of a row: the
 * shape of SE-015's circle brush for a square, here for any rectangle. Every value stays below
 * 2^53 up to `MAX_ELLIPSE_SIDE`, so the doubles hold them exactly.
 */
export function ellipseRows(w: number, h: number): { starts: Int32Array; ends: Int32Array } {
    const starts = new Int32Array(h).fill(w);
    const ends = new Int32Array(h).fill(0);
    if (w === 0 || h === 0) return { starts, ends };
    const plot = (x: number, y: number) => {
        if (y < 0 || y >= h) return;
        starts[y] = Math.min(starts[y], x);
        ends[y] = Math.max(ends[y], x + 1);
    };
    let x0 = 0;
    let x1 = w - 1;
    let a = w - 1;
    const b = h - 1;
    let b1 = b & 1;
    let dx = 4 * (1 - a) * b * b;
    let dy = 4 * (b1 + 1) * a * a;
    let error = dx + dy + b1 * a * a;
    let y0 = Math.floor((b + 1) / 2);
    let y1 = y0 - b1;
    a *= 8 * a;
    b1 = 8 * b * b;
    do {
        plot(x1, y0);
        plot(x0, y0);
        plot(x0, y1);
        plot(x1, y1);
        const doubled = 2 * error;
        if (doubled <= dy) {
            y0++;
            y1--;
            dy += a;
            error += dy;
        }
        if (doubled >= dx || 2 * error > dy) {
            x0++;
            x1--;
            dx += b1;
            error += dx;
        }
    } while (x0 <= x1);
    // Flat ellipses stop early: their tips are finished here, down to rows 0 and b. `y0` and
    // `y1` are the next rows to plot and `y0 + y1 = b`, so rows b and 0 are plotted in the
    // pass that starts at `y0 - y1 = b`: the condition is Zingl's `<=`. (SE-015's circle
    // brush stops at `<`, which gives the same rows for every square, as the tests check, but
    // leaves the end rows of an ellipse 1 pixel wide empty.)
    while (y0 - y1 <= b) {
        plot(x0 - 1, y0);
        plot(x1 + 1, y0++);
        plot(x0 - 1, y1);
        plot(x1 + 1, y1--);
    }
    return { starts, ends };
}

/**
 * The pixels of the filled ellipse that fits `rect` (see `ellipseRows`) that lie on the
 * canvas. Throws `RangeError` for a side above `MAX_ELLIPSE_SIDE`.
 */
export function ellipseMask(width: number, height: number, rect: Rect): BitMask {
    assertRect(rect, "ellipseMask");
    if (rect.width > MAX_ELLIPSE_SIDE || rect.height > MAX_ELLIPSE_SIDE) {
        throw new RangeError(
            `ellipseMask: a side is at most ${MAX_ELLIPSE_SIDE} pixels, got ` +
                `${rect.width} × ${rect.height}.`,
        );
    }
    const mask = createMask(width, height);
    const { starts, ends } = ellipseRows(rect.width, rect.height);
    for (let row = 0; row < rect.height; row++) {
        if (ends[row] > starts[row]) {
            setMaskRun(mask, rect.y + row, rect.x + starts[row], rect.x + ends[row]);
        }
    }
    return mask;
}

/**
 * The pixels of a closed polygon through `points` (document pixels, in order; the last joins
 * the first) that lie on the canvas: its outline, the Bresenham line of each side, and every
 * pixel whose centre lies inside it by the even-odd rule, as Aseprite's lasso fills its
 * contour. A polygon of fewer than 3 points encloses nothing and gives an empty mask.
 * Throws `RangeError` when a point is not a whole number.
 */
export function polygonMask(width: number, height: number, points: readonly PixelPoint[]): BitMask {
    const mask = createMask(width, height);
    if (points.length < 3) return mask;
    const count = points.length;
    for (let index = 0; index < count; index++) {
        const from = points[index];
        const to = points[(index + 1) % count];
        forEachLinePixel(from.x, from.y, to.x, to.y, (x, y) => setMaskPixel(mask, x, y));
    }
    // The vertices are pixel centres, so the centre of a pixel of row `y` lies on the line
    // `y` of the vertices' coordinates; a side counts on a row from its upper end up to, not
    // including, its lower end.
    let top = Infinity;
    let bottom = -Infinity;
    for (const point of points) {
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
    }
    const crossings: number[] = [];
    for (let y = Math.max(0, top); y <= Math.min(height - 1, bottom); y++) {
        crossings.length = 0;
        for (let index = 0; index < count; index++) {
            const a = points[index];
            const b = points[(index + 1) % count];
            if (a.y > y === b.y > y) continue;
            crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
        crossings.sort((p, q) => p - q);
        for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
            setMaskRun(mask, y, Math.ceil(crossings[pair]), Math.floor(crossings[pair + 1]) + 1);
        }
    }
    return mask;
}
