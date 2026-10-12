import { describe, expect, it } from "vitest";
import {
    addLayerCommand,
    canDeleteLayer,
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
import { assertInvariants, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import {
    A,
    B,
    C,
    composites,
    compositesOf,
    emptySession,
    execute,
    fixture,
    history,
    layer,
    layerIds,
    redo,
    referenceLayer,
    stateOf,
    thrownBy,
    undo,
} from "./se-020-support";

// SE-020 with reference layers in the stack (SPEC §7.6). A reference layer is a layer of the
// document but not of the composite, and the timeline lists it apart from the pixel layers
// (DESIGN §5.6). Each rule the layer commands follow for them has a test here.

const BACK = "ref-back";
const MID = "ref-mid";
const FRONT = "ref-front";
const STACK = [BACK, A, B, MID, C, FRONT];

/** The fixture with a reference layer under, between and over its pixel layers. */
function withReferences(): DocSession {
    const session = fixture();
    const [a, b, c] = session.doc.layers;
    session.doc.layers = [
        referenceLayer(BACK),
        a,
        b,
        referenceLayer(MID, { x: 1.5, y: -2, scale: 0.25 }),
        c,
        referenceLayer(FRONT, { placement: "front" }),
    ];
    assertInvariants(session);
    return session;
}

function ids() {
    return { newId: sequentialIds("new-") };
}

describe("reference layers and the pixel layer every document keeps", () => {
    it("a reference layer does not count: the only pixel layer cannot be deleted", () => {
        const session = emptySession([A]);
        session.doc.layers.push(referenceLayer(FRONT));
        const before = stateOf(session);

        const error = thrownBy(() => deleteLayerCommand(session, A));

        expect(error).toBeInstanceOf(LayerError);
        expect(error).toMatchObject({ code: "last-pixel-layer" });
        expect(canDeleteLayer(session.doc, A)).toBe(false);
        expect(stateOf(session)).toStrictEqual(before);
    });

    it("a reference layer can always be deleted, also next to the only pixel layer", () => {
        const session = emptySession([A]);
        session.doc.layers.unshift(referenceLayer(BACK));
        const start = stateOf(session);
        const target = history(session);
        expect(canDeleteLayer(session.doc, BACK)).toBe(true);
        const command = deleteLayerCommand(session, BACK);

        execute(target, command);

        expect(layerIds(session.doc)).toEqual([A]);
        expect(command.touched).toEqual({ frameIds: [], layerIds: [BACK], structure: true });
        expect(command.bytes).toBe(0);
        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
    });

    it("undo of a deleted reference layer restores it at its place with every property", () => {
        const session = withReferences();
        const start = stateOf(session);
        const target = history(session);

        execute(target, deleteLayerCommand(session, MID));
        expect(layerIds(session.doc)).toEqual([BACK, A, B, C, FRONT]);

        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
        expect(layer(session.doc, MID)).toEqual(
            referenceLayer(MID, { x: 1.5, y: -2, scale: 0.25 }),
        );
    });
});

describe("reference layers and the active layer after delete", () => {
    it.each([
        { deleted: A, active: B, why: "the next pixel layer up, not the reference layer below" },
        { deleted: C, active: B, why: "the next pixel layer down, past the reference layer" },
        { deleted: MID, active: BACK, why: "the next reference layer down" },
        { deleted: BACK, active: MID, why: "the next reference layer up" },
        { deleted: FRONT, active: MID, why: "the next reference layer down" },
    ])("deleting the active layer $deleted activates $active: $why", ({ deleted, active }) => {
        const session = withReferences();
        session.activeLayerId = deleted;
        const target = history(session);

        execute(target, deleteLayerCommand(session, deleted));
        expect(session.activeLayerId).toBe(active);

        undo(target);
        expect(session.activeLayerId).toBe(deleted);
        expect(layerIds(session.doc)).toEqual(STACK);
    });

    it("deleting the only reference layer activates the layer below it, or else above it", () => {
        const over = emptySession([A, B]);
        over.doc.layers.splice(1, 0, referenceLayer(MID));
        over.activeLayerId = MID;
        execute(history(over), deleteLayerCommand(over, MID));
        expect(over.activeLayerId).toBe(A);

        const under = emptySession([A, B]);
        under.doc.layers.unshift(referenceLayer(BACK));
        under.activeLayerId = BACK;
        execute(history(under), deleteLayerCommand(under, BACK));
        expect(under.activeLayerId).toBe(A);
    });
});

describe("reference layers and add", () => {
    it("a new layer goes directly above the active pixel layer, under a reference layer there", () => {
        const session = withReferences();

        execute(history(session), addLayerCommand(session, { newId: () => "new" }));

        expect(layerIds(session.doc)).toEqual([BACK, A, B, "new", MID, C, FRONT]);
        expect(session.activeLayerId).toBe("new");
    });

    it.each([BACK, MID, FRONT])(
        "with the reference layer %s active, a new layer goes on top of the stack",
        (active) => {
            const session = withReferences();
            session.activeLayerId = active;
            const target = history(session);

            execute(target, addLayerCommand(session, { newId: () => "new" }));

            expect(layerIds(session.doc)).toEqual([...STACK, "new"]);
            expect(layer(session.doc, "new").kind).toBe("pixel");
            expect(session.activeLayerId).toBe("new");
            undo(target);
            expect(session.activeLayerId).toBe(active);
        },
    );
});

describe("reference layers and the commands for pixel layers only", () => {
    it("duplicate, blend mode and merge down refuse a reference layer: typed error, session unchanged", () => {
        const session = withReferences();
        const before = stateOf(session);
        const refused = [
            () => duplicateLayerCommand(session, MID),
            () => setLayerBlendModeCommand(session, MID, "multiply"),
            () => mergeDownCommand(session, MID),
        ];

        for (const make of refused) {
            const error = thrownBy(make);
            expect(error).toBeInstanceOf(LayerError);
            expect(error).toMatchObject({ name: "LayerError", code: "not-a-pixel-layer" });
        }
        expect((thrownBy(refused[0]) as LayerError).message).toBe(
            `Duplicate Layer works on pixel layers; "${MID}" is a reference layer.`,
        );
        expect(stateOf(session)).toStrictEqual(before);
    });

    it("duplicating a pixel layer next to reference layers adds no reference layer", () => {
        const session = withReferences();

        execute(history(session), duplicateLayerCommand(session, B, ids()));

        expect(layerIds(session.doc)).toEqual([BACK, A, B, "new-1", MID, C, FRONT]);
        expect(session.doc.layers.filter((entry) => entry.kind === "reference")).toHaveLength(3);
    });
});

describe("reference layers and the property commands", () => {
    it("rename, visibility, lock and opacity work on a reference layer and undo exactly", () => {
        const session = withReferences();
        const start = stateOf(session);
        const pixelsBefore = composites(session.doc);
        const target = history(session);

        execute(target, renameLayerCommand(session, MID, "Sketch"));
        execute(target, setLayerVisibleCommand(session, MID, false));
        execute(target, setLayerLockedCommand(session, MID, true));
        execute(target, setLayerOpacityCommand(session, MID, 30));

        expect(layer(session.doc, MID)).toEqual(
            referenceLayer(MID, {
                name: "Sketch",
                visible: false,
                locked: true,
                opacity: 30,
                x: 1.5,
                y: -2,
                scale: 0.25,
            }),
        );
        // A reference layer is not part of the composite.
        expect(composites(session.doc)).toStrictEqual(pixelsBefore);

        for (let step = 0; step < 4; step++) undo(target);
        expect(stateOf(session)).toStrictEqual(start);
        for (let step = 0; step < 4; step++) redo(target);
        expect(layer(session.doc, MID)).toMatchObject({ name: "Sketch", opacity: 30 });
    });

    it("visibility and opacity touch the reference layer and no frame", () => {
        const session = withReferences();
        const touched = { frameIds: [], layerIds: [FRONT], structure: false };

        expect(setLayerVisibleCommand(session, FRONT, false).touched).toEqual(touched);
        expect(setLayerOpacityCommand(session, FRONT, 9).touched).toEqual(touched);
    });
});

describe("reference layers and reorder", () => {
    it("a reference layer moves like any other and the composite does not change", () => {
        const session = withReferences();
        const before = composites(session.doc);
        const target = history(session);
        const command = reorderLayerCommand(session, BACK, 5);

        execute(target, command);

        expect(layerIds(session.doc)).toEqual([A, B, MID, C, FRONT, BACK]);
        expect(composites(session.doc)).toStrictEqual(before);
        expect(command.touched).toEqual({ frameIds: [], layerIds: [BACK], structure: true });
        undo(target);
        expect(layerIds(session.doc)).toEqual(STACK);
    });

    it("a pixel layer moves past reference layers to the position given", () => {
        const session = withReferences();

        execute(history(session), reorderLayerCommand(session, C, 0));

        expect(layerIds(session.doc)).toEqual([C, BACK, A, B, MID, FRONT]);
    });
});

describe("reference layers and merge down", () => {
    it("the target is the nearest pixel layer below, past a reference layer in between", () => {
        const session = withReferences();
        const { doc } = session;
        const reference = layer(doc, MID);
        const expected = compositesOf(doc, [B, C]);
        expect(mergeDownTarget(doc, C)?.id).toBe(B);
        const target = history(session);

        execute(target, mergeDownCommand(session, C, ids()));

        // The reference layer stays where it was, the same object, untouched.
        expect(layerIds(doc)).toEqual([BACK, A, B, MID, FRONT]);
        expect(layer(doc, MID)).toBe(reference);
        expect(compositesOf(doc, [B])).toStrictEqual(expected);
        undo(target);
        expect(layerIds(doc)).toEqual(STACK);
    });

    it("a pixel layer with only reference layers below has no target", () => {
        const session = withReferences();
        const before = stateOf(session);

        expect(mergeDownTarget(session.doc, A)).toBeUndefined();
        expect(thrownBy(() => mergeDownCommand(session, A))).toMatchObject({
            name: "LayerError",
            code: "no-pixel-layer-below",
        });
        expect(mergeDownTarget(session.doc, MID)).toBeUndefined();
        expect(stateOf(session)).toStrictEqual(before);
    });

    it("merging the active layer down activates the target, not the reference layer under it", () => {
        const session = withReferences();
        session.activeLayerId = C;

        execute(history(session), mergeDownCommand(session, C, ids()));

        expect(session.activeLayerId).toBe(B);
    });
});

describe("reference layers and flatten", () => {
    it("merges the pixel layers into one and leaves the reference layers in the stack", () => {
        const session = withReferences();
        const { doc } = session;
        const references = [BACK, MID, FRONT].map((id) => layer(doc, id));
        const start = stateOf(session);
        const before = composites(doc);
        const target = history(session);

        execute(target, flattenCommand(session, ids()));

        expect(layerIds(doc)).toEqual([BACK, A, MID, FRONT]);
        expect(doc.layers.filter((entry) => entry.kind === "pixel")).toHaveLength(1);
        expect([BACK, MID, FRONT].map((id) => layer(doc, id))).toEqual(references);
        references.forEach((reference) => expect(doc.layers).toContain(reference));
        expect(composites(doc)).toStrictEqual(before);

        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
    });

    it("makes the flat layer active, also when a reference layer was active", () => {
        const session = withReferences();
        session.activeLayerId = FRONT;
        const target = history(session);

        execute(target, flattenCommand(session, ids()));
        expect(session.activeLayerId).toBe(A);

        undo(target);
        expect(session.activeLayerId).toBe(FRONT);
    });

    it("touches the pixel layers only", () => {
        expect(flattenCommand(withReferences()).touched.layerIds).toEqual([A, B, C]);
    });
});
