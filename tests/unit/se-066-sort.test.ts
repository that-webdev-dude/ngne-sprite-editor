import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rgbToHsv, writeOklab } from "../../src/core/color";
import { History } from "../../src/core/history";
import { createDocument } from "../../src/core/model";
import {
    isPermutation,
    restoreOrderCommand,
    sortPaletteCommand,
    sortedColours,
} from "../../src/core/palettes";

// SE-066: sorting the palette in `core/palettes` — by hue (greys first) or by OKLab lightness,
// each one undo step of the palette — and putting an order back.

const RED = 0xff0000ff;
const ORANGE = 0xff8000ff;
const GREEN = 0x00ff00ff;
const BLUE = 0x0000ffff;
const BLACK = 0x000000ff;
const GREY = 0x808080ff;
const WHITE = 0xffffffff;
const DARK_RED = 0x800000ff;

function session(colors: number[]) {
    const created = createDocument({ name: "sort", width: 2, height: 2 });
    created.doc.palette = { name: "Mixed", colors: [...colors] };
    return created;
}

describe("sortedColours", () => {
    it("by hue: greys first, dark to light, then hue, then saturation and value", () => {
        expect(
            sortedColours([BLUE, WHITE, GREEN, RED, GREY, ORANGE, BLACK, DARK_RED], "hue"),
        ).toEqual([BLACK, GREY, WHITE, DARK_RED, RED, ORANGE, GREEN, BLUE]);
    });

    it("by lightness: OKLab L, dark to light; of equal lightness the lower alpha first", () => {
        expect(sortedColours([WHITE, BLUE, RED, BLACK, GREEN, GREY], "lightness")).toEqual([
            BLACK,
            BLUE,
            GREY,
            RED,
            GREEN,
            WHITE,
        ]);
        expect(sortedColours([0xff0000ff, 0xff000080, 0xff000001], "lightness")).toEqual([
            0xff000001, 0xff000080, 0xff0000ff,
        ]);
    });

    it("keeps the colours, orders by its key, and keeps equal keys in their order", () => {
        const lab = new Float64Array(3);
        const lightness = (colour: number) => {
            writeOklab(lab, 0, colour >>> 24, (colour >>> 16) & 0xff, (colour >>> 8) & 0xff);
            return lab[0];
        };
        const hue = (colour: number) => {
            const { h, s } = rgbToHsv(colour >>> 24, (colour >>> 16) & 0xff, (colour >>> 8) & 0xff);
            return s === 0 ? -1 : h;
        };
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 0, max: 0xffffffff }), { maxLength: 64 }),
                (colors) => {
                    for (const [key, measure] of [
                        ["hue", hue],
                        ["lightness", lightness],
                    ] as const) {
                        const sorted = sortedColours(colors, key);
                        expect(isPermutation(sorted, colors)).toBe(true);
                        for (let at = 1; at < sorted.length; at++) {
                            expect(measure(sorted[at - 1])).toBeLessThanOrEqual(
                                measure(sorted[at]),
                            );
                        }
                        // Sorting again changes nothing.
                        expect(sortedColours(sorted, key)).toEqual(sorted);
                    }
                },
            ),
        );
    });
});

describe("isPermutation", () => {
    it("is true for the same colours as often each, in any order", () => {
        expect(isPermutation([1, 2, 2, 3], [2, 3, 2, 1])).toBe(true);
        expect(isPermutation([1, 2, 2], [1, 1, 2])).toBe(false);
        expect(isPermutation([1, 2], [1, 2, 3])).toBe(false);
        expect(isPermutation([], [])).toBe(true);
    });
});

describe("commands", () => {
    it("a sort is one undo step that keeps the name, and none when the order would not change", () => {
        const target = session([WHITE, RED, BLACK]);
        const history = new History(target);
        const command = sortPaletteCommand(target, "lightness");
        expect(command?.label).toBe("Sort Palette by Lightness");
        expect(command?.touched).toEqual({ frameIds: [], layerIds: [], structure: false });
        history.execute(command!);
        expect(target.doc.palette).toEqual({ name: "Mixed", colors: [BLACK, RED, WHITE] });
        expect(history.undoCount).toBe(1);
        expect(sortPaletteCommand(target, "lightness")).toBeNull();
        history.undo();
        expect(target.doc.palette.colors).toEqual([WHITE, RED, BLACK]);
        expect(sortPaletteCommand(target, "hue")?.label).toBe("Sort Palette by Hue");
    });

    it("restoring an order puts back those colours in that order, and only those colours", () => {
        const target = session([BLACK, RED, WHITE]);
        const history = new History(target);
        history.execute(restoreOrderCommand(target, [WHITE, RED, BLACK])!);
        expect(target.doc.palette).toEqual({ name: "Mixed", colors: [WHITE, RED, BLACK] });
        expect(history.undoLabel).toBe("Original Palette Order");
        expect(restoreOrderCommand(target, [WHITE, RED, BLACK])).toBeNull();
        expect(restoreOrderCommand(target, [WHITE, RED])).toBeNull();
        expect(restoreOrderCommand(target, [WHITE, RED, GREEN])).toBeNull();
    });
});
