import type { PixelBuffer } from "../../src/core/pixels";

// Shared by the SE-043 tests: small fixtures written out pixel by pixel.

/** A buffer `width` pixels wide from 0xRRGGBBAA colours in row-major order. */
export function image(width: number, colors: readonly number[]): PixelBuffer {
    const data = new Uint8ClampedArray(colors.length * 4);
    colors.forEach((color, i) => {
        data[i * 4] = color >>> 24;
        data[i * 4 + 1] = (color >>> 16) & 0xff;
        data[i * 4 + 2] = (color >>> 8) & 0xff;
        data[i * 4 + 3] = color & 0xff;
    });
    return { width, height: colors.length / width, data };
}

/** The pixels as 0xRRGGBBAA numbers in row-major order. */
export function colorsOf(buffer: PixelBuffer): number[] {
    const view = new DataView(buffer.data.buffer, buffer.data.byteOffset);
    return Array.from({ length: buffer.width * buffer.height }, (_, i) => view.getUint32(i * 4));
}

/** One string per row, each pixel as eight hex digits `rrggbbaa`, separated by spaces. */
export function hex(buffer: PixelBuffer): string[] {
    const colors = colorsOf(buffer).map((color) => color.toString(16).padStart(8, "0"));
    return Array.from({ length: buffer.height }, (_, y) =>
        colors.slice(y * buffer.width, (y + 1) * buffer.width).join(" "),
    );
}

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
 * A reproducible stream of integers 0..255 (a linear congruential generator with a fixed
 * seed), for fixtures that need many different colours.
 */
export function byteStream(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state >>> 24;
    };
}

/** An opaque `width` × `height` buffer of noise from `byteStream(seed)`. */
export function noise(width: number, height: number, seed: number): PixelBuffer {
    const next = byteStream(seed);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = next();
        data[i + 1] = next();
        data[i + 2] = next();
        data[i + 3] = 255;
    }
    return { width, height, data };
}

/** The number of distinct 0xRRGGBBAA values among the pixels with alpha above 0. */
export function distinctColors(buffers: readonly PixelBuffer[]): number {
    const colors = new Set<number>();
    for (const buffer of buffers) {
        for (const color of colorsOf(buffer)) {
            if ((color & 0xff) !== 0) {
                colors.add(color);
            }
        }
    }
    return colors.size;
}
