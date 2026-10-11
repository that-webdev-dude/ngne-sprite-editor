import { createPixelBuffer } from "./buffer";
import type { PixelBuffer } from "./buffer";

/**
 * New `width` × `height` buffer whose pixel (x, y) is the source pixel with index
 * `pick(x, y)` (row-major, in pixels).
 */
function remap(
    source: PixelBuffer,
    width: number,
    height: number,
    pick: (x: number, y: number) => number,
): PixelBuffer {
    const result = createPixelBuffer(width, height);
    const from = source.data;
    const to = result.data;
    let target = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++, target += 4) {
            const start = pick(x, y) * 4;
            to[target] = from[start];
            to[target + 1] = from[start + 1];
            to[target + 2] = from[start + 2];
            to[target + 3] = from[start + 3];
        }
    }
    return result;
}

/** Mirrored copy: "horizontal" swaps left and right, "vertical" swaps top and bottom. */
export function flipPixels(source: PixelBuffer, axis: "horizontal" | "vertical"): PixelBuffer {
    const { width, height } = source;
    return axis === "horizontal"
        ? remap(source, width, height, (x, y) => y * width + (width - 1 - x))
        : remap(source, width, height, (x, y) => (height - 1 - y) * width + x);
}

/**
 * Copy rotated clockwise by `degrees`; 270 is a quarter turn counter-clockwise. 90 and 270
 * swap width and height.
 */
export function rotatePixels(source: PixelBuffer, degrees: 90 | 180 | 270): PixelBuffer {
    const { width, height } = source;
    switch (degrees) {
        case 90:
            return remap(source, height, width, (x, y) => (height - 1 - x) * width + y);
        case 180:
            return remap(source, width, height, (x, y) => (height - 1 - y) * width + width - 1 - x);
        case 270:
            return remap(source, height, width, (x, y) => x * width + (width - 1 - y));
        default:
            throw new RangeError(
                `Rotation must be 90, 180 or 270 degrees, got ${String(degrees)}.`,
            );
    }
}

/**
 * Copy scaled to `width` × `height` by nearest neighbour: every result pixel takes the source
 * pixel under its centre, so column x reads source column floor((x + 0.5) · source.width /
 * width), and rows likewise. Throws `RangeError` when a side is not a positive integer.
 */
export function resizeNearest(source: PixelBuffer, width: number, height: number): PixelBuffer {
    const nearest = (index: number, count: number, sourceCount: number): number =>
        Math.floor(((2 * index + 1) * sourceCount) / (2 * count));
    return remap(
        source,
        width,
        height,
        (x, y) =>
            nearest(y, height, source.height) * source.width + nearest(x, width, source.width),
    );
}
