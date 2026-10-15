import type { BitMask } from "../../src/core/model";

// Shared by the SE-030 unit tests: masks drawn as text, one string per row, "#" for a set
// pixel and "." for a clear one.

/** The mask that `rows` draws. */
export function maskOf(rows: readonly string[]): BitMask {
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const data = new Uint8Array(Math.ceil((width * height) / 8));
    rows.forEach((row, y) => {
        if (row.length !== width) throw new Error(`row ${y} is ${row.length} wide, not ${width}`);
        for (let x = 0; x < width; x++) {
            if (row[x] === "#") data[(y * width + x) >> 3] |= 1 << ((y * width + x) & 7);
            else if (row[x] !== ".") throw new Error(`row ${y} has "${row[x]}"`);
        }
    });
    return { width, height, data };
}

/** `mask` drawn as text, as `maskOf` reads it. */
export function rowsOf(mask: BitMask): string[] {
    const rows: string[] = [];
    for (let y = 0; y < mask.height; y++) {
        let row = "";
        for (let x = 0; x < mask.width; x++) {
            const bit = y * mask.width + x;
            row += mask.data[bit >> 3] & (1 << (bit & 7)) ? "#" : ".";
        }
        rows.push(row);
    }
    return rows;
}

/** Rows of `width` × `height` with each pixel "#" when `random()` is below `density`. */
export function randomRows(
    width: number,
    height: number,
    density: number,
    random: () => number,
): string[] {
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
        let row = "";
        for (let x = 0; x < width; x++) row += random() < density ? "#" : ".";
        rows.push(row);
    }
    return rows;
}

/** The mask of `randomRows`. */
export function randomMask(
    width: number,
    height: number,
    density: number,
    random: () => number,
): BitMask {
    return maskOf(randomRows(width, height, density, random));
}

/** A repeatable generator of numbers in [0, 1) (mulberry32). */
export function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
