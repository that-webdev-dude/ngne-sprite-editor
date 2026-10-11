import { describe, expect, it } from "vitest";
import {
    blitPixels,
    clonePixelBuffer,
    createPixelBuffer,
    cropPixels,
    fillPixels,
    flipPixels,
    nonTransparentBounds,
    pixelBuffersEqual,
    resizeNearest,
    rotatePixels,
    zeroTransparentRgb,
} from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";

// Buffers are written as rows of characters. "." is transparent black, an upper-case letter
// is an opaque colour of its own, and a lower-case letter is the same colour with alpha 0.
function colorOf(character: string): number[] {
    if (character === ".") {
        return [0, 0, 0, 0];
    }
    const code = character.toUpperCase().charCodeAt(0);
    return [code, 255 - code, (code * 7) & 0xff, character === character.toUpperCase() ? 255 : 0];
}

const CHARACTERS = ".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function grid(...rows: string[]): PixelBuffer {
    const width = rows[0].length;
    const bytes = rows.flatMap((row) => [...row].flatMap(colorOf));
    return { width, height: rows.length, data: Uint8ClampedArray.from(bytes) };
}

function show(buffer: PixelBuffer): string[] {
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

const LETTERS = grid("ABCD", "EFGH", "IJKL", "MNOP");

describe("createPixelBuffer", () => {
    it("creates a transparent black buffer of the given size", () => {
        const buffer = createPixelBuffer(3, 2);
        expect(buffer.width).toBe(3);
        expect(buffer.height).toBe(2);
        expect(buffer.data).toBeInstanceOf(Uint8ClampedArray);
        expect(Array.from(buffer.data)).toEqual(new Array(24).fill(0));
    });

    it("fills the buffer with a 0xRRGGBBAA colour", () => {
        const buffer = createPixelBuffer(2, 1, 0x11223344);
        expect(Array.from(buffer.data)).toEqual([0x11, 0x22, 0x33, 0x44, 0x11, 0x22, 0x33, 0x44]);
    });

    it("rejects a size that is not positive integers", () => {
        for (const [width, height] of [
            [0, 1],
            [1, 0],
            [-1, 1],
            [1.5, 1],
            [1, Number.NaN],
            [Number.POSITIVE_INFINITY, 1],
        ]) {
            expect(() => createPixelBuffer(width, height)).toThrow(RangeError);
        }
    });
});

describe("clonePixelBuffer", () => {
    it("copies size and pixels into separate storage", () => {
        const source = grid("AB", "CD");
        const copy = clonePixelBuffer(source);
        expect(show(copy)).toEqual(["AB", "CD"]);
        copy.data[0] = 1;
        expect(show(source)).toEqual(["AB", "CD"]);
        expect(copy.data.buffer).not.toBe(source.data.buffer);
    });
});

describe("pixelBuffersEqual", () => {
    it("is true for the same size and bytes", () => {
        expect(pixelBuffersEqual(grid("AB", "CD"), grid("AB", "CD"))).toBe(true);
    });

    it("is false when one byte differs", () => {
        const other = grid("AB", "CD");
        other.data[other.data.length - 1] ^= 1;
        expect(pixelBuffersEqual(grid("AB", "CD"), other)).toBe(false);
    });

    it("is false for the same bytes in another shape", () => {
        expect(pixelBuffersEqual(grid("ABCD"), grid("AB", "CD"))).toBe(false);
    });

    it("counts RGB hidden under alpha 0", () => {
        expect(pixelBuffersEqual(grid("a"), grid("."))).toBe(false);
    });
});

describe("fillPixels", () => {
    it("fills the whole buffer", () => {
        const buffer = grid("AB", "CD");
        fillPixels(buffer, 0x01020304);
        expect(Array.from(buffer.data)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]);
    });

    it("fills a rectangle and leaves the rest", () => {
        const buffer = clonePixelBuffer(LETTERS);
        fillPixels(buffer, 0, { x: 1, y: 1, width: 2, height: 2 });
        expect(show(buffer)).toEqual(["ABCD", "E..H", "I..L", "MNOP"]);
    });

    it("clips a rectangle that reaches outside the buffer", () => {
        const buffer = clonePixelBuffer(LETTERS);
        fillPixels(buffer, 0, { x: -2, y: 2, width: 4, height: 9 });
        expect(show(buffer)).toEqual(["ABCD", "EFGH", "..KL", "..OP"]);
    });

    it("does nothing for a rectangle outside the buffer", () => {
        const buffer = clonePixelBuffer(LETTERS);
        fillPixels(buffer, 0, { x: 4, y: 0, width: 3, height: 3 });
        fillPixels(buffer, 0, { x: 0, y: -3, width: 4, height: 3 });
        fillPixels(buffer, 0, { x: 1, y: 1, width: 0, height: 2 });
        expect(pixelBuffersEqual(buffer, LETTERS)).toBe(true);
    });

    it("rejects coordinates that are not integers", () => {
        const buffer = clonePixelBuffer(LETTERS);
        expect(() => fillPixels(buffer, 0, { x: 0.5, y: 0, width: 1, height: 1 })).toThrow(
            RangeError,
        );
    });
});

describe("cropPixels", () => {
    it("returns the pixels of a rectangle inside the buffer", () => {
        const result = cropPixels(LETTERS, { x: 1, y: 2, width: 3, height: 2 });
        expect(show(result)).toEqual(["JKL", "NOP"]);
    });

    it("leaves the part outside the source transparent", () => {
        const result = cropPixels(LETTERS, { x: -1, y: -1, width: 3, height: 3 });
        expect(show(result)).toEqual(["...", ".AB", ".EF"]);
        expect(show(cropPixels(LETTERS, { x: 3, y: 3, width: 2, height: 2 }))).toEqual([
            "P.",
            "..",
        ]);
    });

    it("is fully transparent for a rectangle outside the source", () => {
        expect(show(cropPixels(LETTERS, { x: 10, y: 0, width: 2, height: 1 }))).toEqual([".."]);
    });

    it("does not share storage with the source", () => {
        const source = clonePixelBuffer(LETTERS);
        const result = cropPixels(source, { x: 0, y: 0, width: 4, height: 4 });
        result.data.fill(0);
        expect(pixelBuffersEqual(source, LETTERS)).toBe(true);
    });

    it("rejects a rectangle without a positive integer size", () => {
        expect(() => cropPixels(LETTERS, { x: 0, y: 0, width: 0, height: 1 })).toThrow(RangeError);
        expect(() => cropPixels(LETTERS, { x: 0, y: 0, width: 1.5, height: 1 })).toThrow(
            RangeError,
        );
    });
});

describe("blitPixels", () => {
    it("copies the source to a position, replacing what was there", () => {
        const target = clonePixelBuffer(LETTERS);
        blitPixels(target, grid("XY", "Zx"), 1, 1);
        expect(show(target)).toEqual(["ABCD", "EXYH", "IZxL", "MNOP"]);
    });

    it("clips at every edge of the target", () => {
        const source = grid("XY", "ZW");
        const corners: [number, number, string[]][] = [
            [-1, -1, ["WBCD", "EFGH", "IJKL", "MNOP"]],
            [3, -1, ["ABCZ", "EFGH", "IJKL", "MNOP"]],
            [-1, 3, ["ABCD", "EFGH", "IJKL", "YNOP"]],
            [3, 3, ["ABCD", "EFGH", "IJKL", "MNOX"]],
        ];
        for (const [x, y, expected] of corners) {
            const target = clonePixelBuffer(LETTERS);
            blitPixels(target, source, x, y);
            expect(show(target)).toEqual(expected);
        }
    });

    it("does nothing when the source lands outside the target", () => {
        const target = clonePixelBuffer(LETTERS);
        blitPixels(target, grid("XY", "ZW"), 4, 0);
        blitPixels(target, grid("XY", "ZW"), 0, -2);
        expect(pixelBuffersEqual(target, LETTERS)).toBe(true);
    });

    it("copies only the source rectangle, with its top-left at the position", () => {
        const target = createPixelBuffer(3, 3);
        blitPixels(target, LETTERS, 1, 0, { x: 2, y: 1, width: 2, height: 3 });
        expect(show(target)).toEqual([".GH", ".KL", ".OP"]);
    });

    it("clips a source rectangle that reaches outside the source", () => {
        const target = grid("XXXX", "XXXX", "XXXX");
        blitPixels(target, LETTERS, 0, 0, { x: -1, y: 3, width: 3, height: 3 });
        expect(show(target)).toEqual(["XMNX", "XXXX", "XXXX"]);
    });

    it("moves pixels inside one buffer in any direction", () => {
        for (const [x, y] of [
            [1, 1],
            [-1, -1],
            [0, 1],
            [0, 2],
            [0, -1],
            [1, 0],
            [-2, 0],
            [2, -1],
            [-1, 2],
        ]) {
            const expected = clonePixelBuffer(LETTERS);
            blitPixels(expected, LETTERS, x, y);
            const buffer = clonePixelBuffer(LETTERS);
            blitPixels(buffer, buffer, x, y);
            expect(show(buffer), `shift ${x}, ${y}`).toEqual(show(expected));
        }
    });

    it("rejects a position that is not integers", () => {
        expect(() => blitPixels(createPixelBuffer(2, 2), LETTERS, 0.5, 0)).toThrow(RangeError);
    });
});

describe("nonTransparentBounds", () => {
    it("is null for a fully transparent buffer", () => {
        expect(nonTransparentBounds(grid("...", "..."))).toBeNull();
    });

    it("ignores pixels that have colour but alpha 0", () => {
        expect(nonTransparentBounds(grid("a.b", ".c."))).toBeNull();
    });

    it("is one pixel for a single non-transparent pixel", () => {
        expect(nonTransparentBounds(grid("....", "..A.", "...."))).toEqual({
            x: 2,
            y: 1,
            width: 1,
            height: 1,
        });
    });

    it("spans the outermost non-transparent pixels", () => {
        const buffer = grid(".....", "...A.", ".B...", "..c..", ".....");
        expect(nonTransparentBounds(buffer)).toEqual({ x: 1, y: 1, width: 3, height: 2 });
    });

    it("is the whole buffer when the corners are set", () => {
        expect(nonTransparentBounds(grid("A..", "...", "..B"))).toEqual({
            x: 0,
            y: 0,
            width: 3,
            height: 3,
        });
    });

    it("counts alpha 1", () => {
        const buffer = createPixelBuffer(3, 3);
        buffer.data[(1 * 3 + 1) * 4 + 3] = 1;
        expect(nonTransparentBounds(buffer)).toEqual({ x: 1, y: 1, width: 1, height: 1 });
    });
});

describe("zeroTransparentRgb", () => {
    it("clears RGB where alpha is 0 and nothing else", () => {
        const buffer = grid("aB", ".c");
        buffer.data[4 + 3] = 1;
        const untouched = Array.from(buffer.data.subarray(4, 8));
        zeroTransparentRgb(buffer);
        expect(Array.from(buffer.data.subarray(0, 4))).toEqual([0, 0, 0, 0]);
        expect(Array.from(buffer.data.subarray(4, 8))).toEqual(untouched);
        expect(Array.from(buffer.data.subarray(8, 16))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });
});

describe("flipPixels", () => {
    it("mirrors left and right for horizontal", () => {
        expect(show(flipPixels(grid("ABC", "DEF"), "horizontal"))).toEqual(["CBA", "FED"]);
    });

    it("mirrors top and bottom for vertical", () => {
        expect(show(flipPixels(grid("ABC", "DEF"), "vertical"))).toEqual(["DEF", "ABC"]);
    });

    it("returns a new buffer and gives the source back when applied twice", () => {
        const source = grid("ABC", "DEF");
        for (const axis of ["horizontal", "vertical"] as const) {
            const once = flipPixels(source, axis);
            expect(once.data.buffer).not.toBe(source.data.buffer);
            expect(pixelBuffersEqual(flipPixels(once, axis), source)).toBe(true);
        }
        expect(show(source)).toEqual(["ABC", "DEF"]);
    });
});

describe("rotatePixels", () => {
    const source = grid("ABC", "DEF");

    it("turns 90 degrees clockwise", () => {
        expect(show(rotatePixels(source, 90))).toEqual(["DA", "EB", "FC"]);
    });

    it("turns 180 degrees", () => {
        expect(show(rotatePixels(source, 180))).toEqual(["FED", "CBA"]);
    });

    it("turns 270 degrees clockwise, a quarter turn counter-clockwise", () => {
        expect(show(rotatePixels(source, 270))).toEqual(["CF", "BE", "AD"]);
    });

    it("composes: two quarter turns are a half turn, four give the source back", () => {
        const quarter = rotatePixels(source, 90);
        expect(pixelBuffersEqual(rotatePixels(quarter, 90), rotatePixels(source, 180))).toBe(true);
        expect(pixelBuffersEqual(rotatePixels(quarter, 270), source)).toBe(true);
        expect(pixelBuffersEqual(rotatePixels(rotatePixels(source, 180), 180), source)).toBe(true);
        expect(show(source)).toEqual(["ABC", "DEF"]);
    });

    it("rejects other angles", () => {
        expect(() => rotatePixels(source, 45 as 90)).toThrow(RangeError);
    });
});

describe("resizeNearest", () => {
    it("repeats pixels when scaling up by a whole factor", () => {
        expect(show(resizeNearest(grid("AB", "CD"), 4, 4))).toEqual([
            "AABB",
            "AABB",
            "CCDD",
            "CCDD",
        ]);
        expect(show(resizeNearest(grid("AB"), 6, 1))).toEqual(["AAABBB"]);
    });

    it("takes the source pixel under each result pixel's centre when scaling down", () => {
        // Columns and rows floor((i + 0.5) * 4 / 2) = 1 and 3.
        expect(show(resizeNearest(LETTERS, 2, 2))).toEqual(["FH", "NP"]);
        // Columns floor((i + 0.5) * 3 / 2) = 0 and 2.
        expect(show(resizeNearest(grid("ABC"), 2, 1))).toEqual(["AC"]);
    });

    it("scales each axis on its own", () => {
        // Columns floor((i + 0.5) * 2 / 3) = 0, 1, 1; row floor(0.5 * 2 / 1) = 1.
        expect(show(resizeNearest(grid("AB", "CD"), 3, 1))).toEqual(["CDD"]);
        expect(show(resizeNearest(grid("A"), 2, 3))).toEqual(["AA", "AA", "AA"]);
    });

    it("returns an equal copy for the same size", () => {
        const result = resizeNearest(LETTERS, 4, 4);
        expect(pixelBuffersEqual(result, LETTERS)).toBe(true);
        expect(result.data.buffer).not.toBe(LETTERS.data.buffer);
    });

    it("rejects a size that is not positive integers", () => {
        expect(() => resizeNearest(LETTERS, 0, 4)).toThrow(RangeError);
        expect(() => resizeNearest(LETTERS, 4, 2.5)).toThrow(RangeError);
    });
});
