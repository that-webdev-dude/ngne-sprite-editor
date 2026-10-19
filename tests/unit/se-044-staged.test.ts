import { describe, expect, it } from "vitest";
import {
    ImportError,
    cachedCells,
    createImportCache,
    importCells,
    importSteps,
    runImport,
    runImportSteps,
} from "../../src/core/import";
import type { ImportResult, ImportSettings, ImportSource } from "../../src/core/import";
import { PRESET_PALETTES, paletteFromPreset } from "../../src/core/palettes";
import type { PixelBuffer } from "../../src/core/pixels";
import { byteStream, noise } from "./se-043-support";

// SE-044: `importSteps`, the import of SPEC §8 in stages that keep their results, gives what
// `runImport` gives (the dialog's preview and the import itself are made by it), reuses its
// cache and can be given up between steps.

/** Noise with some transparent and half-transparent pixels, so the alpha steps matter. */
function sheet(width: number, height: number, seed: number): PixelBuffer {
    const pixels = noise(width, height, seed);
    const next = byteStream(seed + 1);
    for (let i = 3; i < pixels.data.length; i += 4) {
        const pick = next();
        pixels.data[i] = pick < 40 ? 0 : pick < 80 ? pick : 255;
    }
    return pixels;
}

const base: ImportSettings = {
    size: { width: 8, height: 8, fit: "contain" },
    resample: "area",
    alpha: { threshold: 128 },
    colors: { mode: "reduce", count: 8 },
    dither: "none",
};

/** A sequence of settings as a user of the dialog makes them, one change at a time. */
const sequence: ImportSettings[] = [
    base,
    { ...base, dither: "bayer" },
    { ...base, dither: "floyd-steinberg" },
    { ...base, colors: { mode: "reduce", count: 4 } },
    { ...base, colors: { mode: "keep" } },
    { ...base, colors: { mode: "palette", palette: paletteFromPreset(PRESET_PALETTES[0]!) } },
    { ...base, alpha: {} },
    { ...base, alpha: { threshold: 200, colorKey: { color: 0x102030ff, tolerance: 90 } } },
    { ...base, resample: "nearest" },
    { ...base, resample: "dominant", size: { width: 5, height: 9, fit: "cover" } },
    { ...base, size: { width: 16, height: 4, fit: "stretch" } },
    { ...base, region: { x: 3, y: 2, width: 20, height: 9 } },
    {
        ...base,
        cells: { mode: "grid", grid: { cell: { columns: 3, rows: 2 }, spacing: { x: 1, y: 0 } } },
    },
    {
        ...base,
        cells: { mode: "grid", grid: { cell: { width: 8, height: 8 }, skipEmpty: true } },
        size: { width: 8, height: 8, fit: "contain" },
        colors: { mode: "keep" },
        alpha: {},
    },
    base,
];

function expectSame(actual: ImportResult, expected: ImportResult): void {
    expect(actual.palette).toEqual(expected.palette);
    expect(actual.frames.length).toBe(expected.frames.length);
    actual.frames.forEach((frame, index) => {
        const want = expected.frames[index]!;
        expect([frame.width, frame.height]).toEqual([want.width, want.height]);
        expect(Buffer.from(frame.data).equals(Buffer.from(want.data))).toBe(true);
    });
}

describe("importSteps", () => {
    it("gives runImport's bytes for every setting of a sequence, one cache throughout", () => {
        const sources: ImportSource[] = [{ name: "sheet.png", pixels: sheet(33, 21, 7) }];
        const cache = createImportCache();
        for (const settings of sequence) {
            expectSame(runImportSteps(cache, sources, settings), runImport(sources, settings));
        }
    });

    it("gives runImport's bytes for several files, a crop applying to each", () => {
        const sources: ImportSource[] = [
            { name: "a10.png", pixels: sheet(12, 12, 3) },
            { name: "a2.png", pixels: sheet(12, 12, 4) },
            { name: "a1.png", pixels: sheet(12, 12, 5) },
        ];
        const cache = createImportCache();
        for (const settings of [base, { ...base, region: { x: 2, y: 2, width: 8, height: 6 } }]) {
            expectSame(runImportSteps(cache, sources, settings), runImport(sources, settings));
        }
    });

    it("keeps the cells and the resampled frames while only later steps change", () => {
        const sources: ImportSource[] = [{ name: "sheet.png", pixels: sheet(40, 40, 9) }];
        const cache = createImportCache();
        runImportSteps(cache, sources, base);
        const cells = cache.cells!.value;
        const frames = cache.frames!.value;
        runImportSteps(cache, sources, { ...base, dither: "floyd-steinberg" });
        expect(cache.cells!.value).toBe(cells);
        expect(cache.frames!.value).toBe(frames);
        runImportSteps(cache, sources, { ...base, colors: { mode: "reduce", count: 3 } });
        expect(cache.frames!.value).toBe(frames);
        // A change of size makes the frames again; the cells stay.
        runImportSteps(cache, sources, { ...base, size: { width: 7, height: 7, fit: "contain" } });
        expect(cache.cells!.value).toBe(cells);
        expect(cache.frames!.value).not.toBe(frames);
        // Other sources clear it.
        const other: ImportSource[] = [{ name: "sheet.png", pixels: sources[0]!.pixels }];
        expect(cachedCells(cache, other, {})).not.toBe(cells);
    });

    it("returns new frame buffers every time, so a caller may transfer them", () => {
        const sources: ImportSource[] = [{ name: "s.png", pixels: sheet(8, 8, 2) }];
        const cache = createImportCache();
        const keep = { ...base, alpha: {}, colors: { mode: "keep" as const } };
        const first = runImportSteps(cache, sources, keep);
        const second = runImportSteps(cache, sources, keep);
        expect(second.frames[0]!.data).not.toBe(first.frames[0]!.data);
        first.frames[0]!.data.fill(9);
        expectSame(runImportSteps(cache, sources, keep), runImport(sources, keep));
    });

    it("yields between steps and frame by frame, and can be given up there", () => {
        const sources: ImportSource[] = [{ name: "s.png", pixels: sheet(32, 8, 1) }];
        const settings: ImportSettings = {
            ...base,
            cells: { mode: "grid", grid: { cell: { columns: 4, rows: 1 } } },
        };
        const cache = createImportCache();
        const steps = importSteps(cache, sources, settings);
        let yields = 0;
        for (let step = steps.next(); !step.done; step = steps.next()) yields++;
        // Cells, four resampled frames, the palette, four mapped frames.
        expect(yields).toBe(1 + 4 + 1 + 4);

        // Given up halfway through the frames: nothing half made is kept.
        const fresh = createImportCache();
        const abandoned = importSteps(fresh, sources, settings);
        abandoned.next();
        abandoned.next();
        abandoned.return(undefined as never);
        expect(fresh.frames).toBeNull();
        expectSame(runImportSteps(fresh, sources, settings), runImport(sources, settings));
    });

    it("throws runImport's errors", () => {
        const sources: ImportSource[] = [{ name: "s.png", pixels: sheet(8, 8, 2) }];
        const cache = createImportCache();
        const bad = { ...base, region: { x: 4, y: 4, width: 8, height: 8 } };
        expect(() => runImport(sources, bad)).toThrow(ImportError);
        expect(() => runImportSteps(cache, sources, bad)).toThrow(
            /not a rectangle inside the 8x8 image/,
        );
        expect(() => runImportSteps(cache, [], base)).toThrow(ImportError);
        expect(() =>
            runImportSteps(cache, sources, { ...base, colors: { mode: "reduce", count: 1 } }),
        ).toThrow(/Colour count/);
        // The cells of a valid call are those of `importCells`.
        expect(cachedCells(cache, sources, {})).toEqual(importCells(sources, {}));
    });
});
