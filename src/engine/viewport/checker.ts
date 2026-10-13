import type { PixelBuffer } from "../../core/model";
import type { ViewportChecker } from "./types";

// The checkerboard behind transparent pixels. NGNE's clear colour is opaque and its sampler
// clamps (SPEC §6.2 #6, #8), so the pattern is an image at document resolution in the slot
// `ed:checker`, drawn under the frame.

/**
 * A `width` × `height` image of opaque squares, `checker.size` document pixels on a side,
 * starting with colour `a` at the top-left. Throws `RangeError` for a size that is not a
 * positive integer.
 */
export function checkerPixels(
    width: number,
    height: number,
    checker: ViewportChecker,
): PixelBuffer {
    const { size } = checker;
    if (![width, height, size].every((value) => Number.isInteger(value) && value >= 1)) {
        throw new RangeError(
            `A checkerboard needs positive integer sizes, got ${width}×${height} in squares ` +
                `of ${size}.`,
        );
    }
    // Two rows of pixels, one starting with each colour; every image row is a copy of one.
    const rowBytes = width * 4;
    const rows = [new Uint8ClampedArray(rowBytes), new Uint8ClampedArray(rowBytes)];
    for (let x = 0; x < width; x++) {
        const first = Math.floor(x / size) % 2 === 0;
        for (const [index, row] of rows.entries()) {
            const colour = first === (index === 0) ? checker.a : checker.b;
            const at = x * 4;
            row[at] = (colour >>> 16) & 255;
            row[at + 1] = (colour >>> 8) & 255;
            row[at + 2] = colour & 255;
            row[at + 3] = 255;
        }
    }
    const data = new Uint8ClampedArray(rowBytes * height);
    for (let y = 0; y < height; y++) {
        data.set(rows[Math.floor(y / size) % 2] ?? rows[0], y * rowBytes);
    }
    return { width, height, data };
}

/** Identifies a checker image: two images with the same spec have the same pixels. */
export function checkerSpec(width: number, height: number, checker: ViewportChecker): string {
    return `${width}x${height}/${checker.size}/${checker.a.toString(16)}/${checker.b.toString(16)}`;
}
