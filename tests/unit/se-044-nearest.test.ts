import { describe, expect, it } from "vitest";
import { writeOklab } from "../../src/core/color";
import { nearestColor, nearestSearch } from "../../src/core/import/nearestColor";
import { byteStream } from "./se-043-support";

// SE-044 review A: `nearestSearch`, the faster search the import uses for a large target, gives
// `nearestColor`'s answer for every query, ties included (the lowest index wins).

/** `count` OKLab colours from random sRGB bytes; `repeat` of them repeated at later indexes. */
function palette(count: number, seed: number, repeat = 0): Float64Array {
    const next = byteStream(seed);
    const lab = new Float64Array(count * 3);
    for (let c = 0; c < count; c++) writeOklab(lab, c * 3, next(), next(), next());
    for (let r = 0; r < repeat; r++) {
        const from = r;
        const to = count - 1 - r;
        lab.copyWithin(to * 3, from * 3, from * 3 + 3);
    }
    return lab;
}

describe("nearestSearch", () => {
    it("answers as nearestColor for random queries against palettes of 1 to 256 colours", () => {
        for (const [count, seed] of [
            [1, 1],
            [2, 2],
            [16, 3],
            [97, 4],
            [256, 5],
        ] as const) {
            const lab = palette(count, seed, Math.min(4, count >> 1));
            const search = nearestSearch(lab);
            const next = byteStream(seed + 100);
            const query = new Float64Array(3);
            for (let q = 0; q < 4000; q++) {
                writeOklab(query, 0, next(), next(), next());
                // Also beyond the gamut, as the dither's mirrored colours are.
                const scale = q % 5 === 0 ? 1.7 : 1;
                const [L, a, b] = [query[0]! * scale, query[1]! * scale, query[2]! * scale];
                expect(search(L, a, b), `${count} colours, query ${q}`).toBe(
                    nearestColor(lab, L, a, b),
                );
            }
        }
    });

    it("of equally near colours takes the lowest index, as nearestColor does", () => {
        // Two copies of each colour, the copy first in L order having the higher index.
        const lab = Float64Array.from([0.5, 0.1, 0, 0.5, -0.1, 0, 0.5, 0.1, 0, 0.5, -0.1, 0]);
        const search = nearestSearch(lab);
        for (const [L, a, b] of [
            [0.5, 0, 0],
            [0.5, 0.1, 0],
            [0.5, -0.1, 0],
            [0.4, 0, 0],
            [0.9, 0, 0.3],
        ] as const) {
            expect(search(L, a, b)).toBe(nearestColor(lab, L, a, b));
        }
        expect(search(0.5, 0, 0)).toBe(0);
        // Colours that differ in L only, at the same distance on both sides.
        const line = Float64Array.from([0.75, 0, 0, 0.25, 0, 0]);
        expect(nearestSearch(line)(0.5, 0, 0)).toBe(0);
        const reversed = Float64Array.from([0.25, 0, 0, 0.75, 0, 0]);
        expect(nearestSearch(reversed)(0.5, 0, 0)).toBe(0);
    });
});
