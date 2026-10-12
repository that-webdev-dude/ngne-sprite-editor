import { describe, expect, it } from "vitest";
import { ImportError, resample } from "../../src/core/import";
import type { ResampleFit, ResampleMethod } from "../../src/core/import";
import { clonePixelBuffer, pixelBuffersEqual, resizeNearest } from "../../src/core/pixels";
import { grid, hex, image, noise, show } from "./se-043-support";

const METHODS: ResampleMethod[] = ["nearest", "area", "dominant"];
const FITS: ResampleFit[] = ["stretch", "contain", "cover"];

/** Opaque pixels with the given red values and no green or blue. */
function reds(width: number, values: number[]) {
    return image(
        width,
        values.map((value) => ((value << 24) | 0xff) >>> 0),
    );
}

describe("resample", () => {
    it("returns an unchanged copy when the size already matches", () => {
        // Colour under alpha 0 and a half-transparent pixel: nothing is normalized.
        const source = grid("aB", ".c");
        source.data[7] = 128;
        for (const method of METHODS) {
            for (const fit of FITS) {
                const result = resample(source, 2, 2, { method, fit });
                expect(pixelBuffersEqual(result, source), `${method} ${fit}`).toBe(true);
                expect(result.data.buffer).not.toBe(source.data.buffer);
            }
        }
    });

    it("does not change the source", () => {
        const source = noise(5, 3, 1);
        const before = clonePixelBuffer(source);
        for (const method of METHODS) {
            for (const fit of FITS) {
                resample(source, 2, 4, { method, fit });
            }
        }
        expect(pixelBuffersEqual(source, before)).toBe(true);
    });

    it("rejects a size that is not positive integers", () => {
        const source = grid("AB", "CD");
        for (const [width, height] of [
            [0, 2],
            [2, 0],
            [-1, 2],
            [1.5, 2],
            [2, Number.NaN],
            [Number.POSITIVE_INFINITY, 2],
        ]) {
            const run = () => resample(source, width, height, { method: "area", fit: "stretch" });
            expect(run, `${width} × ${height}`).toThrow(ImportError);
            expect(run).toThrow(expect.objectContaining({ code: "settings" }));
        }
    });
});

describe("resample, nearest", () => {
    const LETTERS = grid("ABCD", "EFGH", "IJKL", "MNOP");

    it("takes the source pixel under each target pixel's centre", () => {
        const options = { method: "nearest", fit: "stretch" } as const;
        // Columns and rows floor((i + 0.5) × 4 / 2) = 1 and 3.
        expect(show(resample(LETTERS, 2, 2, options))).toEqual(["FH", "NP"]);
        // Columns floor((i + 0.5) × 2 / 3) = 0, 1, 1; row floor(0.5 × 2 / 1) = 1.
        expect(show(resample(grid("AB", "CD"), 3, 1, options))).toEqual(["CDD"]);
        expect(show(resample(grid("AB"), 6, 2, options))).toEqual(["AAABBB", "AAABBB"]);
    });

    it("equals resizeNearest of core/pixels for fit stretch", () => {
        for (let width = 1; width <= 5; width++) {
            for (let height = 1; height <= 4; height++) {
                const source = noise(width, height, width * 16 + height);
                for (let targetWidth = 1; targetWidth <= 7; targetWidth++) {
                    for (let targetHeight = 1; targetHeight <= 6; targetHeight++) {
                        const result = resample(source, targetWidth, targetHeight, {
                            method: "nearest",
                            fit: "stretch",
                        });
                        const expected = resizeNearest(source, targetWidth, targetHeight);
                        expect(
                            pixelBuffersEqual(result, expected),
                            `${width}×${height} → ${targetWidth}×${targetHeight}`,
                        ).toBe(true);
                    }
                }
            }
        }
    });

    it("copies pixels as they are, colour under alpha 0 included", () => {
        const result = resample(grid("aa", "aa"), 1, 1, { method: "nearest", fit: "stretch" });
        expect(show(result)).toEqual(["a"]);
    });
});

describe("resample, area average", () => {
    const options = { method: "area", fit: "stretch" } as const;

    it("averages a 4×4 image with mixed alpha to 2×2, colours weighted by alpha", () => {
        const source = image(4, [
            ...[0xc80000ff, 0x640000ff, 0xffffffff, 0x09090900],
            ...[0x006400ff, 0x00c800ff, 0x07070700, 0xffffffff],
            ...[0x0a141eff, 0xfa643255, 0x01020300, 0x04050600],
            ...[0x00000000, 0x63636300, 0x00000000, 0xc8c8c800],
        ]);
        // Top left, all opaque: alpha 255; red (200 + 100) / 4 = 75, green (100 + 200) / 4 = 75.
        // Top right, two opaque whites and two transparent pixels: alpha 510 / 4 = 127.5,
        //   rounded up to 128; the colour is white, the hidden greys do not count.
        // Bottom left, alpha 255 and 85 and two transparent pixels: alpha 340 / 4 = 85;
        //   red (255 × 10 + 85 × 250) / 340 = 70, green (255 × 20 + 85 × 100) / 340 = 40,
        //   blue (255 × 30 + 85 × 50) / 340 = 35.
        // Bottom right, all transparent: transparent black, whatever the hidden colours.
        expect(hex(resample(source, 2, 2, options))).toEqual([
            "4b4b00ff ffffff80",
            "46282355 00000000",
        ]);
    });

    it("rounds halves up", () => {
        expect(hex(resample(reds(2, [0, 1]), 1, 1, options))).toEqual(["010000ff"]);
        expect(hex(resample(reds(2, [1, 2]), 1, 1, options))).toEqual(["020000ff"]);
        expect(hex(resample(reds(4, [1, 1, 1, 2]), 1, 1, options))).toEqual(["010000ff"]);
        // Alpha (255 + 0) / 2 = 127.5.
        expect(hex(resample(image(2, [0x102030ff, 0x00000000]), 1, 1, options))).toEqual([
            "10203080",
        ]);
    });

    it("gives transparent black when the alpha rounds to 0", () => {
        // Alpha 1 over four pixels is 0.25.
        const source = image(2, [0xff804001, 0, 0, 0]);
        expect(hex(resample(source, 1, 1, options))).toEqual(["00000000"]);
        // Alpha 2 over four pixels is 0.5, rounded up to 1; the colour is that one pixel's.
        const faint = image(2, [0xff804002, 0, 0, 0]);
        expect(hex(resample(faint, 1, 1, options))).toEqual(["ff804001"]);
    });

    it("weights source pixels by the part of them a target pixel covers", () => {
        // 3 → 2: the first target pixel covers pixel 0 and half of pixel 1, the second the
        // other half and pixel 2: (0 + 90 / 2) / 1.5 = 30 and (90 / 2 + 255) / 1.5 = 200.
        expect(hex(resample(reds(3, [0, 90, 255]), 2, 1, options))).toEqual(["1e0000ff c80000ff"]);
        // 2 → 3: the middle target pixel covers a third of each source pixel.
        expect(hex(resample(reds(2, [0, 90]), 3, 1, options))).toEqual([
            "000000ff 2d0000ff 5a0000ff",
        ]);
    });

    it("repeats pixels when scaling up by a whole factor", () => {
        expect(show(resample(grid("AB", "CD"), 4, 4, options))).toEqual([
            "AABB",
            "AABB",
            "CCDD",
            "CCDD",
        ]);
    });

    it("keeps a flat image flat at any ratio and fit", () => {
        const flat = image(7, new Array<number>(35).fill(0x0a141ec8));
        for (const fit of FITS) {
            for (const [width, height] of [
                [3, 2],
                [2, 5],
                [9, 4],
                [1, 1],
            ]) {
                const result = resample(flat, width, height, { method: "area", fit });
                const colors = new Set(hex(result).join(" ").split(" "));
                colors.delete("00000000"); // the margins of fit contain
                expect([...colors], `${fit} ${width}×${height}`).toEqual(["0a141ec8"]);
            }
        }
    });
});

describe("resample, dominant colour", () => {
    const options = { method: "dominant", fit: "stretch" } as const;

    it("takes the most frequent colour of each block", () => {
        expect(show(resample(grid("AACD", "ABDD"), 2, 1, options))).toEqual(["AD"]);
    });

    it("takes the colour met first, in row-major order, when colours tie", () => {
        expect(show(resample(grid("AB", "BA"), 1, 1, options))).toEqual(["A"]);
        expect(show(resample(grid("BA", "AB"), 1, 1, options))).toEqual(["B"]);
        expect(show(resample(grid("ABCD"), 1, 1, options))).toEqual(["A"]);
        // B and A once each, C twice.
        expect(show(resample(grid("BA", "CC"), 1, 1, options))).toEqual(["C"]);
    });

    it("counts all fully transparent pixels as one colour, transparent black", () => {
        // Three transparent pixels with three hidden colours against one opaque pixel.
        expect(show(resample(grid("ab", "A."), 1, 1, options))).toEqual(["."]);
        // Two against two: the one met first wins.
        expect(show(resample(grid("aA", ".A"), 1, 1, options))).toEqual(["."]);
        expect(show(resample(grid("Aa", "A."), 1, 1, options))).toEqual(["A"]);
        expect(show(resample(grid("aA", "AA"), 1, 1, options))).toEqual(["A"]);
    });

    it("tells colours apart by alpha", () => {
        const source = image(3, [0x0a141eff, 0x0a141e80, 0x0a141e80]);
        expect(hex(resample(source, 1, 1, options))).toEqual(["0a141e80"]);
    });

    it("weights colours by the part of them a target pixel covers", () => {
        // 3 → 2: A covers two thirds of the first target pixel, C of the second.
        expect(show(resample(grid("ABC"), 2, 1, options))).toEqual(["AC"]);
    });
});

describe("resample, fit", () => {
    const WIDE = grid("ABCD", "EFGH");
    const TALL = grid("AB", "CD", "EF", "GH");

    it("contain centres the whole source and leaves the rest transparent", () => {
        const options = { method: "nearest", fit: "contain" } as const;
        expect(show(resample(WIDE, 4, 4, options))).toEqual(["....", "ABCD", "EFGH", "...."]);
        expect(show(resample(TALL, 4, 4, options))).toEqual([".AB.", ".CD.", ".EF.", ".GH."]);
        // Scaled down to 2 × 1; an odd number of free rows leaves one more after the image.
        expect(show(resample(WIDE, 2, 2, options))).toEqual(["FH", ".."]);
        expect(show(resample(grid("A"), 2, 1, options))).toEqual(["A."]);
        expect(show(resample(grid("A"), 3, 1, options))).toEqual([".A."]);
    });

    it("contain rounds the fitted side to whole pixels, at least one", () => {
        const options = { method: "nearest", fit: "contain" } as const;
        // 3 × 1 into 2 × 2: 2 × 0.67 rounds to 2 × 1.
        expect(show(resample(grid("ABC"), 2, 2, options))).toEqual(["AC", ".."]);
        // 8 × 1 into 2 × 2: 2 × 0.25 would round to no row at all.
        expect(show(resample(grid("ABCDEFGH"), 2, 2, options))).toEqual(["CG", ".."]);
        // 2 × 3 into 5 × 3 fits as it is: of the three free columns, one is before the image.
        const tall = grid("AB", "CD", "EF");
        expect(show(resample(tall, 5, 3, options))).toEqual([".AB..", ".CD..", ".EF.."]);
        // 2 × 3 into 5 × 5: 3.33 × 5 rounds to 3 × 5, one column free on each side.
        expect(show(resample(tall, 5, 5, options))).toEqual([
            ".ABB.",
            ".ABB.",
            ".CDD.",
            ".EFF.",
            ".EFF.",
        ]);
    });

    it("cover fills the target with the centre of the source", () => {
        for (const method of METHODS) {
            const options = { method, fit: "cover" } as const;
            expect(show(resample(WIDE, 2, 2, options)), method).toEqual(["BC", "FG"]);
            expect(show(resample(TALL, 2, 2, options)), method).toEqual(["CD", "EF"]);
            expect(show(resample(grid("ABC"), 1, 1, options)), method).toEqual(["B"]);
        }
    });

    it("cover cuts through source pixels where the centre part does", () => {
        // 4 × 1 into 1 × 1: the centre pixel covers the source from 1.5 to 2.5.
        const source = reds(4, [0, 100, 200, 250]);
        const area = resample(source, 1, 1, { method: "area", fit: "cover" });
        expect(hex(area)).toEqual(["960000ff"]); // (100 + 200) / 2
        const nearest = resample(source, 1, 1, { method: "nearest", fit: "cover" });
        expect(hex(nearest)).toEqual(["c80000ff"]); // the centre, 2.0, lies in pixel 2
        // Halves of pixels 1 and 2 tie; pixel 1 is met first.
        const dominant = resample(source, 1, 1, { method: "dominant", fit: "cover" });
        expect(hex(dominant)).toEqual(["640000ff"]);
    });

    it("stretch ignores the aspect ratio", () => {
        const options = { method: "nearest", fit: "stretch" } as const;
        expect(show(resample(WIDE, 2, 2, options))).toEqual(["BD", "FH"]);
        expect(show(resample(WIDE, 4, 4, options))).toEqual(["ABCD", "ABCD", "EFGH", "EFGH"]);
    });

    it("gives the same result for every fit when the aspect ratios agree", () => {
        const source = noise(6, 4, 7);
        for (const method of METHODS) {
            const stretched = resample(source, 3, 2, { method, fit: "stretch" });
            for (const fit of FITS) {
                const result = resample(source, 3, 2, { method, fit });
                expect(pixelBuffersEqual(result, stretched), `${method} ${fit}`).toBe(true);
            }
        }
    });
});
