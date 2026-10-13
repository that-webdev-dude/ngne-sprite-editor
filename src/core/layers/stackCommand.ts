import { AllocationError } from "../history";
import type { Command, PixelAllocator } from "../history";
import type { Cel, DocSession, Layer, PixelBuffer, SpriteDoc, Touched } from "../model";

// The one command behind every change of the layer stack (add, delete, duplicate, reorder,
// merge down, flatten).
//
// A document that is back at a place of its history has the same IDs and the same bytes
// there, but not the same objects: a command that creates an image creates it again when it
// is redone. So a stack command keeps nothing of the session it was made from. What it
// decides when it is made is what follows from the structure of the document: its guards,
// `bytes`, `touched`, the IDs it creates. Everything else — the layer objects, the cels, the
// image buffers, the places of the entries in the maps, the active layer — is taken from the
// session at each `do`, and `undo` puts back exactly what that `do` took.

/** The allocator used unless another is given. */
export const defaultAllocator: PixelAllocator = (byteLength) => new Uint8ClampedArray(byteLength);

/** A transparent image of the document's size. Any failure of `allocate` is an `AllocationError`. */
export function allocateImage(allocate: PixelAllocator, doc: SpriteDoc): PixelBuffer {
    const { width, height } = doc;
    const bytes = width * height * 4;
    try {
        return { width, height, data: allocate(bytes) };
    } catch (cause) {
        throw new AllocationError(bytes, cause);
    }
}

/** The cels a stack command adds and the images those cels name, in the order they are added. */
export interface BuiltCels {
    cels: (readonly [key: string, cel: Cel])[];
    images: (readonly [imageId: string, image: PixelBuffer])[];
}

/** What a stack command changes in a session, worked out from that session as it is. */
export interface StackChange {
    /** The stack after the change, bottom to top: layer objects of the session, and new ones. */
    layers: Layer[];
    /** The active layer after the change. */
    activeLayerId: string;
    /** Keys of the cels the change removes. An image left without a cel goes with them. */
    removedCels: ReadonlySet<string>;
    /**
     * Makes the cels the change adds, with new images under IDs no other cel names. It is
     * called once, before the session changes, and may throw `AllocationError`.
     */
    build?: () => BuiltCels;
}

/** A stack command before it is bound to a session. */
export interface StackEdit {
    label: string;
    touched: Touched;
    /**
     * The change the command makes to a session, from the layer objects, the cels, the
     * pixels and the active layer the session has now. It is called when the command is
     * made and by every `do`, each time on a session with the same structure (`structureOf`),
     * and names the same layers, cels and images each time. It changes nothing.
     */
    change(session: DocSession): StackChange;
}

/**
 * What a stack command depends on beyond what it reads at `do`: which layers, frames, cels
 * and images a document has. Two documents with the same structure can differ in pixels, in
 * the properties of layers and cels, and in the order of their maps.
 */
interface Structure {
    /** ID and kind of each layer, bottom to top. */
    layers: (readonly [id: string, kind: Layer["kind"]])[];
    /** ID of each frame, in playback order. */
    frames: string[];
    /** Key of each cel with the image it names. */
    cels: (readonly [key: string, imageId: string])[];
    /** ID of each image with its size in bytes. */
    images: (readonly [imageId: string, bytes: number])[];
}

function structureOf(doc: SpriteDoc): Structure {
    return {
        layers: doc.layers.map((layer) => [layer.id, layer.kind]),
        frames: doc.frames.map((frame) => frame.id),
        cels: Array.from(doc.cels, ([key, cel]) => [key, cel.imageId]),
        images: Array.from(doc.images, ([imageId, image]) => [imageId, image.data.byteLength]),
    };
}

/** Whether a document has exactly the layers, frames, cels and images of `structure`. */
function hasStructure(doc: SpriteDoc, structure: Structure): boolean {
    const { layers, frames, cels, images } = structure;
    return (
        doc.layers.length === layers.length &&
        layers.every(([id, kind], index) => {
            const layer = doc.layers[index];
            return layer.id === id && layer.kind === kind;
        }) &&
        doc.frames.length === frames.length &&
        frames.every((id, index) => doc.frames[index].id === id) &&
        // As many entries, and each of the structure is there: the maps hold the same.
        doc.cels.size === cels.length &&
        cels.every(([key, imageId]) => doc.cels.get(key)?.imageId === imageId) &&
        doc.images.size === images.length &&
        images.every(([imageId, bytes]) => doc.images.get(imageId)?.data.byteLength === bytes)
    );
}

/** An entry taken out of a map, with the position it had in the map's order. */
interface Removed<V> {
    index: number;
    key: string;
    value: V;
}

/** The entries of `map` under `keys`, in the map's order. */
function entriesAt<V>(map: ReadonlyMap<string, V>, keys: ReadonlySet<string>): Removed<V>[] {
    const found: Removed<V>[] = [];
    let index = 0;
    for (const [key, value] of map) {
        if (keys.has(key)) found.push({ index, key, value });
        index++;
    }
    return found;
}

/**
 * Puts removed entries back at the positions they had. `map` holds the entries that stayed,
 * still in their order, so the map gets the order it had before the removal: a document is
 * the same after an undo down to the order of its maps.
 */
function restoreEntries<V>(map: Map<string, V>, removed: readonly Removed<V>[]): void {
    if (removed.length === 0) return;
    const stayed = [...map];
    map.clear();
    let next = 0;
    for (const { index, key, value } of removed) {
        for (; map.size < index && next < stayed.length; next++) {
            map.set(stayed[next][0], stayed[next][1]);
        }
        map.set(key, value);
    }
    for (; next < stayed.length; next++) map.set(stayed[next][0], stayed[next][1]);
}

/** The cels a change removes from a document and the images they orphan, as it has them now. */
interface Removal {
    cels: Removed<Cel>[];
    images: Removed<PixelBuffer>[];
}

function removalOf(doc: SpriteDoc, removedCels: ReadonlySet<string>): Removal {
    const cels = entriesAt(doc.cels, removedCels);
    // An image is orphaned when every cel that names it is removed. Linked cels share an
    // image, so a cel that stays keeps the image even when another cel of it goes.
    const named = new Set<string>();
    for (const [key, cel] of doc.cels) if (!removedCels.has(key)) named.add(cel.imageId);
    const orphaned = new Set(cels.map(({ value }) => value.imageId).filter((id) => !named.has(id)));
    return { cels, images: entriesAt(doc.images, orphaned) };
}

/** Pixel memory of the images of a removal, in bytes. */
function pixelBytes({ images }: Removal): number {
    return images.reduce((sum, { value }) => sum + value.data.byteLength, 0);
}

/** What one `do` took from the session and added to it: what its `undo` reverses. */
interface Done extends Removal {
    /** The layer objects of the stack `do` found, bottom to top. */
    layers: Layer[];
    /** The active layer `do` found. */
    activeLayerId: string;
    built: BuiltCels;
}

const NOTHING_BUILT: BuiltCels = { cels: [], images: [] };

function setLayers(doc: SpriteDoc, layers: readonly Layer[]): void {
    doc.layers.splice(0, doc.layers.length, ...layers);
}

/**
 * The command of a change of the layer stack, made from `session`.
 *
 * `do` works the change out from the session it is given, replaces the stack, removes the
 * change's cels and the images they orphan (SPEC §5.1), adds the built cels and images and
 * sets the active layer. `undo` takes the built cels and images out again and puts back what
 * that `do` found: the layer objects, the removed cels and image buffers at their places in
 * the maps, and the active layer. Nothing of an earlier `do` is used, so it does not matter
 * that a redo of other commands made the images anew in between.
 *
 * `do` throws with the session unchanged
 * - when the document no longer has the structure the command was made from: other layers
 *   or frames, or another order of them, a cel more or less, a cel on another image, an
 *   image more or less or of another size. A redo never throws for this, because undo and
 *   redo bring that structure back; object identity, pixels, properties and the active layer
 *   are not part of it;
 * - with `AllocationError` when memory for the new images cannot be allocated.
 *
 * `bytes` is the pixel memory of the images the command removes, which it keeps while it is
 * done. The history reads it once, when it records the command after the first `do`, and a
 * `compositeCommand` when it is made, so it is fixed when the command is made; it is what
 * every `do` takes, since which images go and how large they are follows from the structure.
 * While the command is undone it keeps no image. Images it adds belong to the document and
 * are made again by a redo.
 */
export function stackCommand(session: DocSession, edit: StackEdit): Command {
    const { label } = edit;
    const structure = structureOf(session.doc);
    const bytes = pixelBytes(removalOf(session.doc, edit.change(session).removedCels));
    let done: Done | null = null;

    return {
        label,
        bytes,
        touched: edit.touched,
        do(target) {
            const { doc } = target;
            if (!hasStructure(doc, structure)) {
                throw new Error(`"${label}": the session changed since the command was made.`);
            }
            const change = edit.change(target);
            const removal = removalOf(doc, change.removedCels);
            // Everything that can fail has happened by here, before the session changes.
            const built = change.build ? change.build() : NOTHING_BUILT;
            done = {
                ...removal,
                layers: [...doc.layers],
                activeLayerId: target.activeLayerId,
                built,
            };
            setLayers(doc, change.layers);
            for (const { key } of removal.cels) doc.cels.delete(key);
            for (const { key } of removal.images) doc.images.delete(key);
            for (const [imageId, image] of built.images) doc.images.set(imageId, image);
            for (const [key, cel] of built.cels) doc.cels.set(key, cel);
            target.activeLayerId = change.activeLayerId;
        },
        undo(target) {
            if (!done) throw new Error(`"${label}": cannot be undone, it is not done.`);
            const { doc } = target;
            for (const [key] of done.built.cels) doc.cels.delete(key);
            for (const [imageId] of done.built.images) doc.images.delete(imageId);
            restoreEntries(doc.cels, done.cels);
            restoreEntries(doc.images, done.images);
            setLayers(doc, done.layers);
            target.activeLayerId = done.activeLayerId;
            // The buffers are the document's again; the command holds none while undone.
            done = null;
        },
    };
}
