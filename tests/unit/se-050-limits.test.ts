import { describe, expect, it, vi } from "vitest";
import {
    MAX_ATLAS_EXTRUDE,
    MAX_ATLAS_PADDING,
    MAX_ATLAS_SIDE,
    PackError,
    pack,
} from "../../src/core/export";
import type { PackErrorCode, PackOptions } from "../../src/core/export";
import { createPixelBuffer } from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";
import { errorOf, grid, noise } from "./se-050-support";

// Sizes are worked out by hand from SPEC §9.4, as in se-050-golden.test.ts:
// atlas side = n × (cell + padding + 2·extrude) + padding for n cells along the side.

/**
 * `count` frames of `width` × `height`: one opaque buffer, listed that many times. Packed
 * without merging, they are `count` rects for the memory of one frame.
 */
function repeated(count: number, width: number, height: number): PixelBuffer[] {
    return new Array<PixelBuffer>(count).fill(createPixelBuffer(width, height, 0x336699ff));
}

const SEPARATE = { mergeDuplicates: false } as const;

describe("pack, the atlas side limit", () => {
    it("is 8192 px", () => {
        expect(MAX_ATLAS_SIDE).toBe(8192);
    });

    it("packs an atlas of exactly 8192 px on a side", () => {
        const fitting: [string, PixelBuffer[], Partial<PackOptions>, number[]][] = [
            // Width 4 × (2048 + 0 + 2·0) + 0 = 8192, height 1 × 2 + 0 = 2.
            ["4 of 2048×2", repeated(4, 2048, 2), { layout: "row", padding: 0 }, [8192, 2]],
            // Width 1 × 2 = 2, height 4 × 2048 = 8192.
            ["4 of 2×2048", repeated(4, 2, 2048), { layout: "column", padding: 0 }, [2, 8192]],
            // Width 431 × (16 + 3) + 3 = 8189 + 3 = 8192, height 1 × (2 + 3) + 3 = 8.
            ["431 of 16×2", repeated(431, 16, 2), { layout: "row", padding: 3 }, [8192, 8]],
            // pitch 2 + 8 + 2·2 = 14 across and 12 + 8 + 2·2 = 24 down:
            // width 1 × 14 + 8 = 22, height 341 × 24 + 8 = 8184 + 8 = 8192.
            [
                "341 of 2×12",
                repeated(341, 2, 12),
                { layout: "column", padding: 8, extrude: 2 },
                [22, 8192],
            ],
        ];
        for (const [name, frames, options, size] of fitting) {
            const { atlas, rects } = pack(frames, { ...options, ...SEPARATE });
            expect([atlas.width, atlas.height], name).toEqual(size);
            expect(rects, name).toHaveLength(frames.length);
        }
    });

    it("places the last rect of a full atlas against the far padding", () => {
        const { rects } = pack(repeated(431, 16, 2), { layout: "row", padding: 3, ...SEPARATE });

        // Start 3 + 430 × 19 = 8173; it ends at 8173 + 16 = 8189, 3 px before 8192.
        expect(rects[430]).toMatchObject({ x: 8173, y: 3, w: 16, h: 2, frameIndices: [430] });
    });

    it("refuses an atlas of 8193 px on a side, naming the limit and the required size", () => {
        // Width 1638 × (2 + 3) + 3 = 8190 + 3 = 8193, height 1 × (2 + 3) + 3 = 8.
        const row = errorOf(() =>
            pack(repeated(1638, 2, 2), { layout: "row", padding: 3, ...SEPARATE }),
        );
        expect(row.code).toBe("atlas-size");
        expect(row.required).toEqual({ width: 8193, height: 8 });
        expect(row.message).toBe("The atlas needs 8193x8 px; the limit is 8192 px per side.");

        const column = errorOf(() =>
            pack(repeated(1638, 2, 2), { layout: "column", padding: 3, ...SEPARATE }),
        );
        expect(column.code).toBe("atlas-size");
        expect(column.required).toEqual({ width: 8, height: 8193 });
        expect(column.message).toContain("8x8193 px");
        expect(column.message).toContain("8192 px per side");

        // Width 2 × (4086 + 7) + 7 = 8186 + 7 = 8193, height 1 × (2 + 7) + 7 = 16.
        const two = errorOf(() =>
            pack(repeated(2, 4086, 2), { layout: "row", padding: 7, ...SEPARATE }),
        );
        expect(two.required).toEqual({ width: 8193, height: 16 });

        // One frame fewer fits: 1637 × 5 + 3 = 8188.
        const fits = pack(repeated(1637, 2, 2), { layout: "row", padding: 3, ...SEPARATE });
        expect([fits.atlas.width, fits.atlas.height]).toEqual([8188, 8]);
    });

    it("counts the extrude gutters and the even padding towards the limit", () => {
        // 1023 × 8 = 8184 px of 8×2 rects in a row fit; with a 1 px gutter on both sides
        // of each they need 1023 × (8 + 2·1) = 10230.
        const frames = repeated(1023, 8, 2);
        const plain = pack(frames, { layout: "row", padding: 0, ...SEPARATE });
        expect([plain.atlas.width, plain.atlas.height]).toEqual([8184, 2]);
        const extruded = errorOf(() =>
            pack(frames, { layout: "row", padding: 0, extrude: 1, ...SEPARATE }),
        );
        expect(extruded.required).toEqual({ width: 10230, height: 4 });

        // 1170 frames of 7×2 hold 1170 × 7 = 8190 px across, but each rect is 8 px wide:
        // 1170 × 8 = 9360.
        const odd = errorOf(() =>
            pack(repeated(1170, 7, 2), { layout: "row", padding: 0, ...SEPARATE }),
        );
        expect(odd.required).toEqual({ width: 9360, height: 2 });
    });

    it("holds the frame counts of SPEC §9.4 at padding 1, and not one frame more", () => {
        // [frame width, most frames, atlas width with them, atlas width with one more].
        // The frames are 2 px tall, so that only the width is at the limit.
        const capacities = [
            // ⌈√49⌉ = 7: 7 × 1025 + 1 = 7176. ⌈√50⌉ = 8: 8 × 1025 + 1 = 8201.
            [1024, 49, 7176, 8201],
            // ⌈√961⌉ = 31: 31 × 257 + 1 = 7968. ⌈√962⌉ = 32: 32 × 257 + 1 = 8225.
            [256, 961, 7968, 8225],
            // ⌈√15876⌉ = 126: 126 × 65 + 1 = 8191. ⌈√15877⌉ = 127: 127 × 65 + 1 = 8256.
            [64, 15876, 8191, 8256],
        ];
        for (const [side, most, width, widthOver] of capacities) {
            const frames = repeated(most + 1, side, 2);
            // √most rows in both cases: a full square, then one more column of as many
            // rows. Each row is 2 + 1 px, plus 1.
            const rows = Math.sqrt(most);
            const height = rows * 3 + 1;

            const { atlas } = pack(frames.slice(1), { padding: 1, ...SEPARATE });
            expect([atlas.width, atlas.height], `${most} of ${side}`).toEqual([width, height]);

            const over = errorOf(() => pack(frames, { padding: 1, ...SEPARATE }));
            expect(over.code, `${most + 1} of ${side}`).toBe("atlas-size");
            expect(over.required, `${most + 1} of ${side}`).toEqual({ width: widthOver, height });
        }
    });

    it("refuses 50 frames of 1024×1024 at padding 1", () => {
        // 8 columns and ⌈50 / 8⌉ = 7 rows: 8 × 1025 + 1 = 8201 by 7 × 1025 + 1 = 7176.
        const error = errorOf(() => pack(repeated(50, 1024, 1024), { padding: 1, ...SEPARATE }));

        expect(error.code).toBe("atlas-size");
        expect(error.message).toBe("The atlas needs 8201x7176 px; the limit is 8192 px per side.");
    });

    it("measures what is packed: merged and trimmed frames need less", () => {
        // The 1638 rects of 2×2 that are 8193 px wide above are one rect when merged:
        // each side is 1 × (2 + 3) + 3 = 8.
        const merged = pack(repeated(1638, 2, 2), { layout: "row", padding: 3 });
        expect([merged.atlas.width, merged.atlas.height]).toEqual([8, 8]);
        expect(merged.rects[0].frameIndices).toHaveLength(1638);

        // Two frames of 4100 px in a row are 8200 wide; trimmed to 2 px each they are 4.
        const wide = createPixelBuffer(4100, 2);
        wide.data.set([1, 2, 3, 255, 4, 5, 6, 255], 4 * 100);
        const frames = [wide, wide];
        const untrimmed = errorOf(() => pack(frames, { layout: "row", padding: 0, ...SEPARATE }));
        expect(untrimmed.required).toEqual({ width: 8200, height: 2 });
        const trimmed = pack(frames, { layout: "row", padding: 0, trim: true, ...SEPARATE });
        expect([trimmed.atlas.width, trimmed.atlas.height]).toEqual([4, 2]);
    });

    it("refuses a single frame larger than the limit", () => {
        const error = errorOf(() => pack([createPixelBuffer(8193, 1)], { padding: 0 }));

        // 8193 is odd: the rect is 8194×2.
        expect(error.required).toEqual({ width: 8194, height: 2 });
        const atLimit = pack([createPixelBuffer(8192, 1, 0x010203ff)], { padding: 0 });
        expect([atLimit.atlas.width, atLimit.atlas.height]).toEqual([8192, 2]);
    });
});

describe("pack, allocation", () => {
    /** Makes every `new Uint8ClampedArray` fail while `run` runs. */
    function withoutMemory<T>(run: () => T): T {
        vi.stubGlobal(
            "Uint8ClampedArray",
            class {
                constructor() {
                    throw new RangeError("Array buffer allocation failed");
                }
            },
        );
        try {
            return run();
        } finally {
            vi.unstubAllGlobals();
        }
    }

    it("refuses an oversized atlas before allocating it", () => {
        const frames = repeated(1638, 2, 2);
        const options = { layout: "row", padding: 3, ...SEPARATE } as const;
        // No allocation can succeed here, so the size error shows that none was tried.
        const error = withoutMemory(() => errorOf(() => pack(frames, options)));

        expect(error.code).toBe("atlas-size");
    });

    it("reports an atlas that cannot be allocated as a memory error", () => {
        const frames = repeated(1637, 2, 2);
        const options = { layout: "row", padding: 3, ...SEPARATE } as const;
        const error = withoutMemory(() => errorOf(() => pack(frames, options)));

        expect(error.code).toBe("memory");
        expect(error.message).toBe("An atlas of 8188x8 px is too large to allocate.");
        expect(error.cause).toBeInstanceOf(RangeError);
        expect(error.required).toBeUndefined();
        // The same call succeeds with memory.
        expect(pack(frames, options).atlas.width).toBe(8188);
    });
});

describe("pack, arguments", () => {
    const frames = [noise(4, 4, 1), noise(4, 4, 2)];

    function codeOf(run: () => unknown): PackErrorCode {
        return errorOf(run).code;
    }

    it("throws a PackError that is an Error with a name", () => {
        const error = errorOf(() => pack([]));

        expect(error).toBeInstanceOf(PackError);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe("PackError");
    });

    it("refuses an empty list of frames", () => {
        const error = errorOf(() => pack([]));

        expect(error.code).toBe("no-frames");
        expect(error.required).toBeUndefined();
        expect(codeOf(() => pack([], { trim: true, mergeDuplicates: false }))).toBe("no-frames");
    });

    it("refuses a frame whose data does not match its size, naming its index", () => {
        const broken: PixelBuffer[] = [
            { width: 2, height: 2, data: new Uint8ClampedArray(15) },
            { width: 2, height: 2, data: new Uint8ClampedArray(20) },
            { width: 0, height: 2, data: new Uint8ClampedArray(0) },
            { width: 2, height: -1, data: new Uint8ClampedArray(8) },
            { width: 1.5, height: 2, data: new Uint8ClampedArray(12) },
            { width: Number.NaN, height: 1, data: new Uint8ClampedArray(4) },
        ];
        for (const frame of broken) {
            const error = errorOf(() => pack([...frames, frame]));
            expect(error.code, `${frame.width}×${frame.height}`).toBe("frame");
            expect(error.message).toContain("Frame 2");
        }
    });

    it("refuses options outside their range, naming the option", () => {
        expect([MAX_ATLAS_PADDING, MAX_ATLAS_EXTRUDE]).toEqual([8, 2]);
        const invalid: [string, Partial<PackOptions>][] = [
            ["Padding", { padding: -1 }],
            ["Padding", { padding: 9 }],
            ["Padding", { padding: 1.5 }],
            ["Padding", { padding: Number.NaN }],
            ["Padding", { padding: Number.POSITIVE_INFINITY }],
            ["Extrude", { extrude: -1 }],
            ["Extrude", { extrude: 3 }],
            ["Extrude", { extrude: 0.5 }],
            ["Layout", { layout: "packed" as "grid" }],
            ["Trim", { trim: "no" as unknown as boolean }],
            ["Merge duplicates", { mergeDuplicates: 1 as unknown as boolean }],
        ];
        for (const [name, options] of invalid) {
            const error = errorOf(() => pack(frames, options));
            expect(error.code, JSON.stringify(options)).toBe("options");
            expect(error.message, JSON.stringify(options)).toContain(name);
        }
        expect(errorOf(() => pack(frames, { padding: 9 })).message).toBe(
            "Padding must be an integer 0..8, got 9.",
        );
        expect(errorOf(() => pack(frames, { extrude: 3 })).message).toBe(
            "Extrude must be an integer 0..2, got 3.",
        );
    });

    it("accepts the smallest and the largest padding and extrude", () => {
        const frame = [grid("AB", "CD")];
        // Each side is 1 × (2 + padding + 2·extrude) + padding.
        const sides: [number, number, number][] = [
            [0, 0, 2],
            // 2 + 8 + 0 + 8.
            [8, 0, 18],
            // 2 + 0 + 4 + 0.
            [0, 2, 6],
            // 2 + 8 + 4 + 8.
            [8, 2, 22],
        ];
        for (const [padding, extrude, side] of sides) {
            const { atlas, rects } = pack(frame, { padding, extrude });
            expect([atlas.width, atlas.height], `${padding}, ${extrude}`).toEqual([side, side]);
            expect([rects[0].x, rects[0].y]).toEqual([padding + extrude, padding + extrude]);
        }
    });
});
