import type { Rect } from "../model";

// Brush stamps (SPEC §7.1, SE-015): a square or a circle of 1 to 64 pixels a side. A brush is
// placed by the pixel under the pointer, as in Aseprite: its top-left pixel lies `size / 2`
// (rounded down) pixels up and to the left of it. An odd brush is centred on that pixel; an
// even one has it as the lower right of its four centre pixels.
//
// The circle is the filled ellipse that fits the brush's square exactly, drawn with Alois
// Zingl's ellipse algorithm ("A Rasterizing Algorithm for Drawing Curves", 2012), as Aseprite
// draws its circle brushes: the outline pixels nearest the ideal curve, and every pixel
// between them on each row. Every row of a brush is one run of pixels.

export type BrushShape = "square" | "circle";

/** The smallest and largest brush sizes (SPEC §7.1). */
export const BRUSH_MIN_SIZE = 1;
export const BRUSH_MAX_SIZE = 64;

export interface Brush {
    readonly shape: BrushShape;
    /** Width and height of the brush's square, in pixels. */
    readonly size: number;
    /**
     * Where the brush's top-left pixel lies from the pixel it is placed at, on both axes:
     * `-floor(size / 2)`.
     */
    readonly origin: number;
    /** For each row of the square, top first: the first column of its run. */
    readonly starts: Int32Array;
    /** For each row of the square: the column after the last of its run. */
    readonly ends: Int32Array;
}

/** The first and last column of each row of the filled ellipse that fits `size` × `size`. */
function circleRows(size: number): { starts: Int32Array; ends: Int32Array } {
    const starts = new Int32Array(size).fill(size);
    const ends = new Int32Array(size).fill(0);
    const plot = (x: number, y: number) => {
        if (y < 0 || y >= size) return;
        starts[y] = Math.min(starts[y], x);
        ends[y] = Math.max(ends[y], x + 1);
    };
    // Zingl's `plotEllipseRect` for the rectangle (0, 0)–(size - 1, size - 1). Every value
    // stays below 2^53, so the doubles hold them exactly.
    let x0 = 0;
    let x1 = size - 1;
    let a = size - 1;
    const b = size - 1;
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
    // Flat ellipses stop early; a circle does not, but the tips are finished all the same.
    while (y0 - y1 < b) {
        plot(x0 - 1, y0);
        plot(x1 + 1, y0++);
        plot(x0 - 1, y1);
        plot(x1 + 1, y1--);
    }
    return { starts, ends };
}

/**
 * The brush of `shape` and `size`. Throws `RangeError` for a size that is not a whole number
 * from `BRUSH_MIN_SIZE` to `BRUSH_MAX_SIZE`.
 */
export function createBrush(shape: BrushShape, size: number): Brush {
    if (!Number.isInteger(size) || size < BRUSH_MIN_SIZE || size > BRUSH_MAX_SIZE) {
        throw new RangeError(
            `A brush size must be a whole number from ${BRUSH_MIN_SIZE} to ${BRUSH_MAX_SIZE}, got ${size}.`,
        );
    }
    const rows =
        shape === "circle"
            ? circleRows(size)
            : { starts: new Int32Array(size), ends: new Int32Array(size).fill(size) };
    // `0 -`: never a negative zero.
    return { shape, size, origin: 0 - Math.floor(size / 2), ...rows };
}

/** Whether the brush covers the pixel `column, row` of its square. */
export function brushCovers(brush: Brush, column: number, row: number): boolean {
    if (row < 0 || row >= brush.size) return false;
    return column >= brush.starts[row] && column < brush.ends[row];
}

/** The square the brush covers when it is placed at `x, y`. */
export function brushBounds(brush: Brush, x: number, y: number): Rect {
    return { x: x + brush.origin, y: y + brush.origin, width: brush.size, height: brush.size };
}

/**
 * The pixels the brush covers when placed at `x, y` (its footprint), row by row: for each
 * row, its `y` and the run `[x, end)` of pixels.
 */
export function brushRuns(
    brush: Brush,
    x: number,
    y: number,
): { y: number; x: number; end: number }[] {
    const runs: { y: number; x: number; end: number }[] = [];
    const left = x + brush.origin;
    const top = y + brush.origin;
    for (let row = 0; row < brush.size; row++) {
        runs.push({
            y: top + row,
            x: left + brush.starts[row],
            end: left + brush.ends[row],
        });
    }
    return runs;
}
