import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    CelTargetError,
    copyCelsCommand,
    linkCelsCommand,
    setCelOpacityCommand,
    unlinkCelsCommand,
} from "../../src/core/cels";
import { deleteFramesCommand, duplicateFramesCommand, LastFrameError } from "../../src/core/frames";
import { History, pixelPatchCommand } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import { LayerError } from "../../src/core/layers";
import { assertInvariants, layerIndex, sequentialIds } from "../../src/core/model";
import type { DocSession, IdGenerator } from "../../src/core/model";
import {
    documents,
    expectNoStrayCel,
    LAYER_KINDS,
    layerCommandOf,
    layerStep,
    sessionOf,
    stateOf,
} from "./se-020-support";
import type { LayerStep, RandomDocument } from "./se-020-support";

// Random sequences that mix layer commands with everything that makes images again when it
// is redone (strokes on empty cels, the frame and cel commands of SE-021) and with pixel
// patches, and that walk the history in between: some steps back, some forward, all the way
// back and forward. Whenever the history arrives at a place, the session is compared with
// the state it had there the first time: every cel, every byte, the order of the maps.
//
// The steps lean towards what a session at work looks like, which is also what finds a
// command that restores a buffer of an earlier do: strokes go to the active layer, patches
// to the newest images, and half of the layer commands name the active layer.

/** The layer commands that change the stack; the others set one property of a layer. */
const STACK_KINDS = ["add", "delete", "duplicate", "reorder", "mergeDown", "flatten"];
/** Those of them that remove cels, and with the cels images. */
const REMOVING_KINDS = ["delete", "mergeDown", "flatten"] as const;
const OTHER_KINDS = [
    "patch",
    "stroke",
    "duplicateFrames",
    "deleteFrames",
    "copyCels",
    "unlinkCels",
    "linkCels",
    "celOpacity",
] as const;
const WALK_KINDS = ["undo", "redo", "undoAll", "redoAll"] as const;

/** A step that is not a layer command; the numbers pick from the document as it is then. */
interface OtherStep {
    /** `activate` switches the active layer and frame, which makes no history entry. */
    kind: (typeof OTHER_KINDS)[number] | (typeof WALK_KINDS)[number] | "activate";
    n: number[];
}

type Step = LayerStep | OtherStep;

/** A layer step; one in three is a command that removes cels and their images. */
const leaningLayerStep: fc.Arbitrary<LayerStep> = fc
    .tuple(layerStep, fc.nat({ max: 8 }))
    .map(([step, lean]) =>
        lean < REMOVING_KINDS.length ? { ...step, kind: REMOVING_KINDS[lean] } : step,
    );

const numbers = fc.array(fc.nat({ max: 999 }), { minLength: 5, maxLength: 5 });

function otherSteps(kinds: readonly OtherStep["kind"][]): fc.Arbitrary<OtherStep> {
    return fc.record({ kind: fc.constantFrom(...kinds), n: numbers });
}

/** Sequences of steps; with `switching`, a step in six switches the active layer and frame. */
function sequences(switching: boolean): fc.Arbitrary<Step[]> {
    const kinds: fc.WeightedArbitrary<Step>[] = [
        { weight: 5, arbitrary: leaningLayerStep },
        { weight: 6, arbitrary: otherSteps(OTHER_KINDS) },
        { weight: 3, arbitrary: otherSteps(WALK_KINDS) },
    ];
    if (switching) kinds.push({ weight: 3, arbitrary: otherSteps(["activate"]) });
    return fc.array(fc.oneof(...kinds), { minLength: 8, maxLength: 30 });
}

function isLayerStep(step: Step): step is LayerStep {
    return (LAYER_KINDS as readonly string[]).includes(step.kind);
}

/** Most frames a random document grows to. */
const MAX_FRAMES = 6;

/**
 * The command of a step that is neither a layer command nor a walk, on the session as it is
 * now; null when it would change nothing there. Throws the error of its module when the
 * request is refused.
 */
function otherCommandOf(session: DocSession, step: OtherStep, newId: IdGenerator): Command | null {
    const { doc } = session;
    const [a, b, c, d, e] = step.n;
    const frame = (pick: number) => doc.frames[pick % doc.frames.length].id;
    const layer = (pick: number) => doc.layers[pick % doc.layers.length].id;
    const everyLayer = doc.layers.map((entry) => entry.id);
    switch (step.kind) {
        case "patch": {
            const images = [...doc.images.keys()];
            if (images.length === 0) return null;
            // Two times in three one of the two newest images.
            const newest = images.length - 1 - (a % Math.min(2, images.length));
            const x = b % doc.width;
            const y = c % doc.height;
            const width = 1 + (d % (doc.width - x));
            const height = 1 + (e % (doc.height - y));
            const data = Uint8ClampedArray.from({ length: width * height * 4 }, (_, index) =>
                index % 4 === 3 ? [255, 128, 0][(a + index) % 3] : (a * 7 + index * 13) % 256,
            );
            return pixelPatchCommand(doc, {
                label: "Patch",
                imageId: images[e % 3 === 0 ? a % images.length : newest],
                x,
                y,
                pixels: { width, height, data },
            });
        }
        case "duplicateFrames":
            if (doc.frames.length >= MAX_FRAMES) return null;
            return duplicateFramesCommand(doc, [frame(a), frame(b)], newId);
        case "deleteFrames":
            return deleteFramesCommand(doc, [frame(a)]);
        case "copyCels":
            // One step down, none or one step up among the pixel layers (an offset counts
            // those only), and one frame back, none or one frame on.
            return copyCelsCommand(
                doc,
                { layerIds: [layer(a)], frameIds: [frame(b)] },
                { layers: (c % 3) - 1, frames: (d % 3) - 1 },
                newId,
            );
        case "unlinkCels":
            return unlinkCelsCommand(doc, { layerIds: everyLayer, frameIds: [frame(a)] }, newId);
        case "linkCels":
            return linkCelsCommand(doc, { layerIds: [layer(a)], frameIds: [frame(b), frame(c)] });
        case "celOpacity":
            return setCelOpacityCommand(
                doc,
                { layerIds: [layer(a)], frameIds: [frame(b)] },
                c % 256,
            );
        default:
            throw new Error(`otherCommandOf: "${step.kind}" is not a command`);
    }
}

/**
 * A history with the state of its session at every place it has been, to compare against.
 * With `switching` the active layer and frame change outside the history, so a place has one
 * document but not one session: the documents are compared, and the active layer is checked
 * against the rule that the undo of a stack command returns to the layer its do found.
 */
class Walker {
    readonly session: DocSession;
    readonly history: History;
    readonly switching: boolean;
    /** `states[at]` is the state with `at` commands done. */
    readonly states: unknown[];
    /** `kinds[at]` is the kind of the command that leads to the place `at`. */
    readonly kinds: string[] = [""];
    /** `found[at]` is the active layer the command that leads to `at` found at its last do. */
    readonly found: string[] = [""];
    at = 0;
    /** Places arrived at by an undo or a redo, each compared with its state. */
    arrivals = 0;
    /** Redos of a stack command: each ran on a document that was put together again. */
    stackRedos = 0;

    constructor(session: DocSession, switching: boolean) {
        this.session = session;
        this.history = new History(session);
        this.switching = switching;
        this.states = [this.#state()];
    }

    /**
     * Records the command the history has just taken, which found `activeLayerId` active:
     * the places after it are gone.
     */
    record(kind: string, activeLayerId: string): void {
        assertInvariants(this.session);
        expectNoStrayCel(this.session.doc);
        this.at++;
        this.states.length = this.kinds.length = this.found.length = this.at;
        this.states.push(this.#state());
        this.kinds.push(kind);
        this.found.push(activeLayerId);
        expect(this.history.undoCount).toBe(this.at);
        expect(this.history.redoCount).toBe(0);
    }

    /** One step back; false at the start of the history. */
    undo = (): boolean => {
        if (this.at === 0) {
            expect(this.history.undo()).toBe(false);
            return false;
        }
        const from = this.at;
        expect(this.history.undo()).toBe(true);
        this.#arrive(from - 1, "undo");
        if (STACK_KINDS.includes(this.kinds[from])) {
            expect(this.session.activeLayerId, `undo to ${this.at}`).toBe(this.found[from]);
        }
        return true;
    };

    /** One step forward; false at the end of the history. */
    redo = (): boolean => {
        if (this.at === this.states.length - 1) {
            expect(this.history.redo()).toBe(false);
            return false;
        }
        this.found[this.at + 1] = this.session.activeLayerId;
        expect(this.history.redo()).toBe(true);
        this.#arrive(this.at + 1, "redo");
        if (STACK_KINDS.includes(this.kinds[this.at])) this.stackRedos++;
        return true;
    };

    /** Repeats a step of a walk until the history is at its start or its end. */
    toTheEnd(move: () => boolean): void {
        let moved = true;
        while (moved) moved = move();
    }

    #state(): unknown {
        const state = stateOf(this.session);
        return this.switching ? state.doc : state;
    }

    #arrive(at: number, by: string): void {
        this.at = at;
        this.arrivals++;
        assertInvariants(this.session);
        expect(this.#state(), `${by} to ${at}`).toStrictEqual(this.states[at]);
    }
}

/**
 * Two strokes of one pixel on a cel of a pixel layer, the active layer two times in three.
 * On an empty cel the first stroke creates the cel and its image, and its command creates
 * both again on every redo; the second stroke is then a patch of that image.
 */
function stroke(walker: Walker, step: OtherStep, newId: IdGenerator): void {
    const { session, history } = walker;
    const { doc } = session;
    const [a, b, c] = step.n;
    const pixels = doc.layers.filter((layer) => layer.kind === "pixel").map((layer) => layer.id);
    const active = pixels.includes(session.activeLayerId) && a % 3 !== 0;
    const cel = {
        layerId: active ? session.activeLayerId : pixels[a % pixels.length],
        frameId: doc.frames[b % doc.frames.length].id,
    };
    for (const shade of [c, c + 101]) {
        const transaction = history.begin(cel, newId);
        const colour = [shade % 256, (shade * 3) % 256, (shade * 7) % 256, 255];
        const unchanged = colour.every((value, index) => transaction.image.data[index] === value);
        transaction.image.data.set(colour);
        transaction.markDirty({ x: 0, y: 0, width: 1, height: 1 });
        const command = transaction.commit("Stroke");
        // A stroke that changes nothing records nothing (SPEC §7.1): two shades can share a
        // colour (332 and 1100), and the walks that follow find any entry it left.
        if (unchanged) {
            expect(command).toBeNull();
            continue;
        }
        expect(command).not.toBeNull();
        walker.record(step.kind, session.activeLayerId);
    }
}

/**
 * Plays a sequence on a random document, then walks the whole history back and forward
 * twice. `executed` counts the commands by kind. Returns the walker for its counters.
 */
function play(
    random: RandomDocument,
    sequence: Step[],
    executed: Map<string, number>,
    switching = false,
): Walker {
    const session = sessionOf(random);
    const { doc } = session;
    const walker = new Walker(session, switching);
    const newId = sequentialIds("new-");
    const count = (kind: string) => executed.set(kind, (executed.get(kind) ?? 0) + 1);

    for (const step of sequence) {
        if (step.kind === "undo" || step.kind === "redo") {
            const move = step.kind === "undo" ? walker.undo : walker.redo;
            for (let times = 1 + (step.n[0] % 3); times > 0; times--) move();
            continue;
        }
        if (step.kind === "undoAll" || step.kind === "redoAll") {
            walker.toTheEnd(step.kind === "undoAll" ? walker.undo : walker.redo);
            continue;
        }
        if (step.kind === "activate") {
            session.activeLayerId = doc.layers[step.n[0] % doc.layers.length].id;
            session.activeFrameId = doc.frames[step.n[1] % doc.frames.length].id;
            count(step.kind);
            continue;
        }
        if (step.kind === "stroke") {
            stroke(walker, step, newId);
            count(step.kind);
            continue;
        }

        const before = stateOf(session);
        let command: Command | null;
        try {
            if (isLayerStep(step)) {
                // Every other layer command names the active layer.
                const active = layerIndex(doc, session.activeLayerId);
                const named = step.value % 2 === 0 ? { ...step, layer: active } : step;
                command = layerCommandOf(session, named, newId);
            } else {
                command = otherCommandOf(session, step, newId);
            }
        } catch (error) {
            // A refused request changes nothing.
            const refusal =
                error instanceof LayerError ||
                error instanceof LastFrameError ||
                error instanceof CelTargetError;
            if (!refusal) throw error;
            expect(stateOf(session)).toStrictEqual(before);
            continue;
        }
        expect(stateOf(session)).toStrictEqual(before);
        if (!command) continue;
        const images = new Map(doc.images);
        walker.history.execute(command);
        walker.record(step.kind, before.activeLayerId);
        count(step.kind);
        if (STACK_KINDS.includes(step.kind)) {
            // What a stack command keeps for undo is what left the document.
            let left = 0;
            for (const [imageId, image] of images) {
                if (!doc.images.has(imageId)) left += image.data.byteLength;
            }
            expect(command.bytes).toBe(left);
        }
    }

    // All the way back and forward, twice: the second round finds what the commands
    // restored after the first round made everything again.
    for (let round = 0; round < 2; round++) {
        walker.toTheEnd(walker.undo);
        expect(walker.at).toBe(0);
        walker.toTheEnd(walker.redo);
        expect(walker.at).toBe(walker.states.length - 1);
    }
    return walker;
}

// A run takes about a second; the timeout leaves room for a machine that is busy with other work.
describe(
    "layer commands among strokes, patches, frame and cel commands, property",
    { timeout: 60_000 },
    () => {
        it("for 300 random sequences with walks through the history, every place of the history has the same session, byte for byte, whenever it is reached", () => {
            let runs = 0;
            let arrivals = 0;
            let stackRedos = 0;
            const executed = new Map<string, number>();

            fc.assert(
                fc.property(documents, sequences(false), (random, sequence) => {
                    runs++;
                    const walker = play(random, sequence, executed);
                    arrivals += walker.arrivals;
                    stackRedos += walker.stackRedos;
                }),
                { numRuns: 300 },
            );

            expect(runs).toBe(300);
            // Every kind of command ran, the walks arrived somewhere, and stack commands were redone.
            for (const kind of [...LAYER_KINDS, ...OTHER_KINDS]) {
                expect(executed.get(kind) ?? 0, kind).toBeGreaterThan(0);
            }
            expect(arrivals).toBeGreaterThan(3000);
            expect(stackRedos).toBeGreaterThan(300);
        });

        it("for 300 random sequences in which the active layer and frame are switched outside the history, every place has the same document, and the undo of a stack command returns to the active layer its do found", () => {
            let runs = 0;
            let stackRedos = 0;
            const executed = new Map<string, number>();

            fc.assert(
                fc.property(documents, sequences(true), (random, sequence) => {
                    runs++;
                    stackRedos += play(random, sequence, executed, true).stackRedos;
                }),
                { numRuns: 300 },
            );

            expect(runs).toBe(300);
            expect(executed.get("activate") ?? 0).toBeGreaterThan(300);
            expect(stackRedos).toBeGreaterThan(300);
        });
    },
);
