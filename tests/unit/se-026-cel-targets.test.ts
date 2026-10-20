import { describe, expect, it } from "vitest";
import {
    anyFilled,
    anyLinked,
    celRows,
    clampCelOffset,
    clearCels,
    dropCels,
    droppedLayerOrder,
    dropLayers,
    editableCels,
    landsOnLocked,
    linkCels,
    targetCels,
    unlinkCels,
} from "../../src/app/timeline/celTargets";
import type { CelRef, TimelineSelection } from "../../src/app/timeline/selection";
import { celAt } from "../../src/core/model";
import type { SpriteDoc } from "../../src/core/model";
import { expectSymmetric, fixture, FRAMES, L1, L2, L3, REF, snapshot } from "./se-021-support";

// SE-026: what the timeline's cel commands and drags act on (`celTargets`), over the SE-021
// fixture:
//
//              f1   f2   f3   f4   f5
//     layer-3  .    .    .    .    g
//     layer-2  d    .    e    e    .
//     layer-ref     (reference layer)
//     layer-1  a    a    b    .    c

const [F1, F2, F3, F4, F5] = FRAMES;
const at = (layerId: string, frameId: string): CelRef => ({ layerId, frameId });
const AT = { layerId: L1, frameId: F1 };

/** The image of every cell, layer by layer from the bottom pixel layer: "a a b . c". */
function grid(doc: SpriteDoc): string[] {
    return [L1, L2, L3].map((layerId) =>
        FRAMES.map((frameId) => celAt(doc, layerId, frameId)?.imageId ?? ".").join(" "),
    );
}

function lock(doc: SpriteDoc, layerId: string): void {
    const layer = doc.layers.find((entry) => entry.id === layerId);
    if (layer) layer.locked = true;
}

const selection = (fields: Partial<TimelineSelection> & Pick<TimelineSelection, "kind">) =>
    ({ documentId: "doc", at: AT, anchor: AT, ...fields }) as TimelineSelection;

describe("targetCels", () => {
    it("is the active cel without a selection", () => {
        const { session } = fixture();
        session.activeLayerId = L2;
        session.activeFrameId = F3;
        expect(targetCels(session, null)).toEqual([at(L2, F3)]);
        // A reference layer has no cel.
        session.activeLayerId = REF;
        expect(targetCels(session, null)).toEqual([]);
    });

    it("is the cels of a cel selection, bottom layer first, frames in order", () => {
        const { session } = fixture();
        const cels = [at(L3, F2), at(L1, F4), at(L1, F1), at(L2, "gone")];
        expect(targetCels(session, selection({ kind: "cels", cels }))).toEqual([
            at(L1, F1),
            at(L1, F4),
            at(L3, F2),
        ]);
    });

    it("is every pixel layer's cel at the frames of a frame selection", () => {
        const { session } = fixture();
        const chosen = targetCels(session, selection({ kind: "frames", frameIds: [F4, F2] }));
        expect(chosen).toEqual([
            at(L1, F2),
            at(L1, F4),
            at(L2, F2),
            at(L2, F4),
            at(L3, F2),
            at(L3, F4),
        ]);
    });

    it("is every cel of the pixel layers of a layer selection", () => {
        const { session } = fixture();
        const chosen = targetCels(session, selection({ kind: "layers", layerIds: [L2, REF] }));
        expect(chosen).toEqual(FRAMES.map((frameId) => at(L2, frameId)));
    });
});

describe("editable cels and the cel commands (SE-021 review: locked layers)", () => {
    it("leaves out the cels of locked layers", () => {
        const { doc } = fixture();
        lock(doc, L2);
        const cels = [at(L1, F1), at(L2, F1), at(L3, F5)];
        expect(editableCels(doc, cels)).toEqual([at(L1, F1), at(L3, F5)]);
    });

    it("clear, link and unlink on locked layers only make no command", () => {
        const { session, doc } = fixture();
        lock(doc, L1);
        lock(doc, L2);
        const cels = targetCels(session, selection({ kind: "layers", layerIds: [L1, L2] }));
        expect(cels.length).toBe(10);
        expect(clearCels(session, cels)).toBeNull();
        expect(linkCels(session, cels)).toBeNull();
        expect(unlinkCels(session, cels)).toBeNull();
    });

    it("clear empties the editable cels only, in one undo step", () => {
        const { session, doc, history } = fixture();
        lock(doc, L2);
        const cels = targetCels(session, selection({ kind: "frames", frameIds: [F1, F3] }));
        expectSymmetric(history, clearCels(session, cels));
        expect(grid(doc)).toEqual([". a . . c", "d . e e .", ". . . . g"]);
        expect(history.undoCount).toBe(1);
    });

    it("clear of cels that are no rectangle is one step of a command per layer", () => {
        const { session, doc, history } = fixture();
        const cels = [at(L1, F2), at(L1, F3), at(L2, F4)];
        expectSymmetric(history, clearCels(session, cels));
        expect(grid(doc)).toEqual(["a . . . c", "d . e . .", ". . . . g"]);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Clear Cels");
    });

    it("link links each layer's cels to its first filled one; unlink gives linked cels images of their own", () => {
        const { session, doc, history } = fixture();
        const cels = [at(L1, F3), at(L1, F4), at(L1, F5), at(L2, F1), at(L2, F2)];
        expectSymmetric(history, linkCels(session, cels));
        expect(grid(doc)).toEqual(["a a b b b", "d d e e .", ". . . . g"]);
        expect(anyLinked(doc, [at(L1, F5)])).toBe(true);
        expectSymmetric(history, unlinkCels(session, [at(L1, F4), at(L1, F5)]));
        expect(celAt(doc, L1, F4)?.imageId).not.toBe(celAt(doc, L1, F5)?.imageId);
        expect(history.undoCount).toBe(2);
    });

    it("tells whether cels hold images and whether one is linked", () => {
        const { doc } = fixture();
        expect(anyFilled(doc, [at(L1, F4), at(L3, F1)])).toBe(false);
        expect(anyFilled(doc, [at(L1, F4), at(L1, F5)])).toBe(true);
        expect(anyLinked(doc, [at(L1, F3), at(L1, F5)])).toBe(false);
        expect(anyLinked(doc, [at(L2, F4)])).toBe(true);
    });

    it("groups cels by layer from the bottom, frames in order", () => {
        const { doc } = fixture();
        expect(celRows(doc, [at(L3, F2), at(L1, F5), at(L1, F1)])).toEqual([
            { layerId: L1, frameIds: [F1, F5] },
            { layerId: L3, frameIds: [F2] },
        ]);
    });
});

describe("dropping cels", () => {
    it("keeps a drag inside the grid", () => {
        const { doc } = fixture();
        const cels = [at(L2, F3), at(L2, F4)];
        expect(clampCelOffset(doc, cels, { layers: 5, frames: 9 })).toEqual({
            layers: 1,
            frames: 1,
        });
        expect(clampCelOffset(doc, cels, { layers: -5, frames: -9 })).toEqual({
            layers: -1,
            frames: -2,
        });
    });

    it("moves a rectangle as a whole in one undo step, past the reference layer", () => {
        const { session, doc, history } = fixture();
        const cels = [at(L1, F1), at(L1, F2), at(L2, F1), at(L2, F2)];
        const drop = dropCels(session, cels, { layers: 1, frames: 1 }, false);
        expect(drop?.moved.map((pair) => pair.to)).toEqual([
            at(L2, F2),
            at(L2, F3),
            at(L3, F2),
            at(L3, F3),
        ]);
        expectSymmetric(history, drop?.command ?? null);
        expect(grid(doc)).toEqual([". . b . c", ". a a e .", ". d . . g"]);
        expect(history.undoCount).toBe(1);
    });

    it("copies a rectangle: the copies have images of their own", () => {
        const { session, doc, history } = fixture();
        const drop = dropCels(session, [at(L1, F3)], { layers: 0, frames: 1 }, true);
        expectSymmetric(history, drop?.command ?? null);
        expect(celAt(doc, L1, F3)?.imageId).toBe("b");
        const copy = celAt(doc, L1, F4)?.imageId;
        expect(copy).toBeDefined();
        expect(copy).not.toBe("b");
        expect(doc.images.get(copy ?? "")?.data).toEqual(doc.images.get("b")?.data);
    });

    it("moves cels that are no rectangle as a whole, whichever way the drag goes", () => {
        for (const layers of [1, -1]) {
            const { session, doc, history } = fixture();
            // L1 f1, f3 and L2 f3: no rectangle. Down from L2/L3, up from L1/L2.
            const cels =
                layers > 0
                    ? [at(L1, F1), at(L1, F3), at(L2, F3)]
                    : [at(L2, F1), at(L2, F3), at(L3, F5)];
            const drop = dropCels(session, cels, { layers, frames: 0 }, false);
            expectSymmetric(history, drop?.command ?? null);
            expect(history.undoCount).toBe(1);
            expect(grid(doc)).toEqual(
                layers > 0
                    ? [". a . . c", "a . b e .", ". . e . g"]
                    : ["d a e . c", ". . . e g", ". . . . ."],
            );
        }
    });

    it("leaves the cels of locked layers where they are", () => {
        const { session, doc, history } = fixture();
        lock(doc, L2);
        const cels = [at(L1, F3), at(L2, F3)];
        const drop = dropCels(session, cels, { layers: 0, frames: 1 }, false);
        expect(drop?.moved).toEqual([{ from: at(L1, F3), to: at(L1, F4) }]);
        history.execute(drop!.command);
        expect(grid(doc)).toEqual(["a a . b c", "d . e e .", ". . . . g"]);
    });

    it("refuses a drop onto a locked layer, and one past the edges", () => {
        const { session, doc } = fixture();
        lock(doc, L3);
        const before = snapshot(session);
        expect(landsOnLocked(doc, [at(L2, F1)], { layers: 1, frames: 0 })).toBe(true);
        expect(dropCels(session, [at(L2, F1)], { layers: 1, frames: 0 }, false)).toBeNull();
        expect(dropCels(session, [at(L2, F1)], { layers: 1, frames: 0 }, true)).toBeNull();
        expect(dropCels(session, [at(L1, F5)], { layers: 0, frames: 1 }, false)).toBeNull();
        expect(dropCels(session, [at(L1, F1)], { layers: 0, frames: 0 }, true)).toBeNull();
        expect(landsOnLocked(doc, [at(L1, F1)], { layers: 1, frames: 0 })).toBe(false);
        expect(snapshot(session)).toStrictEqual(before);
    });
});

describe("dropping layers", () => {
    const names = (doc: SpriteDoc, order = doc.layers) => order.map((layer) => layer.id);

    it("puts the moved layers of a group at the gap, leaving the other kind in its places", () => {
        const { doc } = fixture();
        // The pixel group lists L3, L2, L1 (top first); REF stays at its place in the stack.
        expect(names(doc, droppedLayerOrder(doc, [L3], 3)!)).toEqual([L3, REF, L1, L2]);
        expect(names(doc, droppedLayerOrder(doc, [L1], 0)!)).toEqual([L2, REF, L3, L1]);
        expect(names(doc, droppedLayerOrder(doc, [L1, L3], 1)!)).toEqual([L2, REF, L1, L3]);
        expect(names(doc, droppedLayerOrder(doc, [L2], 1)!)).toEqual(names(doc));
        expect(droppedLayerOrder(doc, ["gone"], 0)).toBeNull();
    });

    it("is one undo step, and none when the order stays", () => {
        const { session, doc, history } = fixture();
        expect(dropLayers(session, [L2], 2)).toBeNull();
        expectSymmetric(history, dropLayers(session, [L3], 3));
        expect(names(doc)).toEqual([L3, REF, L1, L2]);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Move Layer");
    });
});
