import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { srgb8ToOklab } from "../../src/core/color";
import { ImportError, buildPalette } from "../../src/core/import";
import { createPixelBuffer } from "../../src/core/pixels";
import { byteStream, colorsOf, image, noise } from "./se-043-support";

const hexOf = (colors: number[]): string[] =>
    colors.map((color) => color.toString(16).padStart(8, "0"));

/** The distinct opaque versions of the visible colours of the pixels. */
function ownColors(pixels: number[]): number[] {
    const visible = pixels.filter((color) => (color & 0xff) !== 0);
    return [...new Set(visible.map((color) => (color | 0xff) >>> 0))];
}

function lightness(color: number): number {
    return srgb8ToOklab(color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff)[0];
}

describe("buildPalette", () => {
    it("returns the input's own colours when it has fewer than asked for, dark to light", () => {
        const pixels = [0xffffffff, 0x000000ff, 0xff0000ff, 0x00ff00ff, 0x0000ffff, 0xff0000ff];
        // OKLab lightness: black 0, blue 0.452, red 0.628, green 0.866, white 1.
        expect(hexOf(buildPalette([image(3, pixels)], 16))).toEqual([
            "000000ff",
            "0000ffff",
            "ff0000ff",
            "00ff00ff",
            "ffffffff",
        ]);
    });

    it("returns the input's own colours when it has exactly as many as asked for", () => {
        const pixels = [0x102030ff, 0x405060ff, 0x708090ff, 0x405060ff];
        expect(hexOf(buildPalette([image(2, pixels)], 3))).toEqual([
            "102030ff",
            "405060ff",
            "708090ff",
        ]);
    });

    it("ignores fully transparent pixels and the alpha of the others", () => {
        const pixels = [0xaabbcc00, 0x00000000, 0x10203080, 0x10203001, 0x405060ff];
        expect(hexOf(buildPalette([image(5, pixels)], 16))).toEqual(["102030ff", "405060ff"]);
    });

    it("returns no colour for buffers without a visible pixel", () => {
        expect(buildPalette([], 16)).toEqual([]);
        expect(buildPalette([createPixelBuffer(3, 3)], 16)).toEqual([]);
        expect(buildPalette([image(2, [0xff000000, 0x00ff0000])], 16)).toEqual([]);
    });

    it("returns the pixel-weighted mean of each group of close colours", () => {
        // Two dark and two light greys, two groups: the means are the greys between them.
        const pairs = image(4, [0x101010ff, 0x121212ff, 0xf0f0f0ff, 0xf2f2f2ff]);
        expect(hexOf(buildPalette([pairs], 2))).toEqual(["111111ff", "f1f1f1ff"]);
        // Three pixels of grey 16 and one of grey 20 average to grey 17.
        const weighted = image(5, [0x101010ff, 0x101010ff, 0x101010ff, 0x141414ff, 0xf0f0f0ff]);
        expect(hexOf(buildPalette([weighted], 2))).toEqual(["111111ff", "f0f0f0ff"]);
    });

    it("returns exactly n different colours when the input has at least n", () => {
        const source = noise(48, 48, 5);
        for (const count of [1, 2, 3, 4, 8, 16, 64, 255, 256]) {
            const palette = buildPalette([source], count);
            expect(palette, `n = ${count}`).toHaveLength(count);
            expect(new Set(palette).size, `n = ${count}`).toBe(count);
            expect(palette.every((color) => (color & 0xff) === 0xff)).toBe(true);
        }
    });

    it("returns exactly n different colours when group means round to the same colour", () => {
        // The 64 darkest colours: neighbours are so close that the means of two groups can
        // round to one sRGB colour, which must not leave the palette short.
        const pixels: number[] = [];
        for (let red = 0; red < 4; red++) {
            for (let green = 0; green < 4; green++) {
                for (let blue = 0; blue < 4; blue++) {
                    pixels.push(((red << 24) | (green << 16) | (blue << 8) | 0xff) >>> 0);
                }
            }
        }
        for (let count = 1; count <= 64; count++) {
            const palette = buildPalette([image(8, pixels)], count);
            expect(palette, `n = ${count}`).toHaveLength(count);
            expect(new Set(palette).size, `n = ${count}`).toBe(count);
        }
        const ascending = (a: number, b: number): number => a - b;
        expect(buildPalette([image(8, pixels)], 64).sort(ascending)).toEqual(pixels);
    });

    it("returns n different colours, or the input's own, for any pixels and any n", () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 0, max: 0xffffffff }), { minLength: 1, maxLength: 80 }),
                fc.integer({ min: 0, max: 7 }),
                fc.integer({ min: 1, max: 256 }),
                (raw, bits, count) => {
                    // Few bits per channel make colours repeat and lie close together.
                    const mask = (0xff >>> bits) * 0x01010100 + 0xff;
                    const pixels = raw.map((color) => (color & mask) >>> 0);
                    const own = ownColors(pixels);
                    const palette = buildPalette([image(pixels.length, pixels)], count);
                    expect(new Set(palette).size).toBe(palette.length);
                    if (own.length <= count) {
                        const ascending = (a: number, b: number): number => a - b;
                        expect([...palette].sort(ascending)).toEqual(own.sort(ascending));
                    } else {
                        expect(palette).toHaveLength(count);
                    }
                },
            ),
        );
    });

    it("orders the palette from dark to light", () => {
        const palette = buildPalette([noise(32, 32, 9)], 16);
        const values = palette.map(lightness);
        expect(values).toEqual([...values].sort((a, b) => a - b));
    });

    it("is deterministic", () => {
        const first = buildPalette([noise(40, 40, 3)], 16);
        const second = buildPalette([noise(40, 40, 3)], 16);
        expect(second).toEqual(first);
    });

    it("depends only on the colours and their counts, not on where the pixels are", () => {
        const source = noise(40, 40, 3);
        const pixels = colorsOf(source);
        const expected = buildPalette([source], 16);

        expect(buildPalette([image(40, [...pixels].reverse())], 16)).toEqual(expected);
        // The same pixels in another order, another shape and split over three buffers.
        const next = byteStream(77);
        const shuffled = pixels
            .map((color) => ({ color, key: next() * 256 + next() }))
            .sort((a, b) => a.key - b.key)
            .map((entry) => entry.color);
        const parts = [
            image(100, shuffled.slice(0, 700)),
            image(1, shuffled.slice(700, 701)),
            image(29, shuffled.slice(701)),
        ];
        expect(buildPalette(parts, 16)).toEqual(expected);
        // Transparent pixels added anywhere change nothing.
        expect(buildPalette([createPixelBuffer(4, 4), ...parts], 16)).toEqual(expected);
    });

    it("builds one palette across all buffers", () => {
        const red = image(2, [0xff0000ff, 0xfd0000ff]);
        const blue = image(2, [0x0000ffff, 0x0000fdff]);
        // Two colours for both buffers together: the mean of each, not two reds or two blues.
        expect(hexOf(buildPalette([red, blue], 2))).toEqual(["0000feff", "fe0000ff"]);
    });

    it("merges colours before clustering when there are more than 32 768", () => {
        // 65 536 distinct colours: x, y and x xor y.
        const source = createPixelBuffer(256, 256);
        for (let y = 0, i = 0; y < 256; y++) {
            for (let x = 0; x < 256; x++, i += 4) {
                source.data.set([x, y, x ^ y, 255], i);
            }
        }
        const palette = buildPalette([source], 256);
        expect(palette).toHaveLength(256);
        expect(new Set(palette).size).toBe(256);
        expect(buildPalette([source], 256)).toEqual(palette);
        expect(buildPalette([source], 5)).toHaveLength(5);
    });

    it("rejects a palette size that is not an integer 1..256", () => {
        for (const count of [0, 257, -1, 2.5, Number.NaN]) {
            const run = () => buildPalette([noise(4, 4, 1)], count);
            expect(run, String(count)).toThrow(ImportError);
            expect(run).toThrow(expect.objectContaining({ code: "settings" }));
        }
    });
});
