import { celAt } from "../model";
import type { DocSession, PixelBuffer, SpriteDoc, Touched } from "../model";
import { blitPixels } from "../pixels";
import { copyRect, defaultPixelAllocator, type PixelAllocator } from "./allocate";
import type { Command } from "./command";

/**
 * The frames and layers whose cels use an image, in document order. Linked cels share one
 * image, so a change of it shows in each of them.
 */
export function touchedByImage(doc: SpriteDoc, imageId: string): Touched {
    const frames = new Set<string>();
    const layers = new Set<string>();
    for (const layer of doc.layers) {
        for (const frame of doc.frames) {
            if (celAt(doc, layer.id, frame.id)?.imageId === imageId) {
                frames.add(frame.id);
                layers.add(layer.id);
            }
        }
    }
    return {
        frameIds: doc.frames.filter((frame) => frames.has(frame.id)).map((frame) => frame.id),
        layerIds: [...layers],
        structure: false,
    };
}

/** What `patchCommand` stores: the pixels of one rectangle of an image before and after. */
export interface StoredPatch {
    label: string;
    imageId: string;
    x: number;
    y: number;
    before: PixelBuffer;
    after: PixelBuffer;
    touched: Touched;
}

/** The command of a stored patch: `do` writes `after` at (x, y) of the image, `undo` `before`. */
export function patchCommand(patch: StoredPatch): Command {
    const { label, imageId, x, y, before, after, touched } = patch;
    const write = (session: DocSession, pixels: PixelBuffer) => {
        const image = session.doc.images.get(imageId);
        if (!image) throw new Error(`"${label}": the document has no image "${imageId}".`);
        blitPixels(image, pixels, x, y);
    };
    return {
        label,
        bytes: before.data.byteLength + after.data.byteLength,
        touched,
        do: (session) => write(session, after),
        undo: (session) => write(session, before),
    };
}

/** New pixels for one rectangle of one image. */
export interface PixelPatch {
    label: string;
    imageId: string;
    /** Top-left of the rectangle in the image; the rectangle has the size of `pixels`. */
    x: number;
    y: number;
    /** The new pixels. The command keeps this buffer, so it must not change afterwards. */
    pixels: PixelBuffer;
}

/**
 * A command that replaces one rectangle of an image with `patch.pixels` and restores the
 * pixels found there now on undo. It is not applied here: pass it to `History.execute`.
 * Throws `RangeError` when the document has no such image or the rectangle leaves it, and
 * `AllocationError` when the pixels for undo cannot be stored.
 */
export function pixelPatchCommand(
    doc: SpriteDoc,
    patch: PixelPatch,
    allocate: PixelAllocator = defaultPixelAllocator,
): Command {
    const { label, imageId, x, y, pixels } = patch;
    const { width, height } = pixels;
    const image = doc.images.get(imageId);
    if (!image) throw new RangeError(`"${label}": the document has no image "${imageId}".`);
    const fits =
        [x, y, width, height].every(Number.isInteger) &&
        width >= 1 &&
        height >= 1 &&
        pixels.data.length === width * height * 4 &&
        x >= 0 &&
        y >= 0 &&
        x + width <= image.width &&
        y + height <= image.height;
    if (!fits) {
        throw new RangeError(
            `"${label}": a ${width}×${height} patch (${pixels.data.length} bytes) at ` +
                `(${x}, ${y}) does not fit image "${imageId}" (${image.width}×${image.height}).`,
        );
    }
    const before = copyRect(allocate, image, { x, y, width, height });
    return patchCommand({
        label,
        imageId,
        x,
        y,
        before,
        after: pixels,
        touched: touchedByImage(doc, imageId),
    });
}
