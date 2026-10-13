import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { AllocationError, compositeCommand } from "../../src/core/history";
import {
    flattenCommand,
    LayerError,
    mergeDownCommand,
    mergeDownTarget,
    renameLayerCommand,
    setLayerLockedCommand,
    setLayerOpacityCommand,
    setLayerVisibleCommand,
} from "../../src/core/layers";
import { celAt, celKey, pixelMemoryBytes, sequentialIds } from "../../src/core/model";
import type { DocSession, SpriteDoc } from "../../src/core/model";
import {
    A,
    addCel,
    B,
    C,
    celBytes,
    composites,
    compositesOf,
    compositesShown,
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
    linkCel,
    made,
    pixelLayer,
    pixels,
    redo,
    referenceLayer,
    stateOf,
    thrownBy,
    undo,
    WIDTH,
} from "./se-020-support";

// SE-020: merge down and flatten (SPEC §7.3). Both bake opacity and blend mode through
// `compositeFrame`, frame by frame.

const [F1, F2, F3, F4] = FRAMES;

/** An image of the fixture's size with every pixel `rgba`. */
function flood(rgba: readonly number[]): Uint8ClampedArray {
    const data = new Uint8ClampedArray(IMAGE_BYTES);
    for (let at = 0; at < data.length; at += 4) data.set(rgba, at);
    return data;
}

/** Gives a cel an image of its own in which every pixel is `rgba`. */
function floodCel(
    doc: SpriteDoc,
    layerId: string,
    frameId: string,
    rgba: readonly number[],
    opacity = 255,
): void {
    const imageId = `image-${layerId}-${frameId}`;
    doc.images.set(imageId, { width: WIDTH, height: HEIGHT, data: flood(rgba) });
    doc.cels.set(celKey(layerId, frameId), { imageId, opacity });
}

/** The composite of each frame of one layer alone, with the layer as it is in the document. */
function alone(doc: SpriteDoc, layerId: string) {
    return compositesOf(doc, [layerId]);
}

const BLUE = [0, 0, 255, 255];
const HALF_RED = [255, 0, 0, 128];
/** `HALF_RED` over `BLUE` (hand-computed in se-010-golden.test.ts). */
const PURPLE = [128, 0, 127, 255];

function ids() {
    return { newId: sequentialIds("new-") };
}

describe("merge down, the acceptance on the fixture", () => {
    it.each([
        { upper: B, lower: A, rest: [A, C], hidden: [] },
        { upper: C, lower: B, rest: [A, B], hidden: [] },
        { upper: B, lower: A, rest: [A, C], hidden: [B] },
        { upper: B, lower: A, rest: [A, C], hidden: [A] },
        { upper: B, lower: A, rest: [A, C], hidden: [A, B] },
        { upper: C, lower: B, rest: [A, B], hidden: [C] },
        { upper: C, lower: B, rest: [A, B], hidden: [B] },
        { upper: C, lower: B, rest: [A, B], hidden: [B, C] },
    ])(
        "$upper into $lower with $hidden hidden: the result equals compositeFrame restricted to the two layers, both taken as visible, for every frame",
        ({ upper, lower, rest, hidden }) => {
            const session = fixture();
            const { doc } = session;
            for (const id of hidden) layer(doc, id).visible = false;
            const expected = compositesShown(doc, [lower, upper]);
            expect(expected).toHaveLength(4);
            // Whatever is hidden, it is what the two layers give when both are shown.
            expect(expected).toStrictEqual(compositesOf(fixture().doc, [lower, upper]));

            execute(history(session), mergeDownCommand(session, upper, ids()));

            expect(layerIds(doc)).toEqual(rest);
            // The merged layer by itself composites to what the two layers gave together…
            expect(compositesShown(doc, [lower])).toStrictEqual(expected);
            // …because its images are those composites, shown as they are.
            FRAMES.forEach((frame, index) => {
                expect(celBytes(doc, lower, frame), frame).toStrictEqual(expected[index].data);
                expect(celAt(doc, lower, frame)?.opacity, frame).toBe(255);
            });
            // The target stays hidden or visible as it was.
            expect(layer(doc, lower)).toMatchObject({
                kind: "pixel",
                visible: !(hidden as string[]).includes(lower),
                opacity: 255,
                blend: "normal",
            });
        },
    );

    it("unlinks linked cels of the target whose results differ", () => {
        const session = fixture();
        expect(imageIdsOf(session.doc, A)).toEqual(["a1", "a1", "a3", null]);

        execute(history(session), mergeDownCommand(session, B, ids()));

        // a1 was shared by frames 1 and 2; layer b has b1 above the one and b2 above the other.
        const merged = imageIdsOf(session.doc, A);
        expect(merged).toEqual(["new-1", "new-2", "new-3", "new-4"]);
        expect(celBytes(session.doc, A, F1)).not.toStrictEqual(celBytes(session.doc, A, F2));
        expect([...session.doc.images.keys()]).toEqual(["c1", "new-1", "new-2", "new-3", "new-4"]);
    });

    it("keeps linked cels of the target linked when their results are byte-equal", () => {
        const session = fixture();
        expect(imageIdsOf(session.doc, B)).toEqual(["b1", "b2", "b2", "b4"]);

        execute(history(session), mergeDownCommand(session, C, ids()));

        // b2 is shared by frames 2 and 3, and layer c has the same image above both.
        expect(imageIdsOf(session.doc, B)).toEqual(["new-1", "new-2", "new-2", "new-4"]);
        expect(session.doc.images.has("new-3")).toBe(false);
        expect([...session.doc.images.keys()]).toEqual(["a1", "a3", "new-1", "new-2", "new-4"]);
    });

    it("makes the layer below active when the merged layer was active (Aseprite)", () => {
        const session = fixture();
        const target = history(session);

        execute(target, mergeDownCommand(session, B, ids()));
        expect(session.activeLayerId).toBe(A);
        expect(target.undoLabel).toBe("Merge Down");

        undo(target);
        expect(session.activeLayerId).toBe(B);
    });

    it("leaves another active layer active", () => {
        const session = fixture();
        session.activeLayerId = A;

        execute(history(session), mergeDownCommand(session, C, ids()));

        expect(session.activeLayerId).toBe(A);
    });

    it("undo restores both layers with their opacity, cels, links and pixels; redo merges again", () => {
        const session = fixture();
        const start = stateOf(session);
        const target = history(session);
        execute(target, mergeDownCommand(session, B, ids()));
        const done = stateOf(session);

        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
        expect(layer(session.doc, B).opacity).toBe(128);
        expect(imageIdsOf(session.doc, A)).toEqual(["a1", "a1", "a3", null]);
        expect(celBytes(session.doc, A, F2)).toStrictEqual(pixels(1));

        redo(target);
        expect(stateOf(session)).toStrictEqual(done);
    });

    it("touches both layers, the frames where one of them has a cel, and the structure", () => {
        const session = fixture();

        expect(mergeDownCommand(session, C).touched).toEqual({
            frameIds: [F1, F2, F3, F4],
            layerIds: [B, C],
            structure: true,
        });
        session.doc.cels.delete(celKey(B, F4));
        session.doc.images.delete("b4");
        expect(mergeDownCommand(session, B).touched).toEqual({
            frameIds: [F1, F2, F3],
            layerIds: [A, B],
            structure: true,
        });
    });
});

describe("merge down, what is baked", () => {
    /** Two layers, `lower` and `upper`, with the first frame active. */
    function pair(): DocSession {
        const session = emptySession(["lower", "upper"]);
        session.activeLayerId = "upper";
        return session;
    }

    function merge(session: DocSession): void {
        execute(history(session), mergeDownCommand(session, "upper", ids()));
    }

    it("blends the upper layer over the lower one with the compositor's formula", () => {
        const session = pair();
        floodCel(session.doc, "lower", F1, BLUE);
        floodCel(session.doc, "upper", F1, HALF_RED);

        merge(session);

        expect(celBytes(session.doc, "lower", F1)).toStrictEqual(flood(PURPLE));
    });

    it("bakes layer opacity and cel opacity into the pixels and resets both to 255", () => {
        const session = pair();
        layer(session.doc, "lower").opacity = 100;
        floodCel(session.doc, "lower", F1, [10, 20, 30, 200]);
        floodCel(session.doc, "lower", F2, [10, 20, 30, 200], 100);
        layer(session.doc, "upper").opacity = 0;
        floodCel(session.doc, "upper", F3, [1, 2, 3, 255]);
        const before = composites(session.doc);

        merge(session);
        const { doc } = session;

        // mul(200, 100) = round(78.43) = 78; mul(100, 100) = 39 and mul(200, 39) = 31.
        expect(celBytes(doc, "lower", F1)).toStrictEqual(flood([10, 20, 30, 78]));
        expect(celBytes(doc, "lower", F2)).toStrictEqual(flood([10, 20, 30, 31]));
        expect(layer(doc, "lower").opacity).toBe(255);
        expect(FRAMES.map((frame) => celAt(doc, "lower", frame)?.opacity)).toEqual([
            255,
            255,
            255,
            undefined,
        ]);
        // What the two layers showed is what the one layer shows.
        expect(composites(doc)).toStrictEqual(before);
        // A visible layer with opacity 0 has a cel at frame 3: the result has one, transparent.
        expect(celBytes(doc, "lower", F3)).toStrictEqual(new Uint8ClampedArray(IMAGE_BYTES));
    });

    it("bakes the blend modes and leaves the merged layer with blend mode normal", () => {
        const session = pair();
        Object.assign(layer(session.doc, "lower"), { blend: "screen" });
        Object.assign(layer(session.doc, "upper"), { blend: "multiply" });
        addCel(session.doc, "lower", F1, "l1", 11);
        addCel(session.doc, "upper", F1, "u1", 12);
        const expected = composites(session.doc);

        merge(session);

        expect(layer(session.doc, "lower")).toMatchObject({ blend: "normal" });
        expect(alone(session.doc, "lower")).toStrictEqual(expected);
    });

    it("drops colour stored under alpha 0, as every composite does", () => {
        const session = pair();
        floodCel(session.doc, "lower", F1, [9, 9, 9, 0]);
        floodCel(session.doc, "upper", F1, [7, 7, 7, 0]);

        merge(session);

        expect(celBytes(session.doc, "lower", F1)).toStrictEqual(
            new Uint8ClampedArray(IMAGE_BYTES),
        );
    });

    it("gives the target a cel where only the upper layer has one, and none where neither has", () => {
        const session = pair();
        addCel(session.doc, "lower", F1, "l1", 1);
        addCel(session.doc, "upper", F2, "u2", 2);
        addCel(session.doc, "lower", F3, "l3", 3);
        addCel(session.doc, "upper", F3, "u3", 4);
        // With nothing below, the pixels of the upper layer are the result.
        const upperAlone = compositeFrame({ ...session.doc, layers: [pixelLayer("upper")] }, F2);

        merge(session);

        expect(imageIdsOf(session.doc, "lower")).toEqual(["new-1", "new-2", "new-3", null]);
        expect(celBytes(session.doc, "lower", F2)).toStrictEqual(upperAlone.data);
        expect(session.doc.cels.size).toBe(3);
        expect(session.doc.images.size).toBe(3);
    });

    it("keeps the target's ID, name and lock", () => {
        const session = pair();
        Object.assign(layer(session.doc, "lower"), { name: "Body", locked: true });
        Object.assign(layer(session.doc, "upper"), { name: "Ink" });
        addCel(session.doc, "upper", F1, "u1", 2);

        merge(session);

        expect(session.doc.layers).toEqual([pixelLayer("lower", { name: "Body", locked: true })]);
    });

    it("unlinks linked cels of the target that differ only in cel opacity", () => {
        const session = pair();
        addCel(session.doc, "lower", F1, "l1", 1);
        linkCel(session.doc, "lower", F2, "l1", 128);
        linkCel(session.doc, "lower", F3, "l1");

        merge(session);

        expect(imageIdsOf(session.doc, "lower")).toEqual(["new-1", "new-2", "new-1", null]);
    });

    it("never links a cel the target did not have, even to an equal result", () => {
        const session = pair();
        addCel(session.doc, "upper", F1, "u1", 6);
        linkCel(session.doc, "upper", F2, "u1");

        merge(session);

        expect(imageIdsOf(session.doc, "lower")).toEqual(["new-1", "new-2", null, null]);
        expect(celBytes(session.doc, "lower", F1)).toStrictEqual(
            celBytes(session.doc, "lower", F2),
        );
    });

    it("keeps an image that a cel of a third layer still names", () => {
        const session = fixture();
        session.doc.cels.set(celKey(C, F4), { imageId: "b4", opacity: 255 });
        const command = mergeDownCommand(session, B, ids());

        execute(history(session), command);

        expect(session.doc.images.has("b4")).toBe(true);
        expect(celBytes(session.doc, C, F4)).toStrictEqual(pixels(7));
        expect(command.bytes).toBe(4 * IMAGE_BYTES);
    });
});

describe("merge down, hidden layers", () => {
    function hidden(which: readonly string[]): DocSession {
        const session = fixture();
        for (const id of which) layer(session.doc, id).visible = false;
        return session;
    }

    // Merge down follows Aseprite: the two layers are merged whatever their `visible` flag,
    // and the target stays hidden or visible as it was. No pixel is lost.

    it("a hidden upper layer is merged like a visible one, and its pixels show in the visible target", () => {
        const session = hidden([B]);
        const { doc } = session;
        const start = stateOf(session);
        const expected = compositesShown(doc, [A, B]);
        // The hidden layer has pixels of its own to add.
        expect(expected).not.toStrictEqual(compositesOf(doc, [A]));
        const shown = composites(doc);
        const target = history(session);

        execute(target, mergeDownCommand(session, B, ids()));

        expect(layer(doc, A).visible).toBe(true);
        expect(alone(doc, A)).toStrictEqual(expected);
        // A cel wherever one of the two layers had one: layer b alone had the one at frame 4.
        expect(imageIdsOf(doc, A)).toEqual(["new-1", "new-2", "new-3", "new-4"]);
        expect(celBytes(doc, A, F4)).toStrictEqual(expected[3].data);
        // What was hidden in layer b is on screen now, in layer a.
        expect(composites(doc)).not.toStrictEqual(shown);
        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
        expect(layer(doc, B).visible).toBe(false);
    });

    it("a hidden target keeps its pixels, takes those of the upper layer and stays hidden", () => {
        const session = hidden([A]);
        const { doc } = session;
        const start = stateOf(session);
        const expected = compositesShown(doc, [A, B]);
        // Neither the pixels of the hidden target nor those of the upper layer are left out.
        expect(expected).not.toStrictEqual(compositesOf(doc, [B]));
        expect(expected).not.toStrictEqual(compositesShown(doc, [A]));
        const target = history(session);

        execute(target, mergeDownCommand(session, B, ids()));

        expect(layer(doc, A)).toEqual(pixelLayer(A, { visible: false }));
        expect(compositesShown(doc, [A])).toStrictEqual(expected);
        expect(imageIdsOf(doc, A)).toEqual(["new-1", "new-2", "new-3", "new-4"]);
        // Hidden, the target adds nothing: only layer c is on screen.
        expect(composites(doc)).toStrictEqual(compositesOf(doc, [C]));
        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
    });

    it("two hidden layers merge into one hidden layer that holds the pixels of both", () => {
        const session = hidden([A, B]);
        const { doc } = session;
        const start = stateOf(session);
        const expected = compositesShown(doc, [A, B]);
        const shown = composites(doc);
        const target = history(session);
        const command = mergeDownCommand(session, B, ids());

        execute(target, command);

        expect(layer(doc, A).visible).toBe(false);
        expect(compositesShown(doc, [A])).toStrictEqual(expected);
        expect(imageIdsOf(doc, A)).toEqual(["new-1", "new-2", "new-3", "new-4"]);
        expect([...doc.images.keys()]).toEqual(["c1", "new-1", "new-2", "new-3", "new-4"]);
        // Hidden before and hidden after: nothing on screen changes.
        expect(composites(doc)).toStrictEqual(shown);
        expect(command.bytes).toBe(5 * IMAGE_BYTES);
        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
    });

    it("keeps the name, the lock and the visibility of the target, and resets what was baked", () => {
        const session = hidden([A]);
        const { doc } = session;
        Object.assign(layer(doc, A), { name: "Body", locked: true, opacity: 90, blend: "screen" });

        execute(history(session), mergeDownCommand(session, B, ids()));

        expect(layer(doc, A)).toEqual(
            pixelLayer(A, { name: "Body", locked: true, visible: false, opacity: 255 }),
        );
    });
});

describe("merge down, guards", () => {
    it("requires a pixel layer below: typed error, session unchanged", () => {
        const session = fixture();
        const before = stateOf(session);
        const target = history(session);

        const error = thrownBy(() => target.execute(mergeDownCommand(session, A)));

        expect(error).toBeInstanceOf(LayerError);
        expect(error).toMatchObject({ name: "LayerError", code: "no-pixel-layer-below" });
        expect((error as LayerError).message).toBe(`Merge Down needs a pixel layer below "${A}".`);
        expect(stateOf(session)).toStrictEqual(before);
        expect(target.undoCount).toBe(0);
    });

    it("rejects a layer the document does not have", () => {
        expect(thrownBy(() => mergeDownCommand(fixture(), "missing"))).toMatchObject({
            name: "LayerError",
            code: "layer-not-found",
        });
    });

    it("names its target, or none", () => {
        const { doc } = fixture();

        expect(mergeDownTarget(doc, C)?.id).toBe(B);
        expect(mergeDownTarget(doc, B)?.id).toBe(A);
        expect(mergeDownTarget(doc, A)).toBeUndefined();
        expect(mergeDownTarget(doc, "missing")).toBeUndefined();
    });

    it("when memory runs out, throws AllocationError and leaves session and history unchanged", () => {
        const session = fixture();
        const before = stateOf(session);
        const target = history(session);
        // One image per frame; the third allocation fails.
        const memory = flakyAllocator(2);
        const command = mergeDownCommand(session, B, { ...ids(), allocate: memory.allocate });

        const error = thrownBy(() => target.execute(command));

        expect(error).toBeInstanceOf(AllocationError);
        expect((error as AllocationError).bytes).toBe(IMAGE_BYTES);
        expect(stateOf(session)).toStrictEqual(before);
        expect(target.undoCount).toBe(0);

        memory.heal();
        execute(target, command);
        expect(layerIds(session.doc)).toEqual([A, C]);
    });
});

describe("flatten, the acceptance on the fixture", () => {
    it("yields one pixel layer whose composite is byte-identical to the pre-flatten composite", () => {
        const session = fixture();
        const { doc } = session;
        const before = composites(doc);
        const target = history(session);

        execute(target, flattenCommand(session, ids()));

        expect(doc.layers).toHaveLength(1);
        expect(doc.layers[0]).toEqual(pixelLayer(A));
        const after = composites(doc);
        expect(after).toHaveLength(4);
        after.forEach((composite, index) => {
            expect(composite.data, FRAMES[index]).toStrictEqual(before[index].data);
        });
        // The images of the one layer are those composites.
        FRAMES.forEach((frame, index) => {
            expect(celBytes(doc, A, frame), frame).toStrictEqual(before[index].data);
            expect(celAt(doc, A, frame)?.opacity, frame).toBe(255);
        });
        expect(target.undoLabel).toBe("Flatten");
    });

    it("flattens into the bottom pixel layer and makes it the active layer", () => {
        const session = fixture();
        session.activeLayerId = C;
        const target = history(session);

        execute(target, flattenCommand(session, ids()));

        expect(layerIds(session.doc)).toEqual([A]);
        expect(session.activeLayerId).toBe(A);
        undo(target);
        expect(session.activeLayerId).toBe(C);
    });

    it("replaces every image; undo restores the three layers exactly", () => {
        const session = fixture();
        const start = stateOf(session);
        const target = history(session);
        const command = made(flattenCommand(session, ids()));

        execute(target, command);
        // Frames 1 and 2 shared a1 in the target, under different images of layer b.
        expect([...session.doc.images.keys()]).toEqual(["new-1", "new-2", "new-3", "new-4"]);
        expect(command.bytes).toBe(6 * IMAGE_BYTES);
        const done = stateOf(session);

        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
        redo(target);
        expect(stateOf(session)).toStrictEqual(done);
    });

    it("touches every pixel layer, the frames where one has a cel, and the structure", () => {
        expect(made(flattenCommand(fixture())).touched).toEqual({
            frameIds: [F1, F2, F3, F4],
            layerIds: [A, B, C],
            structure: true,
        });
    });
});

describe("flatten, rules", () => {
    it("keeps linked cels of the target linked when their results are byte-equal", () => {
        const session = emptySession([A, B]);
        const { doc } = session;
        addCel(doc, A, F1, "a1", 1);
        linkCel(doc, A, F2, "a1");
        linkCel(doc, A, F3, "a1");
        addCel(doc, B, F1, "b1", 2);
        linkCel(doc, B, F2, "b1");
        addCel(doc, B, F3, "b3", 3);
        const before = composites(doc);

        execute(history(session), flattenCommand(session, ids()));

        expect(imageIdsOf(doc, A)).toEqual(["new-1", "new-1", "new-3", null]);
        expect(composites(doc)).toStrictEqual(before);
    });

    it("deletes hidden layers, which add nothing, and leaves the composite as it was", () => {
        const session = fixture();
        const { doc } = session;
        layer(doc, B).visible = false;
        const before = composites(doc);
        expect(before).toStrictEqual(compositesOf(doc, [A, C]));

        execute(history(session), flattenCommand(session, ids()));

        expect(layerIds(doc)).toEqual([A]);
        expect(composites(doc)).toStrictEqual(before);
        // Only the hidden layer had a cel at frame 4.
        expect(imageIdsOf(doc, A)).toEqual(["new-1", "new-2", "new-3", null]);
    });

    it("a hidden bottom layer becomes the visible flat layer without its own pixels", () => {
        const session = fixture();
        const { doc } = session;
        layer(doc, A).visible = false;
        const before = composites(doc);

        execute(history(session), flattenCommand(session, ids()));

        expect(doc.layers).toEqual([pixelLayer(A)]);
        expect(composites(doc)).toStrictEqual(before);
    });

    it("bakes opacity, cel opacity and blend mode of a single pixel layer", () => {
        const session = emptySession([A]);
        const { doc } = session;
        Object.assign(layer(doc, A), { opacity: 100, blend: "overlay", locked: true });
        addCel(doc, A, F1, "a1", 1, 100);
        const before = composites(doc);

        execute(history(session), flattenCommand(session, ids()));

        expect(doc.layers).toEqual([pixelLayer(A, { locked: true })]);
        expect(celAt(doc, A, F1)).toEqual({ imageId: "new-1", opacity: 255 });
        expect(composites(doc)).toStrictEqual(before);
        expect(celBytes(doc, A, F1)).toStrictEqual(before[0].data);
        // Alpha 255 of the source became mul(255, mul(100, 100)) = 39.
        expect(Array.from(celBytes(doc, A, F1)).filter((_, at) => at % 4 === 3)).toContain(39);
    });

    it("when memory runs out, throws AllocationError and leaves session and history unchanged", () => {
        const session = fixture();
        const before = stateOf(session);
        const target = history(session);
        const memory = flakyAllocator(3);
        const command = made(flattenCommand(session, { ...ids(), allocate: memory.allocate }));

        expect(() => target.execute(command)).toThrow(AllocationError);

        expect(memory.calls).toBe(4);
        expect(stateOf(session)).toStrictEqual(before);
        expect(target.undoCount).toBe(0);
    });

    it("allocates one image per frame through the given allocator", () => {
        const session = fixture();
        const memory = flakyAllocator(Infinity);

        execute(history(session), flattenCommand(session, { ...ids(), allocate: memory.allocate }));

        expect(memory.calls).toBe(FRAMES.length);
        expect(session.doc.images.size).toBe(4);
        expect(pixelMemoryBytes(session.doc)).toBe(4 * IMAGE_BYTES);
    });
});

describe("flatten, nothing to flatten", () => {
    /** One pixel layer with nothing to bake, and cels at two frames. */
    function flat(): DocSession {
        const session = emptySession([A]);
        addCel(session.doc, A, F1, "a1", 1);
        linkCel(session.doc, A, F2, "a1");
        return session;
    }

    it("makes no command for one pixel layer that is visible, at opacity 255, blend mode normal, with every cel at opacity 255", () => {
        const session = flat();
        const before = stateOf(session);

        expect(flattenCommand(session)).toBeNull();
        expect(stateOf(session)).toStrictEqual(before);
        // Without a cel as well.
        expect(flattenCommand(emptySession([A]))).toBeNull();
    });

    it("makes no command when only reference layers are beside that layer, and leaves the active layer alone", () => {
        const session = flat();
        session.doc.layers.unshift(referenceLayer("ref-back"));
        session.doc.layers.push(referenceLayer("ref-front"));
        session.activeLayerId = "ref-front";

        expect(flattenCommand(session)).toBeNull();
        expect(session.activeLayerId).toBe("ref-front");
    });

    it.each([
        {
            what: "the layer is hidden",
            change: (doc: SpriteDoc) => (layer(doc, A).visible = false),
        },
        {
            what: "the layer has opacity 254",
            change: (doc: SpriteDoc) => (layer(doc, A).opacity = 254),
        },
        {
            what: "the layer has another blend mode",
            change: (doc: SpriteDoc) => Object.assign(layer(doc, A), { blend: "multiply" }),
        },
        {
            what: "a cel has opacity 254",
            change: (doc: SpriteDoc) =>
                doc.cels.set(celKey(A, F2), { imageId: "a1", opacity: 254 }),
        },
        {
            what: "there is a second pixel layer, though it is empty",
            change: (doc: SpriteDoc) => doc.layers.push(pixelLayer(B)),
        },
    ])("makes a command when $what", ({ change }) => {
        const session = flat();
        change(session.doc);
        const before = composites(session.doc);
        const target = history(session);

        execute(target, flattenCommand(session, ids()));

        expect(session.doc.layers).toEqual([pixelLayer(A)]);
        expect(composites(session.doc)).toStrictEqual(before);
        expect(target.undoCount).toBe(1);
        // What it left is flat.
        expect(flattenCommand(session)).toBeNull();
    });

    it("after a flatten there is nothing to flatten", () => {
        const session = fixture();
        const target = history(session);

        execute(target, flattenCommand(session, ids()));

        expect(flattenCommand(session)).toBeNull();
        undo(target);
        expect(flattenCommand(session)).not.toBeNull();
    });
});

describe("merge down and flatten on the session they find when they are done", () => {
    it("a rename of the target and a merge down made together keep the new name", () => {
        const session = fixture();
        const start = stateOf(session);
        const expected = compositesOf(session.doc, [A, B]);
        const target = history(session);
        // Both are made from the same session; the merge is done after the rename.
        const step = compositeCommand("Rename and Merge", [
            made(renameLayerCommand(session, A, "Body")),
            mergeDownCommand(session, B, ids()),
        ]);

        execute(target, step);

        expect(layerIds(session.doc)).toEqual([A, C]);
        expect(layer(session.doc, A).name).toBe("Body");
        expect(compositesOf(session.doc, [A])).toStrictEqual(expected);
        const done = stateOf(session);

        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
        redo(target);
        expect(stateOf(session)).toStrictEqual(done);
        expect(layer(session.doc, A).name).toBe("Body");
    });

    it("lock and visibility set in the same step are those the merged layer keeps", () => {
        const session = fixture();
        const target = history(session);

        execute(
            target,
            compositeCommand("Lock, Hide and Merge", [
                made(setLayerLockedCommand(session, A, true)),
                made(setLayerVisibleCommand(session, A, false)),
                mergeDownCommand(session, B, ids()),
            ]),
        );

        expect(layer(session.doc, A)).toEqual(pixelLayer(A, { locked: true, visible: false }));
    });

    it("an opacity set in the same step is the opacity a merge down bakes", () => {
        const session = fixture();
        const target = history(session);
        const opaque = fixture();
        layer(opaque.doc, B).opacity = 255;
        const expected = compositesOf(opaque.doc, [A, B]);

        execute(
            target,
            compositeCommand("Opacity and Merge", [
                made(setLayerOpacityCommand(session, B, 255)),
                mergeDownCommand(session, B, ids()),
            ]),
        );

        expect(compositesOf(session.doc, [A])).toStrictEqual(expected);
    });

    it("a layer hidden in the same step is a hidden layer to flatten: its pixels are dropped", () => {
        const session = fixture();
        const start = stateOf(session);
        const withoutB = compositesOf(session.doc, [A, C]);
        const target = history(session);

        execute(
            target,
            compositeCommand("Hide and Flatten", [
                made(setLayerVisibleCommand(session, B, false)),
                made(flattenCommand(session, ids())),
            ]),
        );

        expect(layerIds(session.doc)).toEqual([A]);
        expect(composites(session.doc)).toStrictEqual(withoutB);
        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
    });
});
