import { describe, expect, it } from "vitest";
import { AllocationError, compositeCommand } from "../../src/core/history";
import {
    addLayerCommand,
    canDeleteLayer,
    deleteLayerCommand,
    duplicateLayerCommand,
    LayerError,
    nextLayerName,
    reorderLayerCommand,
} from "../../src/core/layers";
import { celAt, pixelMemoryBytes, sequentialIds } from "../../src/core/model";
import {
    A,
    B,
    C,
    celBytes,
    composites,
    emptySession,
    execute,
    fixture,
    flakyAllocator,
    FRAMES,
    HEIGHT,
    history,
    IMAGE_BYTES,
    imageIdsOf,
    layer,
    layerIds,
    made,
    pixels,
    redo,
    stateOf,
    thrownBy,
    undo,
    WIDTH,
} from "./se-020-support";

// SE-020: the commands that add, delete, duplicate and reorder layers (SPEC §7.3).

const [F1, F2, F3, F4] = FRAMES;

describe("add layer", () => {
    it("adds an empty pixel layer directly above the active layer and makes it active", () => {
        const session = fixture();
        const before = composites(session.doc);
        const target = history(session);

        execute(target, addLayerCommand(session, { newId: sequentialIds("new-") }));

        expect(layerIds(session.doc)).toEqual([A, B, "new-1", C]);
        expect(layer(session.doc, "new-1")).toEqual({
            id: "new-1",
            name: "Layer 1",
            kind: "pixel",
            visible: true,
            locked: false,
            opacity: 255,
            blend: "normal",
        });
        expect(session.activeLayerId).toBe("new-1");
        expect(imageIdsOf(session.doc, "new-1")).toEqual([null, null, null, null]);
        expect(target.undoLabel).toBe("New Layer");
        // An empty layer changes no composite.
        expect(composites(session.doc)).toStrictEqual(before);
    });

    it("adds on top when the active layer is the top layer", () => {
        const session = fixture();
        session.activeLayerId = C;

        execute(history(session), addLayerCommand(session, { newId: () => "new" }));

        expect(layerIds(session.doc)).toEqual([A, B, C, "new"]);
    });

    it("undo removes the layer and makes the layer that was active the active one again", () => {
        const session = fixture();
        const target = history(session);
        execute(target, addLayerCommand(session, { newId: () => "new" }));

        undo(target);

        expect(layerIds(session.doc)).toEqual([A, B, C]);
        expect(session.activeLayerId).toBe(B);
    });

    it("redo adds the layer with the same ID, so later commands still find it", () => {
        const session = fixture();
        const target = history(session);
        execute(target, addLayerCommand(session));
        const id = session.activeLayerId;
        expect([A, B, C]).not.toContain(id);

        undo(target);
        redo(target);

        expect(session.activeLayerId).toBe(id);
        expect(layerIds(session.doc)).toEqual([A, B, id, C]);
    });

    it('names the layer "Layer N", one above the highest number in use, as Aseprite does', () => {
        const session = emptySession([A]);
        const names = (list: string[]) => {
            session.doc.layers.forEach((entry, index) => (entry.name = list[index]));
            return nextLayerName(session.doc);
        };

        expect(names(["Background"])).toBe("Layer 1");
        expect(names(["Layer 1"])).toBe("Layer 2");
        expect(names(["Layer 7"])).toBe("Layer 8");
        // The number counts with text after it, not inside other text.
        expect(names(["Layer 4 Copy"])).toBe("Layer 5");
        expect(names(["My Layer 9"])).toBe("Layer 1");
        expect(names(["Layer"])).toBe("Layer 1");

        session.doc.layers[0].name = "Layer 2";
        const target = history(session);
        const ids = sequentialIds("new-");
        execute(target, addLayerCommand(session, { newId: ids }));
        execute(target, addLayerCommand(session, { newId: ids }));
        expect(session.doc.layers.map((entry) => entry.name)).toEqual([
            "Layer 2",
            "Layer 3",
            "Layer 4",
        ]);
    });

    it("takes a name, without surrounding white space, and rejects an empty one", () => {
        const session = fixture();
        const before = stateOf(session);

        execute(history(session), addLayerCommand(session, { name: "  Ink \n" }));
        expect(layer(session.doc, session.activeLayerId).name).toBe("Ink");

        const other = fixture();
        const error = thrownBy(() => addLayerCommand(other, { name: "   " }));
        expect(error).toBeInstanceOf(LayerError);
        expect(error).toMatchObject({ name: "LayerError", code: "name" });
        expect(stateOf(other)).toStrictEqual(before);
    });

    it("touches the new layer, no frame, and the structure; it retains no pixel memory", () => {
        const command = addLayerCommand(fixture(), { newId: () => "new" });

        expect(command.touched).toEqual({ frameIds: [], layerIds: ["new"], structure: true });
        expect(command.bytes).toBe(0);
    });
});

describe("delete layer", () => {
    it("removes the layer, its cels and the images they orphan", () => {
        const session = fixture();
        const target = history(session);

        execute(target, deleteLayerCommand(session, B));

        expect(layerIds(session.doc)).toEqual([A, C]);
        expect([...session.doc.cels.keys()].filter((key) => key.startsWith(B))).toEqual([]);
        expect([...session.doc.images.keys()]).toEqual(["a1", "a3", "c1"]);
        expect(pixelMemoryBytes(session.doc)).toBe(3 * IMAGE_BYTES);
        expect(target.undoLabel).toBe("Delete Layer");
    });

    it("undo restores the layer at its place with its cels, links and pixels", () => {
        const session = fixture();
        const start = stateOf(session);
        const target = history(session);
        execute(target, deleteLayerCommand(session, B));

        undo(target);

        expect(stateOf(session)).toStrictEqual(start);
        expect(layerIds(session.doc)).toEqual([A, B, C]);
        expect(imageIdsOf(session.doc, B)).toEqual(["b1", "b2", "b2", "b4"]);
        expect(celBytes(session.doc, B, F3)).toStrictEqual(pixels(5));
        // The maps are in the order they had: restored entries are not appended.
        expect([...session.doc.images.keys()]).toEqual(["a1", "a3", "b1", "b2", "b4", "c1"]);
    });

    it("makes the layer below active when the active layer is deleted (Aseprite)", () => {
        const session = fixture();
        session.activeLayerId = C;

        execute(history(session), deleteLayerCommand(session, C));

        expect(session.activeLayerId).toBe(B);
    });

    it("makes the layer above active when the deleted active layer was the bottom one", () => {
        const session = fixture();
        session.activeLayerId = A;
        const target = history(session);

        execute(target, deleteLayerCommand(session, A));
        expect(session.activeLayerId).toBe(B);

        undo(target);
        expect(session.activeLayerId).toBe(A);
    });

    it("leaves the active layer alone when another layer is deleted", () => {
        const session = fixture();

        execute(history(session), deleteLayerCommand(session, A));

        expect(session.activeLayerId).toBe(B);
    });

    it("keeps an image that a cel of another layer still names", () => {
        const session = fixture();
        // Cels of two layers on one image: the model allows it.
        session.doc.cels.set(`${A}:${F4}`, { imageId: "b4", opacity: 255 });
        const target = history(session);
        const command = deleteLayerCommand(session, B);

        execute(target, command);

        expect([...session.doc.images.keys()]).toEqual(["a1", "a3", "b4", "c1"]);
        expect(command.bytes).toBe(2 * IMAGE_BYTES);
        undo(target);
        expect(imageIdsOf(session.doc, B)).toEqual(["b1", "b2", "b2", "b4"]);
    });

    it("cannot delete the last pixel layer: typed error, session unchanged", () => {
        const session = emptySession([A]);
        const before = stateOf(session);
        const target = history(session);

        const error = thrownBy(() => target.execute(deleteLayerCommand(session, A)));

        expect(error).toBeInstanceOf(LayerError);
        expect(error).toMatchObject({ name: "LayerError", code: "last-pixel-layer" });
        expect((error as LayerError).message).toBe("The last pixel layer cannot be deleted.");
        expect(stateOf(session)).toStrictEqual(before);
        expect(target.undoCount).toBe(0);
        expect(canDeleteLayer(session.doc, A)).toBe(false);
    });

    it("deletes down to one pixel layer and then refuses", () => {
        const session = fixture();
        const target = history(session);
        expect(canDeleteLayer(session.doc, B)).toBe(true);

        execute(target, deleteLayerCommand(session, B));
        execute(target, deleteLayerCommand(session, session.activeLayerId));

        expect(layerIds(session.doc)).toEqual([C]);
        expect(session.activeLayerId).toBe(C);
        expect(() => deleteLayerCommand(session, C)).toThrow(LayerError);
    });

    it("rejects a layer the document does not have", () => {
        const session = fixture();

        const error = thrownBy(() => deleteLayerCommand(session, "missing"));

        expect(error).toMatchObject({ name: "LayerError", code: "layer-not-found" });
        expect((error as LayerError).message).toContain('"missing"');
        expect(canDeleteLayer(session.doc, "missing")).toBe(false);
    });

    it("touches the layer, the frames where it has a cel, and the structure", () => {
        const session = fixture();

        expect(deleteLayerCommand(session, A).touched).toEqual({
            frameIds: [F1, F2, F3],
            layerIds: [A],
            structure: true,
        });
        expect(deleteLayerCommand(session, B).touched).toEqual({
            frameIds: [F1, F2, F3, F4],
            layerIds: [B],
            structure: true,
        });
    });
});

describe("duplicate layer", () => {
    it("puts a copy with the layer's properties directly above it and makes it active", () => {
        const session = fixture();
        Object.assign(layer(session.doc, B), { locked: true, visible: false, blend: "screen" });
        const target = history(session);

        execute(target, duplicateLayerCommand(session, B, { newId: sequentialIds("new-") }));

        expect(layerIds(session.doc)).toEqual([A, B, "new-1", C]);
        expect(layer(session.doc, "new-1")).toEqual({
            ...layer(session.doc, B),
            id: "new-1",
            name: `${B} Copy`,
        });
        expect(layer(session.doc, "new-1")).toMatchObject({
            kind: "pixel",
            opacity: 128,
            locked: true,
            visible: false,
            blend: "screen",
        });
        expect(session.activeLayerId).toBe("new-1");
        expect(target.undoLabel).toBe("Duplicate Layer");
    });

    it("copies every cel onto an image of its own; linked cels stay linked within the copy", () => {
        const session = fixture();

        execute(
            history(session),
            duplicateLayerCommand(session, C, { newId: sequentialIds("new-") }),
        );
        const { doc } = session;

        // c1 is linked across three frames: one new image, shared by the three copies.
        expect(imageIdsOf(doc, "new-1")).toEqual(["new-2", "new-2", "new-2", null]);
        expect(imageIdsOf(doc, C)).toEqual(["c1", "c1", "c1", null]);
        expect(doc.images.get("new-2")).not.toBe(doc.images.get("c1"));
        expect(doc.images.get("new-2")?.data.buffer).not.toBe(doc.images.get("c1")?.data.buffer);
        // Byte for byte, colour under alpha 0 included.
        expect(doc.images.get("new-2")).toStrictEqual(doc.images.get("c1"));
        expect(celBytes(doc, "new-1", F1)).toStrictEqual(pixels(8));
        // Cel opacity is copied with the cel.
        expect(celAt(doc, "new-1", F1)?.opacity).toBe(200);
        expect(celAt(doc, "new-1", F2)?.opacity).toBe(255);
    });

    it("copies a layer with linked and unlinked cels, one image per image of the layer", () => {
        const session = fixture();

        execute(
            history(session),
            duplicateLayerCommand(session, B, { newId: sequentialIds("new-") }),
        );
        const { doc } = session;

        expect(imageIdsOf(doc, "new-1")).toEqual(["new-2", "new-3", "new-3", "new-4"]);
        expect(doc.images.size).toBe(9);
        for (const frame of FRAMES) {
            expect(celBytes(doc, "new-1", frame)).toStrictEqual(celBytes(doc, B, frame));
            expect(celBytes(doc, "new-1", frame)).not.toBe(celBytes(doc, B, frame));
        }
    });

    it("a change of the copy does not reach the layer it was copied from", () => {
        const session = fixture();
        execute(
            history(session),
            duplicateLayerCommand(session, B, { newId: sequentialIds("new-") }),
        );

        celBytes(session.doc, "new-1", F2).fill(9);

        expect(celBytes(session.doc, "new-1", F3)).toStrictEqual(
            new Uint8ClampedArray(IMAGE_BYTES).fill(9),
        );
        expect(celBytes(session.doc, B, F2)).toStrictEqual(pixels(5));
    });

    it("undo removes the copy with its images; redo makes the same IDs and bytes again", () => {
        const session = fixture();
        const start = stateOf(session);
        const target = history(session);
        const command = duplicateLayerCommand(session, B, { newId: sequentialIds("new-") });
        execute(target, command);
        const done = stateOf(session);

        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
        expect(session.doc.images.has("new-2")).toBe(false);
        expect(session.activeLayerId).toBe(B);

        redo(target);
        expect(stateOf(session)).toStrictEqual(done);
        // The copies belong to the document; the command retains nothing.
        expect(command.bytes).toBe(0);
        expect(target.bytes).toBe(0);
    });

    it("touches the copy, the frames where the layer has a cel, and the structure", () => {
        const session = fixture();

        expect(duplicateLayerCommand(session, A, { newId: () => "new" }).touched).toEqual({
            frameIds: [F1, F2, F3],
            layerIds: ["new"],
            structure: true,
        });
    });

    it("rejects a layer the document does not have", () => {
        expect(thrownBy(() => duplicateLayerCommand(fixture(), "missing"))).toMatchObject({
            name: "LayerError",
            code: "layer-not-found",
        });
    });

    it("when memory runs out, throws AllocationError and leaves session and history unchanged", () => {
        const session = fixture();
        const before = stateOf(session);
        const target = history(session);
        // Layer b has three images; the third allocation fails.
        const memory = flakyAllocator(2);
        const command = duplicateLayerCommand(session, B, {
            newId: sequentialIds("new-"),
            allocate: memory.allocate,
        });

        const error = thrownBy(() => target.execute(command));

        expect(error).toBeInstanceOf(AllocationError);
        expect((error as AllocationError).bytes).toBe(IMAGE_BYTES);
        expect(memory.calls).toBe(3);
        expect(stateOf(session)).toStrictEqual(before);
        expect(target.undoCount).toBe(0);

        // The same command works once memory is available.
        memory.heal();
        execute(target, command);
        expect(imageIdsOf(session.doc, "new-1")).toEqual(["new-2", "new-3", "new-3", "new-4"]);
    });

    it("when memory runs out in a redo, leaves the session and the history in place", () => {
        const session = fixture();
        const target = history(session);
        const memory = flakyAllocator(3);
        execute(
            target,
            duplicateLayerCommand(session, B, {
                newId: sequentialIds("new-"),
                allocate: memory.allocate,
            }),
        );
        const done = stateOf(session);
        undo(target);
        const undone = stateOf(session);

        expect(() => target.redo()).toThrow(AllocationError);

        expect(stateOf(session)).toStrictEqual(undone);
        expect(target.redoCount).toBe(1);
        memory.heal();
        redo(target);
        expect(stateOf(session)).toStrictEqual(done);
    });
});

describe("reorder layer", () => {
    it.each([
        { id: A, to: 2, order: [B, C, A] },
        { id: A, to: 1, order: [B, A, C] },
        { id: C, to: 0, order: [C, A, B] },
        { id: B, to: 0, order: [B, A, C] },
        { id: B, to: 2, order: [A, C, B] },
    ])("moves $id to position $to of the stack", ({ id, to, order }) => {
        const session = fixture();
        const target = history(session);

        execute(target, reorderLayerCommand(session, id, to));

        expect(layerIds(session.doc)).toEqual(order);
        expect(session.doc.layers[to].id).toBe(id);
        // The active layer stays the active layer, wherever it went.
        expect(session.activeLayerId).toBe(B);
        expect(target.undoLabel).toBe("Move Layer");
        undo(target);
        expect(layerIds(session.doc)).toEqual([A, B, C]);
    });

    it("makes no command when the layer is at that position already", () => {
        const session = fixture();
        const before = stateOf(session);
        const target = history(session);

        expect(reorderLayerCommand(session, A, 0)).toBeNull();
        expect(reorderLayerCommand(session, B, 1)).toBeNull();
        expect(reorderLayerCommand(session, C, 2)).toBeNull();
        expect(stateOf(session)).toStrictEqual(before);

        execute(target, reorderLayerCommand(session, B, 2));
        expect(reorderLayerCommand(session, B, 2)).toBeNull();
        expect(reorderLayerCommand(session, B, 1)).not.toBeNull();
        expect(target.undoCount).toBe(1);
        // A position outside the stack is an error, not a move that changes nothing.
        expect(() => reorderLayerCommand(session, B, 3)).toThrow(LayerError);
    });

    it("moves the layer objects, not copies, and changes no cel", () => {
        const session = fixture();
        const objects = [...session.doc.layers];
        const cels = structuredClone([...session.doc.cels]);

        execute(history(session), reorderLayerCommand(session, A, 2));

        expect(session.doc.layers).toEqual([objects[1], objects[2], objects[0]]);
        expect(session.doc.layers[2]).toBe(objects[0]);
        expect([...session.doc.cels]).toStrictEqual(cels);
    });

    it("changes the composite where the moved layer covers another", () => {
        const session = fixture();
        const before = composites(session.doc);

        execute(history(session), reorderLayerCommand(session, C, 0));
        const after = composites(session.doc);

        expect(after[0]).not.toStrictEqual(before[0]);
        // Layer c has no cel at frame 4.
        expect(after[3]).toStrictEqual(before[3]);
    });

    it("rejects a position outside the stack and a layer the document does not have", () => {
        const session = fixture();
        const before = stateOf(session);

        for (const to of [-1, 3, 1.5, Number.NaN, Infinity]) {
            const error = thrownBy(() => reorderLayerCommand(session, A, to));
            expect(error, String(to)).toBeInstanceOf(LayerError);
            expect(error, String(to)).toMatchObject({ code: "index" });
        }
        expect(thrownBy(() => reorderLayerCommand(session, "missing", 0))).toMatchObject({
            code: "layer-not-found",
        });
        expect(stateOf(session)).toStrictEqual(before);
    });

    it("touches the layer, the frames where it has a cel, and the structure", () => {
        const command = made(reorderLayerCommand(fixture(), C, 0));

        expect(command.touched).toEqual({
            frameIds: [F1, F2, F3],
            layerIds: [C],
            structure: true,
        });
        expect(command.bytes).toBe(0);
    });
});

describe("stack commands and a session that changed since they were made", () => {
    it("a command made before another one ran throws instead of running", () => {
        const session = fixture();
        const target = history(session);
        const stale = deleteLayerCommand(session, C);
        execute(target, deleteLayerCommand(session, A));
        const before = stateOf(session);

        expect(() => target.execute(stale)).toThrow(/the session changed/);

        expect(stateOf(session)).toStrictEqual(before);
        expect(target.undoCount).toBe(1);
    });

    it("a command made before a stroke added a cel throws instead of running", () => {
        const session = fixture();
        const target = history(session);
        const stale = deleteLayerCommand(session, A);
        const stroke = target.begin({ layerId: A, frameId: F4 }, () => "a4");
        stroke.image.data.fill(255);
        stroke.markDirty({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
        stroke.commit("Pencil");
        const before = stateOf(session);

        // Run, it would leave the new cel behind, on a layer that is gone.
        expect(() => target.execute(stale)).toThrow(/the session changed/);

        expect(stateOf(session)).toStrictEqual(before);
        execute(target, deleteLayerCommand(session, A));
        expect([...session.doc.cels.keys()].filter((key) => key.startsWith(A))).toEqual([]);
        expect(session.doc.images.has("a4")).toBe(false);
    });

    it("two of them in one composite leave the session unchanged", () => {
        const session = fixture();
        const before = stateOf(session);
        const target = history(session);
        const both = compositeCommand("Delete Layers", [
            deleteLayerCommand(session, A),
            deleteLayerCommand(session, C),
        ]);

        expect(() => target.execute(both)).toThrow(/the session changed/);

        // The composite took its first command back.
        expect(stateOf(session)).toStrictEqual(before);
        expect(target.undoCount).toBe(0);
    });
});
