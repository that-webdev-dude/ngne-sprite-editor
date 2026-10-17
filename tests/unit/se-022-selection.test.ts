import { describe, expect, it } from "vitest";
import {
    clickSelection,
    effectiveSelection,
    gridOrder,
    isCelSelected,
    selectedFrameIds,
    selectedLayerIds,
    targetFrameIds,
    targetLayerIds,
} from "../../src/app/timeline/selection";
import type {
    ClickModifiers,
    ClickTarget,
    GridOrder,
    TimelineSelection,
} from "../../src/app/timeline/selection";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, ReferenceLayer } from "../../src/core/model";

// SE-022: the timeline's selection — click, Shift-range and Ctrl-toggle for cels, frames and
// layers — and the frames and layers the commands act on.

const PLAIN: ClickModifiers = { shift: false, toggle: false };
const SHIFT: ClickModifiers = { shift: true, toggle: false };
const CTRL: ClickModifiers = { shift: false, toggle: true };
const BOTH: ClickModifiers = { shift: true, toggle: true };

const ORDER: GridOrder = { layerIds: ["l1", "l2", "l3"], frameIds: ["f1", "f2", "f3", "f4", "f5"] };
const AT = { layerId: "l1", frameId: "f1" };

/** Clicks in order, each on the selection the one before left. */
function clicks(...steps: [ClickTarget, ClickModifiers][]): TimelineSelection | null {
    let selection: TimelineSelection | null = null;
    for (const [target, modifiers] of steps) {
        selection = clickSelection(selection, target, modifiers, ORDER, "doc", AT);
    }
    return selection;
}

const cel = (layerId: string, frameId: string): ClickTarget => ({
    kind: "cels",
    cel: { layerId, frameId },
});
const frame = (frameId: string): ClickTarget => ({ kind: "frames", frameId });
const layer = (layerId: string): ClickTarget => ({ kind: "layers", layerId });

function celsOf(selection: TimelineSelection | null): string[] {
    if (selection?.kind !== "cels") return [];
    return selection.cels.map((entry) => `${entry.layerId}/${entry.frameId}`).sort();
}

/** A session of 3 pixel layers, 5 frames, and a reference layer between the first two. */
function session(): DocSession {
    const result = createDocument({ name: "s", width: 4, height: 4 }, sequentialIds("x"));
    const { doc } = result;
    const reference: ReferenceLayer = {
        id: "ref",
        name: "Reference",
        kind: "reference",
        visible: true,
        locked: false,
        opacity: 128,
        sourceId: "src",
        x: 0,
        y: 0,
        scale: 1,
        placement: "behind",
    };
    const base = doc.layers[0];
    doc.layers = [{ ...base, id: "l1" }, reference, { ...base, id: "l2" }, { ...base, id: "l3" }];
    doc.frames = ["f1", "f2", "f3", "f4", "f5"].map((id) => ({ id, durationMs: 100 }));
    result.activeLayerId = "l1";
    result.activeFrameId = "f1";
    return result;
}

describe("clicks in the grid", () => {
    it("a plain click selects one cel, frame or layer and makes it the anchor", () => {
        expect(clicks([cel("l2", "f3"), PLAIN])).toMatchObject({
            kind: "cels",
            cels: [{ layerId: "l2", frameId: "f3" }],
            anchor: { layerId: "l2", frameId: "f3" },
        });
        expect(clicks([frame("f2"), PLAIN])).toMatchObject({
            kind: "frames",
            frameIds: ["f2"],
            anchor: "f2",
        });
        expect(clicks([layer("l3"), PLAIN])).toMatchObject({
            kind: "layers",
            layerIds: ["l3"],
            anchor: "l3",
        });
    });

    it("Shift selects the rectangle of cels from the anchor, in either direction", () => {
        const down = clicks([cel("l3", "f4"), PLAIN], [cel("l2", "f2"), SHIFT]);
        expect(celsOf(down)).toEqual(["l2/f2", "l2/f3", "l2/f4", "l3/f2", "l3/f3", "l3/f4"].sort());
        // The anchor stays: a second Shift-click replaces the range.
        const again = clicks(
            [cel("l3", "f4"), PLAIN],
            [cel("l2", "f2"), SHIFT],
            [cel("l3", "f5"), SHIFT],
        );
        expect(celsOf(again)).toEqual(["l3/f4", "l3/f5"]);
        expect(again).toMatchObject({ anchor: { layerId: "l3", frameId: "f4" } });
    });

    it("Shift selects the range of frames or layers from the anchor", () => {
        expect(clicks([frame("f4"), PLAIN], [frame("f2"), SHIFT])).toMatchObject({
            frameIds: ["f2", "f3", "f4"],
        });
        expect(clicks([layer("l1"), PLAIN], [layer("l3"), SHIFT])).toMatchObject({
            layerIds: ["l1", "l2", "l3"],
        });
    });

    it("Ctrl adds or removes one item and moves the anchor to it", () => {
        const cels = clicks([cel("l1", "f1"), PLAIN], [cel("l2", "f3"), CTRL]);
        expect(celsOf(cels)).toEqual(["l1/f1", "l2/f3"]);
        expect(celsOf(clicks([cel("l1", "f1"), PLAIN], [cel("l1", "f1"), CTRL]))).toEqual([]);

        const frames = clicks([frame("f1"), PLAIN], [frame("f3"), CTRL], [frame("f1"), CTRL]);
        expect(frames).toMatchObject({ frameIds: ["f3"], anchor: "f1" });

        const layers = clicks([layer("l1"), PLAIN], [layer("l3"), CTRL]);
        expect(layers).toMatchObject({ layerIds: ["l1", "l3"], anchor: "l3" });
    });

    it("Ctrl+Shift adds the range to what is selected", () => {
        const frames = clicks([frame("f1"), PLAIN], [frame("f4"), CTRL], [frame("f5"), BOTH]);
        expect(frames).toMatchObject({ frameIds: ["f1", "f4", "f5"] });
        const cels = clicks(
            [cel("l1", "f1"), PLAIN],
            [cel("l3", "f5"), CTRL],
            [cel("l3", "f4"), BOTH],
        );
        expect(celsOf(cels)).toEqual(["l1/f1", "l3/f4", "l3/f5"]);
    });

    it("Shift or Ctrl on another kind than the selection acts as a plain click", () => {
        expect(clicks([cel("l1", "f1"), PLAIN], [frame("f3"), SHIFT])).toMatchObject({
            kind: "frames",
            frameIds: ["f3"],
        });
        expect(clicks([frame("f1"), PLAIN], [layer("l2"), CTRL])).toMatchObject({
            kind: "layers",
            layerIds: ["l2"],
        });
        expect(celsOf(clicks([layer("l1"), PLAIN], [cel("l2", "f2"), SHIFT]))).toEqual(["l2/f2"]);
    });

    it("an anchor the grid no longer has makes Shift a plain click", () => {
        const stale: TimelineSelection = {
            documentId: "doc",
            at: AT,
            kind: "frames",
            frameIds: ["gone"],
            anchor: "gone",
        };
        expect(clickSelection(stale, frame("f2"), SHIFT, ORDER, "doc", AT)).toMatchObject({
            frameIds: ["f2"],
            anchor: "f2",
        });
    });
});

describe("what a selection means for the document", () => {
    it("holds while the cel it was made at stays active, in its own document", () => {
        const s = session();
        const selection = clickSelection(null, frame("f2"), PLAIN, gridOrder(s.doc), "doc", {
            layerId: "l1",
            frameId: "f1",
        });
        expect(effectiveSelection(selection, "doc", s)).toBe(selection);
        expect(effectiveSelection(selection, "other", s)).toBeNull();
        s.activeFrameId = "f2";
        expect(effectiveSelection(selection, "doc", s)).toBeNull();
        s.activeFrameId = "f1";
        s.activeLayerId = "l2";
        expect(effectiveSelection(selection, "doc", s)).toBeNull();
        expect(effectiveSelection(null, "doc", s)).toBeNull();
    });

    it("the grid's rows are the pixel layers: a reference layer is no row", () => {
        expect(gridOrder(session().doc)).toEqual({
            layerIds: ["l1", "l2", "l3"],
            frameIds: ["f1", "f2", "f3", "f4", "f5"],
        });
    });

    it("selected frames are a frame selection's, or the frames a cel selection has a cel in, in playback order", () => {
        const s = session();
        const order = gridOrder(s.doc);
        const frames = clickSelection(null, frame("f4"), PLAIN, order, "doc", AT);
        const more = clickSelection(frames, frame("f2"), CTRL, order, "doc", AT);
        expect(selectedFrameIds(s.doc, more)).toEqual(["f2", "f4"]);
        const cels = clickSelection(null, cel("l3", "f5"), PLAIN, order, "doc", AT);
        const range = clickSelection(cels, cel("l2", "f3"), SHIFT, order, "doc", AT);
        expect(selectedFrameIds(s.doc, range)).toEqual(["f3", "f4", "f5"]);
        expect(
            selectedFrameIds(s.doc, clickSelection(null, layer("l1"), PLAIN, order, "doc", AT)),
        ).toEqual([]);
        // Frames the document no longer has are left out.
        s.doc.frames = s.doc.frames.filter((entry) => entry.id !== "f4");
        expect(selectedFrameIds(s.doc, more)).toEqual(["f2"]);
    });

    it("selected layers are the pixel layers of a layer selection, bottom to top", () => {
        const s = session();
        const order = gridOrder(s.doc);
        const layers = clickSelection(
            clickSelection(null, layer("l3"), PLAIN, order, "doc", AT),
            layer("l1"),
            SHIFT,
            order,
            "doc",
            AT,
        );
        expect(selectedLayerIds(s.doc, layers)).toEqual(["l1", "l2", "l3"]);
        expect(
            selectedLayerIds(s.doc, clickSelection(null, frame("f1"), PLAIN, order, "doc", AT)),
        ).toEqual([]);
    });

    it("frame and layer commands fall back to the active frame and layer", () => {
        const s = session();
        const order = gridOrder(s.doc);
        expect(targetFrameIds(s, null)).toEqual(["f1"]);
        expect(targetLayerIds(s, null)).toEqual(["l1"]);
        const frames = clickSelection(
            clickSelection(null, frame("f2"), PLAIN, order, "doc", AT),
            frame("f3"),
            SHIFT,
            order,
            "doc",
            AT,
        );
        expect(targetFrameIds(s, frames)).toEqual(["f2", "f3"]);
        expect(targetLayerIds(s, frames)).toEqual(["l1"]);
    });

    it("a cell is selected by a cel, frame or layer selection that covers it", () => {
        const order = ORDER;
        const cels = clickSelection(null, cel("l2", "f2"), PLAIN, order, "doc", AT);
        expect(isCelSelected(cels, "l2", "f2")).toBe(true);
        expect(isCelSelected(cels, "l2", "f3")).toBe(false);
        const frames = clickSelection(null, frame("f3"), PLAIN, order, "doc", AT);
        expect(isCelSelected(frames, "l1", "f3")).toBe(true);
        expect(isCelSelected(frames, "l1", "f2")).toBe(false);
        const layers = clickSelection(null, layer("l3"), PLAIN, order, "doc", AT);
        expect(isCelSelected(layers, "l3", "f5")).toBe(true);
        expect(isCelSelected(layers, "l2", "f5")).toBe(false);
        expect(isCelSelected(null, "l1", "f1")).toBe(false);
    });
});
