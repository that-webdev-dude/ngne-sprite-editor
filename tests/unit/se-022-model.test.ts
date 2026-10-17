import { describe, expect, it } from "vitest";
import { timelineModel } from "../../src/app/timeline/timelineModel";
import { celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";

// SE-022: what the timeline shows of a document — rows, frames and cel states — read from the
// document model alone (cels, not images or composites).

/** 3 pixel layers, 4 frames; cels as `layer:frame → image`. Images are left out on purpose. */
function session(cels: Record<string, string>): DocSession {
    const result = createDocument({ name: "m", width: 4, height: 4 }, sequentialIds("x"));
    const { doc } = result;
    const base = doc.layers[0];
    doc.layers = [
        { ...base, id: "bottom", name: "Bottom" },
        {
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
            placement: "front",
        },
        { ...base, id: "middle", name: "Middle", visible: false, opacity: 90 },
        { ...base, id: "top", name: "Top", locked: true },
    ];
    doc.frames = ["a", "b", "c", "d"].map((id, index) => ({ id, durationMs: 50 * (index + 1) }));
    // No image exists: the timeline must not need one.
    doc.images.clear();
    doc.cels.clear();
    for (const [key, imageId] of Object.entries(cels)) {
        const [layerId = "", frameId = ""] = key.split(":");
        doc.cels.set(celKey(layerId, frameId), { imageId, opacity: 255 });
    }
    result.activeLayerId = "middle";
    result.activeFrameId = "c";
    return result;
}

describe("the timeline model", () => {
    it("has one row per pixel layer, top of the stack first, with the layer's properties", () => {
        const model = timelineModel("doc", session({}));
        expect(model.layers.map((layer) => layer.id)).toEqual(["top", "middle", "bottom"]);
        expect(
            model.layers.map(({ name, visible, locked, opacity }) => ({
                name,
                visible,
                locked,
                opacity,
            })),
        ).toEqual([
            { name: "Top", visible: true, locked: true, opacity: 255 },
            { name: "Middle", visible: false, locked: false, opacity: 90 },
            { name: "Bottom", visible: true, locked: false, opacity: 255 },
        ]);
        expect(model.frames).toEqual([
            { id: "a", durationMs: 50 },
            { id: "b", durationMs: 100 },
            { id: "c", durationMs: 150 },
            { id: "d", durationMs: 200 },
        ]);
        expect(model).toMatchObject({
            documentId: "doc",
            activeLayerId: "middle",
            activeFrameId: "c",
        });
    });

    it("reads empty, filled and linked cels from the cel map, and joins linked neighbours", () => {
        const model = timelineModel(
            "doc",
            session({
                // Linked across two neighbouring frames, then a single cel.
                "top:a": "i1",
                "top:b": "i1",
                "top:d": "i2",
                // Linked to another layer, not to a neighbour.
                "middle:a": "i3",
                "bottom:c": "i3",
                // Linked over a gap: no line.
                "bottom:a": "i4",
                "bottom:d": "i4",
            }),
        );
        const [top, middle, bottom] = model.layers;
        expect(top?.cels).toEqual(["linked", "linked", "empty", "filled"]);
        expect(top?.linkedToNext).toEqual([true, false, false, false]);
        expect(middle?.cels).toEqual(["linked", "empty", "empty", "empty"]);
        expect(middle?.linkedToNext).toEqual([false, false, false, false]);
        expect(bottom?.cels).toEqual(["linked", "empty", "linked", "linked"]);
        expect(bottom?.linkedToNext).toEqual([false, false, false, false]);
    });

    it("gives a row a new key exactly when what it shows changes", () => {
        const s = session({ "top:a": "i1" });
        const key = (model: ReturnType<typeof timelineModel>, id: string) =>
            model.layers.find((layer) => layer.id === id)?.key;
        const before = timelineModel("doc", s);
        // The active cel is not part of a row's own content.
        s.activeFrameId = "a";
        expect(key(timelineModel("doc", s), "top")).toBe(key(before, "top"));
        s.doc.cels.set(celKey("top", "b"), { imageId: "i1", opacity: 255 });
        const linked = timelineModel("doc", s);
        expect(key(linked, "top")).not.toBe(key(before, "top"));
        expect(key(linked, "bottom")).toBe(key(before, "bottom"));
        const middle = s.doc.layers.find((layer) => layer.id === "middle");
        if (middle) middle.name = "Renamed";
        expect(key(timelineModel("doc", s), "middle")).not.toBe(key(before, "middle"));
    });
});
