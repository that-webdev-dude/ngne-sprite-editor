/**
 * What was wrong:
 * - `signature`: the bytes do not start with the PNG signature.
 * - `chunk`: chunk layout — file cut short, checksum mismatch, wrong order, missing or unknown
 *   critical chunk.
 * - `header`: IHDR holds a size, colour type, bit depth or method PNG does not define.
 * - `data`: palette, transparency or image data — invalid zlib stream, too little or too much
 *   data, unknown filter, palette index out of range.
 * - `size`: the image is larger than `MAX_PNG_SIDE` on a side (SPEC §8 limit).
 * - `memory`: the image is too large to allocate.
 * - `buffer`: `encodePng` was given a buffer whose size and data do not match.
 */
export type PngErrorCode = "signature" | "chunk" | "header" | "data" | "size" | "memory" | "buffer";

/** The one error type thrown by `decodePng` and `encodePng`. */
export class PngError extends Error {
    override readonly name = "PngError";
    readonly code: PngErrorCode;

    constructor(code: PngErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.code = code;
    }
}
