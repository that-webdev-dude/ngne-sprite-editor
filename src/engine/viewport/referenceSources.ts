import type { PixelBuffer } from "../../core/model";
import { displaySize } from "./referenceSlots";

// The images of reference layers as the viewport uploads them (SPEC §7.6, SE-045). Each decoded
// source is made once into its display source, limited to 4096 px per side by a one-off
// high-quality downscale; every upload is that display source resampled on the CPU to its size
// on screen. One per viewport, shared by its renderer instances, so a renderer replacement does
// not make them again.

/** How a reference is resampled (SPEC §7.6). */
const RESAMPLE_OPTIONS: ImageBitmapOptions = {
    resizeQuality: "high",
    premultiplyAlpha: "premultiply",
    colorSpaceConversion: "none",
};

/** The display sources of a viewport, by decoded image. */
export class ReferenceSources {
    readonly #sources = new Map<PixelBuffer, Promise<ImageBitmap>>();

    /** Keeps the display sources of `images` only; the others go when nothing uses them. */
    retain(images: ReadonlySet<PixelBuffer>): void {
        // Not closed here: an upload being made may still read one; the page lets it go.
        for (const image of [...this.#sources.keys()]) {
            if (!images.has(image)) this.#sources.delete(image);
        }
    }

    /**
     * The upload source of `image` at `width` × `height`: its display source resampled, or a
     * copy of it at its own size. The caller closes it (the upload queue does).
     */
    async bitmap(image: PixelBuffer, width: number, height: number): Promise<ImageBitmap> {
        const source = await this.#source(image);
        if (width === source.width && height === source.height) {
            return createImageBitmap(source);
        }
        return createImageBitmap(source, {
            ...RESAMPLE_OPTIONS,
            resizeWidth: width,
            resizeHeight: height,
        });
    }

    #source(image: PixelBuffer): Promise<ImageBitmap> {
        let source = this.#sources.get(image);
        if (!source) {
            const size = displaySize(image);
            // The DOM library wants a view on an `ArrayBuffer`; pixel buffers are never shared.
            const data = image.data as Uint8ClampedArray<ArrayBuffer>;
            const pixels = new ImageData(data, image.width, image.height);
            const limited = size.width !== image.width || size.height !== image.height;
            const made = createImageBitmap(
                pixels,
                limited
                    ? { ...RESAMPLE_OPTIONS, resizeWidth: size.width, resizeHeight: size.height }
                    : RESAMPLE_OPTIONS,
            );
            // One that could not be made is tried again at the next upload.
            made.catch(() => {
                if (this.#sources.get(image) === made) this.#sources.delete(image);
            });
            this.#sources.set(image, made);
            source = made;
        }
        return source;
    }
}
