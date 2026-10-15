import { describe, expect, it } from "vitest";
import {
    brushCovers,
    createBrush,
    ELLIPSE_MAX_SIDE,
    ellipsePixels,
    ellipseSpans,
    forEachEllipsePixel,
} from "../../src/core/raster";
import { ellipseRows } from "../../src/core/selection";

// SE-017: the midpoint ellipse of `core/raster`, which fits an exact bounding box for odd and
// even sides. Golden outlines and filled ellipses for the bounding boxes 1×1 through 9×9 and
// 16×7 (and a few flat ones), written out and checked by eye; for every box up to 9×9 (and
// beyond, where cheap) the properties that make the goldens right: inside the box and
// touching all four sides, symmetric about both axes, one connected closed outline, the
// filled ellipse the outline's rows filled in, the same pixels as the selection's ellipse mask
// (SE-030) and, for a square, as SE-015's circle brush.

/** The outline of the ellipse that fits `width` × `height` as rows of `#` and `.`. */
function outline(width: number, height: number): string[] {
    const grid = Array.from({ length: height }, () => new Array<string>(width).fill("."));
    forEachEllipsePixel(0, 0, width - 1, height - 1, (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) {
            throw new Error(`${width}×${height}: pixel ${x}, ${y} outside the box`);
        }
        grid[y]![x] = "#";
    });
    return grid.map((row) => row.join(""));
}

/** The filled ellipse that fits `width` × `height` as rows of `#` and `.`. */
function filled(width: number, height: number): string[] {
    const { starts, ends } = ellipseSpans(width, height);
    return Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => (x >= starts[y]! && x < ends[y]! ? "#" : ".")).join(
            "",
        ),
    );
}

const OUTLINES: Record<string, string[]> = {
    "1x1": ["#"],
    "2x2": ["##", "##"],
    "3x3": [".#.", "#.#", ".#."],
    "4x4": [".##.", "#..#", "#..#", ".##."],
    "5x5": [".###.", "#...#", "#...#", "#...#", ".###."],
    "6x6": ["..##..", ".#..#.", "#....#", "#....#", ".#..#.", "..##.."],
    "7x7": ["..###..", ".#...#.", "#.....#", "#.....#", "#.....#", ".#...#.", "..###.."],
    "8x8": [
        "..####..",
        ".#....#.",
        "#......#",
        "#......#",
        "#......#",
        "#......#",
        ".#....#.",
        "..####..",
    ],
    "9x9": [
        "...###...",
        "..#...#..",
        ".#.....#.",
        "#.......#",
        "#.......#",
        "#.......#",
        ".#.....#.",
        "..#...#..",
        "...###...",
    ],
    "16x7": [
        "....########....",
        "..##........##..",
        ".#............#.",
        "#..............#",
        ".#............#.",
        "..##........##..",
        "....########....",
    ],
    "9x4": ["..#####..", "##.....##", "##.....##", "..#####.."],
    "3x8": [".#.", ".#.", "#.#", "#.#", "#.#", "#.#", ".#.", ".#."],
    "1x5": ["#", "#", "#", "#", "#"],
    "5x1": ["#####"],
    "2x7": ["##", "##", "##", "##", "##", "##", "##"],
};

const FILLED: Record<string, string[]> = {
    "1x1": ["#"],
    "2x2": ["##", "##"],
    "3x3": [".#.", "###", ".#."],
    "4x4": [".##.", "####", "####", ".##."],
    "5x5": [".###.", "#####", "#####", "#####", ".###."],
    "6x6": ["..##..", ".####.", "######", "######", ".####.", "..##.."],
    "7x7": ["..###..", ".#####.", "#######", "#######", "#######", ".#####.", "..###.."],
    "8x8": [
        "..####..",
        ".######.",
        "########",
        "########",
        "########",
        "########",
        ".######.",
        "..####..",
    ],
    "9x9": [
        "...###...",
        "..#####..",
        ".#######.",
        "#########",
        "#########",
        "#########",
        ".#######.",
        "..#####..",
        "...###...",
    ],
    "16x7": [
        "....########....",
        "..############..",
        ".##############.",
        "################",
        ".##############.",
        "..############..",
        "....########....",
    ],
    "9x4": ["..#####..", "#########", "#########", "..#####.."],
    "3x8": [".#.", ".#.", "###", "###", "###", "###", ".#.", ".#."],
    "1x5": ["#", "#", "#", "#", "#"],
    "5x1": ["#####"],
    "2x7": ["##", "##", "##", "##", "##", "##", "##"],
};

describe("ellipses, golden", () => {
    for (const key of Object.keys(OUTLINES)) {
        const [width, height] = key.split("x").map(Number) as [number, number];
        it(`outline ${width}×${height}`, () => {
            expect(outline(width, height)).toEqual(OUTLINES[key]);
        });
        it(`filled ${width}×${height}`, () => {
            expect(filled(width, height)).toEqual(FILLED[key]);
        });
    }
    it("covers every square box from 1×1 to 9×9 and the box 16×7", () => {
        for (let side = 1; side <= 9; side++) expect(OUTLINES[`${side}x${side}`]).toBeDefined();
        expect(OUTLINES["16x7"]).toBeDefined();
    });
});

/** The pixels of rows of `#` as `x,y` keys. */
function keysOf(rows: readonly string[]): Set<string> {
    const keys = new Set<string>();
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === "#") keys.add(`${x},${y}`);
    });
    return keys;
}

/** Whether the pixels are one 8-connected group. */
function connected(keys: Set<string>): boolean {
    const [first] = keys;
    if (first === undefined) return false;
    const seen = new Set([first]);
    const queue = [first];
    while (queue.length > 0) {
        const [x, y] = queue.pop()!.split(",").map(Number) as [number, number];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const key = `${x + dx},${y + dy}`;
                if (keys.has(key) && !seen.has(key)) {
                    seen.add(key);
                    queue.push(key);
                }
            }
        }
    }
    return seen.size === keys.size;
}

describe("ellipses fit their bounding box exactly", () => {
    const boxes: [number, number][] = [];
    for (let height = 1; height <= 9; height++) {
        for (let width = 1; width <= 9; width++) boxes.push([width, height]);
    }
    for (const extra of [
        [16, 7],
        [7, 16],
        [20, 3],
        [31, 12],
        [64, 64],
        [63, 2],
    ] as const) {
        boxes.push([extra[0], extra[1]]);
    }

    it("lies inside the box and touches its four sides, for odd and even sides", () => {
        for (const [width, height] of boxes) {
            const rows = outline(width, height);
            expect(rows[0], `${width}×${height} top`).toContain("#");
            expect(rows[height - 1], `${width}×${height} bottom`).toContain("#");
            expect(
                rows.some((row) => row[0] === "#"),
                `${width}×${height} left`,
            ).toBe(true);
            expect(
                rows.some((row) => row[width - 1] === "#"),
                `${width}×${height} right`,
            ).toBe(true);
            // Every row of the box has an outline pixel.
            expect(
                rows.every((row) => row.includes("#")),
                `${width}×${height} rows`,
            ).toBe(true);
        }
    });

    it("is symmetric about both axes", () => {
        for (const [width, height] of boxes) {
            const rows = outline(width, height);
            const mirrored = rows.map((row) => [...row].reverse().join(""));
            expect(mirrored, `${width}×${height} left-right`).toEqual(rows);
            expect([...rows].reverse(), `${width}×${height} top-bottom`).toEqual(rows);
        }
    });

    it("is one connected outline: each row's pixels lie at its ends", () => {
        for (const [width, height] of boxes) {
            const rows = outline(width, height);
            expect(connected(keysOf(rows)), `${width}×${height}`).toBe(true);
            // Inside each row the outline holds no pixel apart from the runs at the row's two
            // ends, so the filled ellipse is the outline's rows filled in.
            rows.forEach((row, y) => {
                const runs = row.split(/\.+/).filter((run) => run.length > 0);
                expect(runs.length, `${width}×${height} row ${y}`).toBeLessThanOrEqual(2);
            });
        }
    });

    it("fills every pixel between a row's outline pixels", () => {
        for (const [width, height] of boxes) {
            const rows = outline(width, height);
            const expected = rows.map((row) => {
                const first = row.indexOf("#");
                const last = row.lastIndexOf("#");
                return Array.from({ length: width }, (_, x) =>
                    x >= first && x <= last ? "#" : ".",
                ).join("");
            });
            expect(filled(width, height), `${width}×${height}`).toEqual(expected);
        }
    });

    it("fills the same pixels as the selection's ellipse mask (SE-030) up to 32×32", () => {
        for (let height = 1; height <= 32; height++) {
            for (let width = 1; width <= 32; width++) {
                const ours = ellipseSpans(width, height);
                const selection = ellipseRows(width, height);
                expect(ours.starts, `${width}×${height}`).toEqual(selection.starts);
                expect(ours.ends, `${width}×${height}`).toEqual(selection.ends);
            }
        }
    });

    it("fills a square box as SE-015's circle brush of that size, 1 to 64", () => {
        for (let size = 1; size <= 64; size++) {
            const brush = createBrush("circle", size);
            const rows = Array.from({ length: size }, (_, y) =>
                Array.from({ length: size }, (_, x) => (brushCovers(brush, x, y) ? "#" : ".")).join(
                    "",
                ),
            );
            expect(filled(size, size), `${size}`).toEqual(rows);
        }
    });
});

describe("placement and limits", () => {
    it("draws the same pixels whatever the order of the corners, moved with them", () => {
        const at = ellipsePixels({ x: 0, y: 0 }, { x: 10, y: 5 });
        const moved = at.map(({ x, y }) => ({ x: x - 7, y: y + 3 }));
        expect(ellipsePixels({ x: 3, y: 8 }, { x: -7, y: 3 })).toEqual(moved);
        expect(ellipsePixels({ x: -7, y: 8 }, { x: 3, y: 3 })).toEqual(moved);
    });

    it("lists each outline pixel once, row by row", () => {
        const pixels = ellipsePixels({ x: 0, y: 0 }, { x: 8, y: 8 });
        expect(pixels).toEqual(
            [...keysOf(OUTLINES["9x9"]!)]
                .map((key) => key.split(",").map(Number) as [number, number])
                .map(([x, y]) => ({ x, y }))
                .sort((p, q) => p.y - q.y || p.x - q.x),
        );
    });

    it("refuses corners that are not whole numbers and sides beyond the exact range", () => {
        const visit = () => {};
        expect(() => forEachEllipsePixel(0, 0, 1.5, 3, visit)).toThrow(RangeError);
        expect(() => forEachEllipsePixel(0, 0, ELLIPSE_MAX_SIDE, 3, visit)).toThrow(RangeError);
        expect(() => forEachEllipsePixel(0, 0, ELLIPSE_MAX_SIDE - 1, 3, visit)).not.toThrow();
        expect(() => ellipseSpans(0, 3)).toThrow(RangeError);
    });
});
