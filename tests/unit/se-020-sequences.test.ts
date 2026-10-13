import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { History } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import { LayerError, mergeDownTarget } from "../../src/core/layers";
import { assertInvariants, pixelMemoryBytes, sequentialIds } from "../../src/core/model";
import {
    asksForNothing,
    composites,
    compositesShown,
    documents,
    expectNoStrayCel,
    LAYER_KINDS,
    layerCommandOf,
    layerStep,
    pixelLayerIds,
    sessionOf,
    stateOf,
} from "./se-020-support";
import type { SessionState } from "./se-020-support";

// Random sequences of layer commands on random documents: pixel and reference layers in any
// order, hidden layers, any opacity, linked cels. Every step is checked against the
// invariants and the rules of its command; then the whole history is undone and redone.

const steps = fc.array(layerStep, { minLength: 1, maxLength: 12 });

// A run takes about a second; the timeout leaves room for a machine that is busy with other work.
describe("layer commands, property", { timeout: 60_000 }, () => {
    it("for 300 random sequences, every step keeps the invariants and its own rule, and undo all then redo all reproduces every state exactly", () => {
        let runs = 0;
        const executed = new Map<string, number>();
        const refused = new Map<string, number>();
        const unchanging = new Map<string, number>();
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
                    // Merge down takes the two layers as visible, whatever their flag.
                    const pair = below ? compositesShown(doc, [below.id, id]) : [];
                    const pixelMemory = pixelMemoryBytes(doc);
                    const nothing = asksForNothing(doc, step);

                    let command: Command | null;
                    try {
                        command = layerCommandOf(session, step, newId);
                    } catch (error) {
                        // A refused request changes nothing.
                        expect(error).toBeInstanceOf(LayerError);
                        expect(stateOf(session)).toStrictEqual(before);
                        count(refused, step.kind);
                        continue;
                    }
                    expect(stateOf(session)).toStrictEqual(before);
                    // No command exactly when there is nothing to change: no undo step.
                    expect(command === null, step.kind).toBe(nothing);
                    if (!command) {
                        count(unchanging, step.kind);
                        continue;
                    }
                    history.execute(command);
                    count(executed, step.kind);
                    retained += command.bytes;

                    assertInvariants(session);
                    expectNoStrayCel(doc);
                    // A command that is made changes the session.
                    expect(stateOf(session), step.kind).not.toStrictEqual(before);
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
                        expect(compositesShown(doc, [below.id])).toStrictEqual(pair);
                        expect(doc.layers.some((layer) => layer.id === id)).toBe(false);
                        // The target stays hidden or visible as it was.
                        const target = doc.layers.find((layer) => layer.id === below.id);
                        expect(target?.visible).toBe(below.visible);
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
        expect([...executed.keys()].sort()).toEqual([...LAYER_KINDS].sort());
        for (const kind of ["delete", "duplicate", "blend", "mergeDown"]) {
            expect(refused.get(kind) ?? 0, kind).toBeGreaterThan(0);
        }
        // Requests for what the document has already were among the steps, and made no command.
        for (const kind of ["reorder", "visible", "locked", "flatten"]) {
            expect(unchanging.get(kind) ?? 0, kind).toBeGreaterThan(0);
        }
        for (const kind of ["add", "delete", "duplicate", "mergeDown"]) {
            expect(unchanging.get(kind) ?? 0, kind).toBe(0);
        }
    });
});
