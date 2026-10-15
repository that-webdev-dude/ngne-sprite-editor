import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isLCorner, linePixels, PixelPerfectFilter, pixelPerfectPath } from "../../src/core/raster";
import type { PixelPoint } from "../../src/core/raster";

// SE-015: Bresenham lines between pointer samples, and the pixel-perfect filter on a diagonal
// and on an L-shaped corner (golden paths written out by hand), as a whole path and as a
// stroke goes.

const p = (x: number, y: number): PixelPoint => ({ x, y });

/** The pixels of a path drawn on a `width` × `height` grid, as rows of `#` and `.`. */
function grid(points: readonly PixelPoint[], width: number, height: number): string[] {
    const rows = Array.from({ length: height }, () => Array<string>(width).fill("."));
    for (const { x, y } of points) rows[y]![x] = "#";
    return rows.map((row) => row.join(""));
}

describe("Bresenham lines", () => {
    it("draws both ends and every pixel between them, golden", () => {
        expect(grid(linePixels(p(0, 0), p(7, 3)), 8, 4)).toEqual([
            "##......",
            "..##....",
            "....##..",
            "......##",
        ]);
        expect(grid(linePixels(p(1, 0), p(2, 5)), 4, 6)).toEqual([
            ".#..",
            ".#..",
            ".#..",
            "..#.",
            "..#.",
            "..#.",
        ]);
        expect(linePixels(p(3, 3), p(3, 3))).toEqual([p(3, 3)]);
        expect(linePixels(p(2, 1), p(-1, -2))).toEqual([p(2, 1), p(1, 0), p(0, -1), p(-1, -2)]);
    });

    it("leaves no gap: each pixel is one of the 8 neighbours of the one before, in any octant", () => {
        const coordinate = fc.integer({ min: -300, max: 300 });
        fc.assert(
            fc.property(coordinate, coordinate, coordinate, coordinate, (x0, y0, x1, y1) => {
                const line = linePixels(p(x0, y0), p(x1, y1));
                expect(line[0]).toEqual(p(x0, y0));
                expect(line.at(-1)).toEqual(p(x1, y1));
                // As many pixels as the longer axis has steps, plus one.
                expect(line).toHaveLength(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
                for (let index = 1; index < line.length; index++) {
                    const a = line[index - 1]!;
                    const b = line[index]!;
                    expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBe(1);
                }
            }),
        );
    });

    it("refuses ends that are not whole numbers", () => {
        expect(() => linePixels(p(0.5, 0), p(2, 2))).toThrow(RangeError);
    });
});

/** Runs the filter as a stroke does: the pixels left drawn after the last one. */
function filtered(path: readonly PixelPoint[]): PixelPoint[] {
    const filter = new PixelPerfectFilter();
    const drawn: PixelPoint[] = [];
    for (const pixel of path) {
        drawn.push(pixel);
        const { removed } = filter.add(pixel);
        if (removed) {
            // The pixel taken back is the one drawn just before.
            expect(drawn.at(-2)).toBe(removed);
            drawn.splice(drawn.length - 2, 1);
        }
    }
    return drawn;
}

describe("pixel-perfect", () => {
    // A slow diagonal drawn by hand: one step right, one step down, and so on.
    const staircase = [p(0, 0), p(1, 0), p(1, 1), p(2, 1), p(2, 2), p(3, 2), p(3, 3), p(4, 3)];

    it("turns a staircase into a clean diagonal, golden", () => {
        expect(grid(staircase, 5, 4)).toEqual(["##...", ".##..", "..##.", "...##"]);
        const kept = pixelPerfectPath(staircase);
        expect(grid(kept, 5, 4)).toEqual(["#....", ".#...", "..#..", "...##"]);
        expect(filtered(staircase)).toEqual(kept);
    });

    it("removes the corner pixel of an L, golden", () => {
        const l = [p(0, 0), p(1, 0), p(2, 0), p(2, 1), p(2, 2), p(2, 3)];
        const kept = pixelPerfectPath(l);
        expect(grid(kept, 3, 4)).toEqual(["##.", "..#", "..#", "..#"]);
        expect(filtered(l)).toEqual(kept);
    });

    it("leaves straight lines, true diagonals and the path's ends alone", () => {
        const straight = [p(0, 0), p(1, 0), p(2, 0), p(3, 0)];
        const diagonal = [p(0, 0), p(1, 1), p(2, 2), p(3, 3)];
        expect(pixelPerfectPath(straight)).toEqual(straight);
        expect(pixelPerfectPath(diagonal)).toEqual(diagonal);
        expect(pixelPerfectPath([p(0, 0), p(1, 0)])).toEqual([p(0, 0), p(1, 0)]);
        expect(isLCorner(p(0, 0), p(1, 0), p(1, 1))).toBe(true);
        expect(isLCorner(p(0, 0), p(1, 0), p(2, 0))).toBe(false);
        expect(isLCorner(p(0, 0), p(1, 1), p(2, 1))).toBe(false);
    });

    it("as a stroke goes, keeps exactly the pixels of the whole path's filter", () => {
        // Random walks of unit steps, as slow hand-drawn strokes give.
        const step = fc.constantFrom(p(1, 0), p(-1, 0), p(0, 1), p(0, -1), p(1, 1), p(-1, 1));
        fc.assert(
            fc.property(fc.array(step, { minLength: 0, maxLength: 60 }), (steps) => {
                const path = [p(0, 0)];
                for (const { x, y } of steps) {
                    const last = path.at(-1)!;
                    path.push(p(last.x + x, last.y + y));
                }
                expect(filtered(path)).toEqual(pixelPerfectPath(path));
            }),
        );
    });
});
