import { describe, expect, it } from "vitest";
import {
    GRID_BORDER,
    SWATCH,
    VISIBLE_ROWS,
    gridColumns,
    gridScrolls,
} from "../../src/ui/colour/gridColumns";

// SE-060: the columns of the palette grid (DESIGN §5.4) leave room for the scroll bar, so the
// grid never overflows the dock sideways. A scroll bar is 0 px wide where it is hidden (the
// headless browser), 15 px in Chrome on Windows with the thin style, other widths elsewhere.

/** The dock's left border and the section's 12 px padding on each side. */
const DOCK_CHROME = 1 + 2 * 12;
const GUTTERS = [0, 8, 15, 17];

/** The section's width in a dock `dock` px wide, with or without the dock's own scroll bar. */
function sectionWidths(dock: number, gutter: number): number[] {
    return [dock - DOCK_CHROME, dock - DOCK_CHROME - gutter];
}

describe("gridColumns", () => {
    it("fits the most columns a 256-colour grid and its scroll bar allow, at docks 220 and 360", () => {
        expect([SWATCH, GRID_BORDER, VISIBLE_ROWS]).toEqual([16, 1, 8]);
        for (const dock of [220, 360]) {
            for (const gutter of GUTTERS) {
                for (const width of sectionWidths(dock, gutter)) {
                    const columns = gridColumns(width, 256, gutter);
                    const where = `dock ${dock}, section ${width}, gutter ${gutter}`;
                    expect(gridScrolls(256, columns), where).toBe(true);
                    expect(columns * 16 + 2 + gutter, where).toBeLessThanOrEqual(width);
                    expect((columns + 1) * 16 + 2 + gutter, where).toBeGreaterThan(width);
                }
            }
        }
    });

    it("leaves no room for a scroll bar a grid of eight rows or fewer does not have", () => {
        for (const dock of [220, 360]) {
            for (const gutter of GUTTERS) {
                for (const width of sectionWidths(dock, gutter)) {
                    const columns = gridColumns(width, 64, gutter);
                    const where = `dock ${dock}, section ${width}, gutter ${gutter}`;
                    expect(gridScrolls(64, columns), where).toBe(false);
                    expect(columns * 16 + 2, where).toBeLessThanOrEqual(width);
                    expect((columns + 1) * 16 + 2, where).toBeGreaterThan(width);
                }
            }
        }
    });

    it("takes the scroll bar when the columns that fit without it leave more than eight rows", () => {
        // 12 columns fit 194 px, and 100 colours need 9 rows of 12: the scroll bar costs one.
        expect(gridColumns(194, 100, 0)).toBe(12);
        expect(gridColumns(194, 100, 15)).toBe(11);
        // 96 colours are 8 rows of 12: no scroll bar, no column lost.
        expect(gridColumns(194, 96, 15)).toBe(12);
    });

    it("has at least one column, and never more than there are colours", () => {
        expect(gridColumns(0, 10, 15)).toBe(1);
        expect(gridColumns(10, 10, 0)).toBe(1);
        expect(gridColumns(335, 5, 0)).toBe(5);
        expect(gridColumns(335, 1, 15)).toBe(1);
    });
});
