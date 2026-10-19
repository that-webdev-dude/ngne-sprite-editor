import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import {
    deleteLayerCommand,
    renameLayerCommand,
    setLayerLockedCommand,
    setLayerOpacityCommand,
    setLayerVisibleCommand,
} from "../../src/core/layers";
import { encodePng } from "../../src/core/png";
import { MAX_REFERENCE_LAYERS, sequentialIds } from "../../src/core/model";
import type { DocSession, ReferenceLayer } from "../../src/core/model";
import { deserialize, serialize } from "../../src/core/project";
import {
    addReferenceLayerCommand,
    fitPlacement,
    fitToCanvas,
    ReferenceLayerError,
    referenceLayers,
    resetReferenceFitCommand,
    setReferenceCommand,
} from "../../src/core/references";
import {
    A,
    B,
    composites,
    execute,
    fixture,
    history,
    HEIGHT,
    redo,
    stateOf,
    thrownBy,
    undo,
    WIDTH,
} from "./se-020-support";

// SE-045: the commands of reference layers (SPEC §7.6) in `core/references`, and what the
// layer commands of `core/layers` do to a reference layer: every change one undo step, the
// composite of every frame untouched, and a project file that keeps them.

/** Adds a reference layer of a `width` × `height` source to the session through a history. */
function withReference(
    session: DocSession,
    sourceId = "src-1",
    width = 6,
    height = 4,
): { id: string; target: ReturnType<typeof history> } {
    const target = history(session);
    const command = addReferenceLayerCommand(session, {
        sourceId,
        sourceWidth: width,
        sourceHeight: height,
        newId: sequentialIds(`ref-${sourceId}-`),
    });
    execute(target, command);
    return { id: command.touched.layerIds[0]!, target };
}

function reference(session: DocSession, id: string): ReferenceLayer {
    const layer = session.doc.layers.find((candidate) => candidate.id === id);
    if (layer?.kind !== "reference") throw new Error(`no reference layer ${id}`);
    return layer;
}

describe("fitting", () => {
    it("fits the whole image inside the rectangle at the largest uniform scale and centres it", () => {
        expect(fitToCanvas({ width: 16, height: 8 }, 8, 8)).toEqual({ x: 4, y: 0, scale: 1 });
        expect(fitToCanvas({ width: 64, height: 64 }, 2048, 2048)).toEqual({
            x: 0,
            y: 0,
            scale: 1 / 32,
        });
        // Wider than the canvas: fitted by width, centred vertically.
        expect(fitToCanvas({ width: 16, height: 16 }, 8, 4)).toEqual({ x: 0, y: 4, scale: 2 });
        expect(fitPlacement(10, 5, { x: 3, y: 2, width: 20, height: 20 })).toEqual({
            x: 3,
            y: 2 + 5,
            scale: 2,
        });
    });
});

describe("addReferenceLayerCommand", () => {
    it("adds a visible, unlocked reference layer at 50% behind the pixel layers, fitted and centred, without changing the active layer", () => {
        const session = fixture();
        const before = stateOf(session);
        const { id, target } = withReference(session, "src-1", 6, 4);
        const layer = reference(session, id);
        const fitted = fitToCanvas(session.doc, 6, 4);
        expect(layer).toEqual({
            id,
            name: "Reference",
            kind: "reference",
            visible: true,
            locked: false,
            opacity: 128,
            sourceId: "src-1",
            x: fitted.x,
            y: fitted.y,
            scale: fitted.scale,
            placement: "behind",
        });
        // At the bottom of the stack, the pixel layers above it as they were.
        expect(session.doc.layers[0]).toBe(layer);
        expect(session.activeLayerId).toBe(before.activeLayerId);
        expect(target.undoCount).toBe(1);
        undo(target);
        expect(stateOf(session)).toEqual(before);
        redo(target);
        expect(reference(session, id)).toEqual(layer);
    });

    it("undo returns to the active layer `do` found when the new reference layer was made active since", () => {
        const session = fixture();
        const active = session.activeLayerId;
        const { id, target } = withReference(session);
        session.activeLayerId = id;
        undo(target);
        expect(session.activeLayerId).toBe(active);
        redo(target);
        // Another layer made active stays so through undo.
        session.activeLayerId = A;
        undo(target);
        expect(session.activeLayerId).toBe(A);
    });

    it("puts a further reference layer directly above the topmost one", () => {
        const session = fixture();
        const first = withReference(session, "src-1");
        const command = addReferenceLayerCommand(session, {
            sourceId: "src-2",
            sourceWidth: 2,
            sourceHeight: 2,
            name: "  Second  ",
            newId: () => "second",
        });
        execute(first.target, command);
        expect(session.doc.layers.map((layer) => layer.id).slice(0, 2)).toEqual([
            first.id,
            "second",
        ]);
        expect(reference(session, "second").name).toBe("Second");
    });

    it("reports the new layer and a change of structure, and no frame", () => {
        const session = fixture();
        const command = addReferenceLayerCommand(session, {
            sourceId: "s",
            sourceWidth: 2,
            sourceHeight: 2,
            newId: () => "new-ref",
        });
        expect(command.touched).toEqual({ frameIds: [], layerIds: ["new-ref"], structure: true });
    });

    it(`refuses a reference layer beyond ${MAX_REFERENCE_LAYERS}; the document is unchanged`, () => {
        const session = fixture();
        const target = history(session);
        for (let index = 0; index < MAX_REFERENCE_LAYERS; index++) {
            execute(
                target,
                addReferenceLayerCommand(session, {
                    sourceId: `s${index}`,
                    sourceWidth: 2,
                    sourceHeight: 2,
                    newId: () => `r${index}`,
                }),
            );
        }
        const before = stateOf(session);
        const error = thrownBy(() =>
            addReferenceLayerCommand(session, { sourceId: "s5", sourceWidth: 2, sourceHeight: 2 }),
        );
        expect(error).toBeInstanceOf(ReferenceLayerError);
        expect((error as ReferenceLayerError).code).toBe("limit");
        expect((error as ReferenceLayerError).message).toBe(
            "A sprite can have at most 4 reference layers.",
        );
        expect(stateOf(session)).toEqual(before);
        expect(target.undoCount).toBe(MAX_REFERENCE_LAYERS);
    });

    it("refuses a source size that is not a positive integer and a placement out of range", () => {
        const session = fixture();
        for (const [sourceWidth, sourceHeight] of [
            [0, 4],
            [3, 1.5],
            [Number.NaN, 2],
        ] as const) {
            const error = thrownBy(() =>
                addReferenceLayerCommand(session, { sourceId: "s", sourceWidth, sourceHeight }),
            );
            expect((error as ReferenceLayerError).code).toBe("value");
        }
        const error = thrownBy(() =>
            addReferenceLayerCommand(session, {
                sourceId: "s",
                sourceWidth: 2,
                sourceHeight: 2,
                placement: { x: 0, y: 0, scale: 0 },
            }),
        );
        expect((error as ReferenceLayerError).code).toBe("value");
    });
});

describe("every property change is one undo step", () => {
    it("position, scale, placement, reset to fit, opacity, visibility, lock, name and delete each make one step that undo reverses", () => {
        const session = fixture();
        const { id, target } = withReference(session, "src-1", 6, 4);
        const steps = [
            () => setReferenceCommand(session, id, { x: 2.5, y: -1 }),
            () => setReferenceCommand(session, id, { scale: 0.75 }),
            () => setReferenceCommand(session, id, { placement: "front" }),
            () => resetReferenceFitCommand(session, id, 6, 4),
            () => setLayerOpacityCommand(session, id, 40),
            () => setLayerVisibleCommand(session, id, false),
            () => setLayerLockedCommand(session, id, true),
            () => renameLayerCommand(session, id, "Sketch"),
            () => deleteLayerCommand(session, id),
        ];
        for (const make of steps) {
            const before = stateOf(session);
            const count = target.undoCount;
            execute(target, make());
            expect(target.undoCount).toBe(count + 1);
            expect(stateOf(session)).not.toEqual(before);
            const after = stateOf(session);
            undo(target);
            expect(stateOf(session)).toEqual(before);
            redo(target);
            expect(stateOf(session)).toEqual(after);
        }
        expect(referenceLayers(session.doc)).toEqual([]);
    });

    it("sets several fields in one step, and makes no step when nothing changes", () => {
        const session = fixture();
        const { id, target } = withReference(session);
        const layer = reference(session, id);
        execute(
            target,
            setReferenceCommand(session, id, { x: 1, y: 2, scale: 3, placement: "front" }),
        );
        expect(reference(session, id)).toMatchObject({ x: 1, y: 2, scale: 3, placement: "front" });
        expect(target.undoCount).toBe(2);
        expect(setReferenceCommand(session, id, { x: 1, y: 2, scale: 3 })).toBeNull();
        expect(resetReferenceFitCommand(session, id, 6, 4)?.label).toBe("Reset Reference to Fit");
        execute(target, resetReferenceFitCommand(session, id, 6, 4));
        expect(resetReferenceFitCommand(session, id, 6, 4)).toBeNull();
        // Fitted again, and the placement kept.
        expect(reference(session, id)).toMatchObject({
            ...fitToCanvas(session.doc, 6, 4),
            placement: "front",
        });
        expect(layer.sourceId).toBe("src-1");
    });

    it("names the step by the fields it changes", () => {
        const session = fixture();
        const { id } = withReference(session);
        expect(setReferenceCommand(session, id, { x: 9 })?.label).toBe("Move Reference");
        expect(setReferenceCommand(session, id, { scale: 9 })?.label).toBe("Scale Reference");
        expect(setReferenceCommand(session, id, { placement: "front" })?.label).toBe(
            "Reference to Front",
        );
        expect(setReferenceCommand(session, id, { x: 9, scale: 9 })?.label).toBe(
            "Reference Properties",
        );
    });

    it("refuses values a project file cannot hold, and pixel layers", () => {
        const session = fixture();
        const { id } = withReference(session);
        for (const change of [
            { x: Number.NaN },
            { y: 2_000_000 },
            { scale: 0 },
            { scale: -1 },
            { placement: "above" as "front" },
        ]) {
            const error = thrownBy(() => setReferenceCommand(session, id, change));
            expect((error as ReferenceLayerError).code).toBe("value");
        }
        const error = thrownBy(() => setReferenceCommand(session, A, { x: 1 }));
        expect((error as ReferenceLayerError).code).toBe("not-a-reference-layer");
    });

    it("reports the layer and no frame for a change of position, scale or placement", () => {
        const session = fixture();
        const { id } = withReference(session);
        expect(setReferenceCommand(session, id, { x: 4, placement: "front" })?.touched).toEqual({
            frameIds: [],
            layerIds: [id],
            structure: false,
        });
    });
});

describe("references are not in the composite", () => {
    it("compositeFrame is identical with and without reference layers, behind or in front, at any opacity", () => {
        const session = fixture();
        const without = composites(session.doc).map((buffer) => Array.from(buffer.data));
        const { id, target } = withReference(session, "src-1", WIDTH, HEIGHT);
        const second = addReferenceLayerCommand(session, {
            sourceId: "src-2",
            sourceWidth: 1,
            sourceHeight: 1,
            newId: () => "front-ref",
        });
        execute(target, second);
        execute(target, setReferenceCommand(session, "front-ref", { placement: "front" }));
        execute(target, setLayerOpacityCommand(session, id, 255));
        // Between the pixel layers too: its place in the stack changes nothing.
        const [first] = session.doc.layers.splice(0, 1);
        session.doc.layers.splice(2, 0, first!);
        const withReferences = composites(session.doc).map((buffer) => Array.from(buffer.data));
        expect(withReferences).toEqual(without);
        expect(session.doc.layers.some((layer) => layer.id === B)).toBe(true);
        expect(compositeFrame(session.doc, session.doc.frames[0]!.id).data.length).toBe(
            WIDTH * HEIGHT * 4,
        );
    });
});

describe("project file", () => {
    it("serialize / deserialize restores position, scale, opacity, placement and identical source bytes", async () => {
        const session = fixture();
        const sourceBytes = encodePng({
            width: 5,
            height: 3,
            data: new Uint8ClampedArray(5 * 3 * 4).map((_, index) => (index * 37) % 256),
        });
        const { id, target } = withReference(session, "sketch", 5, 3);
        execute(
            target,
            setReferenceCommand(session, id, {
                x: -1.25,
                y: 0.5,
                scale: 0.375,
                placement: "front",
            }),
        );
        execute(target, setLayerOpacityCommand(session, id, 77));
        execute(target, setLayerLockedCommand(session, id, true));
        const bytes = serialize(session.doc, new Map([["sketch", sourceBytes]]));
        const { doc, referenceSources } = await deserialize(bytes);
        const restored = doc.layers.find((layer) => layer.id === id);
        expect(restored).toEqual(reference(session, id));
        expect(restored).toMatchObject({
            x: -1.25,
            y: 0.5,
            scale: 0.375,
            opacity: 77,
            placement: "front",
            locked: true,
        });
        expect([...referenceSources.keys()]).toEqual(["sketch"]);
        expect(Array.from(referenceSources.get("sketch")!)).toEqual(Array.from(sourceBytes));
        // The pixel layers and their order are as they were.
        expect(doc.layers.map((layer) => layer.id)).toEqual(
            session.doc.layers.map((layer) => layer.id),
        );
    });
});
