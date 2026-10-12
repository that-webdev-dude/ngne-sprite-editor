// The PNG import pipeline of SPEC §8 on decoded images: pure functions, one per step, and
// `runImport`, which composes them. No function changes a buffer it is given, the same input
// always gives the same output, and every problem is reported as an `ImportError`.

export { applyAlpha } from "./alpha";
export type { AlphaOptions, ColorKey } from "./alpha";
export { buildPalette } from "./buildPalette";
export { cellsFromFiles, compareNatural, crop, gridLayout, sliceGrid } from "./cells";
export type { GridLayout, GridOptions, ImportSource } from "./cells";
export {
    ImportError,
    MAX_IMPORT_FRAMES,
    MAX_IMPORT_PIXEL_BYTES,
    MAX_IMPORT_SOURCE_SIDE,
} from "./errors";
export type { ImportErrorCode } from "./errors";
export { mapToPalette } from "./mapToPalette";
export type { DitherMethod, MapOptions } from "./mapToPalette";
export { resample } from "./resample";
export type { ResampleFit, ResampleMethod, ResampleOptions } from "./resample";
export { IMPORTED_PALETTE_NAME, importCells, runImport } from "./runImport";
export type { ImportResult } from "./runImport";
export type { CellSettings, ColorSettings, ImportSettings, SizeSettings } from "./settings";
export { DEFAULT_ALPHA_THRESHOLD, DEFAULT_COLOR_COUNT, smartDefaults } from "./smartDefaults";
