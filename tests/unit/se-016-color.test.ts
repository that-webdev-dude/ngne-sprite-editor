import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    formatHex,
    hsvToRgb,
    packRgba,
    parseHex,
    rgbToHsv,
    unpackRgba,
} from "../../src/core/color";

// SE-016: the pure colour conversions of `core/color` — sRGB8 ↔ HSV and hex text ↔
// 0xRRGGBBAA — and their round trips on 8-bit values.

/** Every 8-bit grey. */
const GREYS = Array.from({ length: 256 }, (_, value) => [value, value, value] as const);

/** 4096 colours: 16 levels per channel (0, 17, …, 255), every combination. */
const SAMPLE_4096: (readonly [number, number, number])[] = [];
for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) SAMPLE_4096.push([r, g, b]);
    }
}

/** RGB → HSV → RGB. */
function roundTrip(r: number, g: number, b: number) {
    const { h, s, v } = rgbToHsv(r, g, b);
    return hsvToRgb(h, s, v);
}

describe("rgb ↔ hsv", () => {
    it("the sample holds 4096 distinct colours", () => {
        expect(SAMPLE_4096).toHaveLength(4096);
        expect(new Set(SAMPLE_4096.map((rgb) => rgb.join(","))).size).toBe(4096);
    });

    it("hsv→rgb→hsv keeps RGB identical for every 8-bit grey", () => {
        for (const [r, g, b] of GREYS) {
            expect(roundTrip(r, g, b), `${r}`).toEqual({ r, g, b });
            // Back to HSV and once more to RGB: still the same grey.
            const hsv = rgbToHsv(r, g, b);
            expect(hsv.s).toBe(0);
            expect(hsvToRgb(hsv.h, hsv.s, hsv.v)).toEqual({ r, g, b });
        }
    });

    it("hsv→rgb→hsv keeps RGB identical for a 4096-colour sample", () => {
        for (const [r, g, b] of SAMPLE_4096) {
            const hsv = rgbToHsv(r, g, b);
            const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
            expect(rgb, `${r}, ${g}, ${b}`).toEqual({ r, g, b });
            // HSV of that RGB again, and RGB once more: still identical, and the same HSV.
            const again = rgbToHsv(rgb.r, rgb.g, rgb.b);
            expect(again).toEqual(hsv);
            expect(hsvToRgb(again.h, again.s, again.v)).toEqual({ r, g, b });
        }
    });

    it("keeps RGB identical for any 8-bit colour (property)", () => {
        const byte = fc.integer({ min: 0, max: 255 });
        fc.assert(
            fc.property(byte, byte, byte, (r, g, b) => {
                expect(roundTrip(r, g, b)).toEqual({ r, g, b });
            }),
            { numRuns: 20_000 },
        );
    });

    it("an HSV colour's RGB survives HSV and back", () => {
        const fraction = fc.double({ min: 0, max: 1, noNaN: true });
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 360, noNaN: true }),
                fraction,
                fraction,
                (h, s, v) => {
                    const rgb = hsvToRgb(h, s, v);
                    expect(roundTrip(rgb.r, rgb.g, rgb.b)).toEqual(rgb);
                },
            ),
            { numRuns: 5_000 },
        );
    });

    it("gives the HSV of the primaries, the secondaries, white and black", () => {
        expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
        expect(rgbToHsv(255, 255, 0)).toEqual({ h: 60, s: 1, v: 1 });
        expect(rgbToHsv(0, 255, 0)).toEqual({ h: 120, s: 1, v: 1 });
        expect(rgbToHsv(0, 255, 255)).toEqual({ h: 180, s: 1, v: 1 });
        expect(rgbToHsv(0, 0, 255)).toEqual({ h: 240, s: 1, v: 1 });
        expect(rgbToHsv(255, 0, 255)).toEqual({ h: 300, s: 1, v: 1 });
        expect(rgbToHsv(255, 255, 255)).toEqual({ h: 0, s: 0, v: 1 });
        expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
        expect(rgbToHsv(255, 0, 1).h).toBeGreaterThan(359);
        expect(rgbToHsv(255, 0, 1).h).toBeLessThan(360);
        expect(hsvToRgb(360, 1, 1)).toEqual({ r: 255, g: 0, b: 0 });
        expect(hsvToRgb(30, 1, 1)).toEqual({ r: 255, g: 128, b: 0 });
    });

    it("keeps the previous hue for a grey, and the previous hue and saturation for black", () => {
        const previous = { h: 200, s: 0.4, v: 0.7 };
        expect(rgbToHsv(128, 128, 128, previous)).toEqual({ h: 200, s: 0, v: 128 / 255 });
        expect(rgbToHsv(0, 0, 0, previous)).toEqual({ h: 200, s: 0.4, v: 0 });
        // A colour with a hue of its own takes it.
        expect(rgbToHsv(0, 0, 255, previous)).toEqual({ h: 240, s: 1, v: 1 });
    });

    it("clamps saturation and value outside 0..1 and wraps the hue", () => {
        expect(hsvToRgb(-120, 2, 1.5)).toEqual(hsvToRgb(240, 1, 1));
        expect(hsvToRgb(480, -1, 0.5)).toEqual({ r: 128, g: 128, b: 128 });
    });
});

describe("hex ↔ rgba", () => {
    it("accepts 3, 4, 6 and 8 digits", () => {
        expect(parseHex("#f80")).toBe(0xff8800ff);
        expect(parseHex("#f808")).toBe(0xff880088);
        expect(parseHex("#12ab9f")).toBe(0x12ab9fff);
        expect(parseHex("#12ab9f40")).toBe(0x12ab9f40);
    });

    it("accepts the digits with or without #, in either case, with white space around", () => {
        expect(parseHex("F80")).toBe(0xff8800ff);
        expect(parseHex("12AB9F")).toBe(0x12ab9fff);
        expect(parseHex("  #12Ab9F40 ")).toBe(0x12ab9f40);
        expect(parseHex("#000")).toBe(0x000000ff);
        expect(parseHex("#0000")).toBe(0);
        expect(parseHex("ffffffff")).toBe(0xffffffff);
    });

    it("refuses any other text", () => {
        for (const text of [
            "",
            "#",
            "#f",
            "#ff",
            "#fffff",
            "#fffffff",
            "#fffffffff",
            "#ggg",
            "##fff",
            "# fff",
            "rgb(0,0,0)",
            "0x123456",
        ]) {
            expect(parseHex(text), JSON.stringify(text)).toBeNull();
        }
    });

    it("writes six digits for an opaque colour and eight otherwise, in upper case", () => {
        expect(formatHex(0x12ab9fff)).toBe("#12AB9F");
        expect(formatHex(0x12ab9f40)).toBe("#12AB9F40");
        expect(formatHex(0)).toBe("#00000000");
        expect(formatHex(0x12ab9fff, true)).toBe("#12AB9FFF");
        // A signed 32-bit value is the same colour.
        expect(formatHex(0xff0000ff | 0)).toBe("#FF0000");
    });

    it("round-trips every 8-bit value of every channel, and a random sample of colours", () => {
        for (let value = 0; value < 256; value++) {
            for (const colour of [
                packRgba(value, 0, 0, 255),
                packRgba(0, value, 0, 255),
                packRgba(0, 0, value, 255),
                packRgba(17, 34, 51, value),
            ]) {
                expect(parseHex(formatHex(colour))).toBe(colour);
                expect(parseHex(formatHex(colour, true))).toBe(colour);
            }
        }
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 0xffffffff }), (colour) => {
                expect(parseHex(formatHex(colour))).toBe(colour);
            }),
            { numRuns: 10_000 },
        );
    });

    it("packs and unpacks the four channels", () => {
        expect(unpackRgba(0x12ab9f40)).toEqual({ r: 0x12, g: 0xab, b: 0x9f, a: 0x40 });
        expect(packRgba(0xff, 0, 0, 0xff)).toBe(0xff0000ff);
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 0xffffffff }), (colour) => {
                const { r, g, b, a } = unpackRgba(colour);
                expect(packRgba(r, g, b, a)).toBe(colour);
            }),
        );
    });
});
