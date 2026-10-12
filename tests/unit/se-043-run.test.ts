import { describe, expect, it } from "vitest";
import {
    IMPORTED_PALETTE_NAME,
    ImportError,
    MAX_IMPORT_FRAMES,
    MAX_IMPORT_PIXEL_BYTES,
    MAX_IMPORT_SOURCE_SIDE,
    applyAlpha,
    buildPalette,
    importCells,
    mapToPalette,
    resample,
    runImport,
    sliceGrid,
    smartDefaults,
} from "../../src/core/import";
import type {
    ColorSettings,
    DitherMethod,
    ImportErrorCode,
    ImportSettings,
    ImportSource,
} from "../../src/core/import";
import { PRESET_PALETTES, paletteFromPreset } from "../../src/core/palettes";
import { clonePixelBuffer, createPixelBuffer, pixelBuffersEqual } from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";
import { colorsOf, distinctColors, grid, hex, image, noise, show } from "./se-043-support";

/** Settings that change nothing at the given size; tests override single steps. */
function keepAll(width: number, height: number): ImportSettings {
    return {
        size: { width, height, fit: "stretch" },
        resample: "nearest",
        alpha: {},
        colors: { mode: "keep" },
        dither: "none",
    };
}

function source(name: string, pixels: PixelBuffer): ImportSource {
    return { name, pixels };
}

/** The `ImportError` that `run` throws; fails when it throws anything else or nothing. */
function errorOf(run: () => unknown): ImportError {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(ImportError);
        return error as ImportError;
    }
    throw new Error("Expected an ImportError, but nothing was thrown.");
}

function codeOf(run: () => unknown): ImportErrorCode {
    return errorOf(run).code;
}

/** Opaque noise with soft alpha along its top row, so that every step has something to do. */
function softSheet(width: number, height: number, seed: number): PixelBuffer {
    const sheet = noise(width, height, seed);
    for (let x = 0; x < width; x++) {
        sheet.data[x * 4 + 3] = (x * 37) & 0xff;
    }
    return sheet;
}

// Two cells of 2 × 2 side by side.
// Left, all opaque: red (200 + 100) / 4 = 75, green (100 + 200) / 4 = 75.
// Right, two opaque whites and two transparent pixels: white at alpha 510 / 4 = 127.5 → 128.
const TWO_CELLS = image(4, [
    ...[0xc80000ff, 0x640000ff, 0xffffffff, 0x09090900],
    ...[0x006400ff, 0x00c800ff, 0x07070700, 0xffffffff],
]);
const TWO_CELLS_TO_1X1: ImportSettings = {
    cells: { mode: "grid", grid: { cell: { width: 2, height: 2 } } },
    size: { width: 1, height: 1, fit: "stretch" },
    resample: "area",
    alpha: {},
    colors: { mode: "keep" },
    dither: "none",
};

describe("importCells", () => {
    const SHEET = grid("xxxxxx", "xAABBx", "xAABBx", "xxxxxx");
    const INNER = { x: 1, y: 1, width: 4, height: 2 };

    it("returns the one source itself as a single sprite", () => {
        const pixels = grid("AB", "CD");
        const cells = importCells([source("s.png", pixels)], {});
        expect(cells).toHaveLength(1);
        expect(cells[0]).toBe(pixels);
        expect(importCells([source("s.png", pixels)], { cells: { mode: "single" } })[0]).toBe(
            pixels,
        );
    });

    it("crops the region, then slices the grid", () => {
        const cells = importCells([source("s.png", SHEET)], {
            region: INNER,
            cells: { mode: "grid", grid: { cell: { width: 2, height: 2 } } },
        });
        expect(cells.map(show)).toEqual([
            ["AA", "AA"],
            ["BB", "BB"],
        ]);
        expect(importCells([source("s.png", SHEET)], { region: INNER }).map(show)).toEqual([
            ["AABB", "AABB"],
        ]);
    });

    it("takes several sources as one cell each, in natural order, whatever `cells` says", () => {
        const sources = [
            source("a2.png", grid("B")),
            source("a10.png", grid("C")),
            source("a1.png", grid("A")),
        ];
        expect(importCells(sources, {}).map(show)).toEqual([["A"], ["B"], ["C"]]);
        const sheets = [source("2.png", SHEET), source("1.png", grid("....", "IJKL", "MNOP"))];
        const cells = importCells(sheets, {
            region: { x: 1, y: 1, width: 2, height: 2 },
            cells: { mode: "grid", grid: { cell: { width: 1, height: 1 } } },
        });
        expect(cells.map(show)).toEqual([
            ["JK", "NO"],
            ["AA", "AA"],
        ]);
    });

    it("refuses what runImport refuses in these steps", () => {
        const one = [source("s.png", grid("AB", "CD"))];
        expect(codeOf(() => importCells([], {}))).toBe("no-cells");
        expect(codeOf(() => importCells([source("b.png", createPixelBuffer(8193, 1))], {}))).toBe(
            "source-size",
        );
        expect(
            codeOf(() => importCells(one, { region: { x: 1, y: 1, width: 2, height: 2 } })),
        ).toBe("settings");
        const tooFine = { mode: "grid", grid: { cell: { width: 1, height: 1 } } } as const;
        const wide = [source("w.png", createPixelBuffer(1025, 1, 0x010203ff))];
        expect(codeOf(() => importCells(wide, { cells: tooFine }))).toBe("frame-count");
        const skipping = { mode: "grid", grid: { ...tooFine.grid, skipEmpty: true } } as const;
        const blank = [source("e.png", createPixelBuffer(4, 4))];
        expect(codeOf(() => importCells(blank, { cells: skipping }))).toBe("no-cells");
    });

    it("feeds smartDefaults, whose settings runImport accepts as they are", () => {
        const sources = [source("s.png", noise(48, 32, 3))];
        const settings = smartDefaults(importCells(sources, {}), { width: 16, height: 16 });
        const { frames, palette } = runImport(sources, settings);
        // 48 × 32 contained in 16 × 16: 16 × 11, two transparent rows above and three below.
        expect([frames[0].width, frames[0].height]).toEqual([16, 16]);
        expect(palette.colors).toHaveLength(16);
        const rows = hex(frames[0]).map((row) => row.split(" "));
        expect(rows.map((row) => row.every((color) => color === "00000000"))).toEqual([
            ...[true, true],
            ...new Array<boolean>(11).fill(false),
            ...[true, true, true],
        ]);
        expect(
            rows
                .slice(2, 13)
                .flat()
                .every((color) => color.endsWith("ff")),
        ).toBe(true);
    });
});

describe("runImport", () => {
    it("slices, resamples and keeps: one frame per cell and the frames' own palette", () => {
        const result = runImport([source("sheet.png", TWO_CELLS)], TWO_CELLS_TO_1X1);
        expect(result.frames.map(hex)).toEqual([["4b4b00ff"], ["ffffff80"]]);
        // Dark to light; the half-transparent white counts as white.
        expect(result.palette).toEqual({
            name: IMPORTED_PALETTE_NAME,
            colors: [0x4b4b00ff, 0xffffffff],
        });
    });

    it("applies the alpha step after resampling", () => {
        const settings = { ...TWO_CELLS_TO_1X1, alpha: { threshold: 128 } };
        const { frames } = runImport([source("sheet.png", TWO_CELLS)], settings);
        expect(frames.map(hex)).toEqual([["4b4b00ff"], ["ffffffff"]]);
        const stricter = { ...TWO_CELLS_TO_1X1, alpha: { threshold: 129 } };
        expect(runImport([source("sheet.png", TWO_CELLS)], stricter).frames.map(hex)).toEqual([
            ["4b4b00ff"],
            ["00000000"],
        ]);
    });

    it("maps the frames to a given palette and returns a copy of it", () => {
        const palette = { name: "Two", colors: [0x000000ff, 0xffffffff] };
        const settings: ImportSettings = {
            ...TWO_CELLS_TO_1X1,
            colors: { mode: "palette", palette },
        };
        const result = runImport([source("sheet.png", TWO_CELLS)], settings);
        // The dark olive 75, 75, 0 is nearer to black; alpha is kept.
        expect(result.frames.map(hex)).toEqual([["000000ff"], ["ffffff80"]]);
        expect(result.palette).toEqual(palette);
        expect(result.palette.colors).not.toBe(palette.colors);
    });

    it("reduces all frames to one palette of the asked size", () => {
        const sheet = softSheet(32, 16, 21);
        const options = { cell: { width: 16, height: 16 } };
        const settings: ImportSettings = {
            cells: { mode: "grid", grid: options },
            size: { width: 6, height: 6, fit: "stretch" },
            resample: "area",
            alpha: { threshold: 128 },
            colors: { mode: "reduce", count: 4 },
            dither: "none",
        };
        const result = runImport([source("sheet.png", sheet)], settings);

        // The same steps by hand.
        const cells = sliceGrid(sheet, options).map((cell) =>
            applyAlpha(resample(cell, 6, 6, { method: "area", fit: "stretch" }), {
                threshold: 128,
            }),
        );
        const colors = buildPalette(cells, 4);
        const expected = cells.map((cell) => mapToPalette(cell, colors, { dither: "none" }));

        expect(result.frames).toHaveLength(2);
        expect(result.frames).toEqual(expected);
        expect(result.palette).toEqual({ name: IMPORTED_PALETTE_NAME, colors });
        expect(colors).toHaveLength(4);
        expect(distinctColors(result.frames)).toBeLessThanOrEqual(4);
    });

    it("imports a 256×64 sheet as 4 frames of 32×32 with 8 colours", () => {
        const settings: ImportSettings = {
            cells: { mode: "grid", grid: { cell: { columns: 4, rows: 1 } } },
            size: { width: 32, height: 32, fit: "contain" },
            resample: "area",
            alpha: { threshold: 128 },
            colors: { mode: "reduce", count: 8 },
            dither: "none",
        };
        const { frames, palette } = runImport([source("sheet.png", noise(256, 64, 8))], settings);
        expect(frames.map((frame) => [frame.width, frame.height])).toEqual([
            [32, 32],
            [32, 32],
            [32, 32],
            [32, 32],
        ]);
        expect(palette.colors).toHaveLength(8);
        const allowed = new Set(palette.colors);
        expect(frames.flatMap(colorsOf).filter((color) => !allowed.has(color))).toEqual([]);
    });

    it("dithers only when it maps to a palette", () => {
        const gradient = createPixelBuffer(16, 16);
        for (let i = 0; i < 256; i++) {
            gradient.data.set([i, i, i, 255], i * 4);
        }
        const twoGreys: ColorSettings = { mode: "reduce", count: 2 };
        const run = (colors: ColorSettings, dither: DitherMethod) =>
            runImport([source("g.png", gradient)], { ...keepAll(16, 16), colors, dither })
                .frames[0];

        const plain = run(twoGreys, "none");
        expect(pixelBuffersEqual(run(twoGreys, "bayer"), plain)).toBe(false);
        expect(pixelBuffersEqual(run(twoGreys, "floyd-steinberg"), plain)).toBe(false);
        expect(distinctColors([run(twoGreys, "bayer")])).toBe(2);
        expect(pixelBuffersEqual(run({ mode: "keep" }, "bayer"), gradient)).toBe(true);
    });

    it("crops the region before anything else", () => {
        const sheet = grid("xxxxxx", "xAABBx", "xAABBx", "xxxxxx");
        const settings: ImportSettings = {
            ...keepAll(2, 2),
            region: { x: 1, y: 1, width: 4, height: 2 },
            cells: { mode: "grid", grid: { cell: { width: 2, height: 2 } } },
        };
        const { frames } = runImport([source("sheet.png", sheet)], settings);
        expect(frames.map(show)).toEqual([
            ["AA", "AA"],
            ["BB", "BB"],
        ]);
        // As a single sprite, the region is the one cell.
        const single = { ...settings, cells: { mode: "single" } as const, ...keepAll(4, 2) };
        expect(runImport([source("sheet.png", sheet)], single).frames.map(show)).toEqual([
            ["AABB", "AABB"],
        ]);
    });

    it("takes several sources as one cell each, in natural order of their names", () => {
        const sources = [
            source("a2.png", grid("B")),
            source("a10.png", grid("C")),
            source("a1.png", grid("A")),
        ];
        const { frames } = runImport(sources, keepAll(1, 1));
        expect(frames.map(show)).toEqual([["A"], ["B"], ["C"]]);
    });

    it("with several sources ignores the cells setting and crops every one of them", () => {
        const sources = [
            source("2.png", grid("ABCD", "EFGH")),
            source("1.png", grid("IJKL", "MNOP")),
        ];
        const settings: ImportSettings = {
            ...keepAll(2, 1),
            region: { x: 1, y: 1, width: 2, height: 1 },
            cells: { mode: "grid", grid: { cell: { width: 1, height: 1 } } },
        };
        expect(runImport(sources, settings).frames.map(show)).toEqual([["NO"], ["FG"]]);
    });

    it("resamples sources of different sizes to the one target size", () => {
        const sources = [source("1.png", grid("AB", "CD")), source("2.png", grid("E"))];
        const { frames } = runImport(sources, keepAll(2, 2));
        expect(frames.map(show)).toEqual([
            ["AB", "CD"],
            ["EE", "EE"],
        ]);
    });

    it("returns frames that share nothing with the sources and leaves the sources alone", () => {
        // Colour under alpha 0, which the frame does not keep.
        const pixels = grid("aB", "C.");
        const before = clonePixelBuffer(pixels);
        const { frames, palette } = runImport([source("s.png", pixels)], keepAll(2, 2));
        expect(show(frames[0])).toEqual([".B", "C."]);
        expect(frames[0].data.buffer).not.toBe(pixels.data.buffer);
        expect(pixelBuffersEqual(pixels, before)).toBe(true);
        expect(palette.colors).toHaveLength(2);
    });

    it("gives the 256 colours of buildPalette as the palette of kept frames with more", () => {
        const pixels = noise(32, 32, 6);
        const { frames, palette } = runImport([source("n.png", pixels)], keepAll(32, 32));
        expect(pixelBuffersEqual(frames[0], pixels)).toBe(true);
        expect(palette.colors).toEqual(buildPalette([pixels], 256));
        expect(palette.colors).toHaveLength(256);
    });

    it("maps to a preset palette", () => {
        const preset = PRESET_PALETTES[2];
        const settings: ImportSettings = {
            ...keepAll(8, 8),
            resample: "area",
            colors: { mode: "palette", palette: paletteFromPreset(preset) },
            dither: "floyd-steinberg",
        };
        const { frames, palette } = runImport([source("n.png", noise(64, 64, 12))], settings);
        const allowed = new Set(preset.colors);
        expect(colorsOf(frames[0]).filter((color) => !allowed.has(color))).toEqual([]);
        expect(palette).toEqual({ name: "PICO-8", colors: [...preset.colors] });
    });
});

describe("runImport, determinism", () => {
    const colorModes: ColorSettings[] = [
        { mode: "keep" },
        { mode: "reduce", count: 16 },
        { mode: "reduce", count: 256 },
        { mode: "palette", palette: paletteFromPreset(PRESET_PALETTES[0]) },
    ];

    it("gives byte-identical output for the same input and settings", () => {
        for (const colors of colorModes) {
            for (const dither of ["none", "bayer", "floyd-steinberg"] as const) {
                for (const resampleMethod of ["nearest", "area", "dominant"] as const) {
                    const settings: ImportSettings = {
                        region: { x: 1, y: 0, width: 60, height: 30 },
                        cells: {
                            mode: "grid",
                            grid: { cell: { width: 14, height: 13 }, spacing: { x: 1, y: 2 } },
                        },
                        size: { width: 9, height: 11, fit: "cover" },
                        resample: resampleMethod,
                        alpha: { threshold: 100, colorKey: { color: 0x808080ff, tolerance: 40 } },
                        colors,
                        dither,
                    };
                    // Two runs on separately built, equal inputs.
                    const first = runImport([source("s.png", softSheet(64, 32, 31))], settings);
                    const second = runImport([source("s.png", softSheet(64, 32, 31))], settings);
                    const label = `${colors.mode} ${dither} ${resampleMethod}`;
                    expect(first.frames, label).toHaveLength(8);
                    expect(second.palette, label).toEqual(first.palette);
                    second.frames.forEach((frame, i) => {
                        expect(Array.from(frame.data), label).toEqual(
                            Array.from(first.frames[i].data),
                        );
                    });
                }
            }
        }
    });

    it("gives the same output whatever order the files arrive in", () => {
        const files = ["f3.png", "f1.png", "f12.png", "f2.png"].map((name, i) =>
            source(name, softSheet(20, 20, 40 + i)),
        );
        const settings: ImportSettings = {
            size: { width: 8, height: 8, fit: "contain" },
            resample: "area",
            alpha: { threshold: 128 },
            colors: { mode: "reduce", count: 8 },
            dither: "bayer",
        };
        const first = runImport(files, settings);
        const second = runImport([...files].reverse(), settings);
        expect(second).toEqual(first);
    });
});

describe("runImport, limits", () => {
    it("refuses a source larger than 8192 px on a side", () => {
        expect(MAX_IMPORT_SOURCE_SIDE).toBe(8192);
        for (const [width, height] of [
            [8193, 1],
            [1, 8193],
        ]) {
            const tooLarge = [source("big.png", createPixelBuffer(width, height))];
            const error = errorOf(() => runImport(tooLarge, keepAll(1, 1)));
            expect(error.code).toBe("source-size");
            expect(error.message).toContain(`"big.png" is ${width}x${height}`);
            expect(error.message).toContain("8192 px per side");
        }
        const atLimit = [source("wide.png", createPixelBuffer(8192, 1, 0x010203ff))];
        expect(runImport(atLimit, keepAll(1, 1)).frames).toHaveLength(1);
    });

    it("refuses a source larger than 8192 px among several", () => {
        const sources = [
            source("a.png", createPixelBuffer(2, 2)),
            source("b.png", createPixelBuffer(1, 8193)),
        ];
        const error = errorOf(() => runImport(sources, keepAll(1, 1)));
        expect(error.code).toBe("source-size");
        expect(error.message).toContain('"b.png"');
    });

    it("refuses more than 1024 resulting frames", () => {
        expect(MAX_IMPORT_FRAMES).toBe(1024);
        const cells = { mode: "grid", grid: { cell: { width: 1, height: 1 } } } as const;
        const sheet = (count: number) => [source("s.png", createPixelBuffer(count, 1, 0x010203ff))];
        expect(runImport(sheet(1024), { ...keepAll(1, 1), cells }).frames).toHaveLength(1024);
        const error = errorOf(() => runImport(sheet(1025), { ...keepAll(1, 1), cells }));
        expect(error.code).toBe("frame-count");
        expect(error.message).toContain("1025 frames");
        expect(error.message).toContain("limit is 1024 frames");

        const pixels = createPixelBuffer(1, 1, 0x010203ff);
        const files = Array.from({ length: 1025 }, (_, i) => source(`${i}.png`, pixels));
        expect(codeOf(() => runImport(files, keepAll(1, 1)))).toBe("frame-count");
        expect(runImport(files.slice(1), keepAll(1, 1)).frames).toHaveLength(1024);
    });

    it("refuses more than 256 MB of resulting pixel data, before making a frame", () => {
        expect(MAX_IMPORT_PIXEL_BYTES).toBe(256 * 1024 * 1024);
        const cells = { mode: "grid", grid: { cell: { width: 1, height: 1 } } } as const;
        // 1024 frames of 256 × 256 are exactly 256 MB; one more row per frame is over.
        const sheet = [source("s.png", createPixelBuffer(1024, 1, 0x010203ff))];
        const over = { ...keepAll(256, 257), cells };
        const error = errorOf(() => runImport(sheet, over));
        expect(error.code).toBe("pixel-data");
        expect(error.message).toContain("1024 frames of 256x257 hold 269484032 bytes");
        expect(error.message).toContain("limit is 268435456 bytes (256 MB)");
        expect(codeOf(() => runImport(sheet, { ...keepAll(1024, 1024), cells }))).toBe(
            "pixel-data",
        );
        // One frame at the largest sprite size is far below the limit.
        const one = [source("s.png", createPixelBuffer(1, 1, 0x010203ff))];
        expect(runImport(one, keepAll(1024, 1024)).frames[0].data).toHaveLength(4 * 1024 * 1024);
    });

    it("refuses an import without a source or without a cell", () => {
        const noSource = errorOf(() => runImport([], keepAll(1, 1)));
        expect(noSource.code).toBe("no-cells");
        const settings: ImportSettings = {
            ...keepAll(2, 2),
            cells: { mode: "grid", grid: { cell: { width: 2, height: 2 }, skipEmpty: true } },
        };
        const empty = [source("empty.png", createPixelBuffer(8, 8))];
        expect(codeOf(() => runImport(empty, settings))).toBe("no-cells");
    });

    it("refuses settings outside their range, naming the setting", () => {
        const pixels = [source("s.png", noise(4, 4, 1))];
        const base = keepAll(4, 4);
        const invalid: [string, ImportSettings][] = [
            ["Target width", { ...base, size: { width: 0, height: 4, fit: "stretch" } }],
            ["Target width", { ...base, size: { width: 1025, height: 4, fit: "stretch" } }],
            ["Target height", { ...base, size: { width: 4, height: 2.5, fit: "stretch" } }],
            ["Target height", { ...base, size: { width: 4, height: 1025, fit: "stretch" } }],
            ["Fit", { ...base, size: { width: 4, height: 4, fit: "fill" as "stretch" } }],
            ["Resample method", { ...base, resample: "bilinear" as "area" }],
            ["Dither", { ...base, dither: "atkinson" as "none" }],
            ["Cells mode", { ...base, cells: { mode: "files" as "single" } }],
            ["Colours mode", { ...base, colors: { mode: "auto" as "keep" } }],
            ["Colour count", { ...base, colors: { mode: "reduce", count: 1 } }],
            ["Colour count", { ...base, colors: { mode: "reduce", count: 257 } }],
            ["Colour count", { ...base, colors: { mode: "reduce", count: 2.5 } }],
            [
                "Palette size",
                { ...base, colors: { mode: "palette", palette: { name: "", colors: [] } } },
            ],
            [
                "Palette size",
                {
                    ...base,
                    colors: {
                        mode: "palette",
                        palette: { name: "", colors: new Array<number>(257).fill(0xff) },
                    },
                },
            ],
            ["Alpha threshold", { ...base, alpha: { threshold: 0 } }],
            [
                "Colour key tolerance",
                { ...base, alpha: { colorKey: { color: 0, tolerance: 256 } } },
            ],
            ["region", { ...base, region: { x: 2, y: 0, width: 4, height: 4 } }],
            [
                "Grid cell width",
                { ...base, cells: { mode: "grid", grid: { cell: { width: 0, height: 1 } } } },
            ],
        ];
        for (const [name, settings] of invalid) {
            const error = errorOf(() => runImport(pixels, settings));
            expect(error.code, name).toBe("settings");
            expect(error.message, name).toContain(name);
        }
    });

    it("refuses a source that is not a valid buffer", () => {
        const broken = { width: 2, height: 2, data: new Uint8ClampedArray(15) };
        expect(codeOf(() => runImport([source("x.png", broken)], keepAll(2, 2)))).toBe("settings");
    });

    it("accepts the smallest and the largest palette size", () => {
        const pixels = [source("s.png", noise(32, 32, 1))];
        for (const count of [2, 256]) {
            const settings: ImportSettings = {
                ...keepAll(32, 32),
                colors: { mode: "reduce", count },
            };
            expect(runImport(pixels, settings).palette.colors).toHaveLength(count);
        }
    });
});
