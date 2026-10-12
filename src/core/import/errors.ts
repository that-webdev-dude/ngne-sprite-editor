import { MAX_PNG_SIDE } from "../png";

// The limits of SPEC §8 and the error every function of `core/import` reports with.

/** Largest width or height of a source image, in pixels. The PNG decoder has the same limit. */
export const MAX_IMPORT_SOURCE_SIDE = MAX_PNG_SIDE;

/** Most frames one import may produce. */
export const MAX_IMPORT_FRAMES = 1024;

/** Most pixel data one import may produce (frames × width × height × 4 bytes): 256 MB. */
export const MAX_IMPORT_PIXEL_BYTES = 256 * 1024 * 1024;

/** Most colours a palette holds (SPEC §5.1). */
export const MAX_PALETTE_COLORS = 256;

/**
 * What was wrong:
 * - `source-size`: a source image is larger than `MAX_IMPORT_SOURCE_SIDE` on a side.
 * - `frame-count`: the import yields more than `MAX_IMPORT_FRAMES` frames.
 * - `pixel-data`: the frames would hold more than `MAX_IMPORT_PIXEL_BYTES` bytes.
 * - `no-cells`: there is nothing to import: no source, or every grid cell is empty and skipped.
 * - `settings`: an argument or a setting is outside its range; the message names it.
 */
export type ImportErrorCode =
    "source-size" | "frame-count" | "pixel-data" | "no-cells" | "settings";

/** The one error type thrown by the functions of `core/import`. */
export class ImportError extends Error {
    override readonly name = "ImportError";
    readonly code: ImportErrorCode;

    constructor(code: ImportErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.code = code;
    }
}

/** Throws the `frame-count` error unless `count` frames are within the limit. */
export function assertFrameCount(count: number): void {
    if (count > MAX_IMPORT_FRAMES) {
        throw new ImportError(
            "frame-count",
            `The import yields ${count} frames; the limit is ${MAX_IMPORT_FRAMES} frames.`,
        );
    }
}

/** Throws the `settings` error unless `value` is an integer from `min` to `max`. */
export function assertInteger(name: string, value: number, min: number, max = Infinity): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        const range =
            max === Infinity ? `an integer of at least ${min}` : `an integer ${min}..${max}`;
        throw new ImportError("settings", `${name} must be ${range}, got ${value}.`);
    }
}
