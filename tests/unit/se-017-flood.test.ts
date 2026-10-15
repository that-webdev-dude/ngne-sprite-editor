import { describe, expect, it } from "vitest";
import type { BitMask, PixelBuffer } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";
import { floodMask, paintInk, paintMask } from "../../src/core/raster";
import type { FloodOptions, PixelPoint } from "../../src/core/raster";
import { maskBounds, selectionOf } from "../../src/core/selection";
import { maskOf, rowsOf, seeded } from "./se-030-support";

// SE-017: the scanline flood fill of `core/raster`, which returns a mask (the paint bucket's
// area, and the magic wand's input in SE-031). Goldens: a spiral maze, contiguous and global,
// 4-connected; tolerance thresholds at 0, 1 and 255; the selection as a limit. Without
// recursion: a 1024 × 1024 serpentine maze, whose single corridor would need a call depth of
// half a million pixels from a recursive fill. Random mazes against a breadth-first oracle.
// `paintMask` inks the mask's pixels.

const WALL = [0, 0, 0, 255] as const;
const FLOOR = [255, 255, 255, 255] as const;

/** An image from rows of "X" (opaque black) and "." (opaque white). */
function imageOf(rows: readonly string[]): PixelBuffer {
    const width = rows[0]!.length;
    const image = createPixelBuffer(width, rows.length);
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) {
            image.data.set(row[x] === "X" ? WALL : FLOOR, (y * width + x) * 4);
        }
    });
    return image;
}

/** An image of one row of the given pixels. */
function rowOf(pixels: readonly (readonly number[])[]): PixelBuffer {
    const image = createPixelBuffer(pixels.length, 1);
    pixels.forEach((pixel, x) => image.data.set(pixel, x * 4));
    return image;
}

const p = (x: number, y: number): PixelPoint => ({ x, y });
const exact: FloodOptions = { tolerance: 0, contiguous: true };

/** A spiral corridor of white inside black walls, and a walled white pocket beside it. */
const SPIRAL = [
    "XXXXXXXXXXXXXXXXXXXX",
    "X.............XX...X",
    "X.XXXXXXXXXXX.XX...X",
    "X.X.........X.XXXXXX",
    "X.X.XXXXXXX.X.XXXXXX",
    "X.X.X.....X.X.XXXXXX",
    "X.X.X.XXX.X.X.XXXXXX",
    "X.X.X.X.X.X.X.XXXXXX",
    "X.X.X.X.X.X.X.XXXXXX",
    "X.X.X.X...X.X.XXXXXX",
    "X.X.X.XXXXX.X.XXXXXX",
    "X.X.X.......X.XXXXXX",
    "X.X.XXXXXXXXX.XXXXXX",
    "X.X...........XXXXXX",
    "XXXXXXXXXXXXXXXXXXXX",
];

/** The spiral's corridor: every white pixel but the pocket's. */
const CORRIDOR = [
    "....................",
    ".#############......",
    ".#...........#......",
    ".#.#########.#......",
    ".#.#.......#.#......",
    ".#.#.#####.#.#......",
    ".#.#.#...#.#.#......",
    ".#.#.#.#.#.#.#......",
    ".#.#.#.#.#.#.#......",
    ".#.#.#.###.#.#......",
    ".#.#.#.....#.#......",
    ".#.#.#######.#......",
    ".#.#.........#......",
    ".#.###########......",
    "....................",
];

describe("flood fill, golden", () => {
    it("fills the whole spiral corridor from its centre, and not the pocket beside it", () => {
        const mask = floodMask(imageOf(SPIRAL), p(7, 7), exact);
        expect(rowsOf(mask)).toEqual(CORRIDOR);
        // From the corridor's outer end: the same pixels.
        expect(rowsOf(floodMask(imageOf(SPIRAL), p(1, 13), exact))).toEqual(CORRIDOR);
    });

    it("fills only the walls from a wall, which all touch", () => {
        const mask = floodMask(imageOf(SPIRAL), p(0, 0), exact);
        expect(rowsOf(mask)).toEqual(SPIRAL.map((row) => row.replace(/X/g, "#")));
    });

    it("global: every pixel of the seed's colour, the pocket's too", () => {
        const mask = floodMask(imageOf(SPIRAL), p(7, 7), { tolerance: 0, contiguous: false });
        expect(rowsOf(mask)).toEqual(
            SPIRAL.map((row) => row.replace(/\./g, "#").replace(/X/g, ".")),
        );
    });

    it("joins pixels by their edges only, not their corners", () => {
        const rows = [".X.", "X.X", ".X."];
        expect(rowsOf(floodMask(imageOf(rows), p(1, 1), exact))).toEqual(["...", ".#.", "..."]);
        expect(rowsOf(floodMask(imageOf(rows), p(0, 0), exact))).toEqual(["#..", "...", "..."]);
    });

    it("gives an empty mask for a seed outside the image", () => {
        for (const seed of [p(-1, 0), p(0, -1), p(20, 3), p(3, 15)]) {
            expect(maskBounds(floodMask(imageOf(SPIRAL), seed, exact))).toBeNull();
        }
    });
});

describe("tolerance thresholds", () => {
    const SEED = [100, 100, 100, 200];
    const pixels = [
        SEED,
        [101, 100, 100, 200], // red +1
        [100, 99, 100, 200], // green −1
        [100, 100, 101, 200], // blue +1
        [100, 100, 100, 201], // alpha +1
        [102, 100, 100, 200], // red +2
        [100, 100, 100, 198], // alpha −2
        [0, 0, 0, 0], // transparent
        [255, 255, 255, 255],
        [0, 0, 0, 255],
        SEED,
    ];
    const global = (tolerance: number) =>
        rowsOf(floodMask(rowOf(pixels), p(0, 0), { tolerance, contiguous: false }))[0];

    it("0: the exact colour only", () => {
        expect(global(0)).toBe("#.........#");
    });

    it("1: a difference of at most 1 in every channel, alpha included", () => {
        expect(global(1)).toBe("#####.....#");
    });

    it("255: every pixel", () => {
        expect(global(255)).toBe("###########");
    });

    it("contiguous with a tolerance stops at the first pixel beyond it", () => {
        expect(
            rowsOf(floodMask(rowOf(pixels), p(0, 0), { tolerance: 1, contiguous: true }))[0],
        ).toBe("#####......");
        expect(
            rowsOf(floodMask(rowOf(pixels), p(0, 0), { tolerance: 2, contiguous: true }))[0],
        ).toBe("#######....");
    });

    it("two transparent pixels match whatever their colour, at every tolerance", () => {
        const clear = [
            [0, 0, 0, 0],
            [50, 60, 70, 0],
            [255, 255, 255, 0],
            [0, 0, 0, 1],
            [0, 0, 0, 0],
        ];
        const at = (tolerance: number) =>
            rowsOf(floodMask(rowOf(clear), p(0, 0), { tolerance, contiguous: false }))[0];
        expect(at(0)).toBe("###.#");
        expect(at(1)).toBe("#####");
    });

    it("refuses a tolerance that is not a whole number from 0 to 255", () => {
        for (const tolerance of [-1, 256, 1.5, Number.NaN]) {
            expect(() =>
                floodMask(rowOf(pixels), p(0, 0), { tolerance, contiguous: true }),
            ).toThrow(RangeError);
        }
    });
});

describe("a selection limits the fill", () => {
    const rows = ["........", "........", "........", "........"];
    // Two selected areas joined only through unselected pixels.
    const selected = maskOf(["###..###", "###..###", "###..###", "........"]);

    it("takes no pixel outside it and does not cross one to reach another selected area", () => {
        const mask = floodMask(imageOf(rows), p(1, 1), { ...exact, within: selected });
        expect(rowsOf(mask)).toEqual(["###.....", "###.....", "###.....", "........"]);
    });

    it("global: every matching selected pixel", () => {
        const mask = floodMask(imageOf(rows), p(1, 1), {
            tolerance: 0,
            contiguous: false,
            within: selected,
        });
        expect(rowsOf(mask)).toEqual(rowsOf(selected));
    });

    it("a seed outside the selection fills nothing", () => {
        const mask = floodMask(imageOf(rows), p(4, 1), { ...exact, within: selected });
        expect(maskBounds(mask)).toBeNull();
    });

    it("refuses a limit of another size", () => {
        expect(() =>
            floodMask(imageOf(rows), p(0, 0), { ...exact, within: maskOf(["##", "##"]) }),
        ).toThrow(RangeError);
    });
});

/** The flood by breadth-first search: the oracle of the scanline fill. */
function oracle(source: PixelBuffer, seed: PixelPoint, options: FloodOptions): string[] {
    const { width, height, data } = source;
    const taken = new Uint8Array(width * height);
    const allowed = (index: number) => {
        const within = options.within;
        return !within || (within.data[index >> 3]! & (1 << (index & 7))) !== 0;
    };
    const s = (seed.y * width + seed.x) * 4;
    const matches = (index: number) => {
        const at = index * 4;
        if (data[at + 3] === 0 && data[s + 3] === 0) return true;
        return [0, 1, 2, 3].every(
            (channel) => Math.abs(data[at + channel]! - data[s + channel]!) <= options.tolerance,
        );
    };
    const start = seed.y * width + seed.x;
    if (allowed(start)) {
        const queue = [start];
        taken[start] = 1;
        while (queue.length > 0) {
            const index = queue.shift()!;
            const x = index % width;
            const y = Math.floor(index / width);
            const next = [
                x > 0 ? index - 1 : -1,
                x < width - 1 ? index + 1 : -1,
                y > 0 ? index - width : -1,
                y < height - 1 ? index + width : -1,
            ];
            for (const neighbour of next) {
                if (neighbour < 0 || taken[neighbour] || !allowed(neighbour)) continue;
                if (!matches(neighbour)) continue;
                taken[neighbour] = 1;
                queue.push(neighbour);
            }
        }
    }
    return Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => (taken[y * width + x] ? "#" : ".")).join(""),
    );
}

describe("random mazes against a breadth-first oracle", () => {
    it("contiguous fills of random images of a few colours, with tolerances and limits", () => {
        const random = seeded(17);
        for (let round = 0; round < 300; round++) {
            const width = 1 + Math.floor(random() * 40);
            const height = 1 + Math.floor(random() * 30);
            const image = createPixelBuffer(width, height);
            const density = random();
            for (let index = 0; index < width * height; index++) {
                const wall = random() < density;
                const shade = Math.floor(random() * 3);
                image.data.set(
                    wall ? [10 * shade, 0, 0, 255] : [200, 200, 200 + shade, 255],
                    index * 4,
                );
            }
            const within: BitMask | null =
                random() < 0.3
                    ? maskOf(
                          Array.from({ length: height }, () =>
                              Array.from({ length: width }, () =>
                                  random() < 0.8 ? "#" : ".",
                              ).join(""),
                          ),
                      )
                    : null;
            const seed = p(Math.floor(random() * width), Math.floor(random() * height));
            const options: FloodOptions = {
                tolerance: [0, 1, 2, 30][Math.floor(random() * 4)]!,
                contiguous: true,
                within,
            };
            const expected = oracle(image, seed, options);
            if (within && !rowsOf(within)[seed.y]![seed.x]!.includes("#")) {
                expect(maskBounds(floodMask(image, seed, options)), `round ${round}`).toBeNull();
                continue;
            }
            expect(rowsOf(floodMask(image, seed, options)), `round ${round}`).toEqual(expected);
        }
    });
});

describe("without recursion", () => {
    const SIDE = 1024;

    it("fills the single corridor of a 1024 × 1024 serpentine maze, half a million pixels long", () => {
        // Even rows are corridor; each odd row is a wall with one gap, at its right end and its
        // left end in turn, so the corridor runs the whole image in one path.
        // The last row's gap is a dead end off the last corridor row.
        const gap = (y: number) => ((y >> 1) % 2 === 0 ? SIDE - 1 : 0);
        const image = createPixelBuffer(SIDE, SIDE, 0xffffffff);
        for (let y = 1; y < SIDE; y += 2) {
            for (let x = 0; x < SIDE; x++) {
                if (x !== gap(y)) image.data.set(WALL, (y * SIDE + x) * 4);
            }
        }
        const mask = floodMask(image, p(0, 0), exact);
        let count = 0;
        for (let index = 0; index < SIDE * SIDE; index++) {
            const set = (mask.data[index >> 3]! & (1 << (index & 7))) !== 0;
            const x = index % SIDE;
            const y = Math.floor(index / SIDE);
            const corridor = y % 2 === 0 || x === gap(y);
            if (set !== corridor) throw new Error(`pixel ${x}, ${y}: ${set ? "set" : "clear"}`);
            if (set) count++;
        }
        // 512 corridor rows and 512 gaps.
        expect(count).toBe((SIDE / 2) * SIDE + SIDE / 2);
    });

    it("fills a 1024 × 1024 empty canvas in full", () => {
        const image = createPixelBuffer(SIDE, SIDE);
        const mask = floodMask(image, p(500, 700), exact);
        expect(mask.data.every((byte) => byte === 0xff)).toBe(true);
        expect(selectionOf(mask)?.bounds).toEqual({ x: 0, y: 0, width: SIDE, height: SIDE });
    });
});

describe("painting the mask", () => {
    it("inks exactly the mask's pixels and returns the rectangle of those that changed", () => {
        const image = imageOf(SPIRAL);
        const before = image.data.slice();
        const mask = floodMask(image, p(16, 1), exact);
        expect(rowsOf(mask).filter((row) => row.includes("#"))).toEqual([
            "................###.",
            "................###.",
        ]);
        const changed = paintMask(image, image, mask, paintInk("simple", 0x336699ff, 255));
        expect(changed).toEqual({ x: 16, y: 1, width: 3, height: 2 });
        for (let index = 0; index < 20 * 15; index++) {
            const inside = (mask.data[index >> 3]! & (1 << (index & 7))) !== 0;
            const pixel = Array.from(image.data.slice(index * 4, index * 4 + 4));
            expect(pixel).toEqual(
                inside
                    ? [0x33, 0x66, 0x99, 255]
                    : Array.from(before.slice(index * 4, index * 4 + 4)),
            );
        }
        // Again: nothing changes.
        expect(paintMask(image, image, mask, paintInk("simple", 0x336699ff, 255))).toBeNull();
    });

    it("computes each pixel from its own value, so the original may be the image itself", () => {
        const image = rowOf([
            [255, 0, 0, 128],
            [255, 0, 0, 128],
            [0, 0, 255, 255],
        ]);
        const copy = { ...image, data: image.data.slice() };
        const ink = paintInk("alpha", 0x0000ff80, 255);
        const mask = maskOf(["##."]);
        paintMask(image, image, mask, ink);
        paintMask(copy, { ...copy, data: copy.data.slice() }, mask, ink);
        expect(image.data).toEqual(copy.data);
        expect(Array.from(image.data.slice(0, 4))).not.toEqual([255, 0, 0, 128]);
    });

    it("refuses a mask of another size", () => {
        const image = imageOf(["...", "..."]);
        expect(() => paintMask(image, image, maskOf(["##"]), paintInk("simple", 0, 255))).toThrow(
            RangeError,
        );
    });
});
