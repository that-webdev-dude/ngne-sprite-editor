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

/** The contrast of the label the tag bar draws on `colour`. */
function labelContrast(colour: number): number {
    return contrastRatio(colour, labelColourOn(colour) === "black" ? BLACK : WHITE);
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
        for (const colour of [0x757575ff, 0x767676ff, 0x3366ccff, 0xffcc00ff]) {
            const black = contrastRatio(colour, BLACK);
            const white = contrastRatio(colour, WHITE);
            expect(labelColourOn(colour)).toBe(black >= white ? "black" : "white");
        }
    });
});
