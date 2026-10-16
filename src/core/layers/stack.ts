import type { Command, PixelAllocator } from "../history";
import { assertCanAdd, celAt, celKey, layerIndex, randomId, truncateName } from "../model";
import type { DocSession, DocumentLimits, IdGenerator, Layer, PixelLayer } from "../model";
import { LayerError } from "./errors";
import {
    canDeleteLayer,
    celKeysOf,
    findLayer,
    findPixelLayer,
    nextLayerName,
    normalizeLayerName,
    touchedByLayers,
} from "./lookup";
import { allocateImage, defaultAllocator, stackCommand, type BuiltCels } from "./stackCommand";

// Add, delete, duplicate and reorder (SPEC §7.3). Each changes the list of layers, so each
// reports `structure: true` (SPEC §5.2).
//
// A factory checks its guards and fixes what must be the same at every `do`: the IDs the
// command creates, a name given to a new layer and its position. The change itself is worked
// out by `change` from the session each `do` finds (`stackCommand`).

/** A copy of `layers` with `layer` at `index`. */
function insertedAt(layers: readonly Layer[], index: number, layer: Layer): Layer[] {
    return [...layers.slice(0, index), layer, ...layers.slice(index)];
}

/** Options of `addLayerCommand`. */
export interface AddLayerOptions {
    /** Name of the new layer; the default is `nextLayerName(doc)`. */
    name?: string;
    /** Makes the ID of the new layer; the default is `randomId`. */
    newId?: IdGenerator;
    /** The limits the command checks (SPEC §5.1); the default is `DOCUMENT_LIMITS`. */
    limits?: Readonly<DocumentLimits>;
}

/** Options of the commands that create images. */
export interface LayerImageOptions {
    /** Makes the IDs of what the command creates; the default is `randomId`. */
    newId?: IdGenerator;
    /** Allocates the images the command creates; a test replaces it to simulate failure. */
    allocate?: PixelAllocator;
    /** The limits the command checks (SPEC §5.1); the default is `DOCUMENT_LIMITS`. */
    limits?: Readonly<DocumentLimits>;
}

/**
 * Adds an empty pixel layer (visible, unlocked, opacity 255, blend mode normal) directly
 * above the active layer and makes it the active layer, as Aseprite does. When the active
 * layer is a reference layer the new layer goes on top of the stack: a reference layer is
 * drawn behind or in front of all pixel layers (SPEC §12, A7), so it has no place among them
 * that "above it" could mean. Throws the `name` error for an empty `options.name`.
 *
 * The position is the one found when the command is made: a redo puts the layer there
 * again, whichever layer is active by then, so that it gives the document of the first do.
 *
 * Throws `DocumentLimitError` when the document has as many layers as `options.limits`
 * allows, or the name is longer than `MAX_NAME_LENGTH`.
 */
export function addLayerCommand(session: DocSession, options: AddLayerOptions = {}): Command {
    const { doc } = session;
    const { newId = randomId } = options;
    const given = options.name === undefined ? undefined : normalizeLayerName(options.name);
    assertCanAdd(doc, { layers: 1 }, options.limits);
    const id = newId();
    const active = doc.layers.find((candidate) => candidate.id === session.activeLayerId);
    const index = active?.kind === "pixel" ? layerIndex(doc, active.id) + 1 : doc.layers.length;
    return stackCommand(session, {
        label: "New Layer",
        // An empty layer changes no composite.
        touched: { frameIds: [], layerIds: [id], structure: true },
        change(current) {
            // A layer object of its own at every do: the document's to change from then on.
            const layer: PixelLayer = {
                id,
                name: given ?? nextLayerName(current.doc),
                kind: "pixel",
                visible: true,
                locked: false,
                opacity: 255,
                blend: "normal",
            };
            return {
                layers: insertedAt(current.doc.layers, index, layer),
                activeLayerId: id,
                removedCels: new Set(),
            };
        },
    });
}

/**
 * The layer that becomes active when the active layer `layers[index]` is deleted: the nearest
 * layer below it or, when it was the bottom one, the nearest above it (Aseprite). Layers of
 * the deleted layer's kind come first: the timeline lists reference layers in a group of
 * their own (DESIGN §5.6), so the row under a pixel layer is the next pixel layer down,
 * wherever a reference layer sits in the stack.
 */
function activeAfterDelete(layers: readonly Layer[], index: number): string {
    const nearest = [...layers.slice(0, index).reverse(), ...layers.slice(index + 1)];
    const next = nearest.find((layer) => layer.kind === layers[index].kind) ?? nearest[0];
    return next.id;
}

/**
 * Deletes a layer with its cels; images left without a cel go with them and come back on
 * undo. Deleting the active layer makes the layer below it active (`activeAfterDelete`);
 * deleting another layer leaves the active layer as it is. Which of the two it is, is seen
 * at each do: the active layer can be switched between an undo and a redo.
 *
 * Throws the `layer-not-found` error, and the `last-pixel-layer` error for the only pixel
 * layer of the document: reference layers do not count as the layer that has to stay, and a
 * reference layer can always be deleted.
 */
export function deleteLayerCommand(session: DocSession, layerId: string): Command {
    const { doc } = session;
    const layer = findLayer(doc, layerId);
    if (!canDeleteLayer(doc, layerId)) {
        throw new LayerError("last-pixel-layer", "The last pixel layer cannot be deleted.");
    }
    return stackCommand(session, {
        label: "Delete Layer",
        touched: touchedByLayers(doc, [layer], true),
        change(current) {
            const { layers } = current.doc;
            const index = layerIndex(current.doc, layerId);
            return {
                layers: layers.filter((candidate) => candidate.id !== layerId),
                activeLayerId:
                    current.activeLayerId === layerId
                        ? activeAfterDelete(layers, index)
                        : current.activeLayerId,
                removedCels: celKeysOf(current.doc, [layerId]),
            };
        },
    });
}

/**
 * Duplicates a pixel layer, as Aseprite does: the copy, named "<name> Copy", has the layer's
 * properties, sits directly above it and becomes the active layer. Every cel is copied with
 * its opacity onto an image of its own; cels that are linked in the layer are linked in the
 * copy, to a copy of their image, and never to the layer they were copied from.
 *
 * Throws the `layer-not-found` error, and the `not-a-pixel-layer` error for a reference
 * layer: reference layers are created only in the ways SPEC §7.6 lists. Throws
 * `DocumentLimitError` when the copy, its cels or its images would take the document past
 * `options.limits`. A name that would pass `MAX_NAME_LENGTH` with " Copy" is cut to it.
 */
export function duplicateLayerCommand(
    session: DocSession,
    layerId: string,
    options: LayerImageOptions = {},
): Command {
    const { doc } = session;
    const { newId = randomId, allocate = defaultAllocator } = options;
    const label = "Duplicate Layer";
    const source = findPixelLayer(doc, layerId, label);
    // One new image per image of the layer, so that the links carry over.
    const images = new Set<string>();
    let cels = 0;
    for (const frame of doc.frames) {
        const cel = celAt(doc, layerId, frame.id);
        if (!cel) continue;
        cels++;
        images.add(cel.imageId);
    }
    assertCanAdd(
        doc,
        {
            layers: 1,
            cels,
            images: images.size,
            pixelBytes: images.size * doc.width * doc.height * 4,
        },
        options.limits,
    );
    const copyId = newId();
    const copyOf = new Map<string, string>();
    for (const imageId of images) copyOf.set(imageId, newId());
    return stackCommand(session, {
        label,
        // The copy shows wherever the layer has a cel.
        touched: { ...touchedByLayers(doc, [source], true), layerIds: [copyId] },
        change(current) {
            const found = findPixelLayer(current.doc, layerId, label);
            const copy: PixelLayer = {
                ...found,
                id: copyId,
                name: truncateName(`${found.name} Copy`),
            };
            return {
                layers: insertedAt(current.doc.layers, layerIndex(current.doc, layerId) + 1, copy),
                activeLayerId: copyId,
                removedCels: new Set(),
                build() {
                    const built: BuiltCels = { cels: [], images: [] };
                    for (const [imageId, copiedId] of copyOf) {
                        const image = current.doc.images.get(imageId);
                        if (!image) throw new Error(`"${label}": no image "${imageId}".`);
                        const pixels = allocateImage(allocate, current.doc);
                        pixels.data.set(image.data);
                        built.images.push([copiedId, pixels]);
                    }
                    for (const frame of current.doc.frames) {
                        const cel = celAt(current.doc, layerId, frame.id);
                        const copiedId = cel && copyOf.get(cel.imageId);
                        if (!cel || copiedId === undefined) continue;
                        built.cels.push([celKey(copyId, frame.id), { ...cel, imageId: copiedId }]);
                    }
                    return built;
                },
            };
        },
    });
}

/**
 * Moves a layer to the position `toIndex` of the stack (0 is the bottom), which is where it
 * is found afterwards. The active layer stays the active layer. Reference layers move like
 * any other; where one sits does not change the composite.
 *
 * Returns null when the layer is at that position already: there is then no step to undo.
 * Throws the `layer-not-found` error, and the `index` error unless `toIndex` is an integer
 * from 0 to the number of layers minus one.
 */
export function reorderLayerCommand(
    session: DocSession,
    layerId: string,
    toIndex: number,
): Command | null {
    const { doc } = session;
    const layer = findLayer(doc, layerId);
    const last = doc.layers.length - 1;
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > last) {
        throw new LayerError(
            "index",
            `Layer position ${toIndex} is not allowed: it must be an integer from 0 to ${last}.`,
        );
    }
    if (layerIndex(doc, layerId) === toIndex) return null;
    return stackCommand(session, {
        label: "Move Layer",
        touched: touchedByLayers(doc, [layer], true),
        change(current) {
            const moved = findLayer(current.doc, layerId);
            const others = current.doc.layers.filter((candidate) => candidate !== moved);
            return {
                layers: insertedAt(others, toIndex, moved),
                activeLayerId: current.activeLayerId,
                removedCels: new Set(),
            };
        },
    });
}
