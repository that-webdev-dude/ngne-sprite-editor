import { describe, expect, it } from "vitest";
import { pack } from "../../src/core/export";
import type { PackOptions, PackedRect } from "../../src/core/export";
import { cropPixels, pixelBuffersEqual } from "../../src/core/pixels";
import { atlasOf, contentOf, firstDifference, grid, noise, show } from "./se-050-support";

// Every expected size, position and pixel below was worked out by hand from SPEC §9.2 and
// §9.4; the arithmetic is written next to it. On each axis, with `cell` the largest
// rectangle and r the number of rectangles:
//
//     pitch      = cell + padding + 2·extrude
//     atlas side = n × pitch + padding               n cells along the side
//     rect start = padding + extrude + i × pitch     i the rectangle's column or row
//     grid       = ⌈√r⌉ columns, ⌈r / columns⌉ rows, filled row by row

function places(rects: readonly PackedRect[]): number[][] {
    return rects.map(({ x, y }) => [x, y]);
}

/** The rectangle of a whole frame of even size at (`x`, `y`). */
function whole(x: number, y: number, size: number, frameIndex: number): PackedRect {
    return {
        x,
        y,
        w: size,
        h: size,
        sourceW: size,
        sourceH: size,
        offsetX: 0,
        offsetY: 0,
        contentW: size,
        contentH: size,
        frameIndices: [frameIndex],
    };
}

describe("pack, 8 frames of 32×32 with padding 1", () => {
    /** Eight different opaque frames. */
    const frames = Array.from({ length: 8 }, (_, seed) => noise(32, 32, seed));
    // pitch = 32 + 1 + 2·0 = 33 on both axes. A column or row i starts at 1 + 0 + i × 33:
    const starts = [1, 34, 67, 100, 133, 166, 199, 232];

    it("grid: 3 × 3 cells in 100×100", () => {
        const { atlas, rects } = pack(frames, { layout: "grid", padding: 1 });

        // ⌈√8⌉ = ⌈2.83⌉ = 3 columns, ⌈8 / 3⌉ = 3 rows; each side is 3 × 33 + 1 = 100.
        expect([atlas.width, atlas.height]).toEqual([100, 100]);
        // Row by row; the ninth cell stays empty.
        expect(places(rects)).toEqual([
            [1, 1],
            [34, 1],
            [67, 1],
            [1, 34],
            [34, 34],
            [67, 34],
            [1, 67],
            [34, 67],
        ]);
    });

    it("row: 8 × 1 cells in 265×34", () => {
        const { atlas, rects } = pack(frames, { layout: "row", padding: 1 });

        // Width 8 × 33 + 1 = 265, height 1 × 33 + 1 = 34.
        expect([atlas.width, atlas.height]).toEqual([265, 34]);
        expect(places(rects)).toEqual(starts.map((x) => [x, 1]));
    });

    it("column: 1 × 8 cells in 34×265", () => {
        const { atlas, rects } = pack(frames, { layout: "column", padding: 1 });

        // Width 1 × 33 + 1 = 34, height 8 × 33 + 1 = 265.
        expect([atlas.width, atlas.height]).toEqual([34, 265]);
        expect(places(rects)).toEqual(starts.map((y) => [1, y]));
    });

    it("in every layout, rect i is the whole of frame i and the rest is transparent", () => {
        for (const layout of ["grid", "row", "column"] as const) {
            const { atlas, rects } = pack(frames, { layout, padding: 1 });

            expect(rects, layout).toEqual(rects.map(({ x, y }, i) => whole(x, y, 32, i)));
            rects.forEach((rect, i) => {
                expect(pixelBuffersEqual(contentOf(atlas, rect), frames[i]), layout).toBe(true);
            });
            const expected = atlasOf(atlas.width, atlas.height, rects, frames, 0);
            expect(firstDifference(atlas, expected), layout).toBeNull();
        }
    });
});

describe("pack, the example of SPEC §9.2", () => {
    it("packs 4 frames of 32×32 with padding 1 into 67×67, the first at 1, 1", () => {
        const frames = Array.from({ length: 4 }, (_, seed) => noise(32, 32, seed));
        const { atlas, rects } = pack(frames, { padding: 1 });

        // ⌈√4⌉ = 2 columns, ⌈4 / 2⌉ = 2 rows; each side is 2 × (32 + 1) + 1 = 67.
        expect([atlas.width, atlas.height]).toEqual([67, 67]);
        // Starts 1 and 1 + 33 = 34.
        expect(rects).toEqual([
            whole(1, 1, 32, 0),
            whole(34, 1, 32, 1),
            whole(1, 34, 32, 2),
            whole(34, 34, 32, 3),
        ]);
    });

    it("keeps that size for 3 frames, whose fourth cell is empty", () => {
        const frames = Array.from({ length: 3 }, (_, seed) => noise(32, 32, seed));
        const { atlas, rects } = pack(frames, { padding: 1 });

        // ⌈√3⌉ = ⌈1.73⌉ = 2 columns, ⌈3 / 2⌉ = 2 rows.
        expect([atlas.width, atlas.height]).toEqual([67, 67]);
        expect(places(rects)).toEqual([
            [1, 1],
            [34, 1],
            [1, 34],
        ]);
    });
});

describe("pack, a 33×33 frame", () => {
    it("yields a 34×34 rect with a transparent last column and row", () => {
        const frame = noise(33, 33, 7);
        const { atlas, rects } = pack([frame], { padding: 1 });

        // 33 is odd, so w = h = 34. One cell: each side is 1 × (34 + 1) + 1 = 36.
        expect([atlas.width, atlas.height]).toEqual([36, 36]);
        expect(rects).toEqual([
            {
                x: 1,
                y: 1,
                w: 34,
                h: 34,
                sourceW: 33,
                sourceH: 33,
                offsetX: 0,
                offsetY: 0,
                // min(34, 33 − 0) = 33.
                contentW: 33,
                contentH: 33,
                frameIndices: [0],
            },
        ]);
        expect(pixelBuffersEqual(contentOf(atlas, rects[0]), frame)).toBe(true);
        // The rect spans 1..34 on both axes; its last column and row are at 34.
        const lastColumn = cropPixels(atlas, { x: 34, y: 1, width: 1, height: 34 });
        const lastRow = cropPixels(atlas, { x: 1, y: 34, width: 34, height: 1 });
        expect(Array.from(lastColumn.data)).toEqual(new Array(34 * 4).fill(0));
        expect(Array.from(lastRow.data)).toEqual(new Array(34 * 4).fill(0));
        // The column and row before them are the opaque last ones of the frame.
        const beforeColumn = cropPixels(atlas, { x: 33, y: 1, width: 1, height: 33 });
        const beforeRow = cropPixels(atlas, { x: 1, y: 33, width: 33, height: 1 });
        expect(beforeColumn.data.filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true);
        expect(beforeRow.data.filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true);
    });
});

describe("pack, small atlases pixel by pixel", () => {
    const AD = grid("AB", "CD");
    const EH = grid("EF", "GH");
    const IL = grid("IJ", "KL");
    const MP = grid("MN", "OP");

    function packed(
        frames: Parameters<typeof pack>[0],
        options: Partial<PackOptions>,
    ): { rows: string[]; at: number[][] } {
        const { atlas, rects } = pack(frames, options);
        return { rows: show(atlas), at: places(rects) };
    }

    it("puts the padding between cells and at every border", () => {
        // pitch = 2 + 1 = 3: width 2 × 3 + 1 = 7, height 1 × 3 + 1 = 4; starts 1 and 4.
        expect(packed([AD, EH], { layout: "row", padding: 1 })).toEqual({
            rows: [".......", ".AB.EF.", ".CD.GH.", "......."],
            at: [
                [1, 1],
                [4, 1],
            ],
        });
        // pitch = 2 + 3 = 5: width 1 × 5 + 3 = 8, height 2 × 5 + 3 = 13; starts 3 and 8.
        expect(packed([AD, EH], { layout: "column", padding: 3 })).toEqual({
            rows: [
                "........",
                "........",
                "........",
                "...AB...",
                "...CD...",
                "........",
                "........",
                "........",
                "...EF...",
                "...GH...",
                "........",
                "........",
                "........",
            ],
            at: [
                [3, 3],
                [3, 8],
            ],
        });
    });

    it("with padding 0 and extrude 0 the rects touch", () => {
        // pitch = 2: each side is 2 × 2 + 0 = 4; starts 0 and 2.
        expect(packed([AD, EH, IL, MP], { layout: "grid", padding: 0 })).toEqual({
            rows: ["ABEF", "CDGH", "IJMN", "KLOP"],
            at: [
                [0, 0],
                [2, 0],
                [0, 2],
                [2, 2],
            ],
        });
    });

    it("extrude repeats the edge pixels around each rect, inside the padding", () => {
        // pitch = 2 + 1 + 2·1 = 5: width 2 × 5 + 1 = 11, height 1 × 5 + 1 = 6;
        // starts 1 + 1 = 2 and 2 + 5 = 7. Each rect has one gutter pixel on every side.
        expect(packed([AD, EH], { layout: "row", padding: 1, extrude: 1 })).toEqual({
            rows: [
                "...........",
                ".AABB.EEFF.",
                ".AABB.EEFF.",
                ".CCDD.GGHH.",
                ".CCDD.GGHH.",
                "...........",
            ],
            at: [
                [2, 2],
                [7, 2],
            ],
        });
    });

    it("extrude 2 fills two pixels on every side, the corners with the corner pixel", () => {
        // pitch = 2 + 0 + 2·2 = 6: each side is 1 × 6 + 0 = 6; start 0 + 2 = 2.
        expect(packed([AD], { padding: 0, extrude: 2 })).toEqual({
            rows: ["AAABBB", "AAABBB", "AAABBB", "CCCDDD", "CCCDDD", "CCCDDD"],
            at: [[2, 2]],
        });
    });

    it("with padding 0, the gutters of neighbours touch and do not overlap", () => {
        // pitch = 2 + 0 + 2·1 = 4: width 2 × 4 = 8, height 1 × 4 = 4; starts 1 and 5.
        expect(packed([AD, EH], { layout: "row", padding: 0, extrude: 1 })).toEqual({
            rows: ["AABBEEFF", "AABBEEFF", "CCDDGGHH", "CCDDGGHH"],
            at: [
                [1, 1],
                [5, 1],
            ],
        });
    });

    it("does not extrude the padded side of an odd rect", () => {
        // 3×3 becomes 4×4. pitch = 4 + 1 + 2·1 = 7: each side is 1 × 7 + 1 = 8; start 2.
        // The rect spans 2..5; its column 5 and row 5 are the transparent padding, and the
        // gutter beside them (6) repeats that. Left and top repeat A, D, G and A, B, C.
        const { atlas, rects } = pack([grid("ABC", "DEF", "GHI")], { padding: 1, extrude: 1 });

        expect(show(atlas)).toEqual([
            "........",
            ".AABC...",
            ".AABC...",
            ".DDEF...",
            ".GGHI...",
            "........",
            "........",
            "........",
        ]);
        expect(rects[0]).toMatchObject({ x: 2, y: 2, w: 4, h: 4, contentW: 3, contentH: 3 });
    });

    it("a 1×1 frame has a 2×2 rect", () => {
        // One cell of 2: each side is 1 × (2 + 1) + 1 = 4.
        const { atlas, rects } = pack([grid("A")], { padding: 1 });

        expect(show(atlas)).toEqual(["....", ".A..", "....", "...."]);
        expect(rects).toEqual([
            {
                x: 1,
                y: 1,
                w: 2,
                h: 2,
                sourceW: 1,
                sourceH: 1,
                offsetX: 0,
                offsetY: 0,
                // min(2, 1 − 0) = 1.
                contentW: 1,
                contentH: 1,
                frameIndices: [0],
            },
        ]);
        // pitch = 2 + 0 + 2·1 = 4: each side is 4; start 1. Only left and top are extruded.
        expect(packed([grid("A")], { padding: 0, extrude: 1 })).toEqual({
            rows: ["AA..", "AA..", "....", "...."],
            at: [[1, 1]],
        });
    });
});
