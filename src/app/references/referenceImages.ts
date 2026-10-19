import type { PixelBuffer } from "../../core/model";
import { decodePng } from "../../core/png";

// The decoded images of reference sources (SPEC §7.6, SE-045), by the bytes the document's
// store holds (`OpenDocument.referenceSources`). Decoding uses the lossless PNG path of import
// (SE-005), so colours match. A source is decoded once, when something first asks for it; the
// viewport is told when a decode finishes (`subscribe`). An image is kept as long as its bytes
// are: a source that no document holds any more goes with its bytes.

export interface ReferenceImages {
    /**
     * The decoded image of `bytes`, or null while it is being decoded or when it could not
     * be; asking starts the decode.
     */
    get(bytes: Uint8Array): PixelBuffer | null;
    /** The decoded image of `bytes`; rejects with `PngError` for a file that is not a PNG. */
    decode(bytes: Uint8Array): Promise<PixelBuffer>;
    /** Records an image decoded elsewhere for `bytes` (adding a layer has decoded it). */
    put(bytes: Uint8Array, image: PixelBuffer): void;
    /** Calls `listener` when a decode finishes. Returns the function that stops it. */
    subscribe(listener: () => void): () => void;
}

interface Entry {
    image: PixelBuffer | null;
    decoding: Promise<PixelBuffer>;
}

export function createReferenceImages(): ReferenceImages {
    const entries = new WeakMap<Uint8Array, Entry>();
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of [...listeners]) listener();
    };
    const entryOf = (bytes: Uint8Array): Entry => {
        let entry = entries.get(bytes);
        if (!entry) {
            const made: Entry = { image: null, decoding: decodePng(bytes) };
            made.decoding.then(
                (image) => {
                    made.image = image;
                    notify();
                },
                (error: unknown) => console.error("A reference image could not be decoded:", error),
            );
            entries.set(bytes, made);
            entry = made;
        }
        return entry;
    };
    return {
        get: (bytes) => entryOf(bytes).image,
        decode: (bytes) => entryOf(bytes).decoding,
        put(bytes, image) {
            entries.set(bytes, { image, decoding: Promise.resolve(image) });
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

/** The decoded reference images of the app. */
export const referenceImages = createReferenceImages();
