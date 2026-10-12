import type { PixelBuffer } from "../pixels";
import { MAX_PALETTE_COLORS } from "./errors";
import { KeyIndex } from "./keyIndex";
import type { ImportSettings } from "./settings";

// The defaults of SPEC §8: the "Default" column of the step table and the smart defaults of
// steps 6 and 7, which depend on the cells.

/** The threshold step 6 defaults to when alpha is not kept. */
export const DEFAULT_ALPHA_THRESHOLD = 128;

/** The palette size step 7 defaults to when colours are not kept. */
export const DEFAULT_COLOR_COUNT = 16;

/** True when every alpha value of every cell is 0 or 255. */
function hasBinaryAlpha(cells: readonly PixelBuffer[]): boolean {
    for (const { data } of cells) {
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] !== 0 && data[i] !== 255) {
                return false;
            }
        }
    }
    return true;
}

/**
 * True when the cells together use at most `limit` distinct colours: R, G and B of the
 * pixels with alpha above 0.
 */
function usesAtMost(cells: readonly PixelBuffer[], limit: number): boolean {
    const colors = new KeyIndex();
    for (const { data } of cells) {
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] !== 0) {
                colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
                if (colors.size > limit) {
                    return false;
                }
            }
        }
    }
    return true;
}

/**
 * The default settings for importing `cells` (the result of steps 2 and 3, `importCells`) at
 * `targetSize`: fit contain, area average, no dither, and for steps 6 and 7 the smart defaults:
 *
 * - No resampling is needed when every cell already has the target size.
 * - Alpha is kept (`{}`) when no resampling is needed and every alpha value is 0 or 255;
 *   otherwise the threshold is 128.
 * - Colours are kept when no resampling is needed and the cells use at most 256 distinct
 *   colours; otherwise they are reduced to 16.
 *
 * `region` and `cells` are left out, which means the whole image as a single sprite; a
 * caller that made the cells another way adds its own.
 */
export function smartDefaults(
    cells: readonly PixelBuffer[],
    targetSize: { width: number; height: number },
): ImportSettings {
    const { width, height } = targetSize;
    const sized = cells.every((cell) => cell.width === width && cell.height === height);
    return {
        size: { width, height, fit: "contain" },
        resample: "area",
        alpha: sized && hasBinaryAlpha(cells) ? {} : { threshold: DEFAULT_ALPHA_THRESHOLD },
        colors:
            sized && usesAtMost(cells, MAX_PALETTE_COLORS)
                ? { mode: "keep" }
                : { mode: "reduce", count: DEFAULT_COLOR_COUNT },
        dither: "none",
    };
}
