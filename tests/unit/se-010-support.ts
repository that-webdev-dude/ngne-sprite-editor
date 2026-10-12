import fc from "fast-check";
import { assertInvariants, celAt, celKey, createDocument } from "../../src/core/model";
import type {
    BlendMode,
    PixelBuffer,
    PixelLayer,
    ReferenceLayer,
    SpriteDoc,
} from "../../src/core/model";

// Shared by the SE-010 tests: small documents written pixel by pixel, random documents, and
// a second implementation of the compositor's formulas to compare against.

/** The frame every fixture starts with. */
export const FRAME = "frame-0";

/** One pixel: red, green, blue, alpha. */
export type Rgba = readonly [number, number, number, number];

export interface LayerSpec {
    /** Pixels of the layer's cel at `FRAME`, row-major. Without them the cel is empty. */
    pixels?: readonly Rgba[] | Uint8ClampedArray;
    /** Layer opacity; the default is 255. */
    opacity?: number;
    /** Opacity of the cel at `FRAME`; the default is 255. */
    celOpacity?: number;
    /** The default is true. */
    visible?: boolean;
    /** The default is "normal". */
    blend?: BlendMode;
}

/** ID of the layer at `index` from the bottom of a `sprite`. */
export function layerId(index: number): string {
    return `layer-${index}`;
}

/** A `width` × `height` image of the given pixels, row-major. */
export function imageOf(
    width: number,
    height: number,
    pixels: readonly Rgba[] | Uint8ClampedArray,
): PixelBuffer {
    const data =
        pixels instanceof Uint8ClampedArray
            ? pixels.slice()
            : Uint8ClampedArray.from(pixels.flat());
    if (data.length !== width * height * 4) {
        throw new Error(`imageOf: ${data.length} bytes do not fill ${width}×${height} pixels`);
    }
    return { width, height, data };
}

/** Throws unless the document satisfies the invariants of SPEC §5.1. */
export function assertDocument(doc: SpriteDoc): void {
    assertInvariants({
        doc,
        selection: null,
        activeLayerId: doc.layers[0].id,
        activeFrameId: doc.frames[0].id,
    });
}

/**
 * Gives the layer a cel at the frame with an image of its own (`image-<layer>-<frame>`),
 * replacing the cel it had there.
 */
export function setCel(
    doc: SpriteDoc,
    layer: string,
    frame: string,
    pixels: readonly Rgba[] | Uint8ClampedArray,
    opacity = 255,
): PixelBuffer {
    const image = imageOf(doc.width, doc.height, pixels);
    const imageId = `image-${layer}-${frame}`;
    doc.images.set(imageId, image);
    doc.cels.set(celKey(layer, frame), { imageId, opacity });
    return image;
}

/** The image of the layer's cel at the frame; throws when that cel is empty. */
export function celImage(doc: SpriteDoc, layer: string, frame: string): PixelBuffer {
    const image = doc.images.get(celAt(doc, layer, frame)?.imageId ?? "");
    if (!image) throw new Error(`celImage: layer "${layer}" has no cel at frame "${frame}"`);
    return image;
}

export function addFrame(doc: SpriteDoc, id: string): void {
    doc.frames.push({ id, durationMs: 100 });
}

/**
 * A document with the frame `FRAME` and the given pixel layers, bottom first, named
 * `layer-0`, `layer-1`, … Each layer with `pixels` has a cel at `FRAME`.
 */
export function sprite(width: number, height: number, layers: readonly LayerSpec[]): SpriteDoc {
    const ids = ["doc", "unused", FRAME];
    const { doc } = createDocument({ name: "fixture", width, height }, () => {
        const id = ids.shift();
        if (id === undefined) throw new Error("sprite: unexpected ID request");
        return id;
    });
    doc.layers = layers.map((spec, index): PixelLayer => ({
        id: layerId(index),
        name: `Layer ${index}`,
        kind: "pixel",
        visible: spec.visible ?? true,
        locked: false,
        opacity: spec.opacity ?? 255,
        blend: spec.blend ?? "normal",
    }));
    layers.forEach((spec, index) => {
        if (spec.pixels) setCel(doc, layerId(index), FRAME, spec.pixels, spec.celOpacity);
    });
    assertDocument(doc);
    return doc;
}

/** A visible reference layer covering the canvas. */
export function referenceLayer(id: string, placement: "behind" | "front"): ReferenceLayer {
    return {
        id,
        name: id,
        kind: "reference",
        visible: true,
        locked: false,
        opacity: 255,
        sourceId: `source-of-${id}`,
        x: 0,
        y: 0,
        scale: 1,
        placement,
    };
}

/** The pixels of a buffer, row-major. */
export function pixelsOf(buffer: PixelBuffer): number[][] {
    const pixels: number[][] = [];
    for (let at = 0; at < buffer.data.length; at += 4) {
        pixels.push(Array.from(buffer.data.subarray(at, at + 4)));
    }
    return pixels;
}

/** Describes the first pixel in which two buffers differ, or null when they are byte-equal. */
export function firstDifference(actual: PixelBuffer, expected: PixelBuffer): string | null {
    if (actual.width !== expected.width || actual.height !== expected.height) {
        return `${actual.width}×${actual.height}, expected ${expected.width}×${expected.height}`;
    }
    if (actual.data.length !== expected.data.length) {
        return `${actual.data.length} bytes, expected ${expected.data.length}`;
    }
    for (let at = 0; at < expected.data.length; at += 4) {
        const found = actual.data.subarray(at, at + 4).join();
        const wanted = expected.data.subarray(at, at + 4).join();
        if (found !== wanted) {
            const index = at / 4;
            const x = index % expected.width;
            return `pixel (${x}, ${(index - x) / expected.width}) is ${found}, expected ${wanted}`;
        }
    }
    return null;
}

// --- reference implementation ------------------------------------------------------------------

/** `a * b / 255` rounded to the nearest integer. No product of two bytes is a tie. */
function scaled(a: number, b: number): number {
    return Math.round((a * b) / 255);
}

/**
 * The normal blend of one pixel, written from the three rules in `core/composite/blend.ts`
 * with floating-point rounding and no shortcut.
 */
export function referencePixel(backdrop: number[], source: number[], opacity: number): number[] {
    const alpha = scaled(source[3], opacity);
    if (alpha === 0) return backdrop;
    if (backdrop[3] === 0) return [source[0], source[1], source[2], alpha];
    const resultAlpha = alpha + backdrop[3] - scaled(backdrop[3], alpha);
    const channel = (below: number, above: number) =>
        below + Math.trunc(((above - below) * alpha) / resultAlpha);
    return [
        channel(backdrop[0], source[0]),
        channel(backdrop[1], source[1]),
        channel(backdrop[2], source[2]),
        resultAlpha,
    ];
}

/** The composite of a frame, one pixel at a time through `referencePixel`. */
export function referenceComposite(doc: SpriteDoc, frame: string): PixelBuffer {
    const result = imageOf(
        doc.width,
        doc.height,
        new Uint8ClampedArray(doc.width * doc.height * 4),
    );
    for (let at = 0; at < result.data.length; at += 4) {
        let pixel = [0, 0, 0, 0];
        for (const layer of doc.layers) {
            if (layer.kind !== "pixel" || !layer.visible) continue;
            const cel = celAt(doc, layer.id, frame);
            const image = cel && doc.images.get(cel.imageId);
            if (!cel || !image) continue;
            const source = Array.from(image.data.subarray(at, at + 4));
            pixel = referencePixel(pixel, source, scaled(layer.opacity, cel.opacity));
        }
        result.data.set(pixel, at);
    }
    return result;
}

// --- random documents --------------------------------------------------------------------------

export interface RandomSprite {
    width: number;
    height: number;
    layers: LayerSpec[];
}

/** 255 and 0 often, since both take a path of their own, and every value in between. */
const opacities = fc.oneof(
    { weight: 3, arbitrary: fc.constant(255) },
    { weight: 1, arbitrary: fc.constant(0) },
    { weight: 3, arbitrary: fc.nat({ max: 255 }) },
);

/** Image bytes with any colour; alpha is 0, 255 or any value, a third of the pixels each. */
export function imageBytes(pixels: number): fc.Arbitrary<Uint8ClampedArray> {
    return fc
        .tuple(
            fc.uint8Array({ minLength: pixels * 4, maxLength: pixels * 4 }),
            fc.array(fc.constantFrom("transparent", "opaque", "any"), {
                minLength: pixels,
                maxLength: pixels,
            }),
        )
        .map(([bytes, alphas]) => {
            const data = Uint8ClampedArray.from(bytes);
            alphas.forEach((alpha, index) => {
                if (alpha !== "any") data[index * 4 + 3] = alpha === "opaque" ? 255 : 0;
            });
            return data;
        });
}

/**
 * Documents of 1×1 to 12×12 pixels with one to five pixel layers: some hidden, some with an
 * empty cel, with any layer and cel opacity.
 */
export const sprites: fc.Arbitrary<RandomSprite> = fc
    .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }))
    .chain(([width, height]) =>
        fc.record({
            width: fc.constant(width),
            height: fc.constant(height),
            layers: fc.array(
                fc.record({
                    pixels: fc.option(imageBytes(width * height), { nil: undefined, freq: 6 }),
                    opacity: opacities,
                    celOpacity: opacities,
                    visible: fc.oneof(
                        { weight: 5, arbitrary: fc.constant(true) },
                        { weight: 1, arbitrary: fc.constant(false) },
                    ),
                }),
                { minLength: 1, maxLength: 5 },
            ),
        }),
    );
