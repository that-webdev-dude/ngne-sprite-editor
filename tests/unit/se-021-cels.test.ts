import { describe, expect, it } from "vitest";
import {
    CelOpacityError,
    CelTargetError,
    clearCelsCommand,
    copyCelsCommand,
    isCelOpacity,
    linkCelsCommand,
    moveCelsCommand,
    setCelOpacityCommand,
    unlinkCelsCommand,
} from "../../src/core/cels";
import type { CelSelection } from "../../src/core/cels";
import { compositeFrame } from "../../src/core/composite";
import { AllocationError, pixelPatchCommand } from "../../src/core/history";
import type { History } from "../../src/core/history";
import { celAt, sequentialIds } from "../../src/core/model";
import type { SpriteDoc } from "../../src/core/model";
import {
    celBytes,
    expectSymmetric,
    failingAllocator,
    fixture,
    flakyAllocator,
    FRAMES,
    IMAGE_BYTES,
    L1,
    L2,
    L3,
    REF,
    row,
    snapshot,
    some,
} from "./se-021-support";

// SE-021: the cel commands. The fixture is drawn in `se-021-support.ts`:
//
//              f1   f2   f3   f4   f5
//     layer-3  .    .    .    .    g
//     layer-2  d    .    e    e    .       (the cel at f3 has opacity 128)
//     layer-ref     (reference layer)
//     layer-1  a    a    b    .    c
//
// New image IDs are `n1`, `n2`, … in the order a command asks for them.

const ids = () => sequentialIds("n");
const ALL_LAYERS = [L1, REF, L2, L3];
const ALL_FRAMES = [...FRAMES];

function cells(layerIds: string | string[], frameIds: string | string[]): CelSelection {
    return {
        layerIds: typeof layerIds === "string" ? [layerIds] : layerIds,
        frameIds: typeof frameIds === "string" ? [frameIds] : frameIds,
    };
}

/** The composite of every frame, by frame ID. */
function pictures(doc: SpriteDoc): Record<string, number[]> {
    return Object.fromEntries(
        doc.frames.map((frame) => [frame.id, Array.from(compositeFrame(doc, frame.id).data)]),
    );
}

const imageIds = (doc: SpriteDoc) => [...doc.images.keys()];

/** Paints one opaque pixel on a cel through a stroke, as a tool does. */
function paint(history: History, layerId: string, frameId: string, grey: number): void {
    const transaction = history.begin({ layerId, frameId });
    transaction.image.data.set([grey, grey, grey, 255], 0);
    transaction.markDirty({ x: 0, y: 0, width: 1, height: 1 });
    expect(transaction.commit("Pencil")).not.toBeNull();
}

function thrownBy(run: () => unknown): unknown {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error("nothing was thrown");
}

describe("clearCelsCommand", () => {
    it("empties the selected cells and removes the images no cel uses any more", () => {
        const { doc, history } = fixture();
        const command = some(clearCelsCommand(doc, cells([L1, L2], "f3")));

        history.execute(command);

        expect(row(doc, L1)).toEqual(["a", "a", ".", ".", "c"]);
        expect(row(doc, L2)).toEqual(["d", ".", ".", "e", "."]);
        // b had one cel; e is still the cel of f4.
        expect(imageIds(doc)).toEqual(["a", "c", "d", "e", "g"]);
        expect(command.bytes).toBe(IMAGE_BYTES);
        expect(command.label).toBe("Clear Cels");
    });

    it("keeps the image of a linked cel until its last cel is cleared", () => {
        const one = fixture();
        const first = some(clearCelsCommand(one.doc, cells(L1, "f1")));
        one.history.execute(first);
        expect(row(one.doc, L1)).toEqual([".", "a", "b", ".", "c"]);
        expect(one.doc.images.has("a")).toBe(true);
        expect(first.bytes).toBe(0);
        expect(first.label).toBe("Clear Cel");

        const both = fixture();
        const second = some(clearCelsCommand(both.doc, cells(L1, ["f1", "f2"])));
        both.history.execute(second);
        expect(both.doc.images.has("a")).toBe(false);
        expect(second.bytes).toBe(IMAGE_BYTES);
    });

    it("do/undo/redo symmetry: cels and images come back in the order they had", () => {
        const { doc, history } = fixture();

        const { before, after } = expectSymmetric(
            history,
            clearCelsCommand(doc, cells([L3, L1], ["f5", "f1", "f3"])),
        );

        expect(before.doc.images.map(([id]) => id)).toEqual(["a", "b", "c", "d", "e", "g"]);
        expect(after.doc.images.map(([id]) => id)).toEqual(["a", "d", "e"]);
        expect(after.doc.cels).toHaveLength(4);
    });

    it("do/undo/redo symmetry clearing every cel of the document", () => {
        const { doc, history } = fixture();
        const command = some(clearCelsCommand(doc, cells(ALL_LAYERS, ALL_FRAMES)));

        const { after } = expectSymmetric(history, command);

        expect(after.doc.cels).toEqual([]);
        expect(after.doc.images).toEqual([]);
        expect(command.bytes).toBe(6 * IMAGE_BYTES);
    });

    it("returns null when every selected cell is empty", () => {
        const { doc } = fixture();
        expect(clearCelsCommand(doc, cells(L3, ["f1", "f2"]))).toBeNull();
        expect(clearCelsCommand(doc, cells([L1, L2, L3], "f4"))).not.toBeNull();
        expect(clearCelsCommand(doc, cells([L1, L3], "f4"))).toBeNull();
        expect(clearCelsCommand(doc, cells(REF, ALL_FRAMES))).toBeNull();
        expect(clearCelsCommand(doc, cells([], ALL_FRAMES))).toBeNull();
        expect(clearCelsCommand(doc, cells(ALL_LAYERS, []))).toBeNull();
    });

    it("touches the cells it empties, in document order, and no structure", () => {
        const { doc } = fixture();
        expect(some(clearCelsCommand(doc, cells([L3, L2, L1], ["f5", "f4"]))).touched).toEqual({
            frameIds: ["f4", "f5"],
            layerIds: [L1, L2, L3],
            structure: false,
        });
        // The empty cell of layer-2 at f2 is not touched.
        expect(some(clearCelsCommand(doc, cells([L1, L2], "f2"))).touched).toEqual({
            frameIds: ["f2"],
            layerIds: [L1],
            structure: false,
        });
    });
});

describe("moveCelsCommand", () => {
    it("moves a cel to another frame with its image and opacity", () => {
        const { doc, history } = fixture();
        const command = some(moveCelsCommand(doc, cells(L2, "f3"), { layers: 0, frames: -1 }));

        history.execute(command);

        expect(row(doc, L2)).toEqual(["d", "e", ".", "e", "."]);
        expect(celAt(doc, L2, "f2")).toEqual({ imageId: "e", opacity: 128 });
        expect(imageIds(doc)).toEqual(["a", "b", "c", "d", "e", "g"]);
        expect(command.bytes).toBe(0);
        expect(command.label).toBe("Move Cel");
    });

    it("moves the selection as a whole: where it lands, what was there is replaced", () => {
        const { doc, history } = fixture();
        const command = some(
            moveCelsCommand(doc, cells(L1, ["f1", "f2", "f3"]), { layers: 0, frames: 2 }),
        );

        history.execute(command);

        // f3 is left and landed on; c is replaced and has no cel left.
        expect(row(doc, L1)).toEqual([".", ".", "a", "a", "b"]);
        expect(imageIds(doc)).toEqual(["a", "b", "d", "e", "g"]);
        expect(command.bytes).toBe(IMAGE_BYTES);
        expect(command.label).toBe("Move Cels");
    });

    it("an empty selected cell empties the cell it lands on", () => {
        const { doc, history } = fixture();
        history.execute(some(moveCelsCommand(doc, cells(L1, "f4"), { layers: 0, frames: 1 })));
        expect(row(doc, L1)).toEqual(["a", "a", "b", ".", "."]);
        expect(doc.images.has("c")).toBe(false);
    });

    it("shifts overlapping cells by one frame without losing one", () => {
        const { doc, history } = fixture();
        history.execute(
            some(moveCelsCommand(doc, cells(L2, ["f4", "f3"]), { layers: 0, frames: 1 })),
        );
        expect(row(doc, L2)).toEqual(["d", ".", ".", "e", "e"]);
        expect(celAt(doc, L2, "f4")?.opacity).toBe(128);
        expect(celAt(doc, L2, "f5")?.opacity).toBe(255);
    });

    it("moves to another layer, across the reference layer between them", () => {
        const { doc, history } = fixture();
        const command = some(moveCelsCommand(doc, cells(L1, "f1"), { layers: 2, frames: 0 }));

        history.execute(command);

        // The moved cel is still linked to the cel it left behind at f2.
        expect(row(doc, L1)).toEqual([".", "a", "b", ".", "c"]);
        expect(row(doc, L2)).toEqual(["a", ".", "e", "e", "."]);
        expect(doc.images.has("d")).toBe(false);
        expect(command.touched).toEqual({ frameIds: ["f1"], layerIds: [L1, L2], structure: false });
    });

    it("passes over a selected reference layer", () => {
        const { doc, history } = fixture();
        history.execute(
            some(moveCelsCommand(doc, cells([REF, L1, L2], "f1"), { layers: 0, frames: 3 })),
        );
        expect(row(doc, L1)).toEqual([".", "a", "b", "a", "c"]);
        expect(row(doc, L2)).toEqual([".", ".", "e", "d", "."]);
        expect(row(doc, REF)).toEqual([".", ".", ".", ".", "."]);

        // The reference layer is not moved, so where it would land does not matter.
        const up = fixture();
        up.history.execute(
            some(moveCelsCommand(up.doc, cells([L1, REF], "f5"), { layers: 2, frames: 0 })),
        );
        expect(row(up.doc, L2)).toEqual(["d", ".", "e", "e", "c"]);
        expect(row(up.doc, L3)).toEqual([".", ".", ".", ".", "g"]);
    });

    it.each([
        { layers: L1, frames: "f5", offset: { layers: 0, frames: 1 }, reason: "outside-frames" },
        { layers: L1, frames: "f1", offset: { layers: 0, frames: -1 }, reason: "outside-frames" },
        { layers: L3, frames: "f5", offset: { layers: 1, frames: 0 }, reason: "outside-layers" },
        { layers: L1, frames: "f1", offset: { layers: -1, frames: 0 }, reason: "outside-layers" },
        { layers: L1, frames: "f1", offset: { layers: 1, frames: 0 }, reason: "reference-layer" },
        { layers: L2, frames: "f1", offset: { layers: -1, frames: 0 }, reason: "reference-layer" },
        // The empty cell at f5 would land outside as well.
        {
            layers: L2,
            frames: ["f4", "f5"],
            offset: { layers: 0, frames: 1 },
            reason: "outside-frames",
        },
    ] as const)(
        "refuses $offset from $layers at $frames with a typed error: $reason",
        ({ layers, frames, offset, reason }) => {
            const { session, doc } = fixture();
            const before = snapshot(session);
            const selection = cells(layers, typeof frames === "string" ? frames : [...frames]);

            const error = thrownBy(() => moveCelsCommand(doc, selection, offset));

            expect(error).toBeInstanceOf(CelTargetError);
            expect(error).toMatchObject({ name: "CelTargetError", ...offset, reason });
            expect(thrownBy(() => copyCelsCommand(doc, selection, offset))).toBeInstanceOf(
                CelTargetError,
            );
            expect(snapshot(session)).toStrictEqual(before);
        },
    );

    it("returns null when nothing would change", () => {
        const { doc } = fixture();
        expect(moveCelsCommand(doc, cells(L1, ALL_FRAMES), { layers: 0, frames: 0 })).toBeNull();
        expect(moveCelsCommand(doc, cells(L3, "f1"), { layers: 0, frames: 1 })).toBeNull();
        expect(moveCelsCommand(doc, cells(REF, "f1"), { layers: 0, frames: 1 })).toBeNull();
    });

    it("rejects an offset that is not made of integers", () => {
        const { doc } = fixture();
        const selection = cells(L1, "f1");
        expect(() => moveCelsCommand(doc, selection, { layers: 0, frames: 0.5 })).toThrow(
            RangeError,
        );
        expect(() => moveCelsCommand(doc, selection, { layers: Number.NaN, frames: 0 })).toThrow(
            RangeError,
        );
    });

    it.each([
        { layers: [L1], frames: ["f1", "f2", "f3"], offset: { layers: 0, frames: 2 } },
        { layers: [L1, L2], frames: ["f1", "f3"], offset: { layers: 0, frames: 1 } },
        { layers: [L1], frames: ["f3", "f5"], offset: { layers: 3, frames: -2 } },
        { layers: [L2], frames: ["f3", "f4", "f5"], offset: { layers: -2, frames: -2 } },
    ])(
        "do/undo/redo symmetry moving $layers at $frames by $offset",
        ({ layers, frames, offset }) => {
            const { doc, history } = fixture();
            expectSymmetric(history, moveCelsCommand(doc, cells(layers, frames), offset));
        },
    );

    it("touches the cells it leaves and the cells it lands on", () => {
        const { doc } = fixture();
        const command = some(moveCelsCommand(doc, cells(L1, "f1"), { layers: 0, frames: 3 }));
        expect(command.touched).toEqual({
            frameIds: ["f1", "f4"],
            layerIds: [L1],
            structure: false,
        });
    });
});

describe("copyCelsCommand", () => {
    it("copies a cel to another cell, with the same pixels in an image of its own", () => {
        const { doc, history } = fixture();
        const command = some(
            copyCelsCommand(doc, cells(L1, "f3"), { layers: 0, frames: 1 }, ids()),
        );

        history.execute(command);

        expect(row(doc, L1)).toEqual(["a", "a", "b", "n1", "c"]);
        expect(celBytes(doc, L1, "f4")).toEqual(celBytes(doc, L1, "f3"));
        expect(doc.images.get("n1")?.data).not.toBe(doc.images.get("b")?.data);
        expect(command.bytes).toBe(0);
        expect(command.label).toBe("Copy Cel");

        // No link: painting the copy leaves the original alone.
        const original = pictures(doc).f3;
        paint(history, L1, "f4", 200);
        expect(pictures(doc).f3).toEqual(original);
    });

    it("the copy has the opacity of its original", () => {
        const { doc, history } = fixture();
        history.execute(
            some(copyCelsCommand(doc, cells(L2, "f3"), { layers: 0, frames: -1 }, ids())),
        );
        expect(celAt(doc, L2, "f2")).toEqual({ imageId: "n1", opacity: 128 });
        expect(celAt(doc, L2, "f3")).toEqual({ imageId: "e", opacity: 128 });
    });

    it("keeps links among the copies and none to the originals", () => {
        const { doc, history } = fixture();

        history.execute(
            some(copyCelsCommand(doc, cells(L1, ["f1", "f2"]), { layers: 3, frames: 0 }, ids())),
        );

        expect(row(doc, L1)).toEqual(["a", "a", "b", ".", "c"]);
        expect(row(doc, L3)).toEqual(["n1", "n1", ".", ".", "g"]);
        expect(doc.images.size).toBe(7);
    });

    it("an empty selected cell empties the cell it lands on", () => {
        const { doc, history } = fixture();
        const command = some(copyCelsCommand(doc, cells(L1, "f4"), { layers: 0, frames: 1 }));
        history.execute(command);
        expect(row(doc, L1)).toEqual(["a", "a", "b", ".", "."]);
        expect(command.bytes).toBe(IMAGE_BYTES);
    });

    it("copies onto an overlapping place from the cels as they were", () => {
        const { doc, history } = fixture();
        const pixelsOfB = celBytes(doc, L1, "f3");
        const command = some(
            copyCelsCommand(doc, cells(L1, ["f1", "f2", "f3"]), { layers: 0, frames: 1 }, ids()),
        );

        history.execute(command);

        // f2 and f3 get the copy of a, f4 the copy of b; b itself has no cel left.
        expect(row(doc, L1)).toEqual(["a", "n1", "n1", "n2", "c"]);
        expect(celBytes(doc, L1, "f4")).toEqual(pixelsOfB);
        expect(doc.images.has("b")).toBe(false);
        expect(command.bytes).toBe(IMAGE_BYTES);
        expect(command.label).toBe("Copy Cels");
    });

    it("returns null for an offset of zero and when nothing would change", () => {
        const { doc } = fixture();
        expect(copyCelsCommand(doc, cells(L1, ALL_FRAMES), { layers: 0, frames: 0 })).toBeNull();
        expect(copyCelsCommand(doc, cells(L3, "f1"), { layers: 0, frames: 1 })).toBeNull();
    });

    it("do/undo/redo symmetry; redo makes the images again", () => {
        const { session, doc, history } = fixture();

        const { after } = expectSymmetric(
            history,
            copyCelsCommand(doc, cells([L1, L2], ["f3", "f4"]), { layers: 0, frames: -2 }, ids()),
        );

        // b → n1 on layer-1; both cels of e → one copy, n2, on layer-2.
        expect(row(doc, L1)).toEqual(["n1", ".", "b", ".", "c"]);
        expect(row(doc, L2)).toEqual(["n2", "n2", "e", "e", "."]);
        expect(after.doc.images.map(([id]) => id)).toEqual(["b", "c", "e", "g", "n1", "n2"]);

        // A patch of a copy still finds its image after the copy is undone and redone.
        paint(history, L2, "f1", 90);
        const painted = snapshot(session);
        history.undo();
        history.undo();
        history.redo();
        history.redo();
        expect(snapshot(session)).toStrictEqual(painted);
    });

    it.each([
        { allocator: () => failingAllocator, failing: "the first image" },
        { allocator: () => flakyAllocator(1), failing: "the second image" },
    ])(
        "when $failing cannot be allocated, throws AllocationError and changes nothing",
        ({ allocator }) => {
            const { session, doc, history } = fixture();
            const before = snapshot(session);
            const command = some(
                copyCelsCommand(
                    doc,
                    cells(L1, ["f2", "f3"]),
                    { layers: 0, frames: 2 },
                    ids(),
                    allocator(),
                ),
            );

            expect(() => history.execute(command)).toThrow(AllocationError);

            expect(snapshot(session)).toStrictEqual(before);
            expect(history.undoCount).toBe(0);
        },
    );

    it("touches the cells it lands on", () => {
        const { doc } = fixture();
        const command = some(copyCelsCommand(doc, cells(L1, "f3"), { layers: 2, frames: 2 }));
        expect(command.touched).toEqual({ frameIds: ["f5"], layerIds: [L2], structure: false });
    });
});

describe("linkCelsCommand", () => {
    it("gives the selected cells after a layer's first cel the image of that cel", () => {
        const { doc, history } = fixture();
        const command = some(linkCelsCommand(doc, cells(L1, ["f3", "f4", "f5"])));

        history.execute(command);

        expect(row(doc, L1)).toEqual(["a", "a", "b", "b", "b"]);
        // c is replaced and has no cel left.
        expect(doc.images.has("c")).toBe(false);
        expect(command.bytes).toBe(IMAGE_BYTES);
        expect(command.label).toBe("Link Cels");
    });

    it("leaves the empty cells before the first cel empty", () => {
        const { doc, history } = fixture();
        history.execute(some(linkCelsCommand(doc, cells(L2, ["f2", "f3", "f5"]))));
        expect(row(doc, L2)).toEqual(["d", ".", "e", "e", "e"]);
        // The only cel of layer-3 is in the last selected frame: nothing comes after it.
        expect(linkCelsCommand(doc, cells(L3, ALL_FRAMES))).toBeNull();
    });

    it("a linked cel takes the opacity of the cel it is linked to", () => {
        const { doc, history } = fixture();
        history.execute(some(linkCelsCommand(doc, cells(L2, ["f5", "f3", "f4"]))));
        expect(row(doc, L2)).toEqual(["d", ".", "e", "e", "e"]);
        expect(celAt(doc, L2, "f4")).toEqual({ imageId: "e", opacity: 128 });
        expect(celAt(doc, L2, "f5")).toEqual({ imageId: "e", opacity: 128 });
    });

    it("links each layer on its own and passes over a reference layer", () => {
        const { doc, history } = fixture();

        history.execute(some(linkCelsCommand(doc, cells(ALL_LAYERS, ["f4", "f5"]))));

        // layer-1 and layer-3 have their only cel of the two frames at f5.
        expect(row(doc, L1)).toEqual(["a", "a", "b", ".", "c"]);
        expect(row(doc, L2)).toEqual(["d", ".", "e", "e", "e"]);
        expect(row(doc, L3)).toEqual([".", ".", ".", ".", "g"]);
        expect(row(doc, REF)).toEqual([".", ".", ".", ".", "."]);
    });

    it("returns null when the cells are linked already or there is no cel to link to", () => {
        const { doc } = fixture();
        expect(linkCelsCommand(doc, cells(L1, ["f1", "f2"]))).toBeNull();
        expect(linkCelsCommand(doc, cells(L1, "f3"))).toBeNull();
        expect(linkCelsCommand(doc, cells(L3, ["f1", "f2"]))).toBeNull();
        expect(linkCelsCommand(doc, cells(REF, ALL_FRAMES))).toBeNull();
        // Same image, other opacity: still something to do.
        expect(linkCelsCommand(doc, cells(L2, ["f3", "f4"]))).not.toBeNull();
    });

    it("do/undo/redo symmetry", () => {
        const { doc, history } = fixture();
        const command = some(linkCelsCommand(doc, cells([L1, L2], ALL_FRAMES)));

        const { after } = expectSymmetric(history, command);

        expect(row(doc, L1)).toEqual(["a", "a", "a", "a", "a"]);
        expect(row(doc, L2)).toEqual(["d", "d", "d", "d", "d"]);
        expect(after.doc.images.map(([id]) => id)).toEqual(["a", "d", "g"]);
        expect(command.bytes).toBe(3 * IMAGE_BYTES);
    });

    it("touches the cells that change", () => {
        const { doc } = fixture();
        expect(some(linkCelsCommand(doc, cells(L1, ["f3", "f4", "f5"]))).touched).toEqual({
            frameIds: ["f4", "f5"],
            layerIds: [L1],
            structure: false,
        });
    });
});

describe("linked cels", () => {
    it("editing a linked cel changes all cels sharing the image; after unlink it changes one", () => {
        const { doc, history } = fixture();
        history.execute(some(linkCelsCommand(doc, cells(L1, ["f3", "f4"]))));
        expect(celAt(doc, L1, "f3")?.imageId).toBe(celAt(doc, L1, "f4")?.imageId);
        const linked = pictures(doc);

        // A stroke on the cel at f3 shows at f4 as well, and nowhere else.
        paint(history, L1, "f3", 200);
        const edited = pictures(doc);
        expect(celBytes(doc, L1, "f3").slice(0, 4)).toEqual([200, 200, 200, 255]);
        expect(celBytes(doc, L1, "f4")).toEqual(celBytes(doc, L1, "f3"));
        expect(edited.f3).not.toEqual(linked.f3);
        expect(edited.f4).not.toEqual(linked.f4);
        expect(edited.f1).toEqual(linked.f1);
        expect(edited.f5).toEqual(linked.f5);

        // Unlinked, the cel at f3 has the same pixels in an image of its own.
        history.execute(some(unlinkCelsCommand(doc, cells(L1, "f3"), ids())));
        expect(celAt(doc, L1, "f3")?.imageId).not.toBe(celAt(doc, L1, "f4")?.imageId);
        expect(pictures(doc)).toEqual(edited);

        // The same stroke now changes that cel alone.
        paint(history, L1, "f3", 90);
        const alone = pictures(doc);
        expect(celBytes(doc, L1, "f3").slice(0, 4)).toEqual([90, 90, 90, 255]);
        expect(celBytes(doc, L1, "f4").slice(0, 4)).toEqual([200, 200, 200, 255]);
        expect(alone.f3).not.toEqual(edited.f3);
        expect(alone.f4).toEqual(edited.f4);

        // And all of it undoes: stroke, unlink, stroke, link.
        while (history.undo());
        expect(pictures(doc)).toEqual(pictures(fixture().doc));
    });

    it("a pixel patch of a shared image shows in every cel that uses it", () => {
        const { doc, history } = fixture();
        const before = pictures(doc);
        const white = { width: 1, height: 1, data: new Uint8ClampedArray(4).fill(255) };

        history.execute(
            pixelPatchCommand(doc, { label: "Dot", imageId: "a", x: 1, y: 1, pixels: white }),
        );

        const after = pictures(doc);
        expect(after.f1).not.toEqual(before.f1);
        expect(after.f2).not.toEqual(before.f2);
        expect(after.f3).toEqual(before.f3);
    });
});

describe("unlinkCelsCommand", () => {
    it("gives a linked cel a copy of the image for itself", () => {
        const { doc, history } = fixture();
        const before = pictures(doc);
        const command = some(unlinkCelsCommand(doc, cells(L1, "f2"), ids()));

        history.execute(command);

        expect(row(doc, L1)).toEqual(["a", "n1", "b", ".", "c"]);
        expect(celBytes(doc, L1, "f2")).toEqual(celBytes(doc, L1, "f1"));
        expect(doc.images.get("n1")?.data).not.toBe(doc.images.get("a")?.data);
        // Nothing looks different.
        expect(pictures(doc)).toEqual(before);
        expect(command.bytes).toBe(0);
        expect(command.label).toBe("Unlink Cel");
    });

    it("keeps the opacity of each cel", () => {
        const { doc, history } = fixture();
        history.execute(some(unlinkCelsCommand(doc, cells(L2, "f3"), ids())));
        expect(celAt(doc, L2, "f3")).toEqual({ imageId: "n1", opacity: 128 });
        expect(celAt(doc, L2, "f4")).toEqual({ imageId: "e", opacity: 255 });
    });

    it("when every cel of an image is selected, the last one keeps the image", () => {
        const { doc, history } = fixture();
        history.execute(some(linkCelsCommand(doc, cells(L1, ["f1", "f2", "f3", "f4"]))));
        expect(row(doc, L1)).toEqual(["a", "a", "a", "a", "c"]);

        history.execute(some(unlinkCelsCommand(doc, cells([L1, L2], ALL_FRAMES), ids())));

        expect(row(doc, L1)).toEqual(["n1", "n2", "n3", "a", "c"]);
        expect(row(doc, L2)).toEqual(["d", ".", "n4", "e", "."]);
        for (const frame of ["f1", "f2", "f3"]) {
            expect(celBytes(doc, L1, frame)).toEqual(celBytes(doc, L1, "f4"));
        }
    });

    it("unlinks only the selected cels of an image", () => {
        const { doc, history } = fixture();
        history.execute(some(linkCelsCommand(doc, cells(L1, ["f1", "f2", "f3", "f4"]))));
        history.execute(some(unlinkCelsCommand(doc, cells(L1, ["f2", "f3"]), ids())));
        // f1 and f4 are still linked to each other.
        expect(row(doc, L1)).toEqual(["a", "n1", "n2", "a", "c"]);
    });

    it("returns null when no selected cel is linked", () => {
        const { doc } = fixture();
        expect(unlinkCelsCommand(doc, cells(L1, ["f3", "f4", "f5"]))).toBeNull();
        expect(unlinkCelsCommand(doc, cells([L3, REF], ALL_FRAMES))).toBeNull();
        expect(unlinkCelsCommand(doc, cells(L1, "f1"))).not.toBeNull();
    });

    it("do/undo/redo symmetry", () => {
        const { doc, history } = fixture();

        const { after } = expectSymmetric(
            history,
            unlinkCelsCommand(doc, cells(ALL_LAYERS, ALL_FRAMES), ids()),
        );

        expect(row(doc, L1)).toEqual(["n1", "a", "b", ".", "c"]);
        expect(row(doc, L2)).toEqual(["d", ".", "n2", "e", "."]);
        expect(after.doc.images.map(([id]) => id)).toEqual([
            "a",
            "b",
            "c",
            "d",
            "e",
            "g",
            "n1",
            "n2",
        ]);
    });

    it("when an image cannot be allocated, throws AllocationError and changes nothing", () => {
        const { session, doc, history } = fixture();
        const before = snapshot(session);
        const command = some(
            unlinkCelsCommand(doc, cells(ALL_LAYERS, ALL_FRAMES), ids(), flakyAllocator(1)),
        );

        expect(() => history.execute(command)).toThrow(AllocationError);

        expect(snapshot(session)).toStrictEqual(before);
        expect(history.undoCount).toBe(0);
    });

    it("touches the cels it gives an image", () => {
        const { doc } = fixture();
        expect(some(unlinkCelsCommand(doc, cells([L1, L2], ALL_FRAMES))).touched).toEqual({
            frameIds: ["f1", "f3"],
            layerIds: [L1, L2],
            structure: false,
        });
    });
});

describe("setCelOpacityCommand", () => {
    it("sets the opacity of the selected cels and leaves empty cells empty", () => {
        const { doc, history } = fixture();
        const before = pictures(doc);
        const command = some(setCelOpacityCommand(doc, cells([L2, REF], ALL_FRAMES), 64));

        history.execute(command);

        expect(row(doc, L2)).toEqual(["d", ".", "e", "e", "."]);
        for (const frame of ["f1", "f3", "f4"]) expect(celAt(doc, L2, frame)?.opacity).toBe(64);
        expect(celAt(doc, L1, "f1")?.opacity).toBe(255);
        expect(doc.cels.size).toBe(8);
        expect(command.bytes).toBe(0);
        expect(command.label).toBe("Cel Opacity");
        // The composite shows it.
        expect(pictures(doc).f1).not.toEqual(before.f1);
        expect(pictures(doc).f2).toEqual(before.f2);
    });

    it("opacity belongs to the cel: a linked cel keeps its own", () => {
        const { doc, history } = fixture();
        history.execute(some(setCelOpacityCommand(doc, cells(L2, "f4"), 10)));
        expect(celAt(doc, L2, "f4")).toEqual({ imageId: "e", opacity: 10 });
        expect(celAt(doc, L2, "f3")).toEqual({ imageId: "e", opacity: 128 });
    });

    it("accepts 0 and 255", () => {
        const { doc, history } = fixture();
        history.execute(some(setCelOpacityCommand(doc, cells(L1, "f1"), 0)));
        history.execute(some(setCelOpacityCommand(doc, cells(L2, "f3"), 255)));
        expect(celAt(doc, L1, "f1")?.opacity).toBe(0);
        expect(celAt(doc, L2, "f3")?.opacity).toBe(255);
        expect(isCelOpacity(0)).toBe(true);
        expect(isCelOpacity(255)).toBe(true);
    });

    it.each([-1, 256, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        "rejects the opacity %s with a typed error and changes nothing",
        (value) => {
            const { session, doc } = fixture();
            const before = snapshot(session);

            const error = thrownBy(() => setCelOpacityCommand(doc, cells(L1, "f1"), value));

            expect(error).toBeInstanceOf(CelOpacityError);
            expect(error).toMatchObject({ name: "CelOpacityError", opacity: value });
            expect(isCelOpacity(value)).toBe(false);
            expect(snapshot(session)).toStrictEqual(before);
        },
    );

    it("returns null when nothing would change", () => {
        const { doc } = fixture();
        expect(setCelOpacityCommand(doc, cells(L1, ALL_FRAMES), 255)).toBeNull();
        expect(setCelOpacityCommand(doc, cells(L2, "f3"), 128)).toBeNull();
        expect(setCelOpacityCommand(doc, cells(L3, ["f1", "f2"]), 5)).toBeNull();
    });

    it("do/undo/redo symmetry: each cel gets its own opacity back", () => {
        const { doc, history } = fixture();
        const command = some(setCelOpacityCommand(doc, cells(L2, ALL_FRAMES), 128));

        const { before, after } = expectSymmetric(history, command);

        const opacities = (shot: typeof before) =>
            shot.doc.cels.filter(([key]) => key.startsWith(L2)).map(([, cel]) => cel.opacity);
        expect(opacities(before)).toEqual([255, 128, 255]);
        expect(opacities(after)).toEqual([128, 128, 128]);
        // The cel at f3 had the opacity already.
        expect(command.touched).toEqual({
            frameIds: ["f1", "f4"],
            layerIds: [L2],
            structure: false,
        });
    });
});

describe("cel commands, selections", () => {
    const offset = { layers: 0, frames: 0 };
    const commands: [string, (doc: SpriteDoc, selection: CelSelection) => unknown][] = [
        ["clearCelsCommand", (doc, selection) => clearCelsCommand(doc, selection)],
        ["moveCelsCommand", (doc, selection) => moveCelsCommand(doc, selection, offset)],
        ["copyCelsCommand", (doc, selection) => copyCelsCommand(doc, selection, offset)],
        ["linkCelsCommand", (doc, selection) => linkCelsCommand(doc, selection)],
        ["unlinkCelsCommand", (doc, selection) => unlinkCelsCommand(doc, selection)],
        ["setCelOpacityCommand", (doc, selection) => setCelOpacityCommand(doc, selection, 5)],
    ];

    it.each(commands)("%s rejects a layer or frame the document does not have", (_, make) => {
        const { session, doc } = fixture();
        const before = snapshot(session);
        expect(() => make(doc, cells("layer-9", "f1"))).toThrow(RangeError);
        expect(() => make(doc, cells(L1, ["f1", "f9"]))).toThrow(RangeError);
        expect(snapshot(session)).toStrictEqual(before);
    });

    it.each(commands)("%s is not applied until the history executes it", (_, make) => {
        const { session, doc } = fixture();
        const before = snapshot(session);
        make(doc, cells(ALL_LAYERS, ALL_FRAMES));
        expect(snapshot(session)).toStrictEqual(before);
    });

    it("a command keeps its own copy of the cels it puts in place", () => {
        const { doc, history } = fixture();
        history.execute(some(setCelOpacityCommand(doc, cells(L2, "f1"), 64)));
        // Written into the document's cel, behind the history's back.
        const cel = celAt(doc, L2, "f1");
        if (cel) cel.opacity = 3;

        history.undo();
        expect(celAt(doc, L2, "f1")?.opacity).toBe(255);
        history.redo();
        expect(celAt(doc, L2, "f1")?.opacity).toBe(64);
    });

    it("a command whose document changed since it was made throws instead of running", () => {
        const { session, doc, history } = fixture();
        const stale = [
            some(clearCelsCommand(doc, cells(L1, "f3"))),
            some(moveCelsCommand(doc, cells(L1, "f5"), { layers: 0, frames: -1 })),
            some(copyCelsCommand(doc, cells(L1, "f3"), { layers: 0, frames: 1 }, ids())),
            some(linkCelsCommand(doc, cells(L1, ["f3", "f4"]))),
            some(unlinkCelsCommand(doc, cells(L1, "f1"), ids())),
            some(setCelOpacityCommand(doc, cells(L2, "f1"), 10)),
        ];
        // One cel and one image fewer than the commands were made for.
        history.execute(some(clearCelsCommand(doc, cells(L3, "f5"))));
        const before = snapshot(session);

        for (const command of stale) {
            expect(() => history.execute(command)).toThrow(/changed since/);
            expect(snapshot(session)).toStrictEqual(before);
        }
        expect(history.undoCount).toBe(1);
    });

    it("also when the document has as many cels but another one where the command changes it", () => {
        const { session, doc, history } = fixture();
        const stale = some(setCelOpacityCommand(doc, cells(L2, "f1"), 10));
        history.execute(some(setCelOpacityCommand(doc, cells(L2, "f1"), 20)));
        const before = snapshot(session);

        expect(() => history.execute(stale)).toThrow(/changed since/);

        expect(snapshot(session)).toStrictEqual(before);
    });

    it("no command gives a reference layer a cel", () => {
        const { doc, history } = fixture();
        const everything = cells(ALL_LAYERS, ALL_FRAMES);
        history.execute(some(linkCelsCommand(doc, everything)));
        history.execute(some(setCelOpacityCommand(doc, everything, 77)));
        history.execute(some(unlinkCelsCommand(doc, everything, ids())));
        history.execute(
            some(copyCelsCommand(doc, cells([L1, REF], ["f1", "f2"]), { layers: 0, frames: 3 })),
        );
        history.execute(
            some(moveCelsCommand(doc, cells([L1, REF], "f1"), { layers: 3, frames: 0 })),
        );
        // The history of the fixture has checked after each step that no cel is a stray.
        expect(row(doc, REF)).toEqual([".", ".", ".", ".", "."]);
        history.execute(some(clearCelsCommand(doc, everything)));
        expect(doc.cels.size).toBe(0);
        while (history.undo());
        expect(snapshot(history.session)).toStrictEqual(snapshot(fixture().session));
    });
});
