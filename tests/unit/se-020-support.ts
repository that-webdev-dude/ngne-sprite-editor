import { expect } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { History } from "../../src/core/history";
import type { Command, HistoryOptions, PixelAllocator } from "../../src/core/history";
import { assertInvariants, celAt, celKey, createDocument } from "../../src/core/model";
import type {
    DocSession,
    Layer,
    PixelBuffer,
    PixelLayer,
    ReferenceLayer,
    SpriteDoc,
} from "../../src/core/model";

// Shared by the SE-020 tests: the 3-layer, 4-frame fixture with linked cels of the ticket's
// acceptance, and the helpers that run a command. `execute`, `undo` and `redo` call
// `assertInvariants` after the step they perform, so every step made through them is checked.

export const WIDTH = 3;
export const HEIGHT = 2;
/** Bytes of one image of the fixture. */
export const IMAGE_BYTES = WIDTH * HEIGHT * 4;

/** The layers of the fixture, bottom to top. */
export const A = "layer-a";
export const B = "layer-b";
export const C = "layer-c";
/** The frames of the fixture, in playback order. */
export const FRAMES = ["frame-1", "frame-2", "frame-3", "frame-4"] as const;
const [F1, F2, F3, F4] = FRAMES;

/**
 * Six pixels that differ with `seed`, with every kind of alpha among them: opaque, partial
 * and transparent. The transparent ones keep a colour, which only a byte-exact copy keeps.
 */
export function pixels(seed: number): Uint8ClampedArray {
    const alphas = [255, 128, 0, 64, 255, 200];
    const data = new Uint8ClampedArray(IMAGE_BYTES);
    for (let index = 0; index < WIDTH * HEIGHT; index++) {
        const red = (seed * 37 + index * 11) % 256;
        const green = (seed * 59 + index * 23) % 256;
        const blue = (seed * 83 + index * 5) % 256;
        data.set([red, green, blue, alphas[(index + seed) % alphas.length]], index * 4);
    }
    return data;
}

export function pixelLayer(id: string, properties: Partial<PixelLayer> = {}): PixelLayer {
    return {
        id,
        name: id,
        kind: "pixel",
        visible: true,
        locked: false,
        opacity: 255,
        blend: "normal",
        ...properties,
    };
}

export function referenceLayer(
    id: string,
    properties: Partial<ReferenceLayer> = {},
): ReferenceLayer {
    return {
        id,
        name: id,
        kind: "reference",
        visible: true,
        locked: false,
        opacity: 128,
        sourceId: `source-of-${id}`,
        x: 0,
        y: 0,
        scale: 1,
        placement: "behind",
        ...properties,
    };
}

/** Gives a cel an image of its own with the pixels of `seed`. */
export function addCel(
    doc: SpriteDoc,
    layerId: string,
    frameId: string,
    imageId: string,
    seed: number,
    opacity = 255,
): void {
    doc.images.set(imageId, { width: doc.width, height: doc.height, data: pixels(seed) });
    doc.cels.set(celKey(layerId, frameId), { imageId, opacity });
}

/** Makes the cel at (layerId, frameId) a linked cel of an existing image. */
export function linkCel(
    doc: SpriteDoc,
    layerId: string,
    frameId: string,
    imageId: string,
    opacity = 255,
): void {
    doc.cels.set(celKey(layerId, frameId), { imageId, opacity });
}

/** A 3×2 session with one pixel layer per ID, bottom to top, the frames `FRAMES` and no cel. */
export function emptySession(layerIds: readonly string[]): DocSession {
    const ids = ["doc", "unused", "unused"];
    const session = createDocument({ name: "fixture", width: WIDTH, height: HEIGHT }, () => {
        const id = ids.shift();
        if (id === undefined) throw new Error("emptySession: unexpected ID request");
        return id;
    });
    session.doc.layers = layerIds.map((id) => pixelLayer(id));
    session.doc.frames = FRAMES.map((id) => ({ id, durationMs: 100 }));
    session.activeLayerId = layerIds[0];
    session.activeFrameId = F1;
    return session;
}

/**
 * The fixture of the acceptance: three pixel layers, four frames, linked cels. A cell names
 * the image of its cel; cels with the same image are linked.
 *
 *              frame-1    frame-2    frame-3    frame-4
 *     layer-c  c1 (200)   c1         c1         —
 *     layer-b  b1         b2         b2         b4         layer opacity 128
 *     layer-a  a1         a1         a3         —
 *
 * `(200)` is a cel opacity; every other cel has 255. The active layer is `layer-b` and the
 * active frame `frame-2`. A tag spans frames 2 and 3. No layer command changes frames, tags
 * or the selection, which the comparisons of whole sessions prove.
 */
export function fixture(): DocSession {
    const session = emptySession([A, B, C]);
    const { doc } = session;
    doc.layers[1].opacity = 128;
    addCel(doc, A, F1, "a1", 1);
    linkCel(doc, A, F2, "a1");
    addCel(doc, A, F3, "a3", 3);
    addCel(doc, B, F1, "b1", 4);
    addCel(doc, B, F2, "b2", 5);
    linkCel(doc, B, F3, "b2");
    addCel(doc, B, F4, "b4", 7);
    addCel(doc, C, F1, "c1", 8, 200);
    linkCel(doc, C, F2, "c1");
    linkCel(doc, C, F3, "c1");
    doc.tags.push({
        id: "tag-1",
        name: "walk",
        color: 0xff0000ff,
        fromFrameId: F2,
        toFrameId: F3,
        direction: "forward",
        repeat: 0,
    });
    session.activeLayerId = B;
    session.activeFrameId = F2;
    assertInvariants(session);
    return session;
}

/**
 * Everything of a session, copied. The maps are copied as lists of entries, so that two
 * states are equal only when their cels and images are also in the same order.
 */
export function stateOf(session: DocSession) {
    const { doc } = session;
    return structuredClone({
        ...session,
        doc: { ...doc, cels: [...doc.cels], images: [...doc.images] },
    });
}

export type SessionState = ReturnType<typeof stateOf>;

export function history(session: DocSession, options?: HistoryOptions): History {
    return new History(session, options);
}

export function execute(target: History, command: Command): void {
    target.execute(command);
    assertInvariants(target.session);
}

export function undo(target: History): void {
    expect(target.undo()).toBe(true);
    assertInvariants(target.session);
}

export function redo(target: History): void {
    expect(target.redo()).toBe(true);
    assertInvariants(target.session);
}

/** The error `run` throws; fails when it throws nothing. */
export function thrownBy(run: () => unknown): unknown {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error("nothing was thrown");
}

/** IDs of the layers, bottom to top. */
export function layerIds(doc: SpriteDoc): string[] {
    return doc.layers.map((layer) => layer.id);
}

export function layer(doc: SpriteDoc, id: string): Layer {
    const found = doc.layers.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`layer: the document has no layer "${id}"`);
    return found;
}

/** The image IDs of a layer's cels, frame by frame; null for an empty cel. */
export function imageIdsOf(doc: SpriteDoc, layerId: string): (string | null)[] {
    return doc.frames.map((frame) => celAt(doc, layerId, frame.id)?.imageId ?? null);
}

/** The bytes of the image of a cel; throws when that cel is empty. */
export function celBytes(doc: SpriteDoc, layerId: string, frameId: string): Uint8ClampedArray {
    const image = doc.images.get(celAt(doc, layerId, frameId)?.imageId ?? "");
    if (!image) throw new Error(`celBytes: layer "${layerId}" has no cel at "${frameId}"`);
    return image.data;
}

/** The composite of every frame of the document, in playback order. */
export function composites(doc: SpriteDoc): PixelBuffer[] {
    return doc.frames.map((frame) => compositeFrame(doc, frame.id));
}

/** The composite of every frame of the given layers alone, in playback order. */
export function compositesOf(doc: SpriteDoc, ids: readonly string[]): PixelBuffer[] {
    return composites({ ...doc, layers: doc.layers.filter((entry) => ids.includes(entry.id)) });
}

/** What the platform throws when it cannot allocate a typed array. */
function outOfMemory(): never {
    throw new RangeError("Array buffer allocation failed");
}

/**
 * An allocator that works `successes` times and fails from then on, until `heal()` is
 * called. `calls` counts every request.
 */
export function flakyAllocator(successes: number): {
    allocate: PixelAllocator;
    heal(): void;
    readonly calls: number;
} {
    let calls = 0;
    let healed = false;
    return {
        allocate(byteLength) {
            calls++;
            if (!healed && calls > successes) outOfMemory();
            return new Uint8ClampedArray(byteLength);
        },
        heal() {
            healed = true;
        },
        get calls() {
            return calls;
        },
    };
}
