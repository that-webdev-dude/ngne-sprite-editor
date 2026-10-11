import { describe, expect, it } from "vitest";
import {
    INVARIANTS,
    InvariantError,
    assertInvariants,
    celKey,
    createDocument,
    sequentialIds,
    type DocSession,
    type InvariantName,
    type PixelBuffer,
    type PixelLayer,
    type ReferenceLayer,
    type Tag,
} from "../../src/core/model";

const WIDTH = 4;
const HEIGHT = 3;

function image(width = WIDTH, height = HEIGHT): PixelBuffer {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function pixelLayer(id: string): PixelLayer {
    return {
        id,
        name: "Layer",
        kind: "pixel",
        visible: true,
        locked: false,
        opacity: 255,
        blend: "normal",
    };
}

function referenceLayer(id: string): ReferenceLayer {
    return {
        id,
        name: "Reference",
        kind: "reference",
        visible: true,
        locked: false,
        opacity: 128,
        sourceId: "source-1",
        x: 0,
        y: 0,
        scale: 1,
        placement: "behind",
    };
}

function tag(id: string, fromFrameId: string, toFrameId: string): Tag {
    return {
        id,
        name: "walk",
        color: 0xff0000ff,
        fromFrameId,
        toFrameId,
        direction: "forward",
        repeat: 0,
    };
}

/**
 * A valid 4×3 session that exercises every invariant: layers `layer-a`, `layer-b` and the
 * reference layer `ref-1`; frames `frame-a`..`frame-c`; `image-a` shared by two linked cels
 * and `image-b` on a third; tag `tag-a` over the first two frames, named by the export
 * settings; a one-pixel selection.
 */
function fixture(): DocSession {
    const ids = ["doc", "layer-a", "frame-a"];
    const session = createDocument({ name: "fixture", width: WIDTH, height: HEIGHT }, () => {
        const id = ids.shift();
        if (id === undefined) throw new Error("fixture: unexpected ID request");
        return id;
    });
    const { doc } = session;
    doc.layers.push(pixelLayer("layer-b"), referenceLayer("ref-1"));
    doc.frames.push({ id: "frame-b", durationMs: 100 }, { id: "frame-c", durationMs: 100 });
    doc.images.set("image-a", image());
    doc.images.set("image-b", image());
    doc.cels.set(celKey("layer-a", "frame-a"), { imageId: "image-a", opacity: 255 });
    doc.cels.set(celKey("layer-a", "frame-b"), { imageId: "image-a", opacity: 255 });
    doc.cels.set(celKey("layer-b", "frame-c"), { imageId: "image-b", opacity: 255 });
    doc.tags.push(tag("tag-a", "frame-a", "frame-b"));
    doc.exportSettings.frames = { tagId: "tag-a" };
    session.selection = {
        mask: { width: WIDTH, height: HEIGHT, data: Uint8Array.of(1, 0) },
        bounds: { x: 0, y: 0, width: 1, height: 1 },
    };
    return session;
}

function violation(session: DocSession): InvariantError {
    try {
        assertInvariants(session);
    } catch (error) {
        if (error instanceof InvariantError) return error;
        throw error;
    }
    throw new Error("assertInvariants did not throw");
}

function expectViolation(session: DocSession, name: InvariantName): InvariantError {
    const error = violation(session);
    expect(error.invariant).toBe(name);
    expect(error.name).toBe("InvariantError");
    expect(error.message).toContain(`"${name}"`);
    expect(error.message).toContain(INVARIANTS[name]);
    expect(error.message).toContain(error.detail);
    return error;
}

/** One change per invariant that breaks it on the fixture. Typed so none can be left out. */
const violations: Record<InvariantName, (session: DocSession) => void> = {
    "pixel-layer-required": (session) => {
        session.doc.layers = [referenceLayer("ref-1")];
        session.doc.cels.clear();
        session.doc.images.clear();
        session.activeLayerId = "ref-1";
    },
    "frame-required": (session) => {
        session.doc.frames = [];
    },
    "reference-layer-limit": (session) => {
        for (const id of ["ref-2", "ref-3", "ref-4", "ref-5"]) {
            session.doc.layers.push(referenceLayer(id));
        }
    },
    "unique-ids": (session) => {
        session.doc.layers.push(pixelLayer("layer-a"));
    },
    "cel-image-exists": (session) => {
        session.doc.cels.set(celKey("layer-b", "frame-a"), { imageId: "image-x", opacity: 255 });
    },
    "cel-image-size": (session) => {
        session.doc.images.set("image-b", image(WIDTH, HEIGHT + 1));
    },
    "no-orphan-image": (session) => {
        session.doc.images.set("image-c", image());
    },
    "tag-endpoints-exist": (session) => {
        session.doc.tags.push(tag("tag-b", "frame-b", "frame-x"));
    },
    "tag-order": (session) => {
        session.doc.tags.push(tag("tag-b", "frame-c", "frame-b"));
    },
    "export-frames-tag-exists": (session) => {
        session.doc.exportSettings.frames = { tagId: "tag-x" };
    },
    "active-layer-exists": (session) => {
        session.activeLayerId = "layer-x";
    },
    "active-frame-exists": (session) => {
        session.activeFrameId = "frame-x";
    },
    "selection-mask-size": (session) => {
        session.selection = {
            mask: { width: WIDTH + 1, height: HEIGHT, data: new Uint8Array(2) },
            bounds: { x: 0, y: 0, width: 1, height: 1 },
        };
    },
};

describe("assertInvariants on valid sessions", () => {
    it.each([
        [1, 1],
        [32, 32],
        [33, 17],
        [1024, 1024],
    ])("accepts a new %d×%d document", (width, height) => {
        expect(() =>
            assertInvariants(createDocument({ name: "new", width, height })),
        ).not.toThrow();
    });

    it("accepts a new document made with a sequential ID generator", () => {
        const session = createDocument({ name: "new", width: 16, height: 16 }, sequentialIds());
        expect(() => assertInvariants(session)).not.toThrow();
    });

    it("accepts the fixture with layers, frames, linked cels, a tag and a selection", () => {
        expect(() => assertInvariants(fixture())).not.toThrow();
    });

    it("accepts four reference layers", () => {
        const session = fixture();
        session.doc.layers.push(referenceLayer("ref-2"), referenceLayer("ref-3"));
        session.doc.layers.push(referenceLayer("ref-4"));
        expect(() => assertInvariants(session)).not.toThrow();
    });

    it("accepts a reference layer as the active layer", () => {
        const session = fixture();
        session.activeLayerId = "ref-1";
        expect(() => assertInvariants(session)).not.toThrow();
    });

    it("accepts a tag on a single frame and equal names on layers and on tags", () => {
        const session = fixture();
        session.doc.tags.push(tag("tag-b", "frame-c", "frame-c"));
        session.doc.layers.push(pixelLayer("layer-c"));
        expect(session.doc.tags.map((entry) => entry.name)).toEqual(["walk", "walk"]);
        expect(session.doc.layers.filter((layer) => layer.name === "Layer")).toHaveLength(2);
        expect(() => assertInvariants(session)).not.toThrow();
    });

    it("does not change the session", () => {
        const session = fixture();
        const before = structuredClone(session);
        assertInvariants(session);
        expect(session).toEqual(before);
    });
});

describe("assertInvariants catches each invariant", () => {
    it("has a violation for every invariant", () => {
        expect(Object.keys(violations).sort()).toEqual(Object.keys(INVARIANTS).sort());
    });

    it.each(Object.keys(INVARIANTS) as InvariantName[])("%s", (name) => {
        const session = fixture();
        violations[name](session);
        expectViolation(session, name);
    });
});

describe("invariant details", () => {
    it("pixel-layer-required: a document with no layer at all", () => {
        const session = fixture();
        session.doc.layers = [];
        expectViolation(session, "pixel-layer-required");
    });

    it("unique-ids: two frames with one ID", () => {
        const session = fixture();
        session.doc.frames.push({ id: "frame-a", durationMs: 100 });
        const error = expectViolation(session, "unique-ids");
        expect(error.message).toContain('"frame-a"');
    });

    it("unique-ids: two tags with one ID", () => {
        const session = fixture();
        session.doc.tags.push(tag("tag-a", "frame-c", "frame-c"));
        expectViolation(session, "unique-ids");
    });

    it("unique-ids: one ID used by a layer and a frame", () => {
        const session = fixture();
        session.doc.frames.push({ id: "layer-b", durationMs: 100 });
        expectViolation(session, "unique-ids");
    });

    it("unique-ids: one ID used by the document and a tag", () => {
        const session = fixture();
        session.doc.tags.push(tag("doc", "frame-c", "frame-c"));
        expectViolation(session, "unique-ids");
    });

    it("unique-ids: one ID used by a frame and an image", () => {
        const session = fixture();
        session.doc.images.set("frame-c", image());
        session.doc.cels.set(celKey("layer-b", "frame-b"), { imageId: "frame-c", opacity: 255 });
        expectViolation(session, "unique-ids");
    });

    it("cel-image-size: a wrong width", () => {
        const session = fixture();
        session.doc.images.set("image-a", image(WIDTH - 1, HEIGHT));
        const error = expectViolation(session, "cel-image-size");
        expect(error.message).toContain('"image-a"');
    });

    it("cel-image-size: a data length that does not match the dimensions", () => {
        const session = fixture();
        session.doc.images.set("image-a", {
            width: WIDTH,
            height: HEIGHT,
            data: new Uint8ClampedArray(WIDTH * HEIGHT * 4 - 4),
        });
        expectViolation(session, "cel-image-size");
    });

    it("no-orphan-image: the image left behind when its only cel is removed", () => {
        const session = fixture();
        session.doc.cels.delete(celKey("layer-b", "frame-c"));
        const error = expectViolation(session, "no-orphan-image");
        expect(error.message).toContain('"image-b"');
    });

    it("no-orphan-image: removing one of two linked cels keeps the image referenced", () => {
        const session = fixture();
        session.doc.cels.delete(celKey("layer-a", "frame-b"));
        expect(() => assertInvariants(session)).not.toThrow();
    });

    it("tag-endpoints-exist: a missing `from` frame", () => {
        const session = fixture();
        session.doc.tags = [tag("tag-a", "frame-x", "frame-b")];
        const error = expectViolation(session, "tag-endpoints-exist");
        expect(error.message).toContain('"frame-x"');
    });

    it("tag-endpoints-exist: the tag left behind when its frame is removed", () => {
        const session = fixture();
        session.doc.frames = session.doc.frames.filter((frame) => frame.id !== "frame-b");
        session.doc.cels.delete(celKey("layer-a", "frame-b"));
        expectViolation(session, "tag-endpoints-exist");
    });

    it("tag-order: a tag whose frames were put in reverse order", () => {
        const session = fixture();
        session.doc.frames.reverse();
        expectViolation(session, "tag-order");
    });

    it('export-frames-tag-exists: "all" needs no tag', () => {
        const session = fixture();
        session.doc.exportSettings.frames = "all";
        session.doc.tags = [];
        expect(() => assertInvariants(session)).not.toThrow();
    });

    it("export-frames-tag-exists: the setting left behind when its tag is removed", () => {
        const session = fixture();
        session.doc.tags = [];
        expectViolation(session, "export-frames-tag-exists");
    });

    it("selection-mask-size: a wrong height", () => {
        const session = fixture();
        session.selection = {
            mask: { width: WIDTH, height: HEIGHT - 1, data: new Uint8Array(1) },
            bounds: { x: 0, y: 0, width: 1, height: 1 },
        };
        expectViolation(session, "selection-mask-size");
    });

    it("selection-mask-size: a data length that does not match the dimensions", () => {
        const session = fixture();
        session.selection = {
            mask: { width: WIDTH, height: HEIGHT, data: new Uint8Array(WIDTH * HEIGHT) },
            bounds: { x: 0, y: 0, width: 1, height: 1 },
        };
        expectViolation(session, "selection-mask-size");
    });

    it("selection-mask-size: no selection is valid", () => {
        const session = fixture();
        session.selection = null;
        expect(() => assertInvariants(session)).not.toThrow();
    });

    it("reports a document invariant before a session invariant", () => {
        const session = fixture();
        session.activeLayerId = "layer-x";
        session.doc.images.set("image-c", image());
        expectViolation(session, "no-orphan-image");
    });
});
