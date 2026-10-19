import type { PixelBuffer } from "../../core/model";
import { displaySize } from "./referenceSlots";

// The images of reference layers as the viewport uploads them (SPEC §7.6, SE-045). Each decoded
// source is made once into its display source, limited to 4096 px per side by a one-off
// high-quality downscale; every upload is that display source resampled on the CPU to its size
// on screen. One per viewport, shared by its renderer instances, so a renderer replacement does
// not make them again. A display source the viewport no longer shows is closed as soon as no
// upload is being made from it.

/** How a reference is resampled (SPEC §7.6). */
const RESAMPLE_OPTIONS: ImageBitmapOptions = {
    resizeQuality: "high",
    premultiplyAlpha: "premultiply",
    colorSpaceConversion: "none",
};

interface DisplaySource {
    bitmap: Promise<ImageBitmap>;
    /** Uploads being made from it: it is closed only once there are none. */
    pending: number;
    /** No longer kept: closed when the last pending upload has been made. */
    dropped: boolean;
}

/** Closes a display source once it is made, whether or not it could be. */
function close(source: DisplaySource): void {
    source.bitmap.then(
        (bitmap) => bitmap.close(),
        () => {},
    );
}

/** The display sources of a viewport, by decoded image. */
export class ReferenceSources {
    readonly #sources = new Map<PixelBuffer, DisplaySource>();
    /** The images of the last `retain`: only theirs are kept. */
    #kept: ReadonlySet<PixelBuffer> = new Set();

    /** Display sources kept: those of the images given to the last `retain`, made so far. */
    get size(): number {
        return this.#sources.size;
    }

    /**
     * Keeps the display sources of `images` only. The others are let go: closed at once, or
     * when the uploads being made from them are.
     */
    retain(images: ReadonlySet<PixelBuffer>): void {
        this.#kept = new Set(images);
        for (const [image, source] of [...this.#sources]) {
            if (images.has(image)) continue;
            this.#sources.delete(image);
            source.dropped = true;
            if (source.pending === 0) close(source);
        }
    }

    /**
     * The upload source of `image` at `width` × `height`: its display source resampled, or a
     * copy of it at its own size. The caller closes it (the upload queue does).
     */
    async bitmap(image: PixelBuffer, width: number, height: number): Promise<ImageBitmap> {
        const source = this.#source(image);
        source.pending++;
        try {
            const display = await source.bitmap;
            if (width === display.width && height === display.height) {
                return await createImageBitmap(display);
            }
            return await createImageBitmap(display, {
                ...RESAMPLE_OPTIONS,
                resizeWidth: width,
                resizeHeight: height,
            });
        } finally {
            source.pending--;
            if (source.dropped && source.pending === 0) close(source);
        }
    }

    #source(image: PixelBuffer): DisplaySource {
        let source = this.#sources.get(image);
        if (!source) {
            const size = displaySize(image);
            // The DOM library wants a view on an `ArrayBuffer`; pixel buffers are never shared.
            const data = image.data as Uint8ClampedArray<ArrayBuffer>;
            const pixels = new ImageData(data, image.width, image.height);
            const limited = size.width !== image.width || size.height !== image.height;
            const made: DisplaySource = {
                bitmap: createImageBitmap(
                    pixels,
                    limited
                        ? {
                              ...RESAMPLE_OPTIONS,
                              resizeWidth: size.width,
                              resizeHeight: size.height,
                          }
                        : RESAMPLE_OPTIONS,
                ),
                pending: 0,
                // An upload for an image no longer shown makes one for itself alone.
                dropped: !this.#kept.has(image),
            };
            if (made.dropped) return made;
            // One that could not be made is tried again at the next upload.
            made.bitmap.catch(() => {
                if (this.#sources.get(image) === made) this.#sources.delete(image);
            });
            this.#sources.set(image, made);
            source = made;
        }
        return source;
    }
}
