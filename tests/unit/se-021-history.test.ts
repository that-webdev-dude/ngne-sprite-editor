import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    CelTargetError,
    clearCelsCommand,
    copyCelsCommand,
    linkCelsCommand,
    moveCelsCommand,
    setCelOpacityCommand,
    unlinkCelsCommand,
} from "../../src/core/cels";
import { compositeFrame } from "../../src/core/composite";
import {
    addFrameCommand,
    deleteFramesCommand,
    duplicateFramesCommand,
    LastFrameError,
    moveFramesCommand,
    reverseFramesCommand,
    setFrameDurationCommand,
} from "../../src/core/frames";
import { History, pixelPatchCommand } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import { celAt, celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, IdGenerator, Layer, SpriteDoc } from "../../src/core/model";
import { createTagCommand, deleteTagCommand, editTagCommand } from "../../src/core/tags";
import { assertSound, snapshot } from "./se-021-support";

// SE-021: random sequences of frame, cel and tag commands, mixed with pixel patches, on random
// small documents. An operation is a kind and a few numbers; the numbers pick frames, layers,
// tags and values from the document as it is when the operation runs.

const KINDS = [
    "addFrame",
    "duplicateFrames",
    "deleteFrames",
    "moveFrames",
    "reverseFrames",
    "setDuration",
    "clearCels",
    "moveCels",
    "copyCels",
    "linkCels",
    "unlinkCels",
    "setOpacity",
    "createTag",
    "editTag",
    "deleteTag",
    "paint",
] as const;

interface Operation {
    kind: (typeof KINDS)[number];
    n: number[];
}

interface Sketch {
    /** One entry per layer above the bottom pixel layer; false is a reference layer. */
    pixel: boolean[];
    frames: number;
    /** Per cell: 0 an empty cell, 1 and 2 an image of its own, 3 the image of the cel before. */
    cells: number[];
    tags: [number, number][];
    exported: number;
}

const operations: fc.Arbitrary<Operation> = fc.record({
    kind: fc.constantFrom(...KINDS),
    n: fc.array(fc.nat({ max: 999 }), { minLength: 4, maxLength: 4 }),
});

const sketches: fc.Arbitrary<Sketch> = fc.record({
    pixel: fc.array(fc.boolean(), { maxLength: 2 }),
    frames: fc.integer({ min: 1, max: 4 }),
    cells: fc.array(fc.nat({ max: 3 }), { minLength: 12, maxLength: 12 }),
    tags: fc.array(fc.tuple(fc.nat({ max: 3 }), fc.nat({ max: 3 })), { maxLength: 3 }),
    exported: fc.nat({ max: 3 }),
});

function layer(id: string, pixel: boolean): Layer {
    const base = { id, name: id, visible: true, locked: false, opacity: 255 };
    return pixel
        ? { ...base, kind: "pixel", blend: "normal" }
        : {
              ...base,
              kind: "reference",
              sourceId: `s-${id}`,
              x: 0,
              y: 0,
              scale: 1,
              placement: "front",
          };
}

/** A 2×1 document drawn from a sketch: layers `l0`…, frames `f0`…, images `i0`…, tags `t0`…. */
function build(sketch: Sketch): DocSession {
    const session = createDocument({ name: "random", width: 2, height: 1 }, sequentialIds("d"));
    const { doc } = session;
    doc.layers = [true, ...sketch.pixel].map((pixel, index) => layer(`l${index}`, pixel));
    doc.frames = Array.from({ length: sketch.frames }, (_, index) => ({
        id: `f${index}`,
        durationMs: 100,
    }));
    let cell = 0;
    for (const { id: layerId, kind } of doc.layers) {
        let previous: string | null = null;
        for (const { id: frameId } of doc.frames) {
            const choice = sketch.cells[cell++ % sketch.cells.length];
            if (kind !== "pixel" || choice === 0) continue;
            let imageId: string | null = choice === 3 ? previous : null;
            if (imageId === null) {
                imageId = `i${doc.images.size}`;
                const fill = 16 * (doc.images.size + 1);
                doc.images.set(imageId, {
                    width: 2,
                    height: 1,
                    data: Uint8ClampedArray.of(fill, 0, 0, 255, 0, fill, 0, 128),
                });
            }
            doc.cels.set(celKey(layerId, frameId), { imageId, opacity: choice === 3 ? 128 : 255 });
            previous = imageId;
        }
    }
    doc.tags = sketch.tags.map(([a, b], index) => ({
        id: `t${index}`,
        name: `tag ${index}`,
        color: 0x808080ff,
        fromFrameId: doc.frames[Math.min(a % sketch.frames, b % sketch.frames)].id,
        toFrameId: doc.frames[Math.max(a % sketch.frames, b % sketch.frames)].id,
        direction: "forward",
        repeat: 0,
    }));
    if (sketch.exported < doc.tags.length) {
        doc.exportSettings.frames = { tagId: doc.tags[sketch.exported].id };
    }
    session.activeLayerId = doc.layers[0].id;
    session.activeFrameId = doc.frames[0].id;
    assertSound(session);
    return session;
}

function pick<T>(list: readonly T[], n: number): T {
    return list[n % list.length];
}

/** Some of the list, chosen by the bits of `mask`; at least one. */
function several<T>(list: readonly T[], mask: number): T[] {
    const chosen = list.filter((_, index) => (mask >> (index % 10)) & 1);
    return chosen.length > 0 ? chosen : [pick(list, mask)];
}

/**
 * The command of an operation on the document as it is now; null when the command has
 * nothing to change or refuses with one of its typed errors.
 */
function commandOf(doc: SpriteDoc, { kind, n }: Operation, newId: IdGenerator): Command | null {
    const [a, b, c, d] = n;
    const frames = doc.frames.map((frame) => frame.id);
    const selection = {
        layerIds: several(
            doc.layers.map((item) => item.id),
            a,
        ),
        frameIds: several(frames, b),
    };
    // A move or a copy takes one or two frames of one pixel layer, with the reference layers
    // for company, to a place that mostly exists. A layer offset counts pixel layers.
    const pixelLayers = doc.layers.flatMap((item, index) => (item.kind === "pixel" ? [index] : []));
    const fromRow = a % pixelLayers.length;
    const fromLayer = pixelLayers[fromRow];
    const fromFrame = b % frames.length;
    const shifted = {
        layerIds: doc.layers
            .filter((item, index) => index === fromLayer || item.kind === "reference")
            .map((item) => item.id),
        frameIds: frames.slice(fromFrame, fromFrame + 1 + (a % 2)),
    };
    const offset = {
        layers: (c % pixelLayers.length) - fromRow,
        frames: (d % frames.length) - fromFrame,
    };
    const tag = doc.tags.length > 0 ? pick(doc.tags, a) : null;
    const images = [...doc.images.keys()];
    const first = Math.min(a % frames.length, b % frames.length);
    const last = Math.max(a % frames.length, b % frames.length);
    try {
        switch (kind) {
            case "addFrame":
                return frames.length < 12 ? addFrameCommand(doc, pick(frames, a), newId) : null;
            case "duplicateFrames":
                return frames.length < 12
                    ? duplicateFramesCommand(doc, several(frames, a), newId)
                    : null;
            case "deleteFrames":
                return deleteFramesCommand(doc, several(frames, a));
            case "moveFrames":
                return moveFramesCommand(doc, several(frames, a), b % (frames.length + 1));
            case "reverseFrames":
                return reverseFramesCommand(doc, several(frames, a));
            case "setDuration":
                return setFrameDurationCommand(doc, several(frames, a), 50 + (b % 3) * 50);
            case "clearCels":
                return clearCelsCommand(doc, selection);
            case "moveCels":
                return moveCelsCommand(doc, shifted, offset);
            case "copyCels":
                return copyCelsCommand(doc, shifted, offset, newId);
            case "linkCels":
                return linkCelsCommand(doc, selection);
            case "unlinkCels":
                return unlinkCelsCommand(doc, selection, newId);
            case "setOpacity":
                return setCelOpacityCommand(doc, selection, pick([0, 128, 255], c));
            case "createTag":
                return doc.tags.length < 5
                    ? createTagCommand(
                          doc,
                          {
                              name: `made ${c}`,
                              color: d,
                              fromFrameId: frames[first],
                              toFrameId: frames[last],
                              direction: pick(["forward", "reverse", "pingpong"] as const, c),
                              repeat: d % 4,
                          },
                          newId,
                      )
                    : null;
            case "editTag":
                return tag
                    ? editTagCommand(doc, tag.id, {
                          name: c % 2 ? `edited ${d}` : undefined,
                          fromFrameId: c % 3 ? frames[first] : undefined,
                          toFrameId: c % 3 ? frames[last] : undefined,
                          repeat: d % 3,
                      })
                    : null;
            case "deleteTag":
                return tag ? deleteTagCommand(doc, tag.id) : null;
            case "paint":
                return images.length > 0
                    ? pixelPatchCommand(doc, {
                          label: "Paint",
                          imageId: pick(images, a),
                          x: b % 2,
                          y: 0,
                          pixels: { width: 1, height: 1, data: Uint8ClampedArray.of(c, d, a, 255) },
                      })
                    : null;
        }
    } catch (error) {
        if (error instanceof LastFrameError || error instanceof CelTargetError) return null;
        throw error;
    }
}

/** What a command must report of a step, worked out from the documents on both sides of it. */
function expectReported(before: SpriteDoc, after: SpriteDoc, command: Command): void {
    const order = (doc: SpriteDoc) => doc.frames.map((frame) => frame.id);
    const tags = (doc: SpriteDoc) => doc.tags.map((tag) => tag.id);
    const { touched } = command;

    // Structure: the list of frames or of tags has another entry or another order.
    expect(touched.structure).toBe(
        order(before).join() !== order(after).join() || tags(before).join() !== tags(after).join(),
    );
    for (const id of new Set([...order(before), ...order(after)])) {
        const was = order(before).includes(id) ? compositeFrame(before, id).data : null;
        const is = order(after).includes(id) ? compositeFrame(after, id).data : null;
        // A frame that came, went or looks different is named.
        if (!was || !is || was.join() !== is.join()) expect(touched.frameIds).toContain(id);
        if (!was || !is) continue;
        for (const { id: layerId } of after.layers) {
            const a = celAt(before, layerId, id);
            const b = celAt(after, layerId, id);
            if (a?.imageId !== b?.imageId || a?.opacity !== b?.opacity) {
                expect(touched.layerIds).toContain(layerId);
            }
        }
    }
    // Retained: exactly the pixels of the images the step removed from the document.
    let removed = 0;
    for (const [id, image] of before.images) {
        if (!after.images.has(id)) removed += image.data.byteLength;
    }
    expect(command.bytes).toBe(removed);
}

// A snapshot per step of 300 sequences: about a second, and over the default 5 s when the
// machine is busy with other work.
describe("frame, cel and tag commands, property", { timeout: 60_000 }, () => {
    it("for 300 random sequences, undo all then redo all reproduces every intermediate session exactly", () => {
        let executed = 0;
        const seen = new Set<string>();
        fc.assert(
            fc.property(
                sketches,
                fc.array(operations, { minLength: 1, maxLength: 14 }),
                (sketch, sequence) => {
                    const session = build(sketch);
                    const history = new History(session);
                    const newId = sequentialIds("n");
                    const states = [snapshot(session)];

                    for (const operation of sequence) {
                        const before = structuredClone(session.doc);
                        const command = commandOf(session.doc, operation, newId);
                        // Making a command changes nothing.
                        expect(snapshot(session)).toStrictEqual(states[states.length - 1]);
                        if (!command) continue;
                        history.execute(command);
                        assertSound(session);
                        if (operation.kind !== "paint") {
                            expectReported(before, session.doc, command);
                        }
                        states.push(snapshot(session));
                        seen.add(operation.kind);
                        executed++;
                    }
                    const steps = states.length - 1;
                    expect(history.undoCount).toBe(steps);

                    for (let round = 0; round < 2; round++) {
                        for (let index = steps - 1; index >= 0; index--) {
                            expect(history.undo()).toBe(true);
                            assertSound(session);
                            expect(snapshot(session)).toStrictEqual(states[index]);
                        }
                        expect(history.undo()).toBe(false);
                        for (let index = 1; index <= steps; index++) {
                            expect(history.redo()).toBe(true);
                            assertSound(session);
                            expect(snapshot(session)).toStrictEqual(states[index]);
                        }
                        expect(history.redo()).toBe(false);
                    }
                },
            ),
            { numRuns: 300 },
        );
        // The sequences reached every kind of command.
        expect([...seen].sort()).toEqual([...KINDS].sort());
        expect(executed).toBeGreaterThan(600);
    });

    it("the invariants hold through any undo and redo, whatever frame is active and whatever is chosen for export", () => {
        const actions = fc.oneof(
            { weight: 4, arbitrary: operations.map((operation) => ({ operation })) },
            { weight: 3, arbitrary: fc.constant({ step: "undo" as const }) },
            { weight: 2, arbitrary: fc.constant({ step: "redo" as const }) },
            // Neither of these is a command (SPEC §5.2): no history entry.
            { weight: 1, arbitrary: fc.nat({ max: 99 }).map((navigate) => ({ navigate })) },
            { weight: 1, arbitrary: fc.nat({ max: 99 }).map((exported) => ({ exported })) },
        );
        fc.assert(
            fc.property(
                sketches,
                fc.array(actions, { minLength: 1, maxLength: 30 }),
                (sketch, sequence) => {
                    const session = build(sketch);
                    const { doc } = session;
                    const history = new History(session);
                    const newId = sequentialIds("n");
                    for (const action of sequence) {
                        if ("operation" in action) {
                            const command = commandOf(doc, action.operation, newId);
                            if (command) history.execute(command);
                        } else if ("step" in action) {
                            if (action.step === "undo") history.undo();
                            else history.redo();
                        } else if ("navigate" in action) {
                            session.activeFrameId = pick(doc.frames, action.navigate).id;
                        } else {
                            const choices = ["all" as const, ...doc.tags.map((tag) => tag.id)];
                            const choice = pick(choices, action.exported);
                            doc.exportSettings.frames =
                                choice === "all" ? "all" : { tagId: choice };
                        }
                        assertSound(session);
                    }
                    // And back to the start: nothing is left over but those two choices.
                    const start = snapshot(build(sketch));
                    while (history.undo()) assertSound(session);
                    const end = snapshot(session);
                    expect({
                        ...end,
                        activeFrameId: "",
                        doc: { ...end.doc, exportSettings: 0 },
                    }).toStrictEqual({
                        ...start,
                        activeFrameId: "",
                        doc: { ...start.doc, exportSettings: 0 },
                    });
                },
            ),
            { numRuns: 300 },
        );
    });
});
