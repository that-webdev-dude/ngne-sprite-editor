import { describe, expect, it } from "vitest";
import { moveCelsCommand, setCelOpacityCommand } from "../../src/core/cels";
import { moveFramesCommand } from "../../src/core/frames";
import { pixelPatchCommand } from "../../src/core/history";
import type { Command, History } from "../../src/core/history";
import {
    addLayerCommand,
    deleteLayerCommand,
    duplicateLayerCommand,
    flattenCommand,
    mergeDownCommand,
    renameLayerCommand,
    reorderLayerCommand,
    setLayerOpacityCommand,
} from "../../src/core/layers";
import { celAt, pixelMemoryBytes, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import {
    A,
    B,
    C,
    celBytes,
    compositesOf,
    execute,
    fixture,
    FRAMES,
    HEIGHT,
    history,
    IMAGE_BYTES,
    layerIds,
    made,
    redo,
    stateOf,
    undo,
    WIDTH,
} from "./se-020-support";
import type { SessionState } from "./se-020-support";

// SE-020: a layer command that is redone. Other commands make their images again when they
// are redone (a stroke on an empty cel, a duplicated layer, a merge, a copied cel), so a
// document that is back at a place of its history has the same IDs and the same bytes there,
// but not the same buffers. A stack command therefore takes what it removes from the session
// at each `do`, and the active layer too, which can be switched without a history entry.

const [F1, F2, F3, F4] = FRAMES;
const WHITE = [255, 255, 255, 255];

/** A command that writes `rgba` to the pixel (0, 0) of an image. */
function dot(session: DocSession, imageId: string, rgba: readonly number[] = WHITE): Command {
    return pixelPatchCommand(session.doc, {
        label: "Dot",
        imageId,
        x: 0,
        y: 0,
        pixels: { width: 1, height: 1, data: Uint8ClampedArray.from(rgba) },
    });
}

/** A stroke on a cel, which creates the cel and its image `imageId` when the cel is empty. */
function stroke(target: History, layerId: string, frameId: string, imageId: string): void {
    const transaction = target.begin({ layerId, frameId }, () => imageId);
    transaction.image.data.fill(77);
    transaction.markDirty({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
    expect(transaction.commit("Pencil")).not.toBeNull();
}

/**
 * Runs the steps, then walks the history twice all the way back and all the way forward,
 * comparing the session at every place with the state it had there the first time. The
 * second round meets what the commands restored after the first round made everything again.
 * Returns the states, by the number of steps done.
 */
function walk(session: DocSession, steps: ((target: History) => void)[]): SessionState[] {
    const target = history(session);
    const states = [stateOf(session)];
    for (const step of steps) {
        step(target);
        states.push(stateOf(session));
    }
    const last = steps.length;
    for (let at = last - 1; at >= 0; at--) {
        undo(target);
        expect(stateOf(session), `first undo to ${at}`).toStrictEqual(states[at]);
    }
    for (let at = 1; at <= last; at++) {
        redo(target);
        expect(stateOf(session), `redo to ${at}`).toStrictEqual(states[at]);
    }
    for (let at = last - 1; at >= 0; at--) {
        undo(target);
        expect(stateOf(session), `second undo to ${at}`).toStrictEqual(states[at]);
    }
    for (let at = 1; at <= last; at++) {
        redo(target);
        expect(stateOf(session), `second redo to ${at}`).toStrictEqual(states[at]);
    }
    return states;
}

describe("a stack command redone after the images it removes were made again", () => {
    it("delete after duplicate and a pixel patch: undo ×3, redo ×3, undo ×1 keeps the patch", () => {
        const session = fixture();
        const target = history(session);
        const ids = sequentialIds("new-");

        execute(target, duplicateLayerCommand(session, B, { newId: ids }));
        const copy = session.activeLayerId;
        const imageId = celAt(session.doc, copy, F1)?.imageId ?? "";
        execute(target, dot(session, imageId));
        const patched = stateOf(session);
        expect(Array.from(celBytes(session.doc, copy, F1).subarray(0, 4))).toEqual(WHITE);
        execute(target, deleteLayerCommand(session, copy));

        for (let step = 0; step < 3; step++) undo(target);
        for (let step = 0; step < 3; step++) redo(target);
        undo(target);

        // The copy is back as the delete found it: with the patch.
        expect(Array.from(celBytes(session.doc, copy, F1).subarray(0, 4))).toEqual(WHITE);
        expect(stateOf(session)).toStrictEqual(patched);
    });

    it("delete restores the buffer its last do removed, not the one of an earlier do", () => {
        const session = fixture();
        const target = history(session);
        execute(target, duplicateLayerCommand(session, B, { newId: sequentialIds("new-") }));
        const copy = session.activeLayerId;
        const imageId = celAt(session.doc, copy, F1)?.imageId ?? "";
        const first = session.doc.images.get(imageId);
        execute(target, deleteLayerCommand(session, copy));

        undo(target);
        expect(session.doc.images.get(imageId)).toBe(first);
        undo(target);
        redo(target);
        const second = session.doc.images.get(imageId);
        expect(second).not.toBe(first);
        redo(target);
        undo(target);

        expect(session.doc.images.get(imageId)).toBe(second);
    });

    it.each([
        { name: "delete", make: (session: DocSession) => deleteLayerCommand(session, A) },
        { name: "merge down", make: (session: DocSession) => mergeDownCommand(session, B) },
        { name: "flatten", make: (session: DocSession) => flattenCommand(session) },
    ])("$name after a stroke on an empty cel and a pixel patch", ({ make }) => {
        const session = fixture();

        walk(session, [
            // The stroke's command makes the image `a4` again on every redo.
            (target) => stroke(target, A, F4, "a4"),
            (target) => execute(target, dot(session, "a4")),
            (target) => execute(target, make(session)),
        ]);
    });

    it("merge down and flatten after a merge down and a pixel patch on its result", () => {
        const session = fixture();
        const ids = sequentialIds("new-");

        walk(session, [
            (target) => execute(target, mergeDownCommand(session, C, { newId: ids })),
            (target) => execute(target, dot(session, celAt(session.doc, B, F2)?.imageId ?? "")),
            (target) => execute(target, mergeDownCommand(session, B, { newId: ids })),
            (target) => execute(target, dot(session, celAt(session.doc, A, F4)?.imageId ?? "")),
            // One layer is left; an opacity gives the flatten something to bake.
            (target) => execute(target, setLayerOpacityCommand(session, A, 200)),
            (target) => execute(target, flattenCommand(session, { newId: ids })),
        ]);
    });

    it("duplicate, reorder and add around layers whose cels another command replaced", () => {
        const session = fixture();
        const ids = sequentialIds("new-");
        const cell = { layerIds: [B], frameIds: [F1] };
        const run = (target: History, command: Command | null) => {
            if (!command) throw new Error("the command would change nothing");
            execute(target, command);
        };

        walk(session, [
            (target) => run(target, setCelOpacityCommand(session.doc, cell, 40)),
            (target) => run(target, duplicateLayerCommand(session, B, { newId: ids })),
            (target) => run(target, setCelOpacityCommand(session.doc, cell, 90)),
            (target) => run(target, reorderLayerCommand(session, B, 3)),
            (target) => run(target, addLayerCommand(session, { newId: ids })),
            (target) => run(target, deleteLayerCommand(session, B)),
        ]);
    });

    it.each([
        { name: "add", make: (s: DocSession) => addLayerCommand(s, { newId: () => "top" }) },
        { name: "delete", make: (s: DocSession) => deleteLayerCommand(s, "new") },
        { name: "delete of another layer", make: (s: DocSession) => deleteLayerCommand(s, A) },
        { name: "duplicate", make: (s: DocSession) => duplicateLayerCommand(s, "new") },
        { name: "reorder", make: (s: DocSession) => reorderLayerCommand(s, "new", 0) },
        { name: "merge down", make: (s: DocSession) => mergeDownCommand(s, "new") },
        { name: "merge down onto it", make: (s: DocSession) => mergeDownCommand(s, C) },
        { name: "flatten", make: (s: DocSession) => flattenCommand(s) },
    ])("$name after a layer was added, painted and given another opacity and name", ({ make }) => {
        const session = fixture();

        // A redo of the add puts a new layer object into the stack, and the property
        // commands then change that one: the object of the first do is out of date.
        const states = walk(session, [
            (target) => execute(target, addLayerCommand(session, { newId: () => "new" })),
            (target) => stroke(target, "new", F1, "n1"),
            (target) => execute(target, setLayerOpacityCommand(session, "new", 64)),
            (target) => execute(target, renameLayerCommand(session, "new", "Ink")),
            (target) => execute(target, make(session)),
        ]);

        expect(states[4].doc.layers[2]).toMatchObject({ id: "new", name: "Ink", opacity: 64 });
    });

    it.each([
        { name: "delete", make: (session: DocSession) => deleteLayerCommand(session, A) },
        { name: "merge down", make: (session: DocSession) => mergeDownCommand(session, B) },
        { name: "flatten", make: (session: DocSession) => flattenCommand(session) },
    ])("$name after a stroke on an empty cel and a change of the cel object itself", ({ make }) => {
        const session = fixture();
        /** A command that sets the opacity of the cel object it finds, in place. */
        const fade: Command = {
            label: "Fade",
            bytes: 0,
            touched: { frameIds: [F4], layerIds: [A], structure: false },
            do({ doc }) {
                const cel = celAt(doc, A, F4);
                if (cel) cel.opacity = 50;
            },
            undo({ doc }) {
                const cel = celAt(doc, A, F4);
                if (cel) cel.opacity = 255;
            },
        };

        // The stroke's command makes a new cel object on every redo, and `fade` then
        // changes that one: the cel object of the first do has opacity 255 again.
        const states = walk(session, [
            (target) => stroke(target, A, F4, "a4"),
            (target) => execute(target, fade),
            (target) => execute(target, make(session)),
        ]);

        expect(states[2].doc.cels).toContainEqual([`${A}:${F4}`, { imageId: "a4", opacity: 50 }]);
    });

    it("merge down, redone, bakes the opacity of the layer object it finds then", () => {
        const session = fixture();
        const target = history(session);
        execute(target, addLayerCommand(session, { newId: () => "new" }));
        stroke(target, "new", F4, "n4");
        execute(target, setLayerOpacityCommand(session, "new", 64));
        const expected = compositesOf(session.doc, [B, "new"]);
        execute(target, mergeDownCommand(session, "new", { newId: sequentialIds("merged-") }));
        expect(compositesOf(session.doc, [B])).toStrictEqual(expected);

        for (let step = 0; step < 4; step++) undo(target);
        for (let step = 0; step < 4; step++) redo(target);

        // Opacity 64, not the 255 the first layer object went back to when it was undone.
        expect(compositesOf(session.doc, [B])).toStrictEqual(expected);
    });

    it("keeps for undo exactly the bytes it states, at the first do and at a redo", () => {
        const session = fixture();
        const target = history(session);
        stroke(target, A, F4, "a4");
        const before = pixelMemoryBytes(session.doc);
        const command = deleteLayerCommand(session, A);
        expect(command.bytes).toBe(3 * IMAGE_BYTES);

        execute(target, command);
        expect(before - pixelMemoryBytes(session.doc)).toBe(command.bytes);
        undo(target);
        undo(target);
        redo(target);
        redo(target);

        expect(before - pixelMemoryBytes(session.doc)).toBe(command.bytes);
        expect(target.bytes).toBe(command.bytes + IMAGE_BYTES);
    });
});

describe("a stack command and an active layer switched without a history entry", () => {
    it("delete, redone with another layer active, leaves that layer active; undo returns to it", () => {
        const session = fixture();
        const target = history(session);
        execute(target, deleteLayerCommand(session, B));
        expect(session.activeLayerId).toBe(A);
        const done = stateOf(session);
        undo(target);
        expect(session.activeLayerId).toBe(B);

        session.activeLayerId = C;
        redo(target);

        expect(session.activeLayerId).toBe(C);
        expect(stateOf(session).doc).toStrictEqual(done.doc);
        undo(target);
        expect(session.activeLayerId).toBe(C);
        expect(layerIds(session.doc)).toEqual([A, B, C]);
    });

    it("delete, redone with the deleted layer now active, activates the layer below it", () => {
        const session = fixture();
        const target = history(session);
        execute(target, deleteLayerCommand(session, C));
        expect(session.activeLayerId).toBe(B);
        undo(target);

        session.activeLayerId = C;
        redo(target);

        expect(session.activeLayerId).toBe(B);
        undo(target);
        expect(session.activeLayerId).toBe(C);
    });

    it("add, redone with another layer active, puts the layer where it was; undo returns to that layer", () => {
        const session = fixture();
        const target = history(session);
        execute(target, addLayerCommand(session, { newId: () => "new" }));
        const done = stateOf(session);
        undo(target);

        session.activeLayerId = A;
        redo(target);

        // A redo gives the document of the first do: the commands after it count on that.
        expect(layerIds(session.doc)).toEqual([A, B, "new", C]);
        expect(stateOf(session)).toStrictEqual(done);
        undo(target);
        expect(session.activeLayerId).toBe(A);
    });

    it("reorder and a merge of another layer leave a switched active layer alone", () => {
        const session = fixture();
        const target = history(session);
        const ids = sequentialIds("new-");
        execute(target, reorderLayerCommand(session, A, 2));
        execute(target, mergeDownCommand(session, C, { newId: ids }));
        undo(target);
        undo(target);

        session.activeLayerId = A;
        redo(target);
        expect(session.activeLayerId).toBe(A);
        redo(target);
        expect(session.activeLayerId).toBe(A);

        session.activeLayerId = B;
        undo(target);
        expect(session.activeLayerId).toBe(A);
    });

    it("merge down, redone with the merged layer active again, activates its target", () => {
        const session = fixture();
        session.activeLayerId = A;
        const target = history(session);
        execute(target, mergeDownCommand(session, C, { newId: sequentialIds("new-") }));
        expect(session.activeLayerId).toBe(A);
        undo(target);

        session.activeLayerId = C;
        redo(target);

        expect(session.activeLayerId).toBe(B);
        undo(target);
        expect(session.activeLayerId).toBe(C);
    });

    it("flatten and duplicate, redone, activate their layer and undo returns to the one found", () => {
        const session = fixture();
        const target = history(session);
        execute(target, duplicateLayerCommand(session, C, { newId: sequentialIds("new-") }));
        execute(target, flattenCommand(session, { newId: sequentialIds("flat-") }));
        undo(target);
        undo(target);

        session.activeLayerId = A;
        redo(target);
        expect(session.activeLayerId).toBe("new-1");
        session.activeLayerId = C;
        redo(target);
        expect(session.activeLayerId).toBe(A);

        undo(target);
        expect(session.activeLayerId).toBe(C);
        undo(target);
        expect(session.activeLayerId).toBe(A);
    });
});

describe("a stack command and a document that changed since it was made", () => {
    /** Executes `change`, then expects `stale` to throw and to leave the session as it is. */
    function expectStale(session: DocSession, stale: Command, change: Command | null): void {
        const target = history(session);
        if (!change) throw new Error("the change would change nothing");
        execute(target, change);
        const before = stateOf(session);

        expect(() => target.execute(stale)).toThrow(/the session changed/);

        expect(stateOf(session)).toStrictEqual(before);
        expect(target.undoCount).toBe(1);
    }

    it("throws when a cel moved, though the document has as many cels and images as before", () => {
        const session = fixture();
        const stale = deleteLayerCommand(session, B);

        expectStale(
            session,
            stale,
            moveCelsCommand(
                session.doc,
                { layerIds: [A], frameIds: [F3] },
                { layers: 0, frames: 1 },
            ),
        );
    });

    it("throws when the frames are in another order", () => {
        const session = fixture();
        const stale = made(flattenCommand(session));

        expectStale(session, stale, moveFramesCommand(session.doc, [F1], 4));
    });

    it("throws when the layers are in another order", () => {
        const session = fixture();
        const stale = deleteLayerCommand(session, C);

        expectStale(session, stale, reorderLayerCommand(session, A, 2));
    });

    it("throws when a layer was replaced by another, though the stack is as long as before", () => {
        const session = fixture();
        const stale = made(reorderLayerCommand(session, A, 2));
        const target = history(session);
        execute(target, deleteLayerCommand(session, A));
        execute(target, addLayerCommand(session, { newId: () => "other" }));
        const before = stateOf(session);
        expect(session.doc.layers).toHaveLength(3);

        expect(() => target.execute(stale)).toThrow(/the session changed/);

        expect(stateOf(session)).toStrictEqual(before);
    });

    it("throws when a cel names another image of the same size", () => {
        const session = fixture();
        const stale = mergeDownCommand(session, B);
        const target = history(session);
        // Outside the history, to change nothing but the image a cel names.
        session.doc.cels.set(`${A}:${F2}`, { imageId: "a3", opacity: 255 });
        const before = stateOf(session);

        expect(() => target.execute(stale)).toThrow(/the session changed/);

        expect(stateOf(session)).toStrictEqual(before);
    });

    it("throws when an image has another size", () => {
        const session = fixture();
        const stale = duplicateLayerCommand(session, B);
        const target = history(session);
        session.doc.images.set("c1", { width: 1, height: 1, data: new Uint8ClampedArray(4) });

        expect(() => target.execute(stale)).toThrow(/the session changed/);
    });

    it("is redone on a document whose maps another command put back in another order", () => {
        const session = fixture();
        const { doc } = session;
        const key = `${A}:${F1}`;
        /** Takes a cel out and, undone, puts it back at the end of the map, not at its place. */
        let taken = doc.cels.get(key);
        const takeOut: Command = {
            label: "Take Out",
            bytes: 0,
            touched: { frameIds: [F1], layerIds: [A], structure: false },
            do(target) {
                taken = target.doc.cels.get(key);
                target.doc.cels.delete(key);
            },
            undo(target) {
                if (taken) target.doc.cels.set(key, taken);
            },
        };
        const target = history(session);
        const order = [...doc.cels.keys()];
        execute(target, deleteLayerCommand(session, C));
        const done = stateOf(session).doc;
        execute(target, takeOut);
        undo(target);
        undo(target);
        // The same cels on the same images, in another order: not a changed document.
        expect([...doc.cels.keys()]).not.toEqual(order);
        expect([...doc.cels.keys()].sort()).toEqual([...order].sort());

        redo(target);

        expect(layerIds(doc)).toEqual([A, B]);
        expect(new Map(stateOf(session).doc.cels)).toEqual(new Map(done.cels));
        undo(target);
        expect(layerIds(doc)).toEqual([A, B, C]);
        expect([...doc.cels.keys()].sort()).toEqual([...order].sort());
    });

    it("runs on the pixels it finds: a patch made after the command is in what undo restores", () => {
        const session = fixture();
        const target = history(session);
        const command = deleteLayerCommand(session, B);
        execute(target, dot(session, "b1"));
        const patched = stateOf(session);

        execute(target, command);
        undo(target);

        expect(stateOf(session)).toStrictEqual(patched);
        expect(Array.from(celBytes(session.doc, B, F1).subarray(0, 4))).toEqual(WHITE);
    });

    it("runs on the layer properties it finds: a merge bakes the opacity set after it was made", () => {
        const session = fixture();
        const target = history(session);
        const command = mergeDownCommand(session, B, { newId: sequentialIds("new-") });
        execute(target, setLayerOpacityCommand(session, B, 255));
        const expected = compositesOf(session.doc, [A, B]);
        const changed = stateOf(session);

        execute(target, command);

        expect(compositesOf(session.doc, [A])).toStrictEqual(expected);
        undo(target);
        expect(stateOf(session)).toStrictEqual(changed);
    });

    it("throws when it is undone without having been done", () => {
        const session = fixture();
        const before = stateOf(session);

        expect(() => deleteLayerCommand(session, B).undo(session)).toThrow(/not done/);

        expect(stateOf(session)).toStrictEqual(before);
    });
});
