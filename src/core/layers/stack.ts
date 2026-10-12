import type { Command, PixelAllocator } from "../history";
import { celAt, celKey, layerIndex, randomId } from "../model";
import type { DocSession, IdGenerator, Layer, PixelLayer } from "../model";
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
}

/** Options of the commands that create images. */
export interface LayerImageOptions {
    /** Makes the IDs of what the command creates; the default is `randomId`. */
    newId?: IdGenerator;
    /** Allocates the images the command creates; a test replaces it to simulate failure. */
    allocate?: PixelAllocator;
}

/**
 * Adds an empty pixel layer (visible, unlocked, opacity 255, blend mode normal) directly
 * above the active layer and makes it the active layer, as Aseprite does. When the active
 * layer is a reference layer the new layer goes on top of the stack: a reference layer is
 * drawn behind or in front of all pixel layers (SPEC §12, A7), so it has no place among them
 * that "above it" could mean. Throws the `name` error for an empty `options.name`.
 */
export function addLayerCommand(session: DocSession, options: AddLayerOptions = {}): Command {
    const { doc } = session;
    const { newId = randomId } = options;
    const name = options.name === undefined ? nextLayerName(doc) : normalizeLayerName(options.name);
    const layer: PixelLayer = {
        id: newId(),
        name,
        kind: "pixel",
        visible: true,
        locked: false,
        opacity: 255,
        blend: "normal",
    };
    const active = doc.layers.find((candidate) => candidate.id === session.activeLayerId);
    const index = active?.kind === "pixel" ? layerIndex(doc, active.id) + 1 : doc.layers.length;
    return stackCommand(session, {
        label: "New Layer",
        layers: insertedAt(doc.layers, index, layer),
        activeLayerId: layer.id,
        removedCels: new Set(),
        // An empty layer changes no composite.
        touched: touchedByLayers(doc, [layer], true),
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
 * deleting another layer leaves the active layer as it is.
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
    const index = layerIndex(doc, layerId);
    return stackCommand(session, {
        label: "Delete Layer",
        layers: doc.layers.filter((candidate) => candidate !== layer),
        activeLayerId:
            session.activeLayerId === layerId
                ? activeAfterDelete(doc.layers, index)
                : session.activeLayerId,
        removedCels: celKeysOf(doc, [layerId]),
        touched: touchedByLayers(doc, [layer], true),
    });
}

/**
 * Duplicates a pixel layer, as Aseprite does: the copy, named "<name> Copy", has the layer's
 * properties, sits directly above it and becomes the active layer. Every cel is copied with
 * its opacity onto an image of its own; cels that are linked in the layer are linked in the
 * copy, to a copy of their image, and never to the layer they were copied from.
 *
 * Throws the `layer-not-found` error, and the `not-a-pixel-layer` error for a reference
 * layer: reference layers are created only in the ways SPEC §7.6 lists.
 */
export function duplicateLayerCommand(
    session: DocSession,
    layerId: string,
    options: LayerImageOptions = {},
): Command {
    const { doc } = session;
    const { newId = randomId, allocate = defaultAllocator } = options;
    const source = findPixelLayer(doc, layerId, "Duplicate Layer");
    const copy: PixelLayer = { ...source, id: newId(), name: `${source.name} Copy` };
    // One new image per image of the layer, so that the links carry over.
    const copyOf = new Map<string, string>();
    for (const frame of doc.frames) {
        const cel = celAt(doc, layerId, frame.id);
        if (cel && !copyOf.has(cel.imageId)) copyOf.set(cel.imageId, newId());
    }
    return stackCommand(session, {
        label: "Duplicate Layer",
        layers: insertedAt(doc.layers, layerIndex(doc, layerId) + 1, copy),
        activeLayerId: copy.id,
        removedCels: new Set(),
        build(current) {
            const built: BuiltCels = { cels: [], images: [] };
            for (const [imageId, copyId] of copyOf) {
                const image = current.images.get(imageId);
                if (!image) throw new Error(`"Duplicate Layer": no image "${imageId}".`);
                const pixels = allocateImage(allocate, current);
                pixels.data.set(image.data);
                built.images.push([copyId, pixels]);
            }
            for (const frame of current.frames) {
                const cel = celAt(current, layerId, frame.id);
                const copyId = cel && copyOf.get(cel.imageId);
                if (!cel || copyId === undefined) continue;
                built.cels.push([celKey(copy.id, frame.id), { ...cel, imageId: copyId }]);
            }
            return built;
        },
        // The copy shows wherever the layer has a cel.
        touched: { ...touchedByLayers(doc, [source], true), layerIds: [copy.id] },
    });
}

/**
 * Moves a layer to the position `toIndex` of the stack (0 is the bottom), which is where it
 * is found afterwards. The active layer stays the active layer. Reference layers move like
 * any other; where one sits does not change the composite. A move to the layer's own
 * position changes nothing but is still a step of the history: the caller leaves it out.
 *
 * Throws the `layer-not-found` error, and the `index` error unless `toIndex` is an integer
 * from 0 to the number of layers minus one.
 */
export function reorderLayerCommand(
    session: DocSession,
    layerId: string,
    toIndex: number,
): Command {
    const { doc } = session;
    const layer = findLayer(doc, layerId);
    const last = doc.layers.length - 1;
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > last) {
        throw new LayerError(
            "index",
            `Layer position ${toIndex} is not allowed: it must be an integer from 0 to ${last}.`,
        );
    }
    return stackCommand(session, {
        label: "Move Layer",
        layers: insertedAt(
            doc.layers.filter((candidate) => candidate !== layer),
            toIndex,
            layer,
        ),
        activeLayerId: session.activeLayerId,
        removedCels: new Set(),
        touched: touchedByLayers(doc, [layer], true),
    });
}
