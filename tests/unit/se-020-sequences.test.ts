import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BLEND_FUNCTIONS } from "../../src/core/composite";
import { History } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import {
    addLayerCommand,
    deleteLayerCommand,
    duplicateLayerCommand,
    flattenCommand,
    LayerError,
    mergeDownCommand,
    mergeDownTarget,
    renameLayerCommand,
    reorderLayerCommand,
    setLayerBlendModeCommand,
    setLayerLockedCommand,
    setLayerOpacityCommand,
    setLayerVisibleCommand,
} from "../../src/core/layers";
import {
    assertInvariants,
    celKey,
    createDocument,
    pixelMemoryBytes,
    sequentialIds,
} from "../../src/core/model";
import type { BlendMode, DocSession, IdGenerator, SpriteDoc } from "../../src/core/model";
import { composites, compositesOf, pixelLayer, referenceLayer, stateOf } from "./se-020-support";
import type { SessionState } from "./se-020-support";

// Random sequences of layer commands on random documents: pixel and reference layers in any
// order, hidden layers, any opacity, linked cels. Every step is checked against the
// invariants and the rules of its command; then the whole history is undone and redone.

const MODES = Object.keys(BLEND_FUNCTIONS) as BlendMode[];
const KINDS = [
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

interface RandomDocument {
    width: number;
    height: number;
    layers: RandomLayer[];
    /** Picks the active layer. */
    active: number;
}

/** One command of a sequence; `layer` and `to` pick from the stack as it is then. */
interface Step {
    kind: (typeof KINDS)[number];
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

const documents: fc.Arbitrary<RandomDocument> = fc
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

const steps: fc.Arbitrary<Step[]> = fc.array(
    fc.record({
        kind: fc.constantFrom(...KINDS),
        layer: fc.nat({ max: 9 }),
        to: fc.nat({ max: 9 }),
        flag: fc.boolean(),
        value: fc.nat({ max: 255 }),
        blend: fc.constantFrom(...MODES),
    }),
    { minLength: 1, maxLength: 12 },
);

/** The session of a random document. Layer `layer-0` is always a pixel layer. */
function sessionOf(random: RandomDocument): DocSession {
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

/** The command of a step on the session as it is now. Throws `LayerError` when it is refused. */
function commandOf(session: DocSession, step: Step, newId: IdGenerator): Command {
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

function pixelLayerIds(doc: SpriteDoc): string[] {
    return doc.layers.filter((layer) => layer.kind === "pixel").map((layer) => layer.id);
}

/** Every cel belongs to a pixel layer and a frame of the document. */
function expectNoStrayCel(doc: SpriteDoc): void {
    const valid = new Set(
        pixelLayerIds(doc).flatMap((layerId) =>
            doc.frames.map((frame) => celKey(layerId, frame.id)),
        ),
    );
    expect([...doc.cels.keys()].filter((key) => !valid.has(key))).toEqual([]);
}

describe("layer commands, property", () => {
    it("for 300 random sequences, every step keeps the invariants and its own rule, and undo all then redo all reproduces every state exactly", () => {
        let runs = 0;
        const executed = new Map<string, number>();
        const refused = new Map<string, number>();
        const count = (counts: Map<string, number>, kind: string) =>
            counts.set(kind, (counts.get(kind) ?? 0) + 1);

        fc.assert(
            fc.property(documents, steps, (random, sequence) => {
                runs++;
                const session = sessionOf(random);
                const { doc } = session;
                const history = new History(session);
                const newId = sequentialIds("new-");
                const states: SessionState[] = [stateOf(session)];
                let retained = 0;

                for (const step of sequence) {
                    const before = stateOf(session);
                    const shown = composites(doc);
                    const references = doc.layers.filter((layer) => layer.kind === "reference");
                    const id = doc.layers[step.layer % doc.layers.length].id;
                    const below = mergeDownTarget(doc, id);
                    const pair = below ? compositesOf(doc, [below.id, id]) : [];
                    const pixelMemory = pixelMemoryBytes(doc);

                    let command: Command;
                    try {
                        command = commandOf(session, step, newId);
                    } catch (error) {
                        // A refused request changes nothing.
                        expect(error).toBeInstanceOf(LayerError);
                        expect(stateOf(session)).toStrictEqual(before);
                        count(refused, step.kind);
                        continue;
                    }
                    expect(stateOf(session)).toStrictEqual(before);
                    history.execute(command);
                    count(executed, step.kind);
                    retained += command.bytes;

                    assertInvariants(session);
                    expectNoStrayCel(doc);
                    expect(history.bytes).toBe(retained);
                    // What a command removes from the document is what it retains.
                    if (step.kind === "delete") {
                        expect(pixelMemory - pixelMemoryBytes(doc)).toBe(command.bytes);
                    }
                    // Only a delete of that very layer takes a reference layer away, and none is added.
                    const kept = references.filter(
                        (layer) => !(step.kind === "delete" && layer.id === id),
                    );
                    for (const layer of kept) expect(doc.layers).toContain(layer);
                    expect(doc.layers.filter((layer) => layer.kind === "reference")).toHaveLength(
                        kept.length,
                    );
                    if (step.kind === "mergeDown" && below) {
                        expect(compositesOf(doc, [below.id])).toStrictEqual(pair);
                        expect(doc.layers.some((layer) => layer.id === id)).toBe(false);
                    }
                    if (step.kind === "flatten") {
                        expect(pixelLayerIds(doc)).toHaveLength(1);
                        expect(composites(doc)).toStrictEqual(shown);
                        expect(session.activeLayerId).toBe(pixelLayerIds(doc)[0]);
                    }
                    if (step.kind === "add" || step.kind === "duplicate") {
                        expect(before.doc.layers.map((layer) => layer.id)).not.toContain(
                            session.activeLayerId,
                        );
                    }
                    states.push(stateOf(session));
                }

                const done = states.length - 1;
                expect(history.undoCount).toBe(done);
                for (let index = done - 1; index >= 0; index--) {
                    expect(history.undo()).toBe(true);
                    assertInvariants(session);
                    expect(stateOf(session)).toStrictEqual(states[index]);
                }
                expect(history.undo()).toBe(false);
                for (let index = 1; index <= done; index++) {
                    expect(history.redo()).toBe(true);
                    assertInvariants(session);
                    expect(stateOf(session)).toStrictEqual(states[index]);
                }
                expect(history.redo()).toBe(false);
            }),
            { numRuns: 300 },
        );

        expect(runs).toBe(300);
        // Every command ran, and every command that has a guard was refused at least once.
        expect([...executed.keys()].sort()).toEqual([...KINDS].sort());
        for (const kind of ["delete", "duplicate", "blend", "mergeDown"]) {
            expect(refused.get(kind) ?? 0, kind).toBeGreaterThan(0);
        }
    });
});
