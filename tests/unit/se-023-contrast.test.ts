import { describe, expect, it } from "vitest";
import { TAG_COLOURS } from "../../src/app/timeline/tagDialogs";
import {
    BLACK,
    contrastRatio,
    labelColourOn,
    relativeLuminance,
    WHITE,
} from "../../src/core/color/contrast";

// SE-023: the label of a tag's span is black or white, whichever contrasts more with the span's
// colour (DESIGN §3.1), and so at least 4.5:1 against it (WCAG 2.1 AA for normal text).

/**
 * WCAG 2.1 contrast of `colour` (0xRRGGBBAA) with black or white, written out here apart from
 * the module under test, so a mistake there is not measured with itself.
 */
function referenceContrast(colour: number, label: "black" | "white"): number {
    const channel = (shift: number) => {
        const value = Math.floor(colour / 2 ** shift) % 256;
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = 0.2126 * channel(24) + 0.7152 * channel(16) + 0.0722 * channel(8);
    return label === "black" ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
}

/** The contrast of the label the tag bar draws on `colour`. */
function labelContrast(colour: number): number {
    return referenceContrast(colour, labelColourOn(colour));
}

const MID_GREY = 0x808080ff;

describe("contrast of a tag's label against its span", () => {
    it("follows WCAG 2.1: relative luminance and the contrast ratio, alpha left out", () => {
        expect(relativeLuminance(BLACK)).toBe(0);
        expect(relativeLuminance(WHITE)).toBeCloseTo(1, 12);
        expect(relativeLuminance(MID_GREY)).toBeCloseTo(0.2158605, 6);
        expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 12);
        expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 12);
        expect(contrastRatio(MID_GREY, BLACK)).toBeCloseTo(5.317, 3);
        expect(contrastRatio(MID_GREY, WHITE)).toBeCloseTo(3.949, 3);
        // The span is drawn opaque: its colour's alpha changes nothing.
        expect(relativeLuminance(0x80808000)).toBe(relativeLuminance(MID_GREY));
        expect(labelColourOn(0xffffff00)).toBe(labelColourOn(WHITE));
    });

    it("is at least 4.5:1 for black, white and mid-grey spans", () => {
        expect(labelColourOn(BLACK)).toBe("white");
        expect(labelColourOn(WHITE)).toBe("black");
        expect(labelColourOn(MID_GREY)).toBe("black");
        for (const colour of [BLACK, WHITE, MID_GREY]) {
            expect(labelContrast(colour)).toBeGreaterThanOrEqual(4.5);
        }
        expect(labelContrast(BLACK)).toBeCloseTo(21, 12);
        expect(labelContrast(WHITE)).toBeCloseTo(21, 12);
    });

    it("is at least 4.5:1 on every grey", () => {
        let lowest = Infinity;
        for (let level = 0; level < 256; level++) {
            const grey = ((level << 24) | (level << 16) | (level << 8) | 0xff) >>> 0;
            lowest = Math.min(lowest, labelContrast(grey));
        }
        expect(lowest).toBeGreaterThanOrEqual(4.5);
    });

    it("is at least 4.5:1 on every colour of a 32-level grid, and on the preset tag colours", () => {
        let lowest = Infinity;
        const levels = Array.from({ length: 32 }, (_, index) => Math.round((index * 255) / 31));
        for (const r of levels) {
            for (const g of levels) {
                for (const b of levels) {
                    const colour = ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
                    lowest = Math.min(lowest, labelContrast(colour));
                }
            }
        }
        expect(lowest).toBeGreaterThanOrEqual(4.5);
        for (const { name, color } of TAG_COLOURS) {
            expect(labelContrast(color), name).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("takes black or white, whichever has the higher contrast", () => {
        // Just either side of the luminance where both contrasts are equal (about 0.179).
        expect(labelColourOn(0x757575ff)).toBe("white");
        expect(labelColourOn(0x767676ff)).toBe("black");
        // Primaries: red (0.2126) and green (0.7152) are light enough for black, blue
        // (0.0722) is not.
        expect(labelColourOn(0xff0000ff)).toBe("black");
        expect(labelColourOn(0x00ff00ff)).toBe("black");
        expect(labelColourOn(0x0000ffff)).toBe("white");
        // A mid blue (luminance about 0.146) and an amber (about 0.644).
        expect(labelColourOn(0x3366ccff)).toBe("white");
        expect(labelColourOn(0xffcc00ff)).toBe("black");
    });

    it("weighs the channels in the order red, green, blue, and leaves alpha out", () => {
        // WCAG 2.1: the coefficients of the three primaries, each at full intensity.
        expect(relativeLuminance(0xff0000ff)).toBeCloseTo(0.2126, 12);
        expect(relativeLuminance(0x00ff00ff)).toBeCloseTo(0.7152, 12);
        expect(relativeLuminance(0x0000ffff)).toBeCloseTo(0.0722, 12);
        expect(relativeLuminance(0x000000ff)).toBe(0);
        expect(relativeLuminance(0x00000000)).toBe(0);
        // A channel at half level: 128/255 linearized is 0.2158605 (the sRGB transfer curve).
        expect(relativeLuminance(0x800000ff)).toBeCloseTo(0.2126 * 0.2158605, 6);
        expect(relativeLuminance(0x000080ff)).toBeCloseTo(0.0722 * 0.2158605, 6);
        // Below the curve's knee (10/255 ≤ 0.04045) the transfer is linear: c / 12.92.
        expect(relativeLuminance(0x0a0a0aff)).toBeCloseTo(10 / 255 / 12.92, 12);
        // Contrast ratios of known pairs: red on black 5.252, blue on white 8.592.
        expect(contrastRatio(0xff0000ff, BLACK)).toBeCloseTo(5.252, 3);
        expect(contrastRatio(0x0000ffff, WHITE)).toBeCloseTo(8.592, 3);
    });
});
