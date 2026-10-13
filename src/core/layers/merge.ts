import { compositeFrame } from "../composite";
import type { Command } from "../history";
import { celAt, celKey, randomId } from "../model";
import type { DocSession, PixelBuffer, PixelLayer, SpriteDoc } from "../model";
import { pixelBuffersEqual } from "../pixels";
import { LayerError } from "./errors";
import {
    celKeysOf,
    findPixelLayer,
    framesWithCels,
    mergeDownTarget,
    pixelLayers,
    touchedByLayers,
} from "./lookup";
import type { LayerImageOptions } from "./stack";
import {
    allocateImage,
    defaultAllocator,
    stackCommand,
    type BuiltCels,
    type StackEdit,
} from "./stackCommand";

// Merge down and flatten (SPEC §7.3). Both merge pixel layers that follow each other in the
// composite into the lowest of them, the target, and both do it the same way:
//
// - The image of the target at a frame becomes `compositeFrame` of the merged layers alone at
//   that frame. That bakes in what the compositor applies: layer opacity, cel opacity and
//   blend mode. The target then has opacity 255 and blend mode normal, and its cels have
//   opacity 255, so by itself it composites to exactly those images when it is visible. It
//   keeps its ID, name and lock; the other merged layers are deleted.
// - Cels that were linked in the target stay linked when their results are byte-equal and get
//   images of their own when the results differ. A cel that the target did not have is never
//   linked to another.
// - Reference layers are never merged: they are not part of the composite, so they stay in
//   the stack, untouched, and do not separate the pixel layers around them.
// - Every image the merged layers had is replaced, so each is removed unless a cel of another
//   layer names it too, and comes back on undo.
// - The pixels and the properties that are baked are those the layers have when the command
//   is done, and done again: a redo composites anew from what it finds (`stackCommand`).
//
// They differ in what a hidden layer means to them:
//
// - Merge down merges the two layers it is given, whatever their `visible` flag, as Aseprite
//   does: both are composited as if they were visible, so no pixel is lost, and the target
//   keeps its own `visible` flag. The target has a cel at every frame where one of the two
//   layers has one.
// - Flatten keeps the composite of every frame byte-identical. A hidden layer adds nothing
//   to a composite (SPEC §5.3), so its pixels are not in the result and it is deleted with
//   the others; the target is visible afterwards and has a cel at every frame where a
//   visible layer has one.

/** How a merge treats what the compositor would leave out. */
interface MergeRule {
    /**
     * True for merge down: a hidden layer is merged like a visible one and the target keeps
     * its `visible` flag. False for flatten: a hidden layer adds nothing and the target is
     * visible afterwards.
     */
    mergeHidden: boolean;
    /** The active layer after the merge, from the one a `do` finds. */
    activate(activeLayerId: string): string;
}

/** The edit that merges `merged` (pixel layers, bottom to top; the first is the target). */
function mergeEdit(
    session: DocSession,
    label: string,
    merged: readonly PixelLayer[],
    rule: MergeRule,
    options: LayerImageOptions,
): StackEdit {
    const { doc } = session;
    const { newId = randomId, allocate = defaultAllocator } = options;
    const targetId = merged[0].id;
    const mergedIds = new Set(merged.map((layer) => layer.id));
    // The ID of a frame's image is made here, once, so that every redo adds the same IDs:
    // one for each frame at which a merged layer has a cel. A frame that gets no image
    // (flatten: all its cels are hidden) leaves its ID unused; linked cels use the ID of the
    // first of their frames.
    const imageIds = new Map<string, string>();
    for (const frameId of framesWithCels(doc, merged)) imageIds.set(frameId, newId());

    return {
        label,
        touched: touchedByLayers(doc, merged, true),
        change(current) {
            const now = current.doc;
            // The layers as this do finds them: their properties are baked, and the
            // target's name, lock and visibility are kept, as they are now.
            const found = pixelLayers(now).filter((layer) => mergedIds.has(layer.id));
            const [target] = found;
            const layers = rule.mergeHidden
                ? found.map((layer): PixelLayer => ({ ...layer, visible: true }))
                : found;
            const flat: PixelLayer = {
                ...target,
                visible: rule.mergeHidden ? target.visible : true,
                opacity: 255,
                blend: "normal",
            };
            return {
                layers: now.layers.flatMap((layer) => {
                    if (layer.id === targetId) return [flat];
                    return mergedIds.has(layer.id) ? [] : [layer];
                }),
                activeLayerId: rule.activate(current.activeLayerId),
                removedCels: celKeysOf(now, [...mergedIds]),
                build() {
                    // "To composite some of the layers, pass a copy of the document with
                    // those layers" (`compositeFrame`).
                    const stack = { ...now, layers };
                    const built: BuiltCels = { cels: [], images: [] };
                    /** Results so far of the cels that share one image of the target, by that image. */
                    const linked = new Map<string, { imageId: string; image: PixelBuffer }[]>();
                    for (const [frameId, imageId] of imageIds) {
                        const shown = layers.some(
                            (layer) => layer.visible && celAt(now, layer.id, frameId),
                        );
                        if (!shown) continue;
                        const image = compositeFrame(stack, frameId, {
                            into: allocateImage(allocate, now),
                        });
                        const shared = celAt(now, targetId, frameId)?.imageId;
                        const results = (shared !== undefined && linked.get(shared)) || [];
                        let result = results.find((other) => pixelBuffersEqual(other.image, image));
                        if (!result) {
                            result = { imageId, image };
                            built.images.push([imageId, image]);
                            if (shared !== undefined) linked.set(shared, [...results, result]);
                        }
                        built.cels.push([
                            celKey(targetId, frameId),
                            { imageId: result.imageId, opacity: 255 },
                        ]);
                    }
                    return built;
                },
            };
        },
    };
}

/**
 * Merges a pixel layer into the nearest pixel layer below it (`mergeDownTarget`; a reference
 * layer in between is skipped) and deletes it: at every frame the target then holds
 * `compositeFrame` of the two layers alone, both taken as visible. A hidden layer is merged
 * like a visible one, as in Aseprite, and the target stays hidden or visible as it was. The
 * rules are at the top of this file.
 *
 * When the merged layer is the active layer the target becomes active, as the layer below
 * does in Aseprite; another active layer stays active. Which of the two it is, is seen at
 * each do: the active layer can be switched between an undo and a redo.
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
    const targetId = target.id;
    const rule: MergeRule = {
        mergeHidden: true,
        activate: (active) => (active === layerId ? targetId : active),
    };
    return stackCommand(session, mergeEdit(session, label, [target, source], rule, options));
}

/**
 * Whether flatten would leave the document as it is: it has one pixel layer, which is
 * visible with opacity 255 and blend mode normal, and every cel of it has opacity 255. There
 * is then no layer to merge and nothing to bake.
 */
function isFlat(doc: SpriteDoc): boolean {
    const [only, ...others] = pixelLayers(doc);
    return (
        others.length === 0 &&
        only.visible &&
        only.opacity === 255 &&
        only.blend === "normal" &&
        doc.frames.every((frame) => (celAt(doc, only.id, frame.id)?.opacity ?? 255) === 255)
    );
}

/**
 * Merges every pixel layer into the bottom pixel layer, which becomes the active layer: the
 * document then has one pixel layer, and the composite of every frame is byte-identical to
 * what it was. Hidden pixel layers are deleted with the others and add nothing; reference
 * layers stay where they are. The rules are at the top of this file.
 *
 * A document with one pixel layer is flattened too when there is something to bake: the
 * layer's opacity, blend mode or visibility, or the opacity of a cel. Returns null when
 * there is not (`isFlat`): flatten would change nothing, so there is no step to undo.
 */
export function flattenCommand(
    session: DocSession,
    options: LayerImageOptions = {},
): Command | null {
    if (isFlat(session.doc)) return null;
    const merged = pixelLayers(session.doc);
    const targetId = merged[0].id;
    const rule: MergeRule = { mergeHidden: false, activate: () => targetId };
    return stackCommand(session, mergeEdit(session, "Flatten", merged, rule, options));
}
