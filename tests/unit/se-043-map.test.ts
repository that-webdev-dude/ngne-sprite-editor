import { describe, expect, it } from "vitest";
import { srgb8ToOklab } from "../../src/core/color";
import { ImportError, buildPalette, mapToPalette } from "../../src/core/import";
import type { DitherMethod } from "../../src/core/import";
import { PRESET_PALETTES } from "../../src/core/palettes";
import { clonePixelBuffer, pixelBuffersEqual } from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";
import { byteStream, colorsOf, hex, image, noise } from "./se-043-support";

const DITHERS: DitherMethod[] = ["none", "bayer", "floyd-steinberg"];
const BLACK = 0x000000ff;
const WHITE = 0xffffffff;

/** A `width` × `height` buffer of one colour. */
function flat(width: number, height: number, color: number): PixelBuffer {
    return image(width, new Array<number>(width * height).fill(color));
}

/** Opaque greys in row-major order; `null` is a fully transparent pixel. */
function greys(width: number, values: (number | null)[]): PixelBuffer {
    return image(
        width,
        values.map((value) => (value === null ? 0 : (value * 0x01010100 + 0xff) >>> 0)),
    );
}

/** A letter per pixel: white "W", black "B", grey 128 "G", transparent black ".", else "?". */
function blackAndWhite(buffer: PixelBuffer): string[] {
    const letters = new Map([
        ["ffffffff", "W"],
        ["000000ff", "B"],
        ["808080ff", "G"],
        ["00000000", "."],
    ]);
    return hex(buffer).map((row) =>
        row
            .split(" ")
            .map((color) => letters.get(color) ?? "?")
            .join(""),
    );
}

describe("mapToPalette", () => {
    it("replaces every pixel by the nearest palette colour", () => {
        const palette = [BLACK, WHITE, 0xff0000ff, 0x0000ffff];
        const source = image(4, [0x202020ff, 0xe0e0e0ff, 0xc81e1eff, 0x1e1ec8ff]);
        expect(hex(mapToPalette(source, palette, { dither: "none" }))).toEqual([
            "000000ff ffffffff ff0000ff 0000ffff",
        ]);
    });

    it("measures the distance in OKLab, not in sRGB", () => {
        // In sRGB the dark blue 0, 0, 110 is nearer to black (110 against 145 to blue); in
        // OKLab it is nearer to blue (about 0.25 against 0.30 to black).
        const source = image(1, [0x00006eff]);
        expect(hex(mapToPalette(source, [BLACK, 0x0000ffff], { dither: "none" }))).toEqual([
            "0000ffff",
        ]);
    });

    it("agrees with a comparison of every pixel against every palette colour", () => {
        const source = noise(48, 48, 23);
        const palettes = [
            PRESET_PALETTES[5].colors,
            buildPalette([noise(64, 64, 5)], 256),
            // Duplicates: the first of equal colours is as good as any, the result is the same.
            [...PRESET_PALETTES[0].colors, ...PRESET_PALETTES[0].colors],
        ];
        for (const palette of palettes) {
            const lab = palette.map((color) =>
                srgb8ToOklab(color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff),
            );
            const expected = colorsOf(source).map((pixel) => {
                const [L, a, b] = srgb8ToOklab(
                    pixel >>> 24,
                    (pixel >>> 16) & 0xff,
                    (pixel >>> 8) & 0xff,
                );
                let best = 0;
                let bestDistance = Infinity;
                lab.forEach(([paletteL, paletteA, paletteB], index) => {
                    const dL = paletteL - L;
                    const da = paletteA - a;
                    const db = paletteB - b;
                    const distance = dL * dL + da * da + db * db;
                    if (distance < bestDistance) {
                        best = index;
                        bestDistance = distance;
                    }
                });
                return palette[best];
            });
            const result = mapToPalette(source, palette, { dither: "none" });
            expect(colorsOf(result), `${palette.length} colours`).toEqual(expected);
        }
    });

    it("keeps alpha and copies fully transparent pixels unchanged", () => {
        const source = image(3, [0x20202080, 0x12345600, 0xe0e0e001]);
        expect(hex(mapToPalette(source, [BLACK, WHITE], { dither: "none" }))).toEqual([
            "00000080 12345600 ffffff01",
        ]);
        // With dithering too; these pixels are palette colours, so nothing else changes.
        const exact = image(3, [0x00000080, 0x12345600, 0xffffff01]);
        for (const dither of DITHERS) {
            const result = mapToPalette(exact, [BLACK, WHITE], { dither });
            expect(hex(result), dither).toEqual(["00000080 12345600 ffffff01"]);
        }
    });

    it("is the identity for an image that already uses only palette colours", () => {
        for (const preset of PRESET_PALETTES) {
            // Palette colours picked by a fixed pseudo-random stream, some half-transparent
            // and some fully transparent with a colour underneath.
            const next = byteStream(preset.colors.length);
            const pixels = Array.from({ length: 24 * 24 }, (_, i) => {
                const color = preset.colors[next() % preset.colors.length];
                const alpha = i % 7 === 0 ? 0 : i % 5 === 0 ? 0x80 : 0xff;
                return ((color & 0xffffff00) | alpha) >>> 0;
            });
            const source = image(24, pixels);
            for (const dither of DITHERS) {
                const result = mapToPalette(source, preset.colors, { dither });
                expect(pixelBuffersEqual(result, source), `${preset.id} ${dither}`).toBe(true);
                expect(result.data.buffer).not.toBe(source.data.buffer);
            }
        }
    });

    it("uses only palette colours, with every dither method", () => {
        const palette = PRESET_PALETTES[0].colors;
        const allowed = new Set(palette);
        const source = noise(32, 32, 11);
        for (const dither of DITHERS) {
            const result = mapToPalette(source, palette, { dither });
            expect(
                colorsOf(result).filter((color) => !allowed.has(color)),
                dither,
            ).toEqual([]);
        }
    });

    it("never uses a palette entry with alpha 0, and uses the colour of the others", () => {
        const withTransparent = [0x80808000, BLACK, WHITE];
        // Grey 128 has lightness 0.60: nearer to white than to black.
        expect(
            hex(mapToPalette(image(1, [0x808080ff]), withTransparent, { dither: "none" })),
        ).toEqual(["ffffffff"]);
        // A half-transparent entry lends its colour; the pixel keeps its own alpha.
        expect(
            hex(mapToPalette(image(1, [0xf00000ff]), [0xff000080, 0x0000ffff], { dither: "none" })),
        ).toEqual(["ff0000ff"]);
    });

    it("rejects a palette without a visible colour", () => {
        for (const palette of [[], [0x00000000], [0xff000000, 0x00ff0000]]) {
            const run = () => mapToPalette(image(1, [BLACK]), palette, { dither: "none" });
            expect(run).toThrow(ImportError);
            expect(run).toThrow(expect.objectContaining({ code: "settings" }));
        }
    });

    it("does not change the source", () => {
        const source = noise(8, 8, 2);
        const before = clonePixelBuffer(source);
        for (const dither of DITHERS) {
            mapToPalette(source, [BLACK, WHITE, 0xff0000ff], { dither });
        }
        expect(pixelBuffersEqual(source, before)).toBe(true);
    });
});

// OKLab lightness of the greys used below: 34 → 0.252, 72 → 0.402, 86 → 0.453, 99 → 0.4997,
// 100 → 0.5032, 128 → 0.600, 160 → 0.706. Black is 0 and white is 1, so between those two a
// grey's lightness is its share of white, and the greys from 100 up are nearer to white.
describe("mapToPalette, Bayer 4×4", () => {
    const options = { dither: "bayer" } as const;

    it("switches a quarter of the tile for a grey a quarter of the way to white", () => {
        // Share 0.252: above the thresholds 1/32, 3/32, 5/32 and 7/32, which the matrix
        // 0 8 2 10 / 12 4 14 6 / 3 11 1 9 / 15 7 13 5 puts at its entries 0, 1, 2 and 3.
        const result = mapToPalette(flat(4, 4, 0x222222ff), [BLACK, WHITE], options);
        expect(blackAndWhite(result)).toEqual(["WBWB", "BBBB", "WBWB", "BBBB"]);
    });

    it("gives a checkerboard at half way, with the nearer colour on the other fields", () => {
        // Grey 99 is just below the middle: nearest black, white on the entries 0 to 7.
        const below = mapToPalette(flat(4, 4, 0x636363ff), [BLACK, WHITE], options);
        expect(blackAndWhite(below)).toEqual(["WBWB", "BWBW", "WBWB", "BWBW"]);
        // Grey 100 is just above it: nearest white, black on the entries 0 to 7.
        const above = mapToPalette(flat(4, 4, 0x646464ff), [BLACK, WHITE], options);
        expect(blackAndWhite(above)).toEqual(["BWBW", "WBWB", "BWBW", "WBWB"]);
    });

    it("repeats the tile from the top-left pixel of the buffer", () => {
        const wide = mapToPalette(flat(10, 1, 0x222222ff), [BLACK, WHITE], options);
        expect(blackAndWhite(wide)).toEqual(["WBWBWBWBWB"]);
        const tall = mapToPalette(flat(1, 6, 0x222222ff), [BLACK, WHITE], options);
        expect(blackAndWhite(tall)).toEqual(["W", "B", "W", "B", "W", "B"]);
        const offset = mapToPalette(flat(3, 5, 0x222222ff), [BLACK, WHITE], options);
        expect(blackAndWhite(offset)).toEqual(["WBW", "BBB", "WBW", "BBB", "WBW"]);
    });

    it("mixes the nearest colour with the palette colour on the far side of the pixel", () => {
        // Grey 34 between black and grey 128 (lightness 0.600): share 0.252 / 0.600 = 0.42,
        // above the thresholds up to 13/32, the entries 0 to 6. White is never used.
        const palette = [BLACK, 0x808080ff, WHITE];
        const result = mapToPalette(flat(4, 4, 0x222222ff), palette, options);
        expect(blackAndWhite(result)).toEqual(["GBGB", "BGBG", "GBGB", "BBBG"]);
    });

    it("does not dither a colour that has no palette colour on its far side", () => {
        // Darker than both entries: nothing lies beyond it.
        const result = mapToPalette(flat(4, 4, 0x202020ff), [0x404040ff, 0x808080ff], options);
        expect(new Set(colorsOf(result))).toEqual(new Set([0x404040ff]));
    });

    it("skips fully transparent pixels without shifting the tile", () => {
        const source = flat(4, 1, 0x222222ff);
        source.data.fill(0, 0, 4);
        const result = mapToPalette(source, [BLACK, WHITE], options);
        expect(blackAndWhite(result)).toEqual([".BWB"]);
    });
});

describe("mapToPalette, Floyd–Steinberg", () => {
    const options = { dither: "floyd-steinberg" } as const;
    const dither = (source: PixelBuffer): string[] =>
        blackAndWhite(mapToPalette(source, [BLACK, WHITE], options));

    // The next four cases start with grey 128, which takes white and leaves an error of
    // -127. The grey that receives a share of it takes white from 99.5 up (it is rounded
    // first), so two greys two steps apart pin the share between neighbouring fractions.
    it("passes 7/16 of the error to the right", () => {
        // 7/16 of -127 is -55.56: 154 becomes 98.44 → black, 158 becomes 102.44 → white.
        // 6/16 would leave 154 white (106.4); 8/16 would make 158 black (94.5).
        expect(dither(greys(2, [128, 154]))).toEqual(["WB"]);
        expect(dither(greys(2, [128, 158]))).toEqual(["WW"]);
    });

    it("passes 5/16 of the error down", () => {
        // 5/16 of -127 is -39.69: 138 becomes 98.31 → black, 140 becomes 100.31 → white.
        expect(dither(greys(1, [128, 138]))).toEqual(["W", "B"]);
        expect(dither(greys(1, [128, 140]))).toEqual(["W", "W"]);
    });

    it("passes 3/16 of the error down and to the left", () => {
        // 3/16 of -127 is -23.81: 122 becomes 98.19 → black, 124 becomes 100.19 → white.
        expect(dither(greys(2, [null, 128, 122, null]))).toEqual([".W", "B."]);
        expect(dither(greys(2, [null, 128, 124, null]))).toEqual([".W", "W."]);
    });

    it("passes 1/16 of the error down and to the right", () => {
        // 1/16 of -127 is -7.94: 107 becomes 99.06 → black, 108 becomes 100.06 → white.
        expect(dither(greys(2, [128, null, null, 107]))).toEqual(["W.", ".B"]);
        expect(dither(greys(2, [128, null, null, 108]))).toEqual(["W.", ".W"]);
    });

    it("carries the error along a row", () => {
        // 128 → white, error -127, of which -55.56 goes right: 72.44 → black, error +72.44,
        // +31.69 goes right: 159.69 → white, error -95.31, -41.70 goes right: 86.30 → black.
        expect(dither(flat(4, 1, 0x808080ff))).toEqual(["WBWB"]);
    });

    it("visits pixels left to right, top to bottom, adding up what a pixel receives", () => {
        // Row 0: 128 → white (error -127), then 128 - 55.56 = 72.44 → black (error +72.44).
        // Row 1, left: 128 - 39.69 (5/16 from above) + 13.58 (3/16 from above right)
        //   = 101.89 → white, error -153.11.
        // Row 1, right: 128 - 7.94 (1/16) + 22.64 (5/16) - 66.98 (7/16) = 75.71 → black.
        expect(dither(flat(2, 2, 0x808080ff))).toEqual(["WB", "WB"]);
    });

    it("clips a pixel plus its error to 0..255 before taking the pixel's own error", () => {
        // Palette grey 128 and white. Black takes grey 128 and passes -56 to the right. The
        // second black is clipped from -56 to 0, so it passes -56 as well and the white
        // pixel becomes 199 → white. Unclipped it would pass 7/16 of -184 and white would
        // become 174.5, which is nearer to grey 128.
        const result = mapToPalette(greys(3, [0, 0, 255]), [0x808080ff, WHITE], options);
        expect(blackAndWhite(result)).toEqual(["GGW"]);
    });

    it("gives a fully transparent pixel no error and passes none on from it", () => {
        // Without the gap the row is W B W B (above). With it, the third pixel starts
        // again at 128 → white and the fourth takes its error: 72.44 → black.
        expect(dither(greys(4, [128, null, 128, 128]))).toEqual(["W.WB"]);
    });

    it("keeps the average of a flat grey close to the grey", () => {
        // Grey 128 is 128/255 of the way from black to white; so is the share of white.
        const result = mapToPalette(flat(32, 32, 0x808080ff), [BLACK, WHITE], options);
        const white = colorsOf(result).filter((color) => color === WHITE).length;
        expect(Math.abs(white / (32 * 32) - 128 / 255)).toBeLessThan(0.02);
    });
});
