import { AllocationError } from "../history";
import type { PixelAllocator } from "../history";
import { celKey, randomId } from "../model";
import type { Cel, IdGenerator, PixelBuffer, SpriteDoc } from "../model";
import { applyMapEdit, revertMapEdit, type MapUndo } from "./orderedMap";

// Shared by the commands that change cels: the cel commands, and the frame commands that
// copy or delete the cels of a frame. Not part of the public API of `core/cels`.

/** One cell of the timeline grid: a layer at a frame. */
export interface CellRef {
    layerId: string;
    frameId: string;
}

/** The allocator of a command that is given none. */
export const defaultAllocator: PixelAllocator = (byteLength) => new Uint8ClampedArray(byteLength);

/** A copy of an image with its own pixels. Any failure of `allocate` is an `AllocationError`. */
function copyImage(allocate: PixelAllocator, source: PixelBuffer): PixelBuffer {
    const bytes = source.data.byteLength;
    let data: Uint8ClampedArray;
    try {
        data = allocate(bytes);
    } catch (cause) {
        throw new AllocationError(bytes, cause);
    }
    data.set(source.data);
    return { width: source.width, height: source.height, data };
}

/**
 * A change of the cels of a document, with the images it adds and removes, that can be taken
 * back. Under a history `apply` always finds the document as it was planned, because every
 * change of cels and images is a command; `matches` tells when it does not.
 */
export interface CelChange {
    /** Pixel memory of the images the change removes; it keeps them while it is applied. */
    readonly bytes: number;
    /** The cells whose cel the change creates, removes or replaces, in the order planned. */
    readonly cells: readonly CellRef[];
    /**
     * Whether the document still is what the change was planned from, as far as that can be
     * told cheaply: it has as many cels and images, and each cell of `cells` holds what it held.
     */
    matches(doc: SpriteDoc): boolean;
    /**
     * Changes the cels. Images that are copies are made first, so when one cannot be
     * allocated this throws `AllocationError` with the document as it was. Images that no
     * cel uses any more are removed (SPEC §5.1).
     */
    apply(doc: SpriteDoc): void;
    /** Takes `apply` back: the cels and the images as they were, in the order they had. */
    revert(doc: SpriteDoc): void;
}

/**
 * Plans a change of cels against a document without changing it: `set` says what a cell
 * holds afterwards, `build` works out the rest. A new image is always a copy of an existing
 * one and is made again on every `apply`, so the change keeps no pixels for it.
 */
export class CelPlan {
    readonly #doc: SpriteDoc;
    readonly #newId: IdGenerator;
    readonly #allocate: PixelAllocator;
    /** By cel key, in the order the cells were first set. */
    readonly #cells = new Map<string, CellRef & { cel: Cel | null }>();
    /** New image ID → ID of the image it copies. */
    readonly #copies = new Map<string, string>();
    /** Image ID → ID of the copy `copyOf` gave for it. */
    readonly #shared = new Map<string, string>();

    constructor(
        doc: SpriteDoc,
        newId: IdGenerator = randomId,
        allocate: PixelAllocator = defaultAllocator,
    ) {
        this.#doc = doc;
        this.#newId = newId;
        this.#allocate = allocate;
    }

    /** Leaves `cel` at a cell, or with null an empty cell. The last call for a cell counts. */
    set(layerId: string, frameId: string, cel: Cel | null): void {
        this.#cells.set(celKey(layerId, frameId), {
            layerId,
            frameId,
            cel: cel && { imageId: cel.imageId, opacity: cel.opacity },
        });
    }

    /**
     * ID of a new image that will be a copy of the image `imageId`. It is the same on every
     * call for one image, so cels that shared an image share its copy: links are kept among
     * copies, and no copy is linked to its original.
     */
    copyOf(imageId: string): string {
        let copy = this.#shared.get(imageId);
        if (copy === undefined) {
            copy = this.ownCopyOf(imageId);
            this.#shared.set(imageId, copy);
        }
        return copy;
    }

    /** ID of a new image that will be a copy of the image `imageId`, new on every call. */
    ownCopyOf(imageId: string): string {
        const id = this.#newId();
        this.#copies.set(id, imageId);
        return id;
    }

    /** The planned change, or null when it leaves every cel as it is. */
    build(): CelChange | null {
        const doc = this.#doc;
        const allocate = this.#allocate;
        const removes: string[] = [];
        const sets = new Map<string, Cel>();
        const cells: CellRef[] = [];
        /** What each cell of `cells` holds now, by cel key. */
        const found = new Map<string, Cel | null>();
        for (const [key, { layerId, frameId, cel }] of this.#cells) {
            const current = doc.cels.get(key);
            if (cel === null) {
                if (!current) continue;
                removes.push(key);
            } else {
                if (current?.imageId === cel.imageId && current.opacity === cel.opacity) continue;
                if (!doc.images.has(cel.imageId) && !this.#copies.has(cel.imageId)) {
                    throw new Error(`A cel is planned with the unknown image "${cel.imageId}".`);
                }
                sets.set(key, cel);
            }
            cells.push({ layerId, frameId });
            found.set(key, current ? { ...current } : null);
        }
        if (cells.length === 0) return null;
        const counts = { cels: doc.cels.size, images: doc.images.size };

        // The images in use afterwards. The others are removed; a copy no cel took is not made.
        const removed = new Set(removes);
        const used = new Set<string>();
        for (const [key, cel] of doc.cels) {
            if (!removed.has(key)) used.add((sets.get(key) ?? cel).imageId);
        }
        for (const cel of sets.values()) used.add(cel.imageId);
        const orphans = [...doc.images.keys()].filter((id) => !used.has(id));
        const copies = [...this.#copies].filter(([id]) => used.has(id));
        let bytes = 0;
        for (const id of orphans) bytes += doc.images.get(id)?.data.byteLength ?? 0;

        let undo: { cels: MapUndo<Cel>; images: MapUndo<PixelBuffer> } | null = null;
        return {
            bytes,
            cells,
            matches(target) {
                const counted =
                    target.cels.size === counts.cels && target.images.size === counts.images;
                return (
                    counted &&
                    [...found].every(([key, cel]) => {
                        const now = target.cels.get(key);
                        return now?.imageId === cel?.imageId && now?.opacity === cel?.opacity;
                    })
                );
            },
            apply(target) {
                const made = copies.map(([id, sourceId]): [string, PixelBuffer] => {
                    const source = target.images.get(sourceId);
                    if (!source) throw new Error(`The document has no image "${sourceId}".`);
                    return [id, copyImage(allocate, source)];
                });
                // Its own cel objects on every run, so no later change of one reaches the plan.
                const fresh = [...sets].map(([key, cel]): [string, Cel] => [key, { ...cel }]);
                const images = applyMapEdit(target.images, orphans, made);
                undo = { images, cels: applyMapEdit(target.cels, removes, fresh) };
            },
            revert(target) {
                if (!undo) throw new Error("A cel change is taken back before it is applied.");
                revertMapEdit(target.cels, undo.cels);
                revertMapEdit(target.images, undo.images);
                undo = null;
            },
        };
    }
}
