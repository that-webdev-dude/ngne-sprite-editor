// The limits of SPEC §9.4 and the error `pack` reports with.

/** Largest width or height of an atlas, in pixels: NGNE's texture limit (SPEC §6.2 #11). */
export const MAX_ATLAS_SIDE = 8192;

/** Largest `padding` option, in pixels. */
export const MAX_ATLAS_PADDING = 8;

/** Largest `extrude` option, in pixels. */
export const MAX_ATLAS_EXTRUDE = 2;

/**
 * What was wrong:
 * - `no-frames`: there is no frame to pack.
 * - `frame`: a frame is not a pixel buffer whose data matches its size; the message names
 *   its index.
 * - `options`: an option is outside its range; the message names it.
 * - `atlas-size`: the atlas would be larger than `MAX_ATLAS_SIDE` on a side. The message
 *   names the limit and the size the atlas needs, which is also in `required`.
 * - `memory`: the atlas is within the limit but too large to allocate, or larger than the
 *   caller's `PackLimits.maxBytes` (then with its size in `required`).
 */
export type PackErrorCode = "no-frames" | "frame" | "options" | "atlas-size" | "memory";

/** The one error type thrown by `pack`. */
export class PackError extends Error {
    override readonly name = "PackError";
    readonly code: PackErrorCode;
    /**
     * With `atlas-size`, or `memory` for `PackLimits.maxBytes`: the size the atlas needs, in
     * pixels. Otherwise undefined.
     */
    readonly required: { width: number; height: number } | undefined;

    constructor(
        code: PackErrorCode,
        message: string,
        detail: { required?: { width: number; height: number }; cause?: unknown } = {},
    ) {
        super(message, detail.cause === undefined ? undefined : { cause: detail.cause });
        this.code = code;
        this.required = detail.required;
    }
}
