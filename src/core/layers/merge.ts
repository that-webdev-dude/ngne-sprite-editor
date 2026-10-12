import { compositeFrame } from "../composite";
import type { Command } from "../history";
import { celAt, celKey, randomId } from "../model";
import type { DocSession, PixelBuffer, PixelLayer } from "../model";
import { pixelBuffersEqual } from "../pixels";
import { LayerError } from "./errors";
import { celKeysOf, findPixelLayer, mergeDownTarget, pixelLayers, touchedByLayers } from "./lookup";
import type { LayerImageOptions } from "./stack";
import {
    allocateImage,
    defaultAllocator,
    stackCommand,
    type BuiltCels,
    type StackPlan,
} from "./stackCommand";

// Merge down and flatten (SPEC §7.3). Both merge pixel layers that follow each other in the
// composite into the lowest of them, the target, and both do it the same way:
//
// - The image of the target at a frame becomes `compositeFrame` of the merged layers alone at
//   that frame. That bakes in what the compositor applies: layer opacity, cel opacity, blend
//   mode and visibility. The target is then visible with opacity 255 and blend mode normal,
//   and its cels have opacity 255, so by itself it composites to exactly those images. It
//   keeps its ID, name and lock; the other merged layers are deleted.
// - A hidden layer adds nothing to a composite (SPEC §5.3), so its pixels are not in the
//   result: the target holds what the merged layers showed, not what they stored. (Aseprite
//   renders the merged layers whether hidden or not; the acceptance of SE-020 ties the result
//   to the composite instead.)
// - The target has a cel at every frame where a visible merged layer has one, and no cel at
//   the other frames.
// - Cels that were linked in the target stay linked when their results are byte-equal and get
//   images of their own when the results differ. A cel that the target did not have is never
//   linked to another.
// - Reference layers are never merged: they are not part of the composite, so they stay in
//   the stack, untouched, and do not separate the pixel layers around them.
// - Every image the merged layers had is replaced, so each is removed unless a cel of another
//   layer names it too, and comes back on undo.

/**
 * The plan that merges `merged` (pixel layers, bottom to top; the first is the target) and
 * leaves `activeLayerId` active.
 */
function mergePlan(
    session: DocSession,
    label: string,
    merged: readonly PixelLayer[],
    activeLayerId: string,
    options: LayerImageOptions,
): StackPlan {
    const { doc } = session;
    const { newId = randomId, allocate = defaultAllocator } = options;
    const [target] = merged;
    const mergedIds = new Set(merged.map((layer) => layer.id));
    const flat: PixelLayer = { ...target, visible: true, opacity: 255, blend: "normal" };
    // The ID of a frame's image is made here, once, so that every redo adds the same IDs.
    // Linked cels use the ID of the first of their frames.
    const imageIds = new Map<string, string>();
    for (const frame of doc.frames) {
        const shown = merged.some((layer) => layer.visible && celAt(doc, layer.id, frame.id));
        if (shown) imageIds.set(frame.id, newId());
    }

    return {
        label,
        layers: doc.layers.flatMap((layer) => {
            if (layer.id === target.id) return [flat];
            return mergedIds.has(layer.id) ? [] : [layer];
        }),
        activeLayerId,
        removedCels: celKeysOf(
            doc,
            merged.map((layer) => layer.id),
        ),
        build(current) {
            // "To composite some of the layers, pass a copy of the document with those
            // layers" (`compositeFrame`).
            const stack = {
                ...current,
                layers: current.layers.filter((layer) => mergedIds.has(layer.id)),
            };
            const built: BuiltCels = { cels: [], images: [] };
            /** The results so far of the cels that share one image of the target, by that image. */
            const linked = new Map<string, { imageId: string; image: PixelBuffer }[]>();
            for (const [frameId, imageId] of imageIds) {
                const image = compositeFrame(stack, frameId, {
                    into: allocateImage(allocate, current),
                });
                const shared = celAt(current, target.id, frameId)?.imageId;
                const results = (shared !== undefined && linked.get(shared)) || [];
                let result = results.find((other) => pixelBuffersEqual(other.image, image));
                if (!result) {
                    result = { imageId, image };
                    built.images.push([imageId, image]);
                    if (shared !== undefined) linked.set(shared, [...results, result]);
                }
                built.cels.push([
                    celKey(target.id, frameId),
                    { imageId: result.imageId, opacity: 255 },
                ]);
            }
            return built;
        },
        touched: touchedByLayers(doc, merged, true),
    };
}

/**
 * Merges a pixel layer into the nearest pixel layer below it (`mergeDownTarget`; a reference
 * layer in between is skipped) and deletes it: at every frame the target then holds
 * `compositeFrame` of the two layers alone. The rules are at the top of this file.
 *
 * When the merged layer was the active layer the target becomes active, as the layer below
 * does in Aseprite; another active layer stays active.
 *
 * Throws the `layer-not-found` error, the `not-a-pixel-layer` error for a reference layer and
 * the `no-pixel-layer-below` error when there is no pixel layer below.
 */
export function mergeDownCommand(
    session: DocSession,
    layerId: string,
    options: LayerImageOptions = {},
): Command {
    const { doc } = session;
    const label = "Merge Down";
    const source = findPixelLayer(doc, layerId, label);
    const target = mergeDownTarget(doc, layerId);
    if (!target) {
        throw new LayerError(
            "no-pixel-layer-below",
            `${label} needs a pixel layer below "${source.name}".`,
        );
    }
    const activeLayerId = session.activeLayerId === layerId ? target.id : session.activeLayerId;
    return stackCommand(
        session,
        mergePlan(session, label, [target, source], activeLayerId, options),
    );
}

/**
 * Merges every pixel layer into the bottom pixel layer, which becomes the active layer: the
 * document then has one pixel layer, and the composite of every frame is byte-identical to
 * what it was. Hidden pixel layers are deleted with the others and add nothing; reference
 * layers stay where they are. The rules are at the top of this file.
 *
 * A document with one pixel layer is flattened too: the layer's opacity, blend mode and
 * visibility are baked into its images.
 */
export function flattenCommand(session: DocSession, options: LayerImageOptions = {}): Command {
    const merged = pixelLayers(session.doc);
    return stackCommand(session, mergePlan(session, "Flatten", merged, merged[0].id, options));
}
