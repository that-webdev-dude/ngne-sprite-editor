import { clonePixelBuffer } from "../pixels";
import type { PixelBuffer } from "../pixels";
import { assertInteger } from "./errors";

// Step 6 of SPEC §8.

/** Makes one colour transparent. */
export interface ColorKey {
    /** 0xRRGGBBAA; the alpha byte is not used. */
    color: number;
    /**
     * 0..255: a pixel matches when each of its R, G and B differs from the key by at most
     * this much. 0 matches the exact colour only.
     */
    tolerance: number;
}

/** Without either field, alpha is kept as it is. */
export interface AlphaOptions {
    /** 1..255: alpha at or above it becomes 255, alpha below it becomes 0. */
    threshold?: number;
    colorKey?: ColorKey;
}

/**
 * Step 6: a copy of `source` with the colour key applied, then the threshold. A pixel that
 * matches the colour key or falls below the threshold becomes transparent black; a pixel
 * that is already fully transparent is never matched against the key. With empty options
 * the copy is unchanged.
 *
 * `runImport` calls it twice: with the colour key alone on a cell before resampling, and with
 * the threshold alone on the resampled frame.
 *
 * Throws `ImportError` ("settings") when the threshold is not an integer 1..255 or the
 * tolerance not an integer 0..255.
 */
export function applyAlpha(source: PixelBuffer, options: AlphaOptions): PixelBuffer {
    const { threshold, colorKey } = options;
    if (threshold !== undefined) {
        assertInteger("Alpha threshold", threshold, 1, 255);
    }
    if (colorKey) {
        assertInteger("Colour key tolerance", colorKey.tolerance, 0, 255);
    }
    const result = clonePixelBuffer(source);
    if (threshold === undefined && !colorKey) {
        return result;
    }
    const { data } = result;
    const keyRed = colorKey ? colorKey.color >>> 24 : 0;
    const keyGreen = colorKey ? (colorKey.color >>> 16) & 0xff : 0;
    const keyBlue = colorKey ? (colorKey.color >>> 8) & 0xff : 0;
    // No pixel is within a tolerance of -1, and no alpha is below a threshold of 0.
    const tolerance = colorKey ? colorKey.tolerance : -1;
    const limit = threshold ?? 0;
    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        const keyed =
            alpha !== 0 &&
            Math.abs(data[i] - keyRed) <= tolerance &&
            Math.abs(data[i + 1] - keyGreen) <= tolerance &&
            Math.abs(data[i + 2] - keyBlue) <= tolerance;
        if (keyed || alpha < limit) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 0;
        } else if (threshold !== undefined) {
            data[i + 3] = 255;
        }
    }
    return result;
}
