import { describe, expect, it } from "vitest";
import {
    ImportError,
    MAX_IMPORT_FRAMES,
    cellsFromFiles,
    compareNatural,
    crop,
    gridLayout,
    sliceGrid,
} from "../../src/core/import";
import type { GridOptions, ImportErrorCode } from "../../src/core/import";
import { createPixelBuffer, pixelBuffersEqual } from "../../src/core/pixels";
import { grid, show } from "./se-043-support";

/** The code of the `ImportError` that `run` throws; fails when it throws anything else. */
function codeOf(run: () => unknown): ImportErrorCode | "nothing thrown" {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(ImportError);
        return (error as ImportError).code;
    }
    return "nothing thrown";
}

const LETTERS = grid("ABCD", "EFGH", "IJKL", "MNOP");

describe("crop", () => {
    it("returns the pixels of the rectangle", () => {
        expect(show(crop(LETTERS, { x: 1, y: 2, width: 3, height: 2 }))).toEqual(["JKL", "NOP"]);
        expect(show(crop(LETTERS, { x: 0, y: 0, width: 1, height: 1 }))).toEqual(["A"]);
    });

    it("returns a copy of the whole image for the whole rectangle", () => {
        const result = crop(LETTERS, { x: 0, y: 0, width: 4, height: 4 });
        expect(pixelBuffersEqual(result, LETTERS)).toBe(true);
        expect(result.data.buffer).not.toBe(LETTERS.data.buffer);
    });

    it("rejects a rectangle that is not inside the image", () => {
        for (const rect of [
            { x: -1, y: 0, width: 2, height: 2 },
            { x: 0, y: -1, width: 2, height: 2 },
            { x: 3, y: 0, width: 2, height: 1 },
            { x: 0, y: 3, width: 1, height: 2 },
            { x: 4, y: 0, width: 1, height: 1 },
            { x: 0, y: 0, width: 0, height: 1 },
            { x: 0, y: 0, width: 1, height: -1 },
            { x: 0.5, y: 0, width: 1, height: 1 },
            { x: 0, y: 0, width: 1.5, height: 1 },
            { x: 0, y: 0, width: Number.NaN, height: 1 },
        ]) {
            expect(
                codeOf(() => crop(LETTERS, rect)),
                JSON.stringify(rect),
            ).toBe("settings");
        }
    });
});

describe("gridLayout", () => {
    it("counts the whole cells of a cell size", () => {
        expect(gridLayout(64, 32, { cell: { width: 16, height: 16 } })).toEqual({
            columns: 4,
            rows: 2,
            cellWidth: 16,
            cellHeight: 16,
            offsetX: 0,
            offsetY: 0,
            spacingX: 0,
            spacingY: 0,
        });
        // 70 px hold four 16 px cells; the last 6 px are no cell.
        expect(gridLayout(70, 16, { cell: { width: 16, height: 16 } }).columns).toBe(4);
    });

    it("counts cells between the offset and the far edge, with spacing between them", () => {
        // From x = 2: cells at 2, 7, 12 (3 wide, 2 apart); a fourth would end at 20 > 19.
        // From y = 1: cells at 1 and 6 (4 tall, 1 apart); a third would end at 15 > 11.
        const layout = gridLayout(19, 11, {
            cell: { width: 3, height: 4 },
            offset: { x: 2, y: 1 },
            spacing: { x: 2, y: 1 },
        });
        expect([layout.columns, layout.rows]).toEqual([3, 2]);
        // A cell needs no spacing after it: 17 px hold exactly three such columns.
        const exact = gridLayout(17, 5, {
            cell: { width: 3, height: 4 },
            offset: { x: 2, y: 1 },
            spacing: { x: 3, y: 0 },
        });
        expect([exact.columns, exact.rows]).toEqual([3, 1]);
    });

    it("derives the cell size from columns and rows", () => {
        expect(gridLayout(64, 32, { cell: { columns: 4, rows: 2 } })).toMatchObject({
            columns: 4,
            rows: 2,
            cellWidth: 16,
            cellHeight: 16,
        });
        // (20 - 1 - 2 × 2) / 3 = 5 and (11 - 2 - 1) / 2 = 4.
        const layout = gridLayout(20, 11, {
            cell: { columns: 3, rows: 2 },
            offset: { x: 1, y: 2 },
            spacing: { x: 2, y: 1 },
        });
        expect([layout.cellWidth, layout.cellHeight]).toEqual([5, 4]);
        // 10 px in 3 columns are 3 px each; the last pixel is left over.
        expect(gridLayout(10, 1, { cell: { columns: 3, rows: 1 } }).cellWidth).toBe(3);
    });

    it("rejects values that are not integers in range", () => {
        const invalid: GridOptions[] = [
            { cell: { width: 0, height: 4 } },
            { cell: { width: 4, height: -1 } },
            { cell: { width: 2.5, height: 4 } },
            { cell: { columns: 0, rows: 1 } },
            { cell: { columns: 1, rows: 1.5 } },
            { cell: { width: 4, height: 4 }, offset: { x: -1, y: 0 } },
            { cell: { width: 4, height: 4 }, offset: { x: 0, y: 0.5 } },
            { cell: { width: 4, height: 4 }, spacing: { x: -1, y: 0 } },
            { cell: { width: 4, height: 4 }, spacing: { x: 0, y: Number.NaN } },
        ];
        for (const options of invalid) {
            expect(
                codeOf(() => gridLayout(16, 16, options)),
                JSON.stringify(options),
            ).toBe("settings");
        }
    });

    it("rejects a grid of which no cell fits", () => {
        const noFit: GridOptions[] = [
            { cell: { width: 17, height: 4 } },
            { cell: { width: 4, height: 17 } },
            { cell: { width: 4, height: 4 }, offset: { x: 13, y: 0 } },
            { cell: { width: 4, height: 4 }, offset: { x: 0, y: 20 } },
            { cell: { columns: 17, rows: 1 } },
            { cell: { columns: 4, rows: 4 }, spacing: { x: 5, y: 0 } },
        ];
        for (const options of noFit) {
            expect(
                codeOf(() => gridLayout(16, 16, options)),
                JSON.stringify(options),
            ).toBe("settings");
        }
    });
});

describe("sliceGrid", () => {
    it("cuts a sheet into cells in row-major order", () => {
        const sheet = grid("AABB", "AABB", "CCDD", "CCDD");
        const cells = sliceGrid(sheet, { cell: { width: 2, height: 2 } });
        expect(cells.map(show)).toEqual([
            ["AA", "AA"],
            ["BB", "BB"],
            ["CC", "CC"],
            ["DD", "DD"],
        ]);
    });

    it("cuts with an offset and spacing", () => {
        // A 1 px border at the left and top, cells of 2 × 2, 1 px between columns and 2 px
        // between rows. "x" marks the pixels that belong to no cell: a third column would
        // need x = 7 and 8, a third row y = 9 and 10.
        const sheet = grid(
            "xxxxxxxx",
            "xABxCDxx",
            "xEFxGHxx",
            "xxxxxxxx",
            "xxxxxxxx",
            "xIJxKLxx",
            "xMNxOPxx",
            "xxxxxxxx",
        );
        const options = {
            cell: { width: 2, height: 2 },
            offset: { x: 1, y: 1 },
            spacing: { x: 1, y: 2 },
        };
        expect(sliceGrid(sheet, options).map(show)).toEqual([
            ["AB", "EF"],
            ["CD", "GH"],
            ["IJ", "MN"],
            ["KL", "OP"],
        ]);
        // One pixel wider, the third column fits.
        const wider = grid("xxxxxxxxx", "xABxCDxQR", "xEFxGHxST");
        expect(sliceGrid(wider, options).map(show)).toEqual([
            ["AB", "EF"],
            ["CD", "GH"],
            ["QR", "ST"],
        ]);
    });

    it("cuts by columns and rows", () => {
        const sheet = grid("ABCDEF", "GHIJKL");
        expect(sliceGrid(sheet, { cell: { columns: 3, rows: 2 } }).map(show)).toEqual([
            ["AB"],
            ["CD"],
            ["EF"],
            ["GH"],
            ["IJ"],
            ["KL"],
        ]);
    });

    it("skips cells that are fully transparent when asked to", () => {
        // The second cell has colour under alpha 0 only; the third is transparent black.
        const sheet = grid("AAbb..CC", "AAbb...C");
        const options = { cell: { width: 2, height: 2 } };
        expect(sliceGrid(sheet, options)).toHaveLength(4);
        expect(sliceGrid(sheet, { ...options, skipEmpty: true }).map(show)).toEqual([
            ["AA", "AA"],
            ["CC", ".C"],
        ]);
    });

    it("returns no cell when every cell is skipped", () => {
        const empty = createPixelBuffer(4, 4);
        expect(sliceGrid(empty, { cell: { width: 2, height: 2 }, skipEmpty: true })).toEqual([]);
    });

    it("returns cells with storage of their own", () => {
        const sheet = grid("AB", "CD");
        const [cell] = sliceGrid(sheet, { cell: { width: 2, height: 2 } });
        cell.data.fill(0);
        expect(show(sheet)).toEqual(["AB", "CD"]);
    });

    it("refuses more cells than the frame limit, naming the limit", () => {
        const options = { cell: { width: 1, height: 1 } };
        const atLimit = createPixelBuffer(MAX_IMPORT_FRAMES, 1, 0x112233ff);
        expect(sliceGrid(atLimit, options)).toHaveLength(1024);

        const over = createPixelBuffer(MAX_IMPORT_FRAMES + 1, 1, 0x112233ff);
        expect(codeOf(() => sliceGrid(over, options))).toBe("frame-count");
        expect(() => sliceGrid(over, options)).toThrow(/1025 frames; the limit is 1024 frames/);
        expect(codeOf(() => sliceGrid(over, { ...options, skipEmpty: true }))).toBe("frame-count");
    });

    it("counts only the cells it keeps against the frame limit", () => {
        // 2048 cells, every second one empty: 1024 remain.
        const sheet = createPixelBuffer(2048, 1);
        for (let x = 0; x < 2048; x += 2) {
            sheet.data[x * 4 + 3] = 255;
        }
        const options = { cell: { width: 1, height: 1 }, skipEmpty: true };
        expect(sliceGrid(sheet, options)).toHaveLength(1024);
    });
});

describe("compareNatural", () => {
    const sorted = (names: string[]): string[] => [...names].sort(compareNatural);

    it("orders runs of digits as numbers", () => {
        expect(sorted(["a2", "a10", "a1"])).toEqual(["a1", "a2", "a10"]);
        expect(sorted(["f100.png", "f20.png", "f3.png"])).toEqual([
            "f3.png",
            "f20.png",
            "f100.png",
        ]);
        expect(sorted(["x2y10", "x2y9", "x10y1"])).toEqual(["x2y9", "x2y10", "x10y1"]);
    });

    it("compares numbers too long for a double", () => {
        const names = ["n10000000000000000000002", "n10000000000000000000001", "n9"];
        expect(sorted(names)).toEqual([
            "n9",
            "n10000000000000000000001",
            "n10000000000000000000002",
        ]);
    });

    it("ignores case, then leading zeros, before falling back to code units", () => {
        expect(sorted(["b.png", "A.png", "a.png", "B.png"])).toEqual([
            "A.png",
            "a.png",
            "B.png",
            "b.png",
        ]);
        expect(sorted(["Frame10", "frame2"])).toEqual(["frame2", "Frame10"]);
        expect(sorted(["a1", "a01", "a001", "a2"])).toEqual(["a001", "a01", "a1", "a2"]);
    });

    it("puts a name before the names that extend it, whatever the extension", () => {
        expect(sorted(["walk-2.png", "walk.png", "walk2.png", "walk_1.png"])).toEqual([
            "walk.png",
            "walk-2.png",
            "walk2.png",
            "walk_1.png",
        ]);
        expect(sorted(["a.png", "a", "a.gif"])).toEqual(["a", "a.gif", "a.png"]);
    });

    it("is 0 only for identical names and antisymmetric otherwise", () => {
        const names = ["a1", "A1", "a01", "a1.png", "a10", "b", "", "1", "01", ".png", "a.b.c"];
        for (const first of names) {
            for (const second of names) {
                const order = Math.sign(compareNatural(first, second));
                expect(order === 0, `${first} / ${second}`).toBe(first === second);
                expect(Math.sign(compareNatural(second, first)) + order).toBe(0);
            }
        }
    });
});

describe("cellsFromFiles", () => {
    it("orders three files a2, a10, a1 as a1, a2, a10", () => {
        const a2 = { name: "a2.png", pixels: grid("B") };
        const a10 = { name: "a10.png", pixels: grid("C") };
        const a1 = { name: "a1.png", pixels: grid("A") };
        const cells = cellsFromFiles([a2, a10, a1]);
        expect(cells.map(show)).toEqual([["A"], ["B"], ["C"]]);
        // The buffers themselves, not copies.
        expect(cells).toEqual([a1.pixels, a2.pixels, a10.pixels]);
        expect(cells[0]).toBe(a1.pixels);
    });

    it("does not reorder its argument and keeps the given order of identical names", () => {
        const files = [
            { name: "b.png", pixels: grid("B") },
            { name: "a.png", pixels: grid("X") },
            { name: "a.png", pixels: grid("Y") },
        ];
        expect(cellsFromFiles(files).map(show)).toEqual([["X"], ["Y"], ["B"]]);
        expect(files.map((file) => file.name)).toEqual(["b.png", "a.png", "a.png"]);
    });

    it("accepts files of different sizes and no files", () => {
        const files = [
            { name: "2", pixels: grid("AB") },
            { name: "1", pixels: grid("C", "D") },
        ];
        expect(cellsFromFiles(files).map(show)).toEqual([["C", "D"], ["AB"]]);
        expect(cellsFromFiles([])).toEqual([]);
    });

    it("refuses more files than the frame limit", () => {
        const pixels = grid("A");
        const files = Array.from({ length: MAX_IMPORT_FRAMES + 1 }, (_, i) => ({
            name: `f${i}.png`,
            pixels,
        }));
        expect(cellsFromFiles(files.slice(1))).toHaveLength(1024);
        expect(codeOf(() => cellsFromFiles(files))).toBe("frame-count");
    });
});
