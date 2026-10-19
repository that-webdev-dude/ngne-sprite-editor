import type { Palette } from "../model";
import { clonePixelBuffer, zeroTransparentRgb } from "../pixels";
import type { PixelBuffer } from "../pixels";
import { applyAlpha } from "./alpha";
import { buildPalette } from "./buildPalette";
import type { ImportSource } from "./cells";
import { MAX_PALETTE_COLORS } from "./errors";
import { mapToPalette } from "./mapToPalette";
import { resample } from "./resample";
import {
    IMPORTED_PALETTE_NAME,
    assertImportSettings,
    assertPixelData,
    importCells,
} from "./runImport";
import type { ImportResult } from "./runImport";
import type { ImportSettings } from "./settings";

// `runImport` in stages that keep their results (SE-044): the import dialog's live preview
// computes the import again at every change of a setting, and most changes leave the earlier
// steps as they were (REVIEW D14). `importSteps` gives the bytes `runImport` gives for the same
// sources and settings; it reuses what a cache holds for the same sources and the settings of
// the steps up to it, and yields between steps so that a caller can give up a computation
// that a newer setting has made useless.

/** One kept result: the key of the settings it was made with, and the result. */
interface Stage<Value> {
    key: string;
    value: Value;
}

/**
 * What `importSteps` keeps for the next call: the cells (steps 2 and 3), the frames after the
 * colour key, the resampling and the threshold (steps 4 to 6), and the palette of step 7. It
 * belongs to one list of sources: other sources clear it.
 */
export interface ImportCache {
    sources: readonly ImportSource[] | null;
    cells: Stage<PixelBuffer[]> | null;
    frames: Stage<PixelBuffer[]> | null;
    palette: Stage<Palette> | null;
}

export function createImportCache(): ImportCache {
    return { sources: null, cells: null, frames: null, palette: null };
}

/** The cache for `sources`: emptied when it held another list. */
function cacheFor(cache: ImportCache, sources: readonly ImportSource[]): ImportCache {
    if (cache.sources !== sources) {
        cache.sources = sources;
        cache.cells = null;
        cache.frames = null;
        cache.palette = null;
    }
    return cache;
}

function cellsKey(
    sources: readonly ImportSource[],
    settings: Pick<ImportSettings, "region" | "cells">,
) {
    // With several sources the cells settings are not used.
    const cells = sources.length > 1 ? null : (settings.cells ?? null);
    return JSON.stringify([settings.region ?? null, cells]);
}

/**
 * The cells of steps 2 and 3, as `importCells` makes them, kept in `cache` for the same
 * sources and region and cells settings. Throws as `importCells` does. The cells must not be
 * changed: later calls return them again.
 */
export function cachedCells(
    cache: ImportCache,
    sources: readonly ImportSource[],
    settings: Pick<ImportSettings, "region" | "cells">,
): PixelBuffer[] {
    cacheFor(cache, sources);
    const key = cellsKey(sources, settings);
    if (cache.cells?.key !== key) {
        cache.cells = null;
        cache.cells = { key, value: importCells(sources, settings) };
    }
    return cache.cells.value;
}

/**
 * Steps 2 to 8 of SPEC §8 as `runImport` performs them, with the same result for the same
 * sources and settings, and the same errors. A generator: it yields after each step and after
 * each frame of the steps that work frame by frame; drive it with `next()` until it is done,
 * or stop calling `next()` to give the computation up. Earlier results come from `cache` when
 * the sources (the same array) and the settings of the steps up to them are the same; the
 * result's frames are new buffers every time, so the caller may keep or transfer them.
 */
export function* importSteps(
    cache: ImportCache,
    sources: readonly ImportSource[],
    settings: ImportSettings,
): Generator<void, ImportResult, void> {
    assertImportSettings(settings);
    cacheFor(cache, sources);
    const cells = cachedCells(cache, sources, settings);
    const { width, height, fit } = settings.size;
    assertPixelData(cells.length, width, height);
    yield;

    // Steps 4 to 6: the colour key before the resampling, the threshold after it.
    const framesKey = JSON.stringify([
        cache.cells!.key,
        settings.size,
        settings.resample,
        settings.alpha.colorKey ?? null,
        settings.alpha.threshold ?? null,
    ]);
    if (cache.frames?.key !== framesKey) {
        cache.frames = null;
        cache.palette = null;
        const { colorKey, threshold } = settings.alpha;
        const made: PixelBuffer[] = [];
        for (const cell of cells) {
            const keyed = colorKey ? applyAlpha(cell, { colorKey }) : cell;
            const frame = resample(keyed, width, height, { method: settings.resample, fit });
            made.push(threshold === undefined ? frame : applyAlpha(frame, { threshold }));
            yield;
        }
        cache.frames = { key: framesKey, value: made };
    }
    const frames = cache.frames.value;

    // Step 7: the palette.
    const { colors, dither } = settings;
    const paletteKey = JSON.stringify([
        framesKey,
        colors.mode,
        colors.mode === "reduce" ? colors.count : null,
        colors.mode === "palette" ? colors.palette : null,
    ]);
    if (cache.palette?.key !== paletteKey) {
        cache.palette = null;
        let palette: Palette;
        if (colors.mode === "keep") {
            palette = {
                name: IMPORTED_PALETTE_NAME,
                colors: buildPalette(frames, MAX_PALETTE_COLORS),
            };
        } else if (colors.mode === "palette") {
            palette = { name: colors.palette.name, colors: [...colors.palette.colors] };
        } else {
            palette = { name: IMPORTED_PALETTE_NAME, colors: buildPalette(frames, colors.count) };
        }
        cache.palette = { key: paletteKey, value: palette };
        yield;
    }
    const palette = cache.palette.value;

    // Steps 7 and 8: the frames mapped to the palette, with dithering; new buffers.
    const result: PixelBuffer[] = [];
    for (const frame of frames) {
        const final =
            colors.mode === "keep"
                ? clonePixelBuffer(frame)
                : mapToPalette(frame, palette.colors, { dither });
        zeroTransparentRgb(final);
        result.push(final);
        yield;
    }
    return { frames: result, palette: { name: palette.name, colors: [...palette.colors] } };
}

/** Runs `importSteps` to the end at once. */
export function runImportSteps(
    cache: ImportCache,
    sources: readonly ImportSource[],
    settings: ImportSettings,
): ImportResult {
    const steps = importSteps(cache, sources, settings);
    for (;;) {
        const step = steps.next();
        if (step.done) return step.value;
    }
}
