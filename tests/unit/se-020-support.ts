import fc from "fast-check";
import { expect } from "vitest";
import { BLEND_FUNCTIONS, compositeFrame } from "../../src/core/composite";
import { History } from "../../src/core/history";
import type { Command, HistoryOptions, PixelAllocator } from "../../src/core/history";
import {
    addLayerCommand,
    deleteLayerCommand,
    duplicateLayerCommand,
    flattenCommand,
    mergeDownCommand,
    renameLayerCommand,
    reorderLayerCommand,
    setLayerBlendModeCommand,
    setLayerLockedCommand,
    setLayerOpacityCommand,
    setLayerVisibleCommand,
} from "../../src/core/layers";
import {
    assertInvariants,
    celAt,
    celKey,
    createDocument,
    sequentialIds,
} from "../../src/core/model";
import type {
    BlendMode,
    DocSession,
    IdGenerator,
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

/** The command a factory made; fails when the factory found nothing to change and made none. */
export function made(command: Command | null): Command {
    if (!command) throw new Error("made: the factory returned null, nothing would change");
    return command;
}

/** Executes a command a factory made (`made`). */
export function execute(target: History, command: Command | null): void {
    target.execute(made(command));
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

/**
 * The composite of every frame of the given layers alone, each taken as visible whatever its
 * `visible` flag, in playback order.
 */
export function compositesShown(doc: SpriteDoc, ids: readonly string[]): PixelBuffer[] {
    const layers = doc.layers.filter((entry) => ids.includes(entry.id));
    return composites({ ...doc, layers: layers.map((entry) => ({ ...entry, visible: true })) });
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

// --- random documents and random layer commands -------------------------------------------------

const MODES = Object.keys(BLEND_FUNCTIONS) as BlendMode[];
export const LAYER_KINDS = [
    "add",
    "delete",
    "duplicate",
    "rename",
    "reorder",
    "visible",
    "locked",
    "opacity",
    "blend",
    "mergeDown",
    "flatten",
] as const;

/** One cel of a random layer: which of the layer's images it shows, and how opaque. */
interface RandomCel {
    /** Cels of one layer with the same number are linked. */
    image: number;
    opacity: number;
}

interface RandomLayer {
    reference: boolean;
    visible: boolean;
    opacity: number;
    blend: BlendMode;
    /** One entry per frame; null is an empty cel. */
    cels: (RandomCel | null)[];
    /** Bytes of the layer's images; a cel shows the image at its number. */
    images: Uint8Array[];
}

export interface RandomDocument {
    width: number;
    height: number;
    layers: RandomLayer[];
    /** Picks the active layer. */
    active: number;
}

/** One layer command of a sequence; `layer` and `to` pick from the stack as it is then. */
export interface LayerStep {
    kind: (typeof LAYER_KINDS)[number];
    layer: number;
    to: number;
    flag: boolean;
    value: number;
    blend: BlendMode;
}

/** 255 and 0 often, since both take a path of their own in the compositor. */
const opacities = fc.oneof(
    { weight: 3, arbitrary: fc.constant(255) },
    { weight: 1, arbitrary: fc.constant(0) },
    { weight: 2, arbitrary: fc.nat({ max: 255 }) },
);

function layersOf(frames: number, bytes: number): fc.Arbitrary<RandomLayer> {
    return fc.record({
        reference: fc.oneof(
            { weight: 4, arbitrary: fc.constant(false) },
            { weight: 1, arbitrary: fc.constant(true) },
        ),
        visible: fc.oneof(
            { weight: 4, arbitrary: fc.constant(true) },
            { weight: 1, arbitrary: fc.constant(false) },
        ),
        opacity: opacities,
        blend: fc.constantFrom(...MODES),
        cels: fc.array(
            fc.option(fc.record({ image: fc.nat({ max: 1 }), opacity: opacities }), {
                nil: null,
                freq: 4,
            }),
            { minLength: frames, maxLength: frames },
        ),
        // Few byte values, so that equal pixels and equal results are common.
        images: fc.array(
            fc
                .uint8Array({ minLength: bytes, maxLength: bytes })
                .map((data) => data.map((byte) => [0, 90, 255][byte % 3])),
            { minLength: 2, maxLength: 2 },
        ),
    });
}

export const documents: fc.Arbitrary<RandomDocument> = fc
    .tuple(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 4 }),
    )
    .chain(([width, height, frames]) =>
        fc.record({
            width: fc.constant(width),
            height: fc.constant(height),
            layers: fc.array(layersOf(frames, width * height * 4), { minLength: 1, maxLength: 5 }),
            active: fc.nat({ max: 9 }),
        }),
    );

export const layerStep: fc.Arbitrary<LayerStep> = fc.record({
    kind: fc.constantFrom(...LAYER_KINDS),
    layer: fc.nat({ max: 9 }),
    to: fc.nat({ max: 9 }),
    flag: fc.boolean(),
    value: fc.nat({ max: 255 }),
    blend: fc.constantFrom(...MODES),
});

/** The session of a random document. Layer `layer-0` is always a pixel layer. */
export function sessionOf(random: RandomDocument): DocSession {
    const session = createDocument(
        { name: "random", width: random.width, height: random.height },
        sequentialIds("start-"),
    );
    const { doc } = session;
    const frames = random.layers[0].cels.length;
    doc.frames = Array.from({ length: frames }, (_, index) => ({
        id: `frame-${index}`,
        durationMs: 100,
    }));
    let references = 0;
    doc.layers = random.layers.map((spec, index) => {
        const id = `layer-${index}`;
        const { visible, opacity, blend } = spec;
        // The model allows four reference layers and needs one pixel layer.
        if (spec.reference && index > 0 && references < 4) {
            references++;
            return referenceLayer(id, { visible, opacity });
        }
        spec.cels.forEach((cel, frame) => {
            if (!cel) return;
            const imageId = `image-${index}-${cel.image}`;
            doc.images.set(imageId, {
                width: doc.width,
                height: doc.height,
                data: Uint8ClampedArray.from(spec.images[cel.image]),
            });
            doc.cels.set(celKey(id, doc.frames[frame].id), { imageId, opacity: cel.opacity });
        });
        return pixelLayer(id, { visible, opacity, blend });
    });
    session.activeLayerId = doc.layers[random.active % doc.layers.length].id;
    session.activeFrameId = doc.frames[0].id;
    assertInvariants(session);
    return session;
}

/**
 * The command of a step on the session as it is now; null when it would change nothing there.
 * Throws `LayerError` when it is refused.
 */
export function layerCommandOf(
    session: DocSession,
    step: LayerStep,
    newId: IdGenerator,
): Command | null {
    const { doc } = session;
    const id = doc.layers[step.layer % doc.layers.length].id;
    switch (step.kind) {
        case "add":
            return addLayerCommand(session, { newId });
        case "delete":
            return deleteLayerCommand(session, id);
        case "duplicate":
            return duplicateLayerCommand(session, id, { newId });
        case "rename":
            return renameLayerCommand(session, id, `name ${step.value}`);
        case "reorder":
            return reorderLayerCommand(session, id, step.to % doc.layers.length);
        case "visible":
            return setLayerVisibleCommand(session, id, step.flag);
        case "locked":
            return setLayerLockedCommand(session, id, step.flag);
        case "opacity":
            return setLayerOpacityCommand(session, id, step.value);
        case "blend":
            return setLayerBlendModeCommand(session, id, step.blend);
        case "mergeDown":
            return mergeDownCommand(session, id, { newId });
        case "flatten":
            return flattenCommand(session, { newId });
    }
}

/**
 * Whether a step asks for what the document has already, written out from the contract of
 * the factories: then, and only then, `layerCommandOf` gives null.
 */
export function asksForNothing(doc: SpriteDoc, step: LayerStep): boolean {
    const index = step.layer % doc.layers.length;
    const named = doc.layers[index];
    switch (step.kind) {
        case "rename":
            return named.name === `name ${step.value}`;
        case "reorder":
            return index === step.to % doc.layers.length;
        case "visible":
            return named.visible === step.flag;
        case "locked":
            return named.locked === step.flag;
        case "opacity":
            return named.opacity === step.value;
        case "blend":
            return named.kind === "pixel" && named.blend === step.blend;
        case "flatten": {
            const pixels = doc.layers.filter((entry) => entry.kind === "pixel");
            const [only] = pixels;
            return (
                pixels.length === 1 &&
                only.visible &&
                only.opacity === 255 &&
                only.blend === "normal" &&
                doc.frames.every((frame) => (celAt(doc, only.id, frame.id)?.opacity ?? 255) === 255)
            );
        }
        default:
            // Add, delete, duplicate and merge down always change the document.
            return false;
    }
}

export function pixelLayerIds(doc: SpriteDoc): string[] {
    return doc.layers.filter((layer) => layer.kind === "pixel").map((layer) => layer.id);
}

/** Every cel belongs to a pixel layer and a frame of the document. */
export function expectNoStrayCel(doc: SpriteDoc): void {
    const valid = new Set(
        pixelLayerIds(doc).flatMap((layerId) =>
            doc.frames.map((frame) => celKey(layerId, frame.id)),
        ),
    );
    expect([...doc.cels.keys()].filter((key) => !valid.has(key))).toEqual([]);
}
