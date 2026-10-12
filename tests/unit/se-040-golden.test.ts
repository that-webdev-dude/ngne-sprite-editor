import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodePng } from "../../src/core/png";
import { PROJECT_GENERATOR, PROJECT_VERSION, deserialize, serialize } from "../../src/core/project";
import {
    FIRST_FRAME_COMPOSITE,
    HEIGHT,
    IMAGE_BG,
    IMAGE_BODY_A,
    REFERENCE_PNG,
    SOURCE_ID,
    WIDTH,
    entriesOf,
    expectSamePixels,
    fixtureDocument,
    fixtureSources,
    textOf,
    zipHeaders,
} from "./se-040-support";

// A project file of schema version 1, committed, and what it must hold: the parsed JSON written
// out below and the pixels of the fixture. The zip bytes themselves are not compared; they
// may change with the compressor, and the format does not fix them.
//
// The file is written by this test from `fixtureDocument()` of se-040-support.ts:
//
//     SE040_WRITE_GOLDEN=1 npx vitest run tests/unit/se-040-golden.test.ts
//
// It is not to be written again to make a failing test pass. A failure here after a change to
// `core/project` means that files already saved would be read differently, or that new files
// differ from them: a change of the format, which needs a new schema version and a migration.

const GOLDEN = new URL("./se-040-fixtures/golden-v1.ngsprite", import.meta.url);

if (process.env.SE040_WRITE_GOLDEN === "1") {
    mkdirSync(new URL("./se-040-fixtures/", import.meta.url), { recursive: true });
    writeFileSync(GOLDEN, serialize(fixtureDocument(), fixtureSources()));
}

/** `manifest.json` of the committed file. It was written by version 0.0.0 of the editor. */
const GOLDEN_MANIFEST = {
    format: "ngne-sprite-project",
    version: 1,
    generator: "ngne-sprite-editor 0.0.0",
};

const pixelLayer = { kind: "pixel", visible: true, locked: false, opacity: 255, blend: "normal" };
const cel = (layerId: string, frameId: string, imageId: string, opacity = 255) => ({
    layerId,
    frameId,
    imageId,
    opacity,
});

/** `doc.json` of the fixture, field for field and in the order of docs/FORMAT.md. */
const GOLDEN_DOC = {
    id: "doc-hero",
    name: "Hero ✦ idle",
    width: 4,
    height: 3,
    colorMode: "rgba",
    layers: [
        {
            id: "layer-ref",
            kind: "reference",
            name: "Sketch",
            visible: true,
            locked: true,
            opacity: 128,
            sourceId: "source-sketch",
            x: -1.5,
            y: 0.25,
            scale: 0.125,
            placement: "behind",
        },
        { id: "layer-bg", ...pixelLayer, name: "Background" },
        { id: "layer-body", ...pixelLayer, name: "Body" },
        {
            id: "layer-fx",
            kind: "pixel",
            name: "FX",
            visible: false,
            locked: true,
            opacity: 64,
            blend: "screen",
        },
    ],
    frames: [
        { id: "frame-1", durationMs: 100 },
        { id: "frame-2", durationMs: 80 },
        { id: "frame-3", durationMs: 1 },
        { id: "frame-4", durationMs: 65535 },
        { id: "frame-5", durationMs: 250 },
    ],
    cels: [
        cel("layer-bg", "frame-1", "image-bg"),
        cel("layer-bg", "frame-2", "image-bg"),
        cel("layer-bg", "frame-3", "image-bg"),
        cel("layer-bg", "frame-4", "image-bg"),
        cel("layer-bg", "frame-5", "image-bg"),
        cel("layer-body", "frame-1", "image-body-a"),
        cel("layer-body", "frame-2", "image-body-b", 128),
        cel("layer-body", "frame-3", "image-body-a"),
        cel("layer-body", "frame-5", "image-body-c", 1),
        cel("layer-fx", "frame-2", "image-fx", 0),
    ],
    tags: [
        {
            id: "tag-idle",
            name: "idle",
            color: "#3cb371ff",
            fromFrameId: "frame-1",
            toFrameId: "frame-3",
            direction: "forward",
            repeat: 0,
        },
        {
            id: "tag-blink",
            name: "blink ✦",
            color: "#ff000080",
            fromFrameId: "frame-4",
            toFrameId: "frame-5",
            direction: "pingpong",
            repeat: 3,
        },
    ],
    palette: { name: "Hero", colors: ["#00000000", "#ffffffff", "#12345678", "#ff8000ff"] },
    pivot: { x: 0.25, y: 1 },
    settings: {
        grid: { width: 8, height: 4, offsetX: -2, offsetY: 3, visible: true },
        pixelGrid: false,
        onion: {
            enabled: true,
            before: 3,
            after: 0,
            opacity: 96,
            falloff: 0.75,
            tint: true,
            placement: "front",
            withinTag: true,
        },
        symmetry: { mode: "both", axisX: 3, axisY: 5 },
        tiled: "x",
    },
    exportSettings: {
        layout: "row",
        padding: 4,
        extrude: 2,
        trim: true,
        mergeDuplicates: false,
        frames: { tagId: "tag-idle" },
        files: { spritesTs: false, previewConfig: false, asepriteJson: "hash" },
        exportOnSave: true,
    },
};

/** The layer object above is spread with `id` first; the file has `id`, `kind`, `name`, … */
function withLayerKeyOrder(doc: typeof GOLDEN_DOC): unknown {
    return {
        ...doc,
        layers: doc.layers.map(({ id, kind, name, ...rest }) => ({ id, kind, name, ...rest })),
    };
}

const golden = (): Buffer => readFileSync(GOLDEN);

function parsed(file: Uint8Array, name: string): unknown {
    return JSON.parse(textOf(entriesOf(file).get(name) ?? new Uint8Array(0))) as unknown;
}

describe("golden project file, schema version 1", () => {
    it("is committed", () => {
        expect(existsSync(GOLDEN)).toBe(true);
        // A zip: the first local header, and the end record of an archive of nine entries.
        const file = golden();
        expect(file.readUInt32LE(0)).toBe(0x04034b50);
        expect(file.readUInt16LE(file.length - 12)).toBe(9);
    });

    it("holds the expected entries", () => {
        expect([...entriesOf(golden()).keys()].sort()).toEqual([
            "doc.json",
            "images/image-bg.png",
            "images/image-body-a.png",
            "images/image-body-b.png",
            "images/image-body-c.png",
            "images/image-fx.png",
            "manifest.json",
            "refs/source-sketch.png",
            "thumb.png",
        ]);
    });

    it("has the expected manifest.json and doc.json, as parsed JSON", () => {
        expect(parsed(golden(), "manifest.json")).toEqual(GOLDEN_MANIFEST);
        expect(parsed(golden(), "doc.json")).toEqual(GOLDEN_DOC);
    });

    it("has the expected pixels in every image entry", async () => {
        const entries = entriesOf(golden());
        const fixture = fixtureDocument();

        for (const [imageId, image] of fixture.images) {
            const decoded = await decodePng(
                entries.get(`images/${imageId}.png`) ?? new Uint8Array(0),
            );
            expect([decoded.width, decoded.height], imageId).toEqual([WIDTH, HEIGHT]);
            expect(Array.from(decoded.data), imageId).toEqual(Array.from(image.data));
        }
        // Two of the images are written out in se-040-support.ts, pixel by pixel.
        const background = await decodePng(entries.get("images/image-bg.png") ?? new Uint8Array(0));
        expect(Array.from(background.data)).toEqual(Array.from(IMAGE_BG.data));
        expect(Array.from(background.data.subarray(12, 16))).toEqual([200, 100, 50, 0]);
        const body = await decodePng(entries.get("images/image-body-a.png") ?? new Uint8Array(0));
        expect(Array.from(body.data)).toEqual(Array.from(IMAGE_BODY_A.data));
    });

    it("has the composite of the first frame as thumb.png", async () => {
        const thumbnail = await decodePng(
            entriesOf(golden()).get("thumb.png") ?? new Uint8Array(0),
        );

        expect([thumbnail.width, thumbnail.height]).toEqual([WIDTH, HEIGHT]);
        expect(Array.from(thumbnail.data)).toEqual(FIRST_FRAME_COMPOSITE.flat());
    });

    it("has the reference source byte for byte", () => {
        const source = entriesOf(golden()).get(`refs/${SOURCE_ID}.png`) ?? new Uint8Array(0);
        expect(Buffer.compare(Buffer.from(source), REFERENCE_PNG)).toBe(0);
    });

    it("stores its PNG entries and carries the fixed time stamp", () => {
        for (const header of zipHeaders(golden())) {
            expect(header.method, header.name).toBe(header.name.endsWith(".png") ? 0 : 8);
            expect([header.date, header.time], header.name).toEqual([0x21, 0]);
        }
    });

    it("deserializes to the fixture document", async () => {
        const project = await deserialize(golden());

        expect(project.doc).toEqual(fixtureDocument());
        expectSamePixels(project.doc, fixtureDocument());
        expect([...project.referenceSources.keys()]).toEqual([SOURCE_ID]);
        const source = project.referenceSources.get(SOURCE_ID) ?? new Uint8Array(0);
        expect(Buffer.compare(Buffer.from(source), REFERENCE_PNG)).toBe(0);
    });
});

describe("serialize against the golden file", () => {
    const written = (): Uint8Array => serialize(fixtureDocument(), fixtureSources());

    it("still writes the JSON of the golden file, apart from the generator", () => {
        expect(PROJECT_VERSION).toBe(1);
        expect(parsed(written(), "manifest.json")).toEqual({
            ...GOLDEN_MANIFEST,
            generator: PROJECT_GENERATOR,
        });
        expect(parsed(written(), "doc.json")).toEqual(parsed(golden(), "doc.json"));
    });

    it("writes the fields of doc.json in a fixed order", () => {
        const text = textOf(entriesOf(written()).get("doc.json") ?? new Uint8Array(0));
        expect(text).toBe(`${JSON.stringify(withLayerKeyOrder(GOLDEN_DOC), null, 4)}\n`);

        const manifest = textOf(entriesOf(written()).get("manifest.json") ?? new Uint8Array(0));
        expect(Object.keys(JSON.parse(manifest) as object)).toEqual([
            "format",
            "version",
            "generator",
        ]);
    });

    it("still writes the pixels and the source of the golden file", async () => {
        const now = entriesOf(written());
        const then = entriesOf(golden());

        expect([...now.keys()]).toEqual([...then.keys()]);
        for (const [name, entry] of then) {
            if (name.endsWith(".json")) continue;
            const current = now.get(name) ?? new Uint8Array(0);
            if (name.startsWith("refs/")) {
                expect(Buffer.compare(Buffer.from(current), Buffer.from(entry)), name).toBe(0);
                continue;
            }
            const expected = await decodePng(entry);
            const actual = await decodePng(current);
            expect([actual.width, actual.height], name).toEqual([expected.width, expected.height]);
            expect(Array.from(actual.data), name).toEqual(Array.from(expected.data));
        }
    });
});
