import type { BitMask, PixelBuffer, Rect } from "../model";
import { Changes } from "./changes";
import type { Ink } from "./ink";
import type { PixelPoint } from "./line";

// Flood fill (SPEC §7.1, SE-017): the pixels of a source image that match the colour of a
// seed pixel, as a 1-bit mask in the layout of `BitMask` (pixel x, y is bit y · width + x,
// in byte `bit >> 3` at `1 << (bit & 7)`). The paint bucket inks the mask's pixels
// (`paintMask`); the magic wand of SE-031 makes it a selection (`core/selection`,
// `selectionOf`). The source is whatever the caller samples: a layer's image or the
// frame's composite.
//
// A pixel matches when both it and the seed are transparent (alpha 0, whatever their RGB),
// or when each of its four channels differs from the seed's by at most the tolerance: 0 is
// the exact colour, 255 every pixel. Contiguous takes the pixels joined to the seed through
// matching pixels by their edges (4-connected); otherwise every matching pixel. With
// `within` (the selection), a pixel outside it is neither taken nor crossed.
//
// The contiguous fill is a scanline fill with an explicit stack of row spans (Heckbert, "A
// Seed Fill Algorithm", Graphics Gems, 1990), never recursion: a span is filled to its ends
// on its row, and the rows above and below are scanned under it, so a 1024 × 1024 maze runs
// in memory proportional to its spans, not its pixels.

/** The largest tolerance: every pixel matches. */
export const FLOOD_MAX_TOLERANCE = 255;

export interface FloodOptions {
    /** 0..255: the largest difference of any channel from the seed's that still matches. */
    tolerance: number;
    /** Only the matching pixels joined to the seed; otherwise every matching pixel. */
    contiguous: boolean;
    /** The pixels the fill may take, of the source's size; the others it neither takes nor crosses. */
    within?: BitMask | null;
}

function emptyMask(width: number, height: number): BitMask {
    return { width, height, data: new Uint8Array(Math.ceil((width * height) / 8)) };
}

/**
 * The mask of the pixels of `source` that match the colour of `seed` (see the module's
 * comment). Empty when the seed is not a whole pixel of the source or lies outside `within`.
 * Throws `RangeError` for a tolerance that is not a whole number from 0 to 255, or a `within`
 * of another size.
 */
export function floodMask(source: PixelBuffer, seed: PixelPoint, options: FloodOptions): BitMask {
    const { width, height, data } = source;
    const { tolerance, contiguous } = options;
    const within = options.within ?? null;
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > FLOOD_MAX_TOLERANCE) {
        throw new RangeError(
            `A tolerance is a whole number from 0 to ${FLOOD_MAX_TOLERANCE}, got ${tolerance}.`,
        );
    }
    if (within && (within.width !== width || within.height !== height)) {
        throw new RangeError(
            `A flood's limit is ${within.width}×${within.height}; its source is ${width}×${height}.`,
        );
    }
    const mask = emptyMask(width, height);
    const bits = mask.data;
    const { x: sx, y: sy } = seed;
    if (!Number.isInteger(sx) || !Number.isInteger(sy)) return mask;
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) return mask;
    const limit = within?.data ?? null;
    if (limit) {
        const bit = sy * width + sx;
        if ((limit[bit >> 3] & (1 << (bit & 7))) === 0) return mask;
    }

    const seedAt = (sy * width + sx) * 4;
    const r = data[seedAt];
    const g = data[seedAt + 1];
    const b = data[seedAt + 2];
    const a = data[seedAt + 3];
    /** Whether pixel `index` matches the seed and may be taken. */
    const matches = (index: number): boolean => {
        if (limit && (limit[index >> 3] & (1 << (index & 7))) === 0) return false;
        const at = index * 4;
        const alpha = data[at + 3];
        if (alpha === 0 && a === 0) return true;
        if (tolerance === 0) {
            return data[at] === r && data[at + 1] === g && data[at + 2] === b && alpha === a;
        }
        return (
            Math.abs(data[at] - r) <= tolerance &&
            Math.abs(data[at + 1] - g) <= tolerance &&
            Math.abs(data[at + 2] - b) <= tolerance &&
            Math.abs(alpha - a) <= tolerance
        );
    };

    if (!contiguous) {
        const count = width * height;
        for (let index = 0; index < count; index++) {
            if (matches(index)) bits[index >> 3] |= 1 << (index & 7);
        }
        return mask;
    }

    /** Not taken yet, and matching. */
    const open = (index: number): boolean =>
        (bits[index >> 3] & (1 << (index & 7))) === 0 && matches(index);
    const take = (row: number, from: number, to: number) => {
        for (let index = row + from; index <= row + to; index++) {
            bits[index >> 3] |= 1 << (index & 7);
        }
    };

    // Spans to scan: the row `y + dy` under the span `x1..x2` (inclusive) of row `y`.
    const stack: number[] = [];
    {
        const row = sy * width;
        let left = sx;
        while (left > 0 && open(row + left - 1)) left--;
        let right = sx;
        while (right < width - 1 && open(row + right + 1)) right++;
        take(row, left, right);
        stack.push(left, right, sy, 1, left, right, sy, -1);
    }
    while (stack.length > 0) {
        const dy = stack.pop()!;
        const y = stack.pop()!;
        const x2 = stack.pop()!;
        const x1 = stack.pop()!;
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const row = ny * width;
        let x = x1;
        while (x <= x2) {
            if (!open(row + x)) {
                x++;
                continue;
            }
            let left = x;
            while (left > 0 && open(row + left - 1)) left--;
            let right = x;
            while (right < width - 1 && open(row + right + 1)) right++;
            take(row, left, right);
            stack.push(left, right, ny, dy);
            // Where the span reaches past its parent, the row it came from is scanned there.
            if (left < x1) stack.push(left, x1 - 1, ny, -dy);
            if (right > x2) stack.push(x2 + 1, right, ny, -dy);
            x = right + 2;
        }
    }
    return mask;
}

/**
 * Inks every pixel of `image` that `mask` (of the image's size) sets, each from its value in
 * `original`; `original` may be `image` itself, since each pixel is read once, before it is
 * written. Returns the rectangle of the pixels whose bytes changed, or null.
 */
export function paintMask(
    image: PixelBuffer,
    original: PixelBuffer,
    mask: BitMask,
    ink: Ink,
): Rect | null {
    const { width, height, data } = image;
    if (
        mask.width !== width ||
        mask.height !== height ||
        original.width !== width ||
        original.height !== height ||
        original.data.length !== data.length
    ) {
        throw new RangeError(
            `paintMask: the mask is ${mask.width}×${mask.height} and the original ` +
                `${original.width}×${original.height}; the image is ${width}×${height}.`,
        );
    }
    const bits = mask.data;
    const source = original.data;
    const changes = new Changes();
    const count = width * height;
    for (let index = 0; index < count; index++) {
        const byte = bits[index >> 3];
        // A byte of 0 skips its 8 pixels.
        if (byte === 0 && (index & 7) === 0) {
            index += 7;
            continue;
        }
        if ((byte & (1 << (index & 7))) === 0) continue;
        if (ink.apply(data, source, index * 4))
            changes.add(index % width, Math.floor(index / width));
    }
    return changes.rect();
}
