import type { PixelBuffer } from "../core/model";

// Upload sources for `UploadQueue` (SPEC §6.2 #9): NGNE takes images as straight alpha in
// sRGB, decoded without conversion, so a bitmap is built from the CPU buffer with exactly
// those options. Used by the viewport and by the preview panel (SE-054).

export const BITMAP_OPTIONS: ImageBitmapOptions = {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
};

/**
 * An `ImageBitmap` of a straight-alpha RGBA8 buffer, made from an `ImageData` of its pixels.
 * The upload queue closes the bitmap it is given; any other caller closes it itself.
 */
export function bitmapFromPixels(pixels: PixelBuffer): Promise<ImageBitmap> {
    // The DOM library wants a view on an `ArrayBuffer`; pixel buffers are never shared memory.
    const data = pixels.data as Uint8ClampedArray<ArrayBuffer>;
    return createImageBitmap(new ImageData(data, pixels.width, pixels.height), BITMAP_OPTIONS);
}

/**
 * The 1×1 transparent image that replaces the texture of a slot nothing uses any more
 * (SPEC §6.4): NGNE cannot release a manual texture, only replace it.
 */
export function placeholderBitmap(): Promise<ImageBitmap> {
    return bitmapFromPixels({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
}
