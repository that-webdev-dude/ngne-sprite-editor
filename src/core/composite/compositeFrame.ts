import { celAt, frameIndex } from "../model";
import type { PixelBuffer, Rect, SpriteDoc } from "../model";
import { createPixelBuffer } from "../pixels";
import { BLEND_FUNCTIONS, mul255, type BlendFunction } from "./blend";

// The CPU compositor of SPEC §5.3. A frame is composited in two steps: `layerStack` reads
// from the document which images are blended and how, and `blendStack` blends them over a
// rectangle. A whole frame and a dirty rectangle take the same path, with a different
// rectangle. The pixel math is specified in `blend.ts`.

/** An image used in place of the image of one cel of the frame being composited. */
export interface CelOverride {
    /** The pixel layer whose cel is replaced. */
    layerId: string;
    /**
     * Blended instead of the cel's image, with the cel's opacity. It has the document's
     * dimensions. When the cel is empty it counts as a cel of opacity 255.
     */
    image: PixelBuffer;
}

/** Options of `compositeFrame`. */
export interface CompositeOptions {
    /**
     * The area to composite, in document pixels (integers; clipped to the canvas). Pixels of
     * the result outside it are not written. The default is the whole canvas.
     */
    rect?: Rect;
    /**
     * The buffer to write into, which is then the return value. It has the document's
     * dimensions and is not an image of the frame. The default is a new transparent buffer.
     */
    into?: PixelBuffer;
    /**
     * Images blended in place of cel images of the frame, at most one per layer: a live
     * stroke or a floating selection, which the document does not hold.
     */
    overrides?: readonly CelOverride[];
}

/** One layer's part in a composite. */
interface StackLayer {
    /** Pixels of the cel's image, or of its override. */
    data: Uint8ClampedArray;
    /** Layer opacity × cel opacity, 1..255. */
    opacity: number;
    blend: BlendFunction;
}

/**
 * Everything the composite of one frame depends on except the pixels of its images: the
 * layers that contribute, bottom to top, and the size of the canvas.
 */
export interface LayerStack {
    width: number;
    height: number;
    layers: StackLayer[];
}

/** How an image's size differs from the canvas, as the end of a sentence; null when it fits. */
function sizeMismatch(image: PixelBuffer, doc: SpriteDoc): string | null {
    const sized =
        image.width === doc.width &&
        image.height === doc.height &&
        image.data.length === doc.width * doc.height * 4;
    return sized
        ? null
        : `is ${image.width}×${image.height} with ${image.data.length} bytes; the document ` +
              `is ${doc.width}×${doc.height}.`;
}

/**
 * The images that replace cel images, by layer ID. Throws `RangeError` for an override that
 * cannot apply.
 */
function overridesByLayer(
    doc: SpriteDoc,
    overrides: readonly CelOverride[],
): Map<string, PixelBuffer> {
    const images = new Map<string, PixelBuffer>();
    for (const { layerId, image } of overrides) {
        const layer = doc.layers.find((candidate) => candidate.id === layerId);
        if (layer?.kind !== "pixel") {
            throw new RangeError(
                `compositeFrame: an override names "${layerId}", which is not a pixel layer.`,
            );
        }
        if (images.has(layerId)) {
            throw new RangeError(`compositeFrame: two overrides name layer "${layerId}".`);
        }
        const mismatch = sizeMismatch(image, doc);
        if (mismatch) {
            throw new RangeError(`compositeFrame: the override of "${layerId}" ${mismatch}`);
        }
        images.set(layerId, image);
    }
    return images;
}

/** The image of a cel. Throws when the document breaks the invariants of SPEC §5.1 for it. */
function celImage(doc: SpriteDoc, layerId: string, imageId: string): PixelBuffer {
    const image = doc.images.get(imageId);
    if (!image) {
        throw new Error(`compositeFrame: the cel of layer "${layerId}" names image "${imageId}".`);
    }
    const mismatch = sizeMismatch(image, doc);
    if (mismatch) throw new Error(`compositeFrame: image "${imageId}" ${mismatch}`);
    return image;
}

/**
 * The layers that contribute to a frame: visible pixel layers whose cel is not empty and
 * whose opacity is not 0, bottom to top. Reference layers never contribute (SPEC §5.3).
 * Throws `RangeError` when the document has no such frame or an override cannot apply.
 */
export function layerStack(
    doc: SpriteDoc,
    frameId: string,
    overrides: readonly CelOverride[] = [],
): LayerStack {
    if (frameIndex(doc, frameId) === -1) {
        throw new RangeError(`compositeFrame: the document has no frame "${frameId}".`);
    }
    const replaced = overridesByLayer(doc, overrides);
    const layers: StackLayer[] = [];
    for (const layer of doc.layers) {
        if (layer.kind !== "pixel" || !layer.visible) continue;
        const cel = celAt(doc, layer.id, frameId);
        const image = replaced.get(layer.id) ?? (cel && celImage(doc, layer.id, cel.imageId));
        if (!image) continue;
        const opacity = mul255(layer.opacity, cel ? cel.opacity : 255);
        if (opacity === 0) continue;
        layers.push({ data: image.data, opacity, blend: BLEND_FUNCTIONS[layer.blend] });
    }
    return { width: doc.width, height: doc.height, layers };
}

/** True when two stacks blend the same images in the same way on the same canvas. */
export function sameStack(a: LayerStack, b: LayerStack): boolean {
    return (
        a.width === b.width &&
        a.height === b.height &&
        a.layers.length === b.layers.length &&
        a.layers.every((layer, index) => {
            const other = b.layers[index];
            return (
                layer.data === other.data &&
                layer.opacity === other.opacity &&
                layer.blend === other.blend
            );
        })
    );
}

/**
 * Writes the composite of a stack over `area`, which lies inside the canvas, into `out`
 * (canvas-sized RGBA8). With `clear`, the area is first set to transparent black: the
 * backdrop of the bottom layer. Without it the caller guarantees that it already is.
 */
export function blendStack(
    stack: LayerStack,
    area: Rect,
    out: Uint8ClampedArray,
    clear: boolean,
): void {
    const rowBytes = stack.width * 4;
    const areaBytes = area.width * 4;
    const first = area.y * rowBytes + area.x * 4;
    const end = first + area.height * rowBytes;
    if (clear) {
        for (let row = first; row < end; row += rowBytes) out.fill(0, row, row + areaBytes);
    }
    for (const { data, opacity, blend } of stack.layers) {
        for (let row = first; row < end; row += rowBytes) {
            blend(out, row, data, row, area.width, opacity);
        }
    }
}

/** The part of `rect` inside a `width` × `height` canvas, or null when there is none. */
function clipToCanvas(rect: Rect, width: number, height: number): Rect | null {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)) {
        throw new RangeError(
            `compositeFrame: \`rect\` must have integer coordinates, got ` +
                `${rect.x}, ${rect.y}, ${rect.width}, ${rect.height}.`,
        );
    }
    const x = Math.max(rect.x, 0);
    const y = Math.max(rect.y, 0);
    const right = Math.min(rect.x + rect.width, width);
    const bottom = Math.min(rect.y + rect.height, height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/**
 * The composite of one frame (SPEC §5.3): the visible pixel layers, bottom to top, each cel
 * blended with layer opacity × cel opacity by the layer's blend mode over a transparent
 * canvas. Straight-alpha RGBA8 with the document's dimensions; a pixel with alpha 0 is
 * always (0, 0, 0, 0). Hidden layers, empty cels and reference layers add nothing.
 *
 * The document is only read, and of it only `width`, `height`, `layers`, `frames`, `cels` and
 * `images`: to composite some of the layers, pass a copy of the document with those layers.
 *
 * With `rect`, only that area is composited: together with `into` this brings a composite up
 * to date after a change inside the rectangle, with the same bytes as a new composite of
 * the frame. Without `into` the rest of the new buffer stays transparent.
 *
 * The result remembers what it was composited from (`compositeOrigin`), which
 * `CompositeCache.adopt` checks.
 *
 * Throws `RangeError` when the document has no such frame, `rect` is not made of integers,
 * `into` or an override has other dimensions than the document, `into` is one of the images
 * being blended, or an override names no pixel layer or a layer named before.
 */
export function compositeFrame(
    doc: SpriteDoc,
    frameId: string,
    options: CompositeOptions = {},
): PixelBuffer {
    const { rect, into, overrides } = options;
    const stack = layerStack(doc, frameId, overrides);
    if (into) {
        const mismatch = sizeMismatch(into, doc);
        if (mismatch) throw new RangeError(`compositeFrame: \`into\` ${mismatch}`);
        if (stack.layers.some((layer) => layer.data.buffer === into.data.buffer)) {
            throw new RangeError("compositeFrame: `into` is an image of the frame.");
        }
    }
    const whole = { x: 0, y: 0, width: doc.width, height: doc.height };
    const area = rect ? clipToCanvas(rect, doc.width, doc.height) : whole;
    const target = into ?? createPixelBuffer(doc.width, doc.height);
    // A new buffer is transparent already.
    if (area) blendStack(stack, area, target.data, into !== undefined);
    recordOrigin(target, stack, area);
    return target;
}

/**
 * What each composite written by `compositeFrame` was composited from, by its pixel array.
 * Weak: a composite nobody holds any more takes its entry with it.
 */
const origins = new WeakMap<Uint8ClampedArray, LayerStack>();

/**
 * Keeps the origin of `target` after `stack` was blended over `area` of it. A composite of
 * the whole canvas has `stack` as its origin. A rectangle brought up to date from the stack
 * it already had keeps it; from another stack, part of the buffer is of one and part of the
 * other, and it has none. A rectangle of a new buffer is no composite of the frame.
 */
function recordOrigin(target: PixelBuffer, stack: LayerStack, area: Rect | null): void {
    if (!area) return;
    if (
        area.x === 0 &&
        area.y === 0 &&
        area.width === stack.width &&
        area.height === stack.height
    ) {
        origins.set(target.data, stack);
        return;
    }
    const origin = origins.get(target.data);
    if (origin && !sameStack(origin, stack)) origins.delete(target.data);
}

/**
 * The layer stack a buffer was composited from by `compositeFrame`, or null when it was not
 * (or not wholly) composited by it. Pixels written into the stack's images since are not
 * seen here: a caller that wrote them composites them again, as for `CompositeCache`.
 */
export function compositeOrigin(buffer: PixelBuffer): LayerStack | null {
    return origins.get(buffer.data) ?? null;
}
