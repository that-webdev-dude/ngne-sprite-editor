import { encode } from "fast-png";
import { clonePixelBuffer, zeroTransparentRgb } from "../pixels";
import type { PixelBuffer } from "../pixels";
import { PngError } from "./errors";

export interface PngEncodeOptions {
    /**
     * Write R, G and B as 0 wherever alpha is 0. Off by default: pixels are written as given.
     * The buffer passed in is never changed.
     */
    zeroTransparentRgb?: boolean;
}

/**
 * Encodes a straight-alpha RGBA8 buffer as a PNG file: colour type 6, 8 bits per sample, not
 * interlaced, with no chunks besides IHDR, IDAT and IEND (so no gamma, sRGB or colour-profile
 * chunk). Lossless: `decodePng` returns the same bytes. The same buffer always gives the same
 * file. Returns an array of exactly the file's length.
 *
 * Throws `PngError` ("buffer") when the size is not positive integers or the data length is
 * not width × height × 4.
 */
export function encodePng(
    buffer: PixelBuffer,
    options: PngEncodeOptions = {},
): Uint8Array<ArrayBuffer> {
    const { width, height } = buffer;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new PngError("buffer", `Image size ${width}x${height} is not valid.`);
    }
    if (buffer.data.length !== width * height * 4) {
        throw new PngError("buffer", "Pixel data length is not width x height x 4.");
    }
    let { data } = buffer;
    if (options.zeroTransparentRgb) {
        const copy = clonePixelBuffer(buffer);
        zeroTransparentRgb(copy);
        data = copy.data;
    }
    try {
        // fast-png returns a view of its work buffer, which is longer than the file.
        return encode({ width, height, data, depth: 8, channels: 4 }).slice();
    } catch (cause) {
        throw new PngError("memory", "The image could not be encoded.", { cause });
    }
}
