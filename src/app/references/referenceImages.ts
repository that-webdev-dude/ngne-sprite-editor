import type { PixelBuffer } from "../../core/model";
import { decodePng } from "../../core/png";

// The decoded images of reference sources (SPEC §7.6, SE-045), by the bytes the document's
// store holds (`OpenDocument.referenceSources`). Decoding uses the lossless PNG path of import
// (SE-005), so colours match. A source is decoded once, when something first asks for it; the
// viewport is told when a decode finishes (`subscribe`). A source taken out of the store is
// forgotten (`forget`): its image goes, and it is decoded again if it comes back.

export interface ReferenceImages {
    /**
     * The decoded image of `bytes`, or null while it is being decoded or when it could not
     * be; asking starts the decode. A decode that fails is written to the console once.
     */
    get(bytes: Uint8Array): PixelBuffer | null;
    /**
     * The decoded image of `bytes`; rejects with `PngError` for a file that is not a PNG. The
     * caller reports a rejection: it is not written to the console.
     */
    decode(bytes: Uint8Array): Promise<PixelBuffer>;
    /** Records an image decoded elsewhere for `bytes` (adding a layer has decoded it). */
    put(bytes: Uint8Array, image: PixelBuffer): void;
    /** Drops what was decoded of `bytes`. */
    forget(bytes: Uint8Array): void;
    /** Calls `listener` when a decode finishes. Returns the function that stops it. */
    subscribe(listener: () => void): () => void;
}

interface Entry {
    image: PixelBuffer | null;
    decoding: Promise<PixelBuffer>;
    /** The failure has been written to the console (asked for through `get`). */
    logged: boolean;
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
            const made: Entry = { image: null, decoding: decodePng(bytes), logged: false };
            made.decoding.then(
                (image) => {
                    // Forgotten meanwhile: the image is not kept.
                    if (entries.get(bytes) !== made) return;
                    made.image = image;
                    notify();
                },
                // Reported by whoever asked: `decode`'s caller, or `get` below.
                () => {},
            );
            entries.set(bytes, made);
            entry = made;
        }
        return entry;
    };
    return {
        get(bytes) {
            const entry = entryOf(bytes);
            if (!entry.logged) {
                entry.logged = true;
                entry.decoding.catch((error: unknown) =>
                    console.error("A reference image could not be decoded:", error),
                );
            }
            return entry.image;
        },
        decode: (bytes) => entryOf(bytes).decoding,
        put(bytes, image) {
            entries.set(bytes, { image, decoding: Promise.resolve(image), logged: false });
        },
        forget(bytes) {
            entries.delete(bytes);
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
