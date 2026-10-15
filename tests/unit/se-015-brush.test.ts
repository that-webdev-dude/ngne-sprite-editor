import { describe, expect, it } from "vitest";
import {
    BRUSH_MAX_SIZE,
    BRUSH_MIN_SIZE,
    brushBounds,
    brushCovers,
    brushRuns,
    createBrush,
} from "../../src/core/raster";
import type { Brush, BrushShape } from "../../src/core/raster";

// SE-015: brush stamps. Golden masks for sizes 1–8 in both shapes, written out by hand: the
// square fills its square; the circle is the filled ellipse that fits it (Zingl's algorithm,
// as Aseprite draws its circle brushes). A brush is placed as Aseprite places it: its top-left
// pixel is size / 2 (rounded down) up and left of the pixel under the pointer.

/** The brush's square as rows of `#` (covered) and `.`. */
function mask(brush: Brush): string[] {
    const rows: string[] = [];
    for (let row = 0; row < brush.size; row++) {
        let line = "";
        for (let column = 0; column < brush.size; column++) {
            line += brushCovers(brush, column, row) ? "#" : ".";
        }
        rows.push(line);
    }
    return rows;
}

const CIRCLES: Record<number, string[]> = {
    1: ["#"],
    2: ["##", "##"],
    3: [".#.", "###", ".#."],
    4: [".##.", "####", "####", ".##."],
    5: [".###.", "#####", "#####", "#####", ".###."],
    6: ["..##..", ".####.", "######", "######", ".####.", "..##.."],
    7: ["..###..", ".#####.", "#######", "#######", "#######", ".#####.", "..###.."],
    8: [
        "..####..",
        ".######.",
        "########",
        "########",
        "########",
        "########",
        ".######.",
        "..####..",
    ],
};

describe("brush stamps, golden", () => {
    for (let size = 1; size <= 8; size++) {
        it(`square ${size}`, () => {
            expect(mask(createBrush("square", size))).toEqual(
                Array.from({ length: size }, () => "#".repeat(size)),
            );
        });
        it(`circle ${size}`, () => {
            expect(mask(createBrush("circle", size))).toEqual(CIRCLES[size]);
        });
    }
});

describe("placement", () => {
    it("centres an odd brush on the pixel, and puts the pixel at the lower right of an even brush's centre", () => {
        // size: the first covered column (and row) when placed at 10, 20.
        const expected: [number, number][] = [
            [1, 0],
            [2, -1],
            [3, -1],
            [4, -2],
            [5, -2],
            [8, -4],
            [64, -32],
        ];
        for (const [size, offset] of expected) {
            for (const shape of ["square", "circle"] as const) {
                const brush = createBrush(shape, size);
                expect(brush.origin, `${shape} ${size}`).toBe(offset);
                expect(brushBounds(brush, 10, 20)).toEqual({
                    x: 10 + offset,
                    y: 20 + offset,
                    width: size,
                    height: size,
                });
            }
        }
    });

    it("lists the footprint as one run per row, in document pixels", () => {
        const brush = createBrush("circle", 4);
        expect(brushRuns(brush, 10, 20)).toEqual([
            { y: 18, x: 9, end: 11 },
            { y: 19, x: 8, end: 12 },
            { y: 20, x: 8, end: 12 },
            { y: 21, x: 9, end: 11 },
        ]);
    });
});

describe("every size from 1 to 64", () => {
    const shapes: BrushShape[] = ["square", "circle"];
    for (const shape of shapes) {
        it(`${shape}: symmetric, one run per row, touching every side of its square`, () => {
            for (let size = BRUSH_MIN_SIZE; size <= BRUSH_MAX_SIZE; size++) {
                const brush = createBrush(shape, size);
                const rows = mask(brush);
                const label = `${shape} ${size}`;
                // Mirror images left–right, top–bottom and across the diagonal.
                expect(
                    rows.map((row) => [...row].reverse().join("")),
                    label,
                ).toEqual(rows);
                expect([...rows].reverse(), label).toEqual(rows);
                const transposed = rows.map((_, column) => rows.map((row) => row[column]).join(""));
                expect(transposed, label).toEqual(rows);
                // Each row is one run, never empty.
                for (const row of rows) expect(row, label).toMatch(/^\.*#+\.*$/);
                // It fits its square exactly: the middle row and column are full.
                expect(rows[Math.floor(size / 2)], label).toBe("#".repeat(size));
                // Rows widen towards the middle and narrow after it (convex).
                const widths = rows.map((row) => row.replaceAll(".", "").length);
                const middle = Math.floor(size / 2);
                for (let row = 1; row <= middle; row++) {
                    expect(widths[row], label).toBeGreaterThanOrEqual(widths[row - 1]!);
                }
            }
        });
    }

    it("refuses sizes outside 1–64 and fractions", () => {
        for (const size of [0, 65, 1.5, Number.NaN]) {
            expect(() => createBrush("square", size)).toThrow(RangeError);
        }
    });
});
