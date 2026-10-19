import { MAX_DOCUMENT_SIDE, MIN_DOCUMENT_SIDE } from "../model";
import type { Palette } from "../model";
import { zeroTransparentRgb } from "../pixels";
import type { PixelBuffer } from "../pixels";
import { applyAlpha } from "./alpha";
import { buildPalette } from "./buildPalette";
import { cellsFromFiles, cropFile, sliceGrid } from "./cells";
import type { ImportSource } from "./cells";
import {
    ImportError,
    MAX_IMPORT_PIXEL_BYTES,
    MAX_IMPORT_SOURCE_SIDE,
    MAX_PALETTE_COLORS,
    assertFrameCount,
    assertInteger,
} from "./errors";
import { mapToPalette } from "./mapToPalette";
import { resample } from "./resample";
import type { ImportSettings } from "./settings";

/** Name of a palette the import built from the frames' colours. */
export const IMPORTED_PALETTE_NAME = "Imported";

export interface ImportResult {
    /** One buffer per cell at the target size, in cell order; none shares storage with a source. */
    frames: PixelBuffer[];
    /** The colours for the document palette, which may replace or extend it (SPEC §8). */
    palette: Palette;
}

/** Throws the `settings` error unless `value` is one of `allowed`. */
function assertOneOf(name: string, value: string, allowed: readonly string[]): void {
    if (!allowed.includes(value)) {
        throw new ImportError(
            "settings",
            `${name} must be one of ${allowed.join(", ")}, got ${String(value)}.`,
        );
    }
}

/**
 * Checks everything that does not depend on the pixels; the steps check their own options.
 * Throws `ImportError` ("settings") as `runImport` does. Exported for `importSteps`.
 */
export function assertImportSettings(settings: ImportSettings): void {
    const { size, colors } = settings;
    assertInteger("Target width", size.width, MIN_DOCUMENT_SIDE, MAX_DOCUMENT_SIDE);
    assertInteger("Target height", size.height, MIN_DOCUMENT_SIDE, MAX_DOCUMENT_SIDE);
    assertOneOf("Fit", size.fit, ["stretch", "contain", "cover"]);
    assertOneOf("Resample method", settings.resample, ["nearest", "area", "dominant"]);
    assertOneOf("Dither", settings.dither, ["none", "bayer", "floyd-steinberg"]);
    assertOneOf("Cells mode", settings.cells?.mode ?? "single", ["single", "grid"]);
    assertOneOf("Colours mode", colors.mode, ["keep", "reduce", "palette"]);
    if (colors.mode === "reduce") {
        assertInteger("Colour count", colors.count, 2, MAX_PALETTE_COLORS);
    }
    if (colors.mode === "palette") {
        assertInteger("Palette size", colors.palette.colors.length, 1, MAX_PALETTE_COLORS);
    }
}

function assertSource(source: ImportSource): void {
    const { width, height, data } = source.pixels;
    const valid =
        Number.isInteger(width) &&
        Number.isInteger(height) &&
        width >= 1 &&
        height >= 1 &&
        data.length === width * height * 4;
    if (!valid) {
        throw new ImportError("settings", `"${source.name}" is not a valid pixel buffer.`);
    }
    if (width > MAX_IMPORT_SOURCE_SIDE || height > MAX_IMPORT_SOURCE_SIDE) {
        throw new ImportError(
            "source-size",
            `"${source.name}" is ${width}x${height}; the limit is ` +
                `${MAX_IMPORT_SOURCE_SIDE} px per side.`,
        );
    }
}

/**
 * Throws the `pixel-data` error unless `count` frames of `width` × `height` stay within
 * `MAX_IMPORT_PIXEL_BYTES`. Exported for `importSteps`.
 */
export function assertPixelData(count: number, width: number, height: number): void {
    const bytes = count * width * height * 4;
    if (bytes > MAX_IMPORT_PIXEL_BYTES) {
        throw new ImportError(
            "pixel-data",
            `${count} frames of ${width}x${height} hold ${bytes} bytes of pixel data; ` +
                `the limit is ${MAX_IMPORT_PIXEL_BYTES} bytes (256 MB).`,
        );
    }
}

/**
 * Steps 2 and 3 of SPEC §8, as `runImport` performs them: the cells of the sources in frame
 * order. For choosing defaults (`smartDefaults`) and showing the cells before an import.
 *
 * - One source is a single sprite or a sprite sheet (`settings.cells`). Several sources are
 *   one cell each, in natural order of their names (`compareNatural`), and `settings.cells`
 *   is not used. `settings.region` applies to every source.
 * - A cell that is a whole source is that source's own buffer, not a copy.
 *
 * Throws `ImportError`: "source-size" and "frame-count" for the limits of SPEC §8; "no-cells"
 * when there is no source or every grid cell is skipped as empty; "settings" for a region or
 * a grid that does not fit its image. An error about one source names its file.
 */
export function importCells(
    sources: readonly ImportSource[],
    settings: Pick<ImportSettings, "region" | "cells">,
): PixelBuffer[] {
    if (sources.length === 0) {
        throw new ImportError("no-cells", "There is no image to import.");
    }
    sources.forEach(assertSource);
    assertFrameCount(sources.length);

    const { region, cells } = settings;
    const regions = region ? sources.map((source) => cropFile(source, region)) : sources;
    if (regions.length > 1) {
        return cellsFromFiles(regions);
    }
    if (cells?.mode !== "grid") {
        return [regions[0].pixels];
    }
    const sliced = sliceGrid(regions[0].pixels, cells.grid);
    if (sliced.length === 0) {
        throw new ImportError("no-cells", "Every cell of the grid is empty.");
    }
    return sliced;
}

/**
 * Steps 2 to 8 of SPEC §8 on decoded images: region, cells, colour key, size and resampling,
 * alpha threshold, colours and dither, in that order.
 *
 * - The cells are those of `importCells`. Every cell becomes one frame of exactly the target
 *   size. A cell that already has that size is not resampled.
 * - Of step 6, the colour key is applied to each cell before it is resampled and the
 *   threshold to the resampled frame. A keyed pixel therefore adds no colour to an averaged
 *   pixel, only transparency.
 * - `palette` is, by colours mode: `keep`, the frames' own colours when there are at most
 *   256, otherwise their reduction to 256 by `buildPalette` (the frames are not changed);
 *   `reduce`, the palette built for the frames; `palette`, a copy of the given palette.
 *   Built palettes are named `IMPORTED_PALETTE_NAME`.
 * - Fully transparent pixels of the frames are transparent black.
 * - Deterministic: the same sources and settings give the same bytes. The sources are not
 *   changed.
 *
 * Throws `ImportError`: "source-size", "frame-count" and "pixel-data" for the limits of
 * SPEC §8, checked before any frame is made; "no-cells" when there is no source or every
 * grid cell is skipped as empty; "settings" for a value outside its range.
 */
export function runImport(
    sources: readonly ImportSource[],
    settings: ImportSettings,
): ImportResult {
    assertImportSettings(settings);
    const cells = importCells(sources, settings);
    const { width, height, fit } = settings.size;
    assertPixelData(cells.length, width, height);

    // The colour key comes before the resampling: a keyed pixel is transparent by then, so
    // its colour is not averaged into the pixels beside it. `resample` returns a new buffer,
    // so no frame aliases a source.
    const { colorKey, threshold } = settings.alpha;
    const frames = cells.map((cell) => {
        const keyed = colorKey ? applyAlpha(cell, { colorKey }) : cell;
        const frame = resample(keyed, width, height, { method: settings.resample, fit });
        return threshold === undefined ? frame : applyAlpha(frame, { threshold });
    });
    const { colors, dither } = settings;
    let palette: Palette;
    if (colors.mode === "keep") {
        palette = { name: IMPORTED_PALETTE_NAME, colors: buildPalette(frames, MAX_PALETTE_COLORS) };
    } else {
        palette =
            colors.mode === "palette"
                ? { name: colors.palette.name, colors: [...colors.palette.colors] }
                : { name: IMPORTED_PALETTE_NAME, colors: buildPalette(frames, colors.count) };
        // One frame at a time, so that only one frame exists twice.
        for (let i = 0; i < frames.length; i++) {
            frames[i] = mapToPalette(frames[i], palette.colors, { dither });
        }
    }
    frames.forEach(zeroTransparentRgb);
    return { frames, palette };
}
