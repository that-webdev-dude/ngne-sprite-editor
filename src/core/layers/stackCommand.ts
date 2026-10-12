import { AllocationError } from "../history";
import type { Command, PixelAllocator } from "../history";
import type { Cel, DocSession, Layer, PixelBuffer, SpriteDoc, Touched } from "../model";

// The one command behind every change of the layer stack (add, delete, duplicate, reorder,
// merge down, flatten). A change is planned from the session as a `StackPlan`; `stackCommand`
// turns the plan into a command that applies it as a whole and takes it back exactly.

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

/** A change of the layer stack, planned from a session and not applied yet. */
export interface StackPlan {
    label: string;
    /** The stack after the change, bottom to top. */
    layers: Layer[];
    /** The active layer after the change. */
    activeLayerId: string;
    /** Keys of the cels the change removes. An image left without a cel goes with them. */
    removedCels: ReadonlySet<string>;
    /**
     * Makes the cels the change adds, with new images under IDs no other cel names. Every
     * `do` calls it, before the session changes, with the document as the plan found it; it
     * returns the same keys, IDs and bytes each time. It may throw `AllocationError`.
     */
    build?: (doc: SpriteDoc) => BuiltCels;
    touched: Touched;
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

const NOTHING_BUILT: BuiltCels = { cels: [], images: [] };

/**
 * The command of a planned change of the layer stack. `session` is the session the plan was
 * made from, unchanged since.
 *
 * `do` replaces the stack, removes the plan's cels and the images they orphan (SPEC §5.1),
 * adds the built cels and images and sets the active layer. `undo` takes the built cels and
 * images out again and puts back the stack, the removed cels, the removed images (the same
 * buffers, at their places in the maps) and the active layer.
 *
 * `bytes` is the pixel memory the command keeps out of the document for undo: the images it
 * removes. Images it adds belong to the document while the command is done and are dropped
 * when it is undone; a redo makes them again.
 *
 * `do` throws with the session unchanged when memory for the new images cannot be allocated
 * (`AllocationError`), and when the session is no longer the one the plan was made from: it
 * has other layers, or another number of cels or images.
 */
export function stackCommand(session: DocSession, plan: StackPlan): Command {
    const { label, build } = plan;
    const { doc } = session;
    const before = {
        layers: [...doc.layers],
        activeLayerId: session.activeLayerId,
        cels: doc.cels.size,
        images: doc.images.size,
    };
    const cels = entriesAt(doc.cels, plan.removedCels);
    // An image is orphaned when every cel that names it is removed. Linked cels share an
    // image, so a cel that stays keeps the image even when another cel of it goes.
    const named = new Set<string>();
    for (const [key, cel] of doc.cels) if (!plan.removedCels.has(key)) named.add(cel.imageId);
    const orphaned = new Set(cels.map(({ value }) => value.imageId).filter((id) => !named.has(id)));
    const images = entriesAt(doc.images, orphaned);
    let built = NOTHING_BUILT;

    const setLayers = (target: SpriteDoc, layers: readonly Layer[]) => {
        target.layers.splice(0, target.layers.length, ...layers);
    };
    /** Whether a document still is what the plan was made from, as far as the plan depends on it. */
    const asPlanned = (current: SpriteDoc) =>
        current.cels.size === before.cels &&
        current.images.size === before.images &&
        current.layers.length === before.layers.length &&
        current.layers.every((layer, index) => layer.id === before.layers[index].id);

    return {
        label,
        bytes: images.reduce((sum, { value }) => sum + value.data.byteLength, 0),
        touched: plan.touched,
        do(target) {
            if (!asPlanned(target.doc)) {
                throw new Error(`"${label}": the session changed since the command was made.`);
            }
            // Everything that can fail happens here, before the session changes.
            const next = build ? build(target.doc) : NOTHING_BUILT;
            setLayers(target.doc, plan.layers);
            for (const { key } of cels) target.doc.cels.delete(key);
            for (const { key } of images) target.doc.images.delete(key);
            for (const [imageId, image] of next.images) target.doc.images.set(imageId, image);
            for (const [key, cel] of next.cels) target.doc.cels.set(key, cel);
            target.activeLayerId = plan.activeLayerId;
            built = next;
        },
        undo(target) {
            for (const [key] of built.cels) target.doc.cels.delete(key);
            for (const [imageId] of built.images) target.doc.images.delete(imageId);
            built = NOTHING_BUILT;
            restoreEntries(target.doc.cels, cels);
            restoreEntries(target.doc.images, images);
            setLayers(target.doc, before.layers);
            target.activeLayerId = before.activeLayerId;
        },
    };
}
