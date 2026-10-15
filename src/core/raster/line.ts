// Lines of pixels (SPEC §7.1, SE-015): Bresenham's algorithm, in the all-octant form of Alois
// Zingl ("A Rasterizing Algorithm for Drawing Curves", 2012). The line runs from the first
// point to the last, both included; each pixel after the first is one of the 8 neighbours of
// the one before it, so a line has no gap. Integer arithmetic only.

/** A pixel position: whole numbers, which may lie outside any image. */
export interface PixelPoint {
    readonly x: number;
    readonly y: number;
}

function assertWhole(...values: number[]): void {
    if (!values.every(Number.isSafeInteger)) {
        throw new RangeError(`Line ends must be whole numbers, got ${values.join(", ")}.`);
    }
}

/**
 * Calls `visit` for every pixel of the line from `x0, y0` to `x1, y1`, in order, both ends
 * included. Throws `RangeError` when an end is not a whole number.
 */
export function forEachLinePixel(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    visit: (x: number, y: number) => void,
): void {
    assertWhole(x0, y0, x1, y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
        visit(x, y);
        if (x === x1 && y === y1) return;
        const doubled = 2 * error;
        if (doubled >= dy) {
            error += dy;
            x += sx;
        }
        if (doubled <= dx) {
            error += dx;
            y += sy;
        }
    }
}

/** The pixels of the line from `from` to `to`, in order, both ends included. */
export function linePixels(from: PixelPoint, to: PixelPoint): PixelPoint[] {
    const pixels: PixelPoint[] = [];
    forEachLinePixel(from.x, from.y, to.x, to.y, (x, y) => void pixels.push({ x, y }));
    return pixels;
}
