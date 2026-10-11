import { describe, expect, it } from "vitest";
import {
    activeTagAt,
    assertInvariants,
    celAt,
    celKey,
    createDocument,
    frameIndex,
    layerIndex,
    pixelMemoryBytes,
    sequentialIds,
    tagsAtFrame,
    type DocSession,
    type PixelBuffer,
    type SpriteDoc,
    type Tag,
} from "../../src/core/model";

const WIDTH = 8;
const HEIGHT = 4;

function image(): PixelBuffer {
    return { width: WIDTH, height: HEIGHT, data: new Uint8ClampedArray(WIDTH * HEIGHT * 4) };
}

/** Frames `f0`..`f5` and layers `l0` (bottom), `l1`; no cels and no tags. */
function session(): DocSession {
    const created = createDocument(
        { name: "queries", width: WIDTH, height: HEIGHT },
        sequentialIds(),
    );
    const { doc } = created;
    doc.layers = ["l0", "l1"].map((id) => ({
        id,
        name: id,
        kind: "pixel",
        visible: true,
        locked: false,
        opacity: 255,
        blend: "normal",
    }));
    doc.frames = ["f0", "f1", "f2", "f3", "f4", "f5"].map((id) => ({ id, durationMs: 100 }));
    created.activeLayerId = "l0";
    created.activeFrameId = "f0";
    return created;
}

/** Appends a tag over frame indices `from`..`to`, so call order is creation order. */
function addTag(doc: SpriteDoc, id: string, from: number, to: number): Tag {
    const tag: Tag = {
        id,
        name: id,
        color: 0x00ff00ff,
        fromFrameId: `f${from}`,
        toFrameId: `f${to}`,
        direction: "forward",
        repeat: 0,
    };
    doc.tags.push(tag);
    return tag;
}

function ids(tags: Tag[]): string[] {
    return tags.map((tag) => tag.id);
}

describe("celAt", () => {
    it("keys cels by layer and frame", () => {
        expect(celKey("l0", "f2")).toBe("l0:f2");
    });

    it("returns the cel of a layer at a frame and undefined for an empty cel", () => {
        const { doc } = session();
        const cel = { imageId: "image-1", opacity: 200 };
        doc.images.set("image-1", image());
        doc.cels.set("l1:f2", cel);

        expect(celAt(doc, "l1", "f2")).toBe(cel);
        expect(celAt(doc, "l0", "f2")).toBeUndefined();
        expect(celAt(doc, "l1", "f3")).toBeUndefined();
        expect(celAt(doc, "f2", "l1")).toBeUndefined();
        expect(celAt(doc, "missing", "f2")).toBeUndefined();
    });

    it("finds no cel in a new document", () => {
        const { doc, activeLayerId, activeFrameId } = createDocument({
            name: "new",
            width: 8,
            height: 8,
        });
        expect(celAt(doc, activeLayerId, activeFrameId)).toBeUndefined();
    });
});

describe("frameIndex and layerIndex", () => {
    it("returns the position of a frame in playback order, or -1", () => {
        const { doc } = session();
        expect(frameIndex(doc, "f0")).toBe(0);
        expect(frameIndex(doc, "f4")).toBe(4);
        expect(frameIndex(doc, "l0")).toBe(-1);
        expect(frameIndex(doc, "missing")).toBe(-1);
    });

    it("returns the position of a layer from the bottom, or -1", () => {
        const { doc } = session();
        expect(layerIndex(doc, "l0")).toBe(0);
        expect(layerIndex(doc, "l1")).toBe(1);
        expect(layerIndex(doc, "f0")).toBe(-1);
        expect(layerIndex(doc, "missing")).toBe(-1);
    });
});

describe("tagsAtFrame", () => {
    it("returns the tags whose range contains the frame, in creation order", () => {
        const { doc } = session();
        addTag(doc, "late", 3, 5);
        addTag(doc, "all", 0, 5);
        addTag(doc, "early", 0, 2);

        expect(ids(tagsAtFrame(doc, 0))).toEqual(["all", "early"]);
        expect(ids(tagsAtFrame(doc, 2))).toEqual(["all", "early"]);
        expect(ids(tagsAtFrame(doc, 3))).toEqual(["late", "all"]);
        expect(ids(tagsAtFrame(doc, 5))).toEqual(["late", "all"]);
    });

    it("includes both endpoints and nothing outside them", () => {
        const { doc } = session();
        addTag(doc, "mid", 2, 3);

        expect(ids(tagsAtFrame(doc, 1))).toEqual([]);
        expect(ids(tagsAtFrame(doc, 2))).toEqual(["mid"]);
        expect(ids(tagsAtFrame(doc, 3))).toEqual(["mid"]);
        expect(ids(tagsAtFrame(doc, 4))).toEqual([]);
    });

    it("returns nothing without tags or outside the document's frames", () => {
        const { doc } = session();
        expect(tagsAtFrame(doc, 0)).toEqual([]);
        addTag(doc, "all", 0, 5);
        expect(tagsAtFrame(doc, -1)).toEqual([]);
        expect(tagsAtFrame(doc, 6)).toEqual([]);
    });

    it("returns the document's own tag objects", () => {
        const { doc } = session();
        const tag = addTag(doc, "all", 0, 5);
        expect(tagsAtFrame(doc, 1)[0]).toBe(tag);
    });
});

describe("activeTagAt", () => {
    it("nested tags: the shortest range containing the frame wins", () => {
        const { doc } = session();
        addTag(doc, "inner", 2, 3);
        addTag(doc, "outer", 0, 5);
        addTag(doc, "middle", 1, 4);

        expect(activeTagAt(doc, 0)?.id).toBe("outer");
        expect(activeTagAt(doc, 1)?.id).toBe("middle");
        expect(activeTagAt(doc, 2)?.id).toBe("inner");
        expect(activeTagAt(doc, 3)?.id).toBe("inner");
        expect(activeTagAt(doc, 4)?.id).toBe("middle");
        expect(activeTagAt(doc, 5)?.id).toBe("outer");
    });

    it("nested tags: the result does not depend on creation order", () => {
        const { doc } = session();
        addTag(doc, "outer", 0, 5);
        addTag(doc, "inner", 2, 3);
        expect(activeTagAt(doc, 2)?.id).toBe("inner");
        expect(activeTagAt(doc, 4)?.id).toBe("outer");

        doc.tags.reverse();
        expect(activeTagAt(doc, 2)?.id).toBe("inner");
        expect(activeTagAt(doc, 4)?.id).toBe("outer");
    });

    it("equal-length overlap: the tag created later wins", () => {
        const { doc } = session();
        addTag(doc, "first", 1, 3);
        addTag(doc, "second", 2, 4);

        expect(activeTagAt(doc, 1)?.id).toBe("first");
        expect(activeTagAt(doc, 2)?.id).toBe("second");
        expect(activeTagAt(doc, 3)?.id).toBe("second");
        expect(activeTagAt(doc, 4)?.id).toBe("second");
    });

    it("equal-length overlap: the later tag wins whichever range starts first", () => {
        const { doc } = session();
        addTag(doc, "first", 2, 4);
        addTag(doc, "second", 1, 3);

        expect(activeTagAt(doc, 2)?.id).toBe("second");
        expect(activeTagAt(doc, 3)?.id).toBe("second");
        expect(activeTagAt(doc, 4)?.id).toBe("first");
    });

    it("equal-length overlap: identical ranges go to the tag created last", () => {
        const { doc } = session();
        addTag(doc, "first", 0, 2);
        addTag(doc, "second", 0, 2);
        addTag(doc, "third", 0, 2);

        expect(activeTagAt(doc, 1)?.id).toBe("third");
    });

    it("a shorter tag wins over a later, longer one", () => {
        const { doc } = session();
        addTag(doc, "short", 2, 2);
        addTag(doc, "long", 1, 4);

        expect(activeTagAt(doc, 2)?.id).toBe("short");
    });

    it("no tag: returns undefined", () => {
        const { doc } = session();
        expect(activeTagAt(doc, 0)).toBeUndefined();
        expect(activeTagAt(doc, 5)).toBeUndefined();
    });

    it("no tag at the frame: returns undefined", () => {
        const { doc } = session();
        addTag(doc, "early", 0, 1);
        addTag(doc, "late", 4, 5);

        expect(activeTagAt(doc, 2)).toBeUndefined();
        expect(activeTagAt(doc, 3)).toBeUndefined();
        expect(activeTagAt(doc, -1)).toBeUndefined();
        expect(activeTagAt(doc, 6)).toBeUndefined();
    });

    it("follows the frames when they are reordered", () => {
        const { doc } = session();
        addTag(doc, "pair", 0, 1);
        const moved = doc.frames.splice(0, 2);
        doc.frames.push(...moved);

        expect(activeTagAt(doc, 0)).toBeUndefined();
        expect(activeTagAt(doc, 4)?.id).toBe("pair");
        expect(activeTagAt(doc, 5)?.id).toBe("pair");
    });
});

describe("pixelMemoryBytes", () => {
    it("is 0 for a new document", () => {
        expect(pixelMemoryBytes(createDocument({ name: "new", width: 64, height: 64 }).doc)).toBe(
            0,
        );
    });

    it("sums the bytes of the images, counting a linked image once", () => {
        const created = session();
        const { doc } = created;
        doc.images.set("image-1", image());
        doc.images.set("image-2", image());
        doc.cels.set(celKey("l0", "f0"), { imageId: "image-1", opacity: 255 });
        doc.cels.set(celKey("l0", "f1"), { imageId: "image-1", opacity: 255 });
        doc.cels.set(celKey("l1", "f0"), { imageId: "image-2", opacity: 255 });
        assertInvariants(created);

        expect(pixelMemoryBytes(doc)).toBe(2 * WIDTH * HEIGHT * 4);
    });

    it("is 4 MiB for one cel of a 1024×1024 document", () => {
        const { doc, activeLayerId, activeFrameId } = createDocument({
            name: "max",
            width: 1024,
            height: 1024,
        });
        doc.images.set("image-1", {
            width: 1024,
            height: 1024,
            data: new Uint8ClampedArray(1024 * 1024 * 4),
        });
        doc.cels.set(celKey(activeLayerId, activeFrameId), { imageId: "image-1", opacity: 255 });

        expect(pixelMemoryBytes(doc)).toBe(4 * 1024 * 1024);
    });
});

describe("read helpers", () => {
    it("leave the document unchanged", () => {
        const { doc } = session();
        addTag(doc, "outer", 0, 5);
        addTag(doc, "inner", 2, 3);
        doc.images.set("image-1", image());
        doc.cels.set(celKey("l0", "f0"), { imageId: "image-1", opacity: 255 });
        const before = structuredClone(doc);

        celAt(doc, "l0", "f0");
        frameIndex(doc, "f3");
        layerIndex(doc, "l1");
        tagsAtFrame(doc, 2);
        activeTagAt(doc, 2);
        pixelMemoryBytes(doc);

        expect(doc).toEqual(before);
    });
});
