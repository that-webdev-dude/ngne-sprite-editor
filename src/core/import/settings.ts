import type { Palette } from "../model";
import type { PixelRect } from "../pixels";
import type { AlphaOptions } from "./alpha";
import type { GridOptions } from "./cells";
import type { DitherMethod } from "./mapToPalette";
import type { ResampleFit, ResampleMethod } from "./resample";

// The choices of the import pipeline, one field per step of SPEC §8. Step 1 (decode) happens
// before `runImport` and step 9 (place) after it.

/** Step 3 for one source image: the whole region as one sprite, or the cells of a grid. */
export type CellSettings = { mode: "single" } | { mode: "grid"; grid: GridOptions };

/** Step 4: the size of every resulting frame and how a cell of another shape is fitted to it. */
export interface SizeSettings {
    /** Integer 1..1024, a document side (SPEC §5.1). */
    width: number;
    /** Integer 1..1024. */
    height: number;
    fit: ResampleFit;
}

/**
 * Step 7:
 * - `keep`: colours stay as they are.
 * - `reduce`: one palette of `count` colours (2..256) is built for all frames, which are
 *   mapped to it.
 * - `palette`: the frames are mapped to the given palette, the document's or a preset
 *   (1..256 colours).
 */
export type ColorSettings =
    { mode: "keep" } | { mode: "reduce"; count: number } | { mode: "palette"; palette: Palette };

export interface ImportSettings {
    /** Step 2: the part of every source image that is imported. Absent: the whole image. */
    region?: PixelRect;
    /**
     * Step 3, for one source image. Absent: a single sprite. Not used with several source
     * images, which are always one cell per file.
     */
    cells?: CellSettings;
    /** Step 4. */
    size: SizeSettings;
    /** Step 5; not used for a cell that already has the target size. */
    resample: ResampleMethod;
    /** Step 6. */
    alpha: AlphaOptions;
    /** Step 7. */
    colors: ColorSettings;
    /** Step 8; used only when step 7 maps the frames to a palette. */
    dither: DitherMethod;
}
