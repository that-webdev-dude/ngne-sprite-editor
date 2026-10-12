import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { pack } from "../../src/core/export";
import type { PackOptions, PackResult, PackedRect } from "../../src/core/export";
import { celKey, createDocument, defaultExportSettings, sequentialIds } from "../../src/core/model";
import type { PixelLayer, SpriteDoc } from "../../src/core/model";
import {
    clonePixelBuffer,
    createPixelBuffer,
    cropPixels,
    pixelBuffersEqual,
} from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";
import { contentOf, firstDifference, grid, noise, show, sourceOf } from "./se-050-support";

// Expected values are worked out by hand as in se-050-golden.test.ts:
// pitch = cell + padding + 2·extrude, atlas side = n × pitch + padding,
// rect start = padding + extrude + i × pitch, grid = ⌈√r⌉ columns.

/** The fields of a rect that say which part of its frame it shows. */
function cut(rect: PackedRect): number[] {
    return [rect.offsetX, rect.offsetY, rect.w, rect.h, rect.contentW, rect.contentH];
}

function allTransparent(buffer: PixelBuffer): boolean {
    return buffer.data.every((byte) => byte === 0);
}

describe("pack, trim", () => {
    it("cuts a frame to the bounds of its visible pixels", () => {
        const frame = grid("......", ".ABCD.", ".EFGH.", "......", "......");
        const { atlas, rects } = pack([frame], { trim: true, padding: 1 });

        // Bounds 4×2 at (1, 1), both even. Width 1 × (4 + 1) + 1 = 6, height 1 × (2 + 1) + 1 = 4.
        expect(show(atlas)).toEqual(["......", ".ABCD.", ".EFGH.", "......"]);
        expect(rects).toEqual([
            {
                x: 1,
                y: 1,
                w: 4,
                h: 2,
                sourceW: 6,
                sourceH: 5,
                offsetX: 1,
                offsetY: 1,
                // min(4, 6 − 1) = 4 and min(2, 5 − 1) = 2.
                contentW: 4,
                contentH: 2,
                frameIndices: [0],
            },
        ]);
    });

    it("leaves a frame whole without trim", () => {
        const frame = grid("......", ".ABCD.", ".EFGH.", "......");
        const { atlas, rects } = pack([frame], { trim: false, padding: 0 });

        expect(show(atlas)).toEqual(show(frame));
        expect(cut(rects[0])).toEqual([0, 0, 6, 4, 6, 4]);
    });

    it("grows an odd size inside the frame by a transparent column and row of the frame", () => {
        const frame = grid("......", ".ABC..", ".DEF..", ".GHI..", "......");
        const { atlas, rects } = pack([frame], { trim: true, padding: 1 });

        // Bounds 3×3 at (1, 1) grow to 4×4, which is still inside the 6×5 frame:
        // min(4, 6 − 1) = 4 and min(4, 5 − 1) = 4, so the whole rect is content.
        expect(cut(rects[0])).toEqual([1, 1, 4, 4, 4, 4]);
        // Each side is 1 × (4 + 1) + 1 = 6.
        expect(show(atlas)).toEqual(["......", ".ABC..", ".DEF..", ".GHI..", "......", "......"]);
        expect(show(contentOf(atlas, rects[0]))).toEqual(["ABC.", "DEF.", "GHI.", "...."]);
    });

    it("grows an odd size at the right and bottom edge one pixel past the frame", () => {
        const frame = grid(".....", "..ABC", "..DEF", "..GHI");
        const { atlas, rects } = pack([frame], { trim: true, padding: 1 });

        // Bounds 3×3 at (2, 1) grow to 4×4: offsetX + w = 6 = sourceW + 1, and
        // offsetY + h = 5 = sourceH + 1. Content: min(4, 5 − 2) = 3 by min(4, 4 − 1) = 3.
        expect(rects).toEqual([
            {
                x: 1,
                y: 1,
                w: 4,
                h: 4,
                sourceW: 5,
                sourceH: 4,
                offsetX: 2,
                offsetY: 1,
                contentW: 3,
                contentH: 3,
                frameIndices: [0],
            },
        ]);
        expect(show(atlas)).toEqual(["......", ".ABC..", ".DEF..", ".GHI..", "......", "......"]);
    });

    it("pads each axis on its own", () => {
        // 3 wide and 2 tall: only the width grows.
        expect(cut(pack([grid("ABC", "DEF")]).rects[0])).toEqual([0, 0, 4, 2, 3, 2]);
        // 2 wide and 3 tall: only the height grows.
        expect(cut(pack([grid("AB", "CD", "EF")]).rects[0])).toEqual([0, 0, 2, 4, 2, 3]);
    });

    it("keeps a single visible pixel as a 2×2 rect", () => {
        // Inside the frame the rect takes the transparent neighbours with it.
        const inside = pack([grid("....", ".A..", "....")], { trim: true });
        expect(cut(inside.rects[0])).toEqual([1, 1, 2, 2, 2, 2]);
        // In the bottom-right corner there are none: min(2, 4 − 3) = 1 and min(2, 3 − 2) = 1.
        const corner = pack([grid("....", "....", "...A")], { trim: true, padding: 0 });
        expect(cut(corner.rects[0])).toEqual([3, 2, 2, 2, 1, 1]);
        expect(show(corner.atlas)).toEqual(["A.", ".."]);
    });

    it("counts alpha 1 as visible and colour under alpha 0 as not", () => {
        const frame = grid("abcd", "efgh", "ijkl", "mnop");
        frame.data[(2 * 4 + 1) * 4 + 3] = 1;
        const { rects } = pack([frame], { trim: true });

        expect(cut(rects[0])).toEqual([1, 2, 2, 2, 2, 2]);
    });

    it("gives a fully transparent frame a 2×2 transparent rect at offset 0, 0", () => {
        const { atlas, rects } = pack([createPixelBuffer(5, 3)], { trim: true, padding: 1 });

        expect(rects).toEqual([
            {
                x: 1,
                y: 1,
                w: 2,
                h: 2,
                sourceW: 5,
                sourceH: 3,
                offsetX: 0,
                offsetY: 0,
                // min(2, 5) and min(2, 3).
                contentW: 2,
                contentH: 2,
                frameIndices: [0],
            },
        ]);
        // Each side is 1 × (2 + 1) + 1 = 4.
        expect([atlas.width, atlas.height]).toEqual([4, 4]);
        expect(allTransparent(atlas)).toBe(true);
    });

    it("does the same for a frame that only holds colour under alpha 0, and for 1×1", () => {
        const hidden = pack([grid("abc", "def")], { trim: true, padding: 1, extrude: 2 });
        expect(cut(hidden.rects[0])).toEqual([0, 0, 2, 2, 2, 2]);
        expect(allTransparent(hidden.atlas)).toBe(true);

        // The content is what the frame has: min(2, 1) = 1.
        const single = pack([createPixelBuffer(1, 1)], { trim: true });
        expect(cut(single.rects[0])).toEqual([0, 0, 2, 2, 1, 1]);
        expect(allTransparent(single.atlas)).toBe(true);
    });

    it("keeps a fully transparent frame whole without trim", () => {
        const { atlas, rects } = pack([createPixelBuffer(5, 3)], { trim: false, padding: 1 });

        // 5×3 grows to 6×4: width 1 × (6 + 1) + 1 = 8, height 1 × (4 + 1) + 1 = 6.
        expect(cut(rects[0])).toEqual([0, 0, 6, 4, 5, 3]);
        expect([atlas.width, atlas.height]).toEqual([8, 6]);
        expect(allTransparent(atlas)).toBe(true);
    });
});

describe("pack, rects of different sizes", () => {
    it("makes the cell as large as the largest rect and puts each rect at its top-left", () => {
        const small = grid("....", ".AB.", ".CD.", "....");
        const large = grid("EFGH", "IJKL", "MNOP", "QRST");
        const dot = grid("....", "....", "....", "...U");
        const { atlas, rects } = pack([small, large, dot], {
            layout: "row",
            trim: true,
            padding: 1,
        });

        // Rects 2×2, 4×4 and 2×2 (the last one pixel of content): the cell is 4×4.
        // pitch = 4 + 1 = 5: width 3 × 5 + 1 = 16, height 1 × 5 + 1 = 6; starts 1, 6, 11.
        // Cells span 1..4, 6..9 and 11..14, with the padding at 0, 5, 10 and 15.
        expect(show(atlas)).toEqual([
            "................",
            ".AB...EFGH.U....",
            ".CD...IJKL......",
            "......MNOP......",
            "......QRST......",
            "................",
        ]);
        expect(rects.map(({ x, y, w, h }) => [x, y, w, h])).toEqual([
            [1, 1, 2, 2],
            [6, 1, 4, 4],
            [11, 1, 2, 2],
        ]);
        expect(cut(rects[2])).toEqual([3, 3, 2, 2, 1, 1]);
    });

    it("takes the cell width and height from different rects", () => {
        const wide = grid("ABCDEF", "GHIJKL");
        const tall = grid("MN", "OP", "QR", "ST");
        const { atlas, rects } = pack([wide, tall], { layout: "column", padding: 0 });

        // The cell is 6 wide (first) and 4 tall (second): 1 × 6 by 2 × 4.
        expect(show(atlas)).toEqual([
            "ABCDEF",
            "GHIJKL",
            "......",
            "......",
            "MN....",
            "OP....",
            "QR....",
            "ST....",
        ]);
        expect(rects.map(({ x, y }) => [x, y])).toEqual([
            [0, 0],
            [0, 4],
        ]);
    });

    it("packs frames of different source sizes, each rect with its own", () => {
        const frames = [noise(3, 5, 1), noise(8, 2, 2), noise(1, 1, 3)];
        const { atlas, rects } = pack(frames, { layout: "row", padding: 2, extrude: 1 });

        expect(rects.map(({ sourceW, sourceH }) => [sourceW, sourceH])).toEqual([
            [3, 5],
            [8, 2],
            [1, 1],
        ]);
        // Rects 4×6, 8×2 and 2×2: the cell is 8×6. pitch = 8 + 2 + 2 = 12 across and
        // 6 + 2 + 2 = 10 down: width 3 × 12 + 2 = 38, height 1 × 10 + 2 = 12;
        // starts 2 + 1 = 3, 15 and 27.
        expect([atlas.width, atlas.height]).toEqual([38, 12]);
        expect(rects.map(({ x, y, w, h }) => [x, y, w, h])).toEqual([
            [3, 3, 4, 6],
            [15, 3, 8, 2],
            [27, 3, 2, 2],
        ]);
        rects.forEach((rect, i) => {
            expect(pixelBuffersEqual(contentOf(atlas, rect), frames[i])).toBe(true);
        });
    });
});

describe("pack, merging identical frames", () => {
    const X = grid("AB", "CD");
    const Y = grid("EF", "GH");
    const Z = grid("IJ", "KL");

    it("with merge on, identical frames share one rect", () => {
        const { atlas, rects } = pack([X, Y, clonePixelBuffer(X), Z, clonePixelBuffer(Y)], {
            mergeDuplicates: true,
            padding: 1,
        });

        // Three rects, in the order of their first frame: ⌈√3⌉ = 2 columns, 2 rows;
        // each side is 2 × (2 + 1) + 1 = 7; starts 1 and 4.
        expect(rects.map(({ x, y, frameIndices }) => [x, y, frameIndices])).toEqual([
            [1, 1, [0, 2]],
            [4, 1, [1, 4]],
            [1, 4, [3]],
        ]);
        expect(show(atlas)).toEqual([
            ".......",
            ".AB.EF.",
            ".CD.GH.",
            ".......",
            ".IJ....",
            ".KL....",
            ".......",
        ]);
    });

    it("with merge off, every frame has a rect of its own", () => {
        const { atlas, rects } = pack([X, Y, clonePixelBuffer(X), Z, clonePixelBuffer(Y)], {
            mergeDuplicates: false,
            padding: 1,
        });

        // Five rects: ⌈√5⌉ = 3 columns, ⌈5 / 3⌉ = 2 rows; width 3 × 3 + 1 = 10,
        // height 2 × 3 + 1 = 7; starts 1, 4 and 7.
        expect(rects.map(({ x, y, frameIndices }) => [x, y, frameIndices])).toEqual([
            [1, 1, [0]],
            [4, 1, [1]],
            [7, 1, [2]],
            [1, 4, [3]],
            [4, 4, [4]],
        ]);
        expect(show(atlas)).toEqual([
            "..........",
            ".AB.EF.AB.",
            ".CD.GH.CD.",
            "..........",
            ".IJ.EF....",
            ".KL.GH....",
            "..........",
        ]);
    });

    it("merges one buffer passed several times", () => {
        const { rects } = pack([X, X, X]);

        expect(rects.map((rect) => rect.frameIndices)).toEqual([[0, 1, 2]]);
        expect(pack([X, X, X], { mergeDuplicates: false }).rects).toHaveLength(3);
    });

    it("does not merge frames that differ in one byte", () => {
        const other = clonePixelBuffer(X);
        other.data[other.data.length - 1] ^= 1;

        expect(pack([X, other]).rects.map((rect) => rect.frameIndices)).toEqual([[0], [1]]);
    });

    it("does not merge frames with the same pixels in another shape", () => {
        const row = grid("ABCD");
        const square = grid("AB", "CD");

        expect(pack([row, square]).rects).toHaveLength(2);
        // Nor frames of different sizes that trim to the same pixels at the same offset:
        // the rect also carries the source size.
        const narrow = grid("AB.", "CD.");
        const wide = grid("AB...", "CD...");
        const trimmed = pack([narrow, wide], { trim: true });
        expect(trimmed.rects.map(({ sourceW, frameIndices }) => [sourceW, frameIndices])).toEqual([
            [3, [0]],
            [5, [1]],
        ]);
    });

    it("does not merge trimmed frames that differ inside the same bounds", () => {
        // All four have their visible pixels in the 2×2 at (2, 1).
        const base = grid("....", "..AB", "..CD");
        const others = [grid("....", "..XB", "..CD"), grid("....", "..AB", "..CX")];
        for (const other of others) {
            const { rects } = pack([base, other, clonePixelBuffer(base)], { trim: true });
            expect(rects.map(cut)).toEqual([
                [2, 1, 2, 2, 2, 2],
                [2, 1, 2, 2, 2, 2],
            ]);
            expect(rects.map((rect) => rect.frameIndices)).toEqual([[0, 2], [1]]);
        }
    });

    it("does not merge frames whose trimmed pixels are equal at different offsets", () => {
        const left = grid("AB..", "CD..");
        const right = grid("..AB", "..CD");
        const { rects } = pack([left, right], { trim: true });

        expect(rects.map(({ offsetX, frameIndices }) => [offsetX, frameIndices])).toEqual([
            [0, [0]],
            [2, [1]],
        ]);
    });

    it("merges frames that differ only in colour under alpha 0", () => {
        const clean = grid(".B", "C.");
        const hidden = grid("aB", "Cd");
        for (const trim of [false, true]) {
            const { rects } = pack([hidden, clean, grid("xB", "Cy")], { trim });
            expect(rects.map((rect) => rect.frameIndices)).toEqual([[0, 1, 2]]);
        }
    });

    it("merges fully transparent frames of one size, with and without trim", () => {
        const frames = [createPixelBuffer(4, 4), X, grid("abcd", "efgh", "ijkl", "mnop")];
        frames.push(createPixelBuffer(4, 4), createPixelBuffer(4, 2));
        for (const trim of [false, true]) {
            const { rects } = pack(frames, { trim });
            // The 4×2 frame is as empty, but it is another frame.
            expect(rects.map((rect) => rect.frameIndices)).toEqual([[0, 2, 3], [1], [4]]);
        }
    });

    it("counts merged frames once in the layout", () => {
        const frames = Array.from({ length: 8 }, (_, i) => noise(32, 32, i % 2));
        const { atlas, rects } = pack(frames, { padding: 1 });

        // Two rects: ⌈√2⌉ = 2 columns, 1 row; width 2 × 33 + 1 = 67, height 1 × 33 + 1 = 34.
        expect([atlas.width, atlas.height]).toEqual([67, 34]);
        expect(rects.map((rect) => rect.frameIndices)).toEqual([
            [0, 2, 4, 6],
            [1, 3, 5, 7],
        ]);
    });
});

describe("pack, merging frames whose hashes collide", () => {
    // `pack` sorts frames into buckets by the FNV-1a hash of the bytes each rect shows and
    // only then compares pixels. The frames below were searched for: they differ, yet those
    // bytes hash alike, so nothing but the comparison keeps them apart. Each test first
    // checks that premise with the function below.
    function fnv1a(bytes: ArrayLike<number>): number {
        let hash = 0x811c9dc5;
        for (let i = 0; i < bytes.length; i++) {
            hash = Math.imul(hash ^ bytes[i], 0x01000193);
        }
        return hash >>> 0;
    }

    function frame(width: number, bytes: number[]): PixelBuffer {
        return { width, height: bytes.length / 4 / width, data: Uint8ClampedArray.from(bytes) };
    }

    function expectApart(frames: PixelBuffer[], options: Partial<PackOptions>): PackedRect[] {
        const { atlas, rects } = pack(frames, { ...options, mergeDuplicates: true });
        expect(rects.map((rect) => rect.frameIndices)).toEqual([[0], [1]]);
        rects.forEach((rect, i) => {
            expect(firstDifference(contentOf(atlas, rect), sourceOf(frames[i], rect))).toBeNull();
        });
        return rects;
    }

    it("keeps apart 2×2 frames that differ only in their last pixel", () => {
        const first = [5, 11, 9, 255, 169, 165, 123, 255, 159, 196, 42, 255];
        const a = frame(2, [...first, 152, 186, 129, 59]);
        const b = frame(2, [...first, 208, 40, 201, 53]);
        expect([fnv1a(a.data), fnv1a(b.data)]).toEqual([1500711855, 1500711855]);

        expectApart([a, b], {});
        expectApart([b, a], { trim: true });
    });

    it("keeps apart 2×2 frames that differ only in their first pixel", () => {
        const rest = [85, 211, 177, 255, 142, 145, 185, 255, 116, 131, 27, 255];
        const a = frame(2, [108, 191, 189, 139, ...rest]);
        const b = frame(2, [98, 161, 2, 178, ...rest]);
        expect([fnv1a(a.data), fnv1a(b.data)]).toEqual([4026859026, 4026859026]);

        expectApart([a, b], {});
        expectApart([b, a], { trim: true });
    });

    it("still finds the twin of each frame among frames with its hash", () => {
        const first = [5, 11, 9, 255, 169, 165, 123, 255, 159, 196, 42, 255];
        const a = frame(2, [...first, 152, 186, 129, 59]);
        const b = frame(2, [...first, 208, 40, 201, 53]);
        const frames = [a, b, clonePixelBuffer(a), clonePixelBuffer(b), clonePixelBuffer(a)];

        expect(pack(frames).rects.map((rect) => rect.frameIndices)).toEqual([
            [0, 2, 4],
            [1, 3],
        ]);
    });

    it("keeps apart trimmed frames of one size whose rects start at different offsets", () => {
        // 5×2: three pixels at x = 1..3 of the first row, and the same with one more at
        // x = 0. Trimmed, the first is 3×1 at (1, 0) and the second 4×1 at (0, 0); both
        // rects are 4×2, and the second holds everything the first shows.
        const three = [49, 253, 55, 255, 193, 20, 59, 255, 99, 64, 211, 255];
        const clear = [0, 0, 0, 0];
        const blankRow = new Array<number>(20).fill(0);
        const a = frame(5, [...clear, ...three, ...clear, ...blankRow]);
        const b = frame(5, [10, 42, 112, 200, ...three, ...clear, ...blankRow]);
        const shown = (source: PixelBuffer, x: number) =>
            cropPixels(source, { x, y: 0, width: 4, height: 2 }).data;
        expect([fnv1a(shown(a, 1)), fnv1a(shown(b, 0))]).toEqual([3354669535, 3354669535]);

        const rects = expectApart([a, b], { trim: true });
        expect(rects.map(cut)).toEqual([
            [1, 0, 4, 2, 4, 2],
            [0, 0, 4, 2, 4, 2],
        ]);
    });
});

describe("pack, pixels", () => {
    it("writes fully transparent pixels as 0,0,0,0 and leaves the frame as it was", () => {
        const frame = grid("aB", "Cd");
        const before = clonePixelBuffer(frame);
        const { atlas } = pack([frame], { padding: 0 });

        expect(show(atlas)).toEqual([".B", "C."]);
        expect(pixelBuffersEqual(frame, before)).toBe(true);
        expect(show(frame)).toEqual(["aB", "Cd"]);
    });

    it("does not extrude colour hidden under alpha 0", () => {
        const { atlas } = pack([grid("aB", "Cd")], { padding: 0, extrude: 1 });

        expect(show(atlas)).toEqual(["..BB", "..BB", "CC..", "CC.."]);
    });

    it("keeps every alpha above 0 and its colour as they are", () => {
        const frame = createPixelBuffer(2, 2);
        frame.data.set([10, 20, 30, 1, 40, 50, 60, 127, 70, 80, 90, 254, 1, 2, 3, 255]);
        const { atlas } = pack([frame], { padding: 0 });

        expect(Array.from(atlas.data)).toEqual(Array.from(frame.data));
    });

    it("returns an atlas that shares no storage with a frame", () => {
        const frame = grid("AB", "CD");
        const { atlas } = pack([frame], { padding: 0 });

        expect(atlas.data.buffer).not.toBe(frame.data.buffer);
        atlas.data.fill(0);
        expect(show(frame)).toEqual(["AB", "CD"]);
    });

    it("reads a frame that is a view into a larger buffer", () => {
        const backing = new Uint8ClampedArray(4 + 16 + 4).fill(9);
        const frame = { width: 2, height: 2, data: backing.subarray(4, 20) };
        frame.data.set(grid("AB", "CD").data);
        const { atlas } = pack([frame], { padding: 0 });

        expect(show(atlas)).toEqual(["AB", "CD"]);
    });
});

describe("pack, options", () => {
    const frames = [noise(5, 3, 1), noise(5, 3, 2), noise(5, 3, 1)];

    function expectSame(actual: PackResult, expected: PackResult): void {
        expect(actual.rects).toEqual(expected.rects);
        expect(firstDifference(actual.atlas, expected.atlas)).toBeNull();
    }

    it("takes the defaults of SPEC §9.4 for options left out", () => {
        const explicit: PackOptions = {
            layout: "grid",
            padding: 1,
            extrude: 0,
            trim: false,
            mergeDuplicates: true,
        };
        const defaults = pack(frames);

        expectSame(pack(frames, explicit), defaults);
        expectSame(pack(frames, {}), defaults);
        expectSame(pack(frames, { padding: undefined }), defaults);
        // Two rects of 6×4 in one row of the grid: width 2 × (6 + 1) + 1 = 15,
        // height 1 × (4 + 1) + 1 = 6.
        expect([defaults.atlas.width, defaults.atlas.height]).toEqual([15, 6]);
        expect(defaults.rects.map((rect) => rect.frameIndices)).toEqual([[0, 2], [1]]);
    });

    it("accepts a document's export settings as they are", () => {
        const settings = { ...defaultExportSettings(), layout: "column" as const, extrude: 2 };

        expectSame(pack(frames, settings), pack(frames, { layout: "column", extrude: 2 }));
        expectSame(pack(frames, defaultExportSettings()), pack(frames));
    });
});

describe("pack, determinism", () => {
    /** Frames with soft alpha, transparent borders, a duplicate and an empty frame. */
    function frames(): PixelBuffer[] {
        const soft = noise(7, 5, 3);
        for (let i = 3; i < soft.data.length; i += 4) soft.data[i] = (i * 53) & 0xff;
        const bordered = createPixelBuffer(7, 5);
        bordered.data.set(noise(3, 3, 4).data.subarray(0, 12), (2 * 7 + 3) * 4);
        return [soft, bordered, noise(7, 5, 5), clonePixelBuffer(soft), createPixelBuffer(7, 5)];
    }

    it("gives identical atlas pixels and rects for identical input and options", () => {
        for (const layout of ["grid", "row", "column"] as const) {
            for (const [padding, extrude] of [
                [0, 0],
                [1, 0],
                [0, 2],
                [8, 1],
            ]) {
                for (const trim of [false, true]) {
                    for (const mergeDuplicates of [false, true]) {
                        const options = { layout, padding, extrude, trim, mergeDuplicates };
                        // Two runs on separately built, equal inputs.
                        const first = pack(frames(), options);
                        const second = pack(frames(), options);
                        const label = JSON.stringify(options);
                        expect(second.rects, label).toEqual(first.rects);
                        expect(pixelBuffersEqual(second.atlas, first.atlas), label).toBe(true);
                        expect(first.rects, label).toHaveLength(mergeDuplicates ? 4 : 5);
                    }
                }
            }
        }
    });

    it("does not depend on earlier calls", () => {
        const options = { trim: true, extrude: 1 };
        const first = pack(frames(), options);
        pack([noise(9, 9, 1), noise(2, 2, 2)], { layout: "row", padding: 5 });
        const second = pack(frames(), options);

        expect(second.rects).toEqual(first.rects);
        expect(pixelBuffersEqual(second.atlas, first.atlas)).toBe(true);
    });
});

describe("pack, composites of a document", () => {
    const RED = [255, 0, 0, 255];
    const GREEN = [0, 255, 0, 255];
    const CLEAR = [0, 0, 0, 0];
    /** Colour under alpha 0, which a cel may hold and a composite never does (SPEC §5.3). */
    const HIDDEN = [90, 80, 70, 0];

    function setCel(doc: SpriteDoc, layerId: string, frameId: string, pixels: number[][]): void {
        const imageId = `image-${layerId}-${frameId}`;
        const data = Uint8ClampedArray.from(pixels.flat());
        doc.images.set(imageId, { width: doc.width, height: doc.height, data });
        doc.cels.set(celKey(layerId, frameId), { imageId, opacity: 255 });
    }

    /** 3×2, three frames; the third repeats the first. A hidden layer covers everything. */
    function document(): SpriteDoc {
        const { doc } = createDocument({ name: "hero", width: 3, height: 2 }, sequentialIds());
        const [visible] = doc.layers;
        const hidden: PixelLayer = { ...(visible as PixelLayer), id: "hidden", visible: false };
        doc.layers.push(hidden);
        doc.frames.push({ id: "second", durationMs: 100 }, { id: "third", durationMs: 100 });
        const [first, second, third] = doc.frames.map((frame) => frame.id);
        setCel(doc, visible.id, first, [CLEAR, RED, HIDDEN, CLEAR, GREEN, CLEAR]);
        setCel(doc, visible.id, second, [GREEN, GREEN, GREEN, RED, RED, RED]);
        setCel(doc, visible.id, third, [HIDDEN, RED, CLEAR, CLEAR, GREEN, HIDDEN]);
        for (const frame of [first, second, third]) {
            setCel(doc, hidden.id, frame, new Array<number[]>(6).fill([1, 2, 3, 255]));
        }
        return doc;
    }

    it("packs what compositeFrame returns: visible pixel layers only", () => {
        const doc = document();
        const frames = doc.frames.map((frame) => compositeFrame(doc, frame.id));
        const { atlas, rects } = pack(frames, { ...doc.exportSettings, trim: true });

        // Frames 1 and 3 composite to the same pixels: one visible column at x = 1,
        // 1×2, which grows to 2×2 inside the frame. Frame 2 is whole: 3×2 grows to 4×2.
        expect(rects.map((rect) => [...cut(rect), rect.frameIndices])).toEqual([
            [1, 0, 2, 2, 2, 2, [0, 2]],
            [0, 0, 4, 2, 3, 2, [1]],
        ]);
        // The cell is 4×2 and the defaults are grid and padding 1: ⌈√2⌉ = 2 columns,
        // width 2 × (4 + 1) + 1 = 11, height 1 × (2 + 1) + 1 = 4.
        expect([atlas.width, atlas.height]).toEqual([11, 4]);
        for (const rect of rects) {
            for (const index of rect.frameIndices) {
                const source = sourceOf(frames[index], rect);
                expect(pixelBuffersEqual(contentOf(atlas, rect), source)).toBe(true);
            }
        }
        // Nothing of the hidden layer or of the colour under alpha 0 arrives.
        const colors = new Set<string>();
        for (let i = 0; i < atlas.data.length; i += 4) {
            colors.add(atlas.data.subarray(i, i + 4).join());
        }
        expect([...colors].sort()).toEqual([CLEAR.join(), GREEN.join(), RED.join()].sort());
    });
});
