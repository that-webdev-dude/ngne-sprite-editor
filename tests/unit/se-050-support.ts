import { PackError } from "../../src/core/export";
import type { PackedRect } from "../../src/core/export";
import { cropPixels, createPixelBuffer } from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";

// Shared by the SE-050 tests: small frames written out pixel by pixel, frames of noise, and
// a second way to arrive at an atlas, to compare `pack` against.

// Buffers as rows of characters, as in the SE-005 tests: "." is transparent black, an
// upper-case letter is an opaque colour of its own, and a lower-case letter is the same
// colour with alpha 0.
function colorOf(character: string): number[] {
    if (character === ".") {
        return [0, 0, 0, 0];
    }
    const code = character.toUpperCase().charCodeAt(0);
    return [code, 255 - code, (code * 7) & 0xff, character === character.toUpperCase() ? 255 : 0];
}

const CHARACTERS = ".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function grid(...rows: string[]): PixelBuffer {
    const bytes = rows.flatMap((row) => [...row].flatMap(colorOf));
    return { width: rows[0].length, height: rows.length, data: Uint8ClampedArray.from(bytes) };
}

/** The rows of a buffer made of `grid` colours; any other colour shows as "?". */
export function show(buffer: PixelBuffer): string[] {
    const names = new Map<string, string>();
    for (const character of CHARACTERS) {
        names.set(colorOf(character).join(), character);
    }
    const rows: string[] = [];
    for (let y = 0; y < buffer.height; y++) {
        let row = "";
        for (let x = 0; x < buffer.width; x++) {
            const start = (y * buffer.width + x) * 4;
            row += names.get(buffer.data.subarray(start, start + 4).join()) ?? "?";
        }
        rows.push(row);
    }
    return rows;
}

/**
 * An opaque `width` × `height` frame of noise (a linear congruential generator seeded with
 * `seed`): no two pixels need be alike, and frames of different seeds differ.
 */
export function noise(width: number, height: number, seed: number): PixelBuffer {
    let state = (seed + 1) >>> 0;
    const next = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state >>> 24;
    };
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = next();
        data[i + 1] = next();
        data[i + 2] = next();
        data[i + 3] = 255;
    }
    return { width, height, data };
}

/** The `PackError` that `run` throws. Any other error is passed on; throwing nothing is one. */
export function errorOf(run: () => unknown): PackError {
    try {
        run();
    } catch (error) {
        if (error instanceof PackError) return error;
        throw error;
    }
    throw new Error("Expected a PackError, but nothing was thrown.");
}

/** A copy of `frame` in which every pixel with alpha 0 is 0,0,0,0. */
export function normalizedCopy(frame: PixelBuffer): PixelBuffer {
    const data = frame.data.slice();
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) data.fill(0, i, i + 3);
    }
    return { width: frame.width, height: frame.height, data };
}

/** Describes the first pixel in which two buffers differ, or null when they are byte-equal. */
export function firstDifference(actual: PixelBuffer, expected: PixelBuffer): string | null {
    if (actual.width !== expected.width || actual.height !== expected.height) {
        return `${actual.width}×${actual.height}, expected ${expected.width}×${expected.height}`;
    }
    if (actual.data.length !== expected.data.length) {
        return `${actual.data.length} bytes, expected ${expected.data.length}`;
    }
    for (let at = 0; at < expected.data.length; at += 4) {
        const found = actual.data.subarray(at, at + 4).join();
        const wanted = expected.data.subarray(at, at + 4).join();
        if (found !== wanted) {
            const index = at / 4;
            const x = index % expected.width;
            return `pixel (${x}, ${(index - x) / expected.width}) is ${found}, expected ${wanted}`;
        }
    }
    return null;
}

/** The part of the atlas a rectangle's content occupies: the rectangle without its padding. */
export function contentOf(atlas: PixelBuffer, rect: PackedRect): PixelBuffer {
    return cropPixels(atlas, { x: rect.x, y: rect.y, width: rect.contentW, height: rect.contentH });
}

/** The part of a frame a rectangle shows, after normalization. */
export function sourceOf(frame: PixelBuffer, rect: PackedRect): PixelBuffer {
    return cropPixels(normalizedCopy(frame), {
        x: rect.offsetX,
        y: rect.offsetY,
        width: rect.contentW,
        height: rect.contentH,
    });
}

/**
 * The atlas SPEC §9.2 and §9.4 describe for rectangles at the given places, written one
 * pixel at a time: a rectangle shows its source frame from its offset, is transparent where
 * it reaches past the frame, and is surrounded by `extrude` pixels that repeat its nearest
 * edge pixel; every other pixel is transparent. Throws when two rectangles, gutters
 * included, claim one pixel or when one leaves the atlas.
 */
export function atlasOf(
    width: number,
    height: number,
    rects: readonly PackedRect[],
    frames: readonly PixelBuffer[],
    extrude: number,
): PixelBuffer {
    const atlas = createPixelBuffer(width, height);
    const owner = new Int32Array(width * height).fill(-1);
    rects.forEach((rect, index) => {
        const frame = normalizedCopy(frames[rect.frameIndices[0]]);
        for (let dy = -extrude; dy < rect.h + extrude; dy++) {
            for (let dx = -extrude; dx < rect.w + extrude; dx++) {
                const x = rect.x + dx;
                const y = rect.y + dy;
                if (x < 0 || y < 0 || x >= width || y >= height) {
                    throw new Error(`rect ${index} reaches (${x}, ${y}), outside the atlas`);
                }
                if (owner[y * width + x] !== -1) {
                    throw new Error(
                        `rects ${owner[y * width + x]} and ${index} both cover (${x}, ${y})`,
                    );
                }
                owner[y * width + x] = index;
                // The nearest pixel of the rectangle, then that pixel of the frame.
                const sourceX = rect.offsetX + Math.min(Math.max(dx, 0), rect.w - 1);
                const sourceY = rect.offsetY + Math.min(Math.max(dy, 0), rect.h - 1);
                if (sourceX < frame.width && sourceY < frame.height) {
                    const from = (sourceY * frame.width + sourceX) * 4;
                    atlas.data.set(frame.data.subarray(from, from + 4), (y * width + x) * 4);
                }
            }
        }
    });
    return atlas;
}
