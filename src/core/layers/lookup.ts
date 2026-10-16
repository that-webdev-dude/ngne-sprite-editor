import { assertNameLength, celKey, MAX_NAME_LENGTH } from "../model";
import type { Layer, PixelLayer, SpriteDoc, Touched } from "../model";
import { LayerError } from "./errors";

// Read helpers of the layer commands. None of them changes its argument.

/** The layer with this ID. Throws the `layer-not-found` error. */
export function findLayer(doc: SpriteDoc, layerId: string): Layer {
    const layer = doc.layers.find((candidate) => candidate.id === layerId);
    if (!layer) throw new LayerError("layer-not-found", `The document has no layer "${layerId}".`);
    return layer;
}

/**
 * The pixel layer with this ID, for a command (named by its label) that works on pixel layers
 * only. Throws the `layer-not-found` and the `not-a-pixel-layer` error.
 */
export function findPixelLayer(doc: SpriteDoc, layerId: string, label: string): PixelLayer {
    const layer = findLayer(doc, layerId);
    if (layer.kind !== "pixel") {
        throw new LayerError(
            "not-a-pixel-layer",
            `${label} works on pixel layers; "${layer.name}" is a ${layer.kind} layer.`,
        );
    }
    return layer;
}

/** The pixel layers of the document, bottom to top. */
export function pixelLayers(doc: SpriteDoc): PixelLayer[] {
    return doc.layers.filter((layer): layer is PixelLayer => layer.kind === "pixel");
}

/** Keys of the cels the given layers have, layer by layer in frame order. */
export function celKeysOf(doc: SpriteDoc, layerIds: readonly string[]): Set<string> {
    const keys = new Set<string>();
    for (const layerId of layerIds) {
        for (const frame of doc.frames) {
            const key = celKey(layerId, frame.id);
            if (doc.cels.has(key)) keys.add(key);
        }
    }
    return keys;
}

/** IDs of the frames at which one of the given layers has a cel, in playback order. */
export function framesWithCels(doc: SpriteDoc, layers: readonly Layer[]): string[] {
    return doc.frames
        .filter((frame) => layers.some((layer) => doc.cels.has(celKey(layer.id, frame.id))))
        .map((frame) => frame.id);
}

/**
 * `touched` of a command that changes how layers are composited or which of them exist: the
 * frames at which one of them has a cel are the frames whose composite can differ (SPEC §5.2).
 * A reference layer has no cel, so it names no frame.
 */
export function touchedByLayers(
    doc: SpriteDoc,
    layers: readonly Layer[],
    structure: boolean,
): Touched {
    return {
        frameIds: framesWithCels(doc, layers),
        layerIds: layers.map((layer) => layer.id),
        structure,
    };
}

/**
 * Whether Delete Layer accepts the layer: it exists and is not the last pixel layer. A
 * reference layer can always be deleted, and never counts as the layer that has to stay.
 */
export function canDeleteLayer(doc: SpriteDoc, layerId: string): boolean {
    const layer = doc.layers.find((candidate) => candidate.id === layerId);
    return layer !== undefined && (layer.kind !== "pixel" || pixelLayers(doc).length > 1);
}

/**
 * The layer Merge Down merges a layer into: the nearest pixel layer below it. A reference
 * layer in between is skipped, since it is not part of the composite (SPEC §5.3) and so does
 * not separate two pixel layers. `undefined` when the layer does not exist, is a reference
 * layer or has no pixel layer below.
 */
export function mergeDownTarget(doc: SpriteDoc, layerId: string): PixelLayer | undefined {
    const index = doc.layers.findIndex((candidate) => candidate.id === layerId);
    if (index === -1 || doc.layers[index].kind !== "pixel") return undefined;
    for (let below = index - 1; below >= 0; below--) {
        const layer = doc.layers[below];
        if (layer.kind === "pixel") return layer;
    }
    return undefined;
}

const NUMBERED_NAME = /^Layer (\d+)/;

/**
 * The name New Layer gives a layer, as Aseprite makes it: "Layer N", with N one above the
 * highest number among the layers named "Layer <number>…" (1 when there is none).
 */
export function nextLayerName(doc: SpriteDoc): string {
    const numbers = doc.layers.map((layer) => Number(NUMBERED_NAME.exec(layer.name)?.[1] ?? 0));
    return `Layer ${Math.max(0, ...numbers) + 1}`;
}

/**
 * The name as a layer stores it: without surrounding white space. Throws the `name` error
 * for an empty name, and `DocumentLimitError` for one longer than `MAX_NAME_LENGTH` UTF-16
 * code units (FORMAT.md §1.2), which no file could hold.
 */
export function normalizeLayerName(name: string): string {
    const trimmed = name.trim();
    if (trimmed === "") throw new LayerError("name", "A layer name cannot be empty.");
    assertNameLength(trimmed);
    return trimmed;
}

/** Whether `normalizeLayerName` accepts the name. */
export function isLayerName(name: string): boolean {
    const trimmed = name.trim();
    return trimmed !== "" && trimmed.length <= MAX_NAME_LENGTH;
}
