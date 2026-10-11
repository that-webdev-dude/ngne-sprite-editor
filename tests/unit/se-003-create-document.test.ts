import { describe, expect, it } from "vitest";
import {
    DAWNBRINGER_32,
    DocumentSizeError,
    createDocument,
    defaultDocSettings,
    defaultExportSettings,
    randomId,
    sequentialIds,
} from "../../src/core/model";

describe("createDocument", () => {
    it("creates one pixel layer, one frame, no cel and a centre pivot", () => {
        const session = createDocument({ name: "hero", width: 32, height: 24 }, sequentialIds());
        const { doc } = session;

        expect(doc.name).toBe("hero");
        expect(doc.width).toBe(32);
        expect(doc.height).toBe(24);
        expect(doc.colorMode).toBe("rgba");
        expect(doc.layers).toEqual([
            {
                id: "id2",
                name: "Layer 1",
                kind: "pixel",
                visible: true,
                locked: false,
                opacity: 255,
                blend: "normal",
            },
        ]);
        expect(doc.frames).toEqual([{ id: "id3", durationMs: 100 }]);
        expect(doc.cels.size).toBe(0);
        expect(doc.images.size).toBe(0);
        expect(doc.tags).toEqual([]);
        expect(doc.pivot).toEqual({ x: 0.5, y: 0.5 });
    });

    it("starts the session on the only layer and frame with no selection", () => {
        const session = createDocument({ name: "hero", width: 8, height: 8 }, sequentialIds());

        expect(session.activeLayerId).toBe(session.doc.layers[0]?.id);
        expect(session.activeFrameId).toBe(session.doc.frames[0]?.id);
        expect(session.selection).toBeNull();
    });

    it("gives the document the DawnBringer 32 palette as its own copy", () => {
        const first = createDocument({ name: "a", width: 8, height: 8 });
        const second = createDocument({ name: "b", width: 8, height: 8 });

        expect(first.doc.palette).toEqual({ name: "DawnBringer 32", colors: [...DAWNBRINGER_32] });
        first.doc.palette.colors.length = 0;
        expect(second.doc.palette.colors).toHaveLength(32);
        expect(DAWNBRINGER_32).toHaveLength(32);
    });

    it("uses the default settings and export settings", () => {
        const { doc } = createDocument({ name: "hero", width: 32, height: 24 });

        expect(doc.settings).toEqual(defaultDocSettings(32, 24));
        expect(doc.exportSettings).toEqual(defaultExportSettings());
    });

    it("overrides the default grid with the grid option", () => {
        const { doc } = createDocument({
            name: "hero",
            width: 32,
            height: 32,
            grid: { width: 8, height: 12 },
        });

        expect(doc.settings.grid).toEqual({
            ...defaultDocSettings(32, 32).grid,
            width: 8,
            height: 12,
        });
    });

    it("does not share settings objects between documents", () => {
        const first = createDocument({ name: "a", width: 8, height: 8 });
        const second = createDocument({ name: "b", width: 8, height: 8 });

        first.doc.settings.grid.width = 99;
        first.doc.settings.onion.enabled = true;
        first.doc.exportSettings.files.spritesTs = false;
        expect(second.doc.settings).toEqual(defaultDocSettings(8, 8));
        expect(second.doc.exportSettings).toEqual(defaultExportSettings());
    });
});

describe("document size", () => {
    it("accepts 1 and 1024 on each side", () => {
        expect(createDocument({ name: "min", width: 1, height: 1 }).doc.width).toBe(1);
        expect(createDocument({ name: "max", width: 1024, height: 1024 }).doc.height).toBe(1024);
        expect(createDocument({ name: "wide", width: 1024, height: 1 }).doc.width).toBe(1024);
    });

    it.each([
        [0, 32],
        [32, 0],
        [1025, 32],
        [32, 1025],
        [-1, 32],
        [32, -8],
        [16.5, 32],
        [32, 0.5],
        [Number.NaN, 32],
        [32, Number.POSITIVE_INFINITY],
    ])("throws a DocumentSizeError for %d×%d", (width, height) => {
        let error: unknown;
        try {
            createDocument({ name: "bad", width, height });
        } catch (thrown) {
            error = thrown;
        }

        expect(error).toBeInstanceOf(DocumentSizeError);
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ name: "DocumentSizeError", width, height });
        expect((error as DocumentSizeError).message).toContain("1 to 1024");
    });
});

describe("default settings", () => {
    it("has the export defaults of the specification", () => {
        expect(defaultExportSettings()).toEqual({
            layout: "grid",
            padding: 1,
            extrude: 0,
            trim: false,
            mergeDuplicates: true,
            frames: "all",
            files: { spritesTs: true, previewConfig: true, asepriteJson: "none" },
            exportOnSave: false,
        });
    });

    it("has document settings with every feature off and values inside their ranges", () => {
        const settings = defaultDocSettings(33, 20);

        expect(settings.grid).toEqual({
            width: 16,
            height: 16,
            offsetX: 0,
            offsetY: 0,
            visible: false,
        });
        expect(settings.onion.enabled).toBe(false);
        expect([0, 1, 2, 3]).toContain(settings.onion.before);
        expect([0, 1, 2, 3]).toContain(settings.onion.after);
        expect(settings.onion.opacity).toBeGreaterThanOrEqual(0);
        expect(settings.onion.opacity).toBeLessThanOrEqual(255);
        expect(settings.onion.falloff).toBeGreaterThanOrEqual(0);
        expect(settings.onion.falloff).toBeLessThanOrEqual(1);
        expect(settings.onion.placement).toBe("behind");
        // Half-pixel units: the centre lines of a 33×20 canvas.
        expect(settings.symmetry).toEqual({ mode: "none", axisX: 33, axisY: 20 });
        expect(settings.tiled).toBe("none");
    });

    it("returns a new object on every call", () => {
        expect(defaultDocSettings(8, 8)).not.toBe(defaultDocSettings(8, 8));
        expect(defaultDocSettings(8, 8).grid).not.toBe(defaultDocSettings(8, 8).grid);
        expect(defaultExportSettings().files).not.toBe(defaultExportSettings().files);
    });
});

describe("default palette", () => {
    it("holds 32 distinct opaque 0xRRGGBBAA colours", () => {
        expect(new Set(DAWNBRINGER_32).size).toBe(32);
        for (const color of DAWNBRINGER_32) {
            expect(Number.isInteger(color)).toBe(true);
            expect(color).toBeGreaterThanOrEqual(0);
            expect(color).toBeLessThanOrEqual(0xffffffff);
            expect(color % 256).toBe(0xff);
        }
        expect(DAWNBRINGER_32[0]).toBe(0x000000ff);
        expect(DAWNBRINGER_32[21]).toBe(0xffffffff);
        expect(DAWNBRINGER_32[31]).toBe(0x8a6f30ff);
    });
});

describe("ID generation", () => {
    it("takes an injected generator, called for the document, the layer and the frame", () => {
        const calls: string[] = [];
        const next = sequentialIds("n");
        const session = createDocument({ name: "hero", width: 8, height: 8 }, () => {
            const id = next();
            calls.push(id);
            return id;
        });

        expect(calls).toEqual(["n1", "n2", "n3"]);
        expect(session.doc.id).toBe("n1");
        expect(session.doc.layers[0]?.id).toBe("n2");
        expect(session.doc.frames[0]?.id).toBe("n3");
    });

    it("is deterministic with a sequential generator", () => {
        const first = createDocument({ name: "hero", width: 8, height: 8 }, sequentialIds());
        const second = createDocument({ name: "hero", width: 8, height: 8 }, sequentialIds());

        expect(first).toEqual(second);
    });

    it("counts each sequential generator on its own", () => {
        const a = sequentialIds();
        const b = sequentialIds("layer-");

        expect([a(), a(), b(), a()]).toEqual(["id1", "id2", "layer-1", "id3"]);
    });

    it("defaults to random IDs that do not repeat", () => {
        const ids = Array.from({ length: 1000 }, randomId);
        expect(new Set(ids).size).toBe(1000);

        const first = createDocument({ name: "a", width: 8, height: 8 });
        const second = createDocument({ name: "a", width: 8, height: 8 });
        const all = [first, second].flatMap(({ doc }) => [
            doc.id,
            doc.layers[0]?.id,
            doc.frames[0]?.id,
        ]);
        expect(new Set(all).size).toBe(6);
    });
});
