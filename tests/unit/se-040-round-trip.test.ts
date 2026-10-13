import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertInvariants, celKey, createDocument } from "../../src/core/model";
import type {
    BlendMode,
    DocSettings,
    ExportSettings,
    Layer,
    PixelBuffer,
    SpriteDoc,
    Tag,
} from "../../src/core/model";
import { decodePng } from "../../src/core/png";
import { deserialize, docFromJson, docToJson, serialize } from "../../src/core/project";
import {
    HEIGHT,
    IMAGE_BG,
    REFERENCE_PNG,
    SOURCE_ID,
    UNUSED_SOURCE_ID,
    WIDTH,
    entriesOf,
    expectSamePixels,
    fixtureDocument,
    fixtureSession,
    fixtureSources,
    jsonOf,
    noiseImage,
    pngFile,
    smallDocument,
    textOf,
} from "./se-040-support";

describe("project round trip of the fixture", () => {
    it("the fixture is the document the acceptance list asks for", () => {
        const session = fixtureSession();
        const { doc } = session;
        assertInvariants(session);

        expect(doc.layers.filter((layer) => layer.kind === "pixel")).toHaveLength(3);
        expect(doc.layers.filter((layer) => layer.kind === "reference")).toHaveLength(1);
        expect(doc.frames).toHaveLength(5);
        expect(doc.tags).toHaveLength(2);
        // Linked cels: ten cels on five images.
        expect(doc.cels.size).toBe(10);
        expect(doc.images.size).toBe(5);
        expect(doc.palette.colors.length).toBeGreaterThan(0);

        // No setting is left at its default.
        const fresh = createDocument({ name: "fresh", width: WIDTH, height: HEIGHT }).doc;
        const leaves = (value: object, path = ""): [string, unknown][] =>
            Object.entries(value).flatMap(([key, item]): [string, unknown][] =>
                typeof item === "object" && item !== null
                    ? leaves(item, `${path}${key}.`)
                    : [[`${path}${key}`, item]],
            );
        const defaults = new Map(leaves({ ...fresh.settings, ...fresh.exportSettings }));
        const unchanged = leaves({ ...doc.settings, ...doc.exportSettings })
            .filter(([path, value]) => defaults.get(path) === value)
            .map(([path]) => path);
        expect(unchanged).toEqual([]);
        expect(doc.exportSettings.frames).toEqual({ tagId: "tag-idle" });
        expect(doc.pivot).not.toEqual(fresh.pivot);
        expect(doc.palette).not.toEqual(fresh.palette);
    });

    it("yields a deep-equal document with identical pixels", async () => {
        const doc = fixtureDocument();
        const bytes = serialize(doc, fixtureSources());
        const project = await deserialize(bytes);

        expect(project.doc).toEqual(fixtureDocument());
        expectSamePixels(project.doc, fixtureDocument());
        assertInvariants({
            doc: project.doc,
            selection: null,
            activeLayerId: "layer-bg",
            activeFrameId: "frame-1",
        });
        // The same again from the file that was just read.
        const again = await deserialize(serialize(project.doc, project.referenceSources));
        expect(again.doc).toEqual(fixtureDocument());
        expectSamePixels(again.doc, fixtureDocument());
    });

    it("leaves the document and the sources it is given unchanged", () => {
        const doc = fixtureDocument();
        const sources = fixtureSources();
        const sourceBytes = [...sources].map(([id, bytes]) => [id, Buffer.from(bytes)] as const);
        serialize(doc, sources);

        expect(doc).toEqual(fixtureDocument());
        expectSamePixels(doc, fixtureDocument());
        expect([...sources.keys()]).toEqual(sourceBytes.map(([id]) => id));
        for (const [id, bytes] of sourceBytes) {
            expect(Buffer.compare(Buffer.from(sources.get(id) ?? []), bytes), id).toBe(0);
        }
    });

    it("keeps the colour of fully transparent pixels", async () => {
        // The last column of the background has alpha 0 over three different colours.
        expect(Array.from(IMAGE_BG.data.subarray(12, 16))).toEqual([200, 100, 50, 0]);
        const { doc } = await deserialize(serialize(fixtureDocument(), fixtureSources()));
        const background = doc.images.get("image-bg");

        expect(Array.from(background?.data.subarray(12, 16) ?? [])).toEqual([200, 100, 50, 0]);
        expect(Array.from(background?.data.subarray(28, 32) ?? [])).toEqual([1, 2, 3, 0]);
        expect(Array.from(background?.data.subarray(44, 48) ?? [])).toEqual([9, 9, 9, 0]);
    });

    it("returns the reference source bytes verbatim and only the sources in use", async () => {
        const project = await deserialize(serialize(fixtureDocument(), fixtureSources()));

        expect([...project.referenceSources.keys()]).toEqual([SOURCE_ID]);
        const source = project.referenceSources.get(SOURCE_ID);
        expect(source).toBeInstanceOf(Uint8Array);
        // Text chunk, RGB samples and the bytes after IEND: nothing was decoded or rewritten.
        expect(Buffer.compare(Buffer.from(source ?? []), REFERENCE_PNG)).toBe(0);
        expect(Buffer.from(source ?? []).includes("trailing bytes")).toBe(true);

        const entries = entriesOf(serialize(fixtureDocument(), fixtureSources()));
        expect(
            Buffer.compare(Buffer.from(entries.get(`refs/${SOURCE_ID}.png`) ?? []), REFERENCE_PNG),
        ).toBe(0);
        expect(entries.has(`refs/${UNUSED_SOURCE_ID}.png`)).toBe(false);
    });

    it("writes one source for two reference layers that share it", async () => {
        const doc = fixtureDocument();
        const first = doc.layers[0];
        if (first.kind !== "reference") throw new Error("the fixture starts with its reference");
        doc.layers.push({ ...first, id: "layer-ref-2", placement: "front", x: 7 });
        const bytes = serialize(doc, fixtureSources());

        const names = [...entriesOf(bytes).keys()].filter((name) => name.startsWith("refs/"));
        expect(names).toEqual([`refs/${SOURCE_ID}.png`]);
        const project = await deserialize(bytes);
        expect(project.doc).toEqual(doc);
        expect([...project.referenceSources.keys()]).toEqual([SOURCE_ID]);
    });

    it("shares no memory with the file it read", async () => {
        const bytes = serialize(fixtureDocument(), fixtureSources());
        const project = await deserialize(bytes);
        bytes.fill(0);

        expect(project.doc).toEqual(fixtureDocument());
        expectSamePixels(project.doc, fixtureDocument());
        const source = project.referenceSources.get(SOURCE_ID);
        expect(Buffer.compare(Buffer.from(source ?? []), REFERENCE_PNG)).toBe(0);
    });

    it("reads a file held in a view that starts inside a larger buffer", async () => {
        const file = serialize(fixtureDocument(), fixtureSources());
        const padded = Buffer.concat([Buffer.alloc(5, 0xee), file, Buffer.alloc(9, 0xee)]);
        const view = new Uint8Array(padded.buffer, padded.byteOffset + 5, file.length);

        const project = await deserialize(view);
        expect(project.doc).toEqual(fixtureDocument());
        expectSamePixels(project.doc, fixtureDocument());
    });
});

describe("what a project file contains", () => {
    it("holds the entries of SPEC §10, in a fixed order", () => {
        const names = [...entriesOf(serialize(fixtureDocument(), fixtureSources())).keys()];

        expect(names).toEqual([
            "manifest.json",
            "doc.json",
            // By layer, bottom to top, then by frame: the order of each image's first cel.
            "images/image-bg.png",
            "images/image-body-a.png",
            "images/image-body-b.png",
            "images/image-body-c.png",
            "images/image-fx.png",
            `refs/${SOURCE_ID}.png`,
            "thumb.png",
        ]);
    });

    it("serializes linked cels as one image", async () => {
        const doc = fixtureDocument();
        const bytes = serialize(doc, fixtureSources());
        const entries = entriesOf(bytes);

        // Five linked background cels and two linked body cels: seven cels on two images.
        const images = [...entries.keys()].filter((name) => name.startsWith("images/"));
        expect(images).toHaveLength(5);
        expect(images).toHaveLength(doc.images.size);
        const cels = (jsonOf(bytes, "doc.json") as { cels: { imageId: string }[] }).cels;
        expect(cels).toHaveLength(10);
        expect(cels.filter((cel) => cel.imageId === "image-bg")).toHaveLength(5);
        expect(cels.filter((cel) => cel.imageId === "image-body-a")).toHaveLength(2);

        // The linked cels come back linked: one buffer, not two equal ones.
        const { doc: read } = await deserialize(bytes);
        expect(read.cels.get(celKey("layer-body", "frame-1"))?.imageId).toBe("image-body-a");
        expect(read.cels.get(celKey("layer-body", "frame-3"))?.imageId).toBe("image-body-a");
        expect(read.images.size).toBe(5);
    });

    it("stores every image as an 8-bit RGBA PNG of the document's size", async () => {
        const doc = fixtureDocument();
        const entries = entriesOf(serialize(doc, fixtureSources()));

        for (const [imageId, image] of doc.images) {
            const png = Buffer.from(entries.get(`images/${imageId}.png`) ?? []);
            expect([png.readUInt32BE(16), png.readUInt32BE(20)], imageId).toEqual([WIDTH, HEIGHT]);
            // Bit depth 8, colour type 6, not interlaced.
            expect([png[24], png[25], png[28]], imageId).toEqual([8, 6, 0]);
            const decoded = await decodePng(png);
            expect(Array.from(decoded.data), imageId).toEqual(Array.from(image.data));
        }
    });

    it("writes no session state", () => {
        const bytes = serialize(fixtureSession().doc, fixtureSources());
        const text = textOf(entriesOf(bytes).get("doc.json") ?? new Uint8Array(0));

        for (const word of ["selection", "mask", "bounds", "activeLayerId", "activeFrameId"]) {
            expect(text, word).not.toContain(word);
        }
        expect(Object.keys(jsonOf(bytes, "doc.json") as object)).toEqual([
            "id",
            "name",
            "width",
            "height",
            "colorMode",
            "layers",
            "frames",
            "cels",
            "tags",
            "palette",
            "pivot",
            "settings",
            "exportSettings",
        ]);
    });

    it("writes JSON entries as UTF-8 text with a four-space indent and a final line feed", () => {
        const entries = entriesOf(serialize(fixtureDocument(), fixtureSources()));

        for (const name of ["manifest.json", "doc.json"]) {
            const bytes = entries.get(name) ?? new Uint8Array(0);
            const text = textOf(bytes);
            expect(Array.from(bytes.subarray(0, 3)), name).not.toEqual([0xef, 0xbb, 0xbf]);
            expect(text, name).toBe(`${JSON.stringify(JSON.parse(text), null, 4)}\n`);
            expect(text, name).not.toContain("\r");
        }
        // Names are stored as they are, not escaped.
        expect(textOf(entries.get("doc.json") ?? new Uint8Array(0))).toContain('"Hero ✦ idle"');
    });
});

describe("unreachable data", () => {
    it("leaves out a cel that no pixel layer and frame of the document reach", async () => {
        const doc = fixtureDocument();
        doc.images.set("image-stale", noiseImage(40));
        doc.cels.set(celKey("layer-gone", "frame-1"), { imageId: "image-stale", opacity: 255 });
        doc.cels.set(celKey("layer-bg", "frame-gone"), { imageId: "image-stale", opacity: 255 });
        // On the reference layer: no composite reads a cel there.
        doc.cels.set(celKey("layer-ref", "frame-1"), { imageId: "image-stale", opacity: 255 });
        // Under keys that `celKey` does not make.
        for (const key of ["", ":", "layer-bg", "layer-bg:", ":frame-1", "layer-bg:frame-1:x"]) {
            doc.cels.set(key, { imageId: "image-stale", opacity: 255 });
        }

        const bytes = serialize(doc, fixtureSources());
        expect(entriesOf(bytes).has("images/image-stale.png")).toBe(false);
        const project = await deserialize(bytes);
        expect(project.doc).toEqual(fixtureDocument());
    });

    it("leaves out an image that no cel uses", async () => {
        const doc = fixtureDocument();
        doc.images.set("image-orphan", noiseImage(41));

        const bytes = serialize(doc, fixtureSources());
        expect(entriesOf(bytes).has("images/image-orphan.png")).toBe(false);
        expect((await deserialize(bytes)).doc).toEqual(fixtureDocument());
    });

    it("finds a cel by the key of SPEC §5.1: layer ID, colon, frame ID", () => {
        // The writer takes the two IDs from the key. Should the model form its keys another
        // way, this fails first.
        expect(celKey("layer-bg", "frame-1")).toBe("layer-bg:frame-1");
        expect([...fixtureDocument().cels.keys()].every((key) => /^[^:]+:[^:]+$/.test(key))).toBe(
            true,
        );
    });
});

describe("docToJson and docFromJson", () => {
    it("are inverse to each other, given the images", () => {
        const doc = fixtureDocument();
        const json = docToJson(doc);
        const read = docFromJson(JSON.parse(JSON.stringify(json)), doc.images);

        expect(read).toEqual(doc);
        expect(docToJson(read)).toEqual(json);
        // The buffers given are the document's images, not copies.
        expect(read.images.get("image-bg")).toBe(doc.images.get("image-bg"));
    });

    it("docToJson returns values that share nothing with the document", () => {
        const doc = fixtureDocument();
        const json = docToJson(doc);
        json.layers[1].name = "changed";
        json.palette.colors.push("#00000000");
        json.settings.grid.width = 99;
        json.exportSettings.files.spritesTs = true;
        json.pivot.x = 0;
        (json.exportSettings.frames as { tagId: string }).tagId = "changed";

        expect(doc).toEqual(fixtureDocument());
    });

    it("docToJson is the content of doc.json", () => {
        const doc = fixtureDocument();
        expect(jsonOf(serialize(doc, fixtureSources()), "doc.json")).toEqual(docToJson(doc));
    });

    it("docFromJson takes only the images the cels name", () => {
        const doc = fixtureDocument();
        const images = new Map<string, PixelBuffer>([
            ...doc.images,
            ["image-extra", noiseImage(1)],
        ]);

        const read = docFromJson(docToJson(doc), images);
        expect([...read.images.keys()].sort()).toEqual([...doc.images.keys()].sort());
    });

    it("writes the JSON form of a colour and reads both letter cases", () => {
        const doc = smallDocument();
        doc.palette.colors = [0x00000000, 0x0a0b0c0d, 0xffffffff, 0x80000000];
        const json = docToJson(doc);
        expect(json.palette.colors).toEqual(["#00000000", "#0a0b0c0d", "#ffffffff", "#80000000"]);

        json.palette.colors = ["#0A0B0C0D", "#FFFFFFFF", "#aBcDeF01"];
        expect(docFromJson(json, doc.images).palette.colors).toEqual([
            0x0a0b0c0d, 0xffffffff, 0xabcdef01,
        ]);
    });
});

// --- random documents ---------------------------------------------------------------------------

const BLEND_MODES: BlendMode[] = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
    "addition",
    "subtract",
    "divide",
];

const byte = fc.integer({ min: 0, max: 255 });
const color = fc.integer({ min: 0, max: 0xffffffff });
const name = fc.string({ unit: "grapheme", maxLength: 12 });
/** A position of a reference layer; `+ 0` makes −0 the 0 that JSON writes. */
const offset = fc.double({ min: -1e6, max: 1e6, noNaN: true }).map((value) => value + 0);
const unit = fc.double({ min: 0, max: 1, noNaN: true }).map((value) => value + 0);
const axes = fc.constantFrom("none", "x", "y", "both") as fc.Arbitrary<DocSettings["tiled"]>;
const placement = fc.constantFrom("behind", "front") as fc.Arbitrary<"behind" | "front">;

const settings: fc.Arbitrary<DocSettings> = fc.record({
    grid: fc.record({
        width: fc.integer({ min: 1, max: 1024 }),
        height: fc.integer({ min: 1, max: 1024 }),
        offsetX: fc.integer({ min: -1024, max: 1024 }),
        offsetY: fc.integer({ min: -1024, max: 1024 }),
        visible: fc.boolean(),
    }),
    pixelGrid: fc.boolean(),
    onion: fc.record({
        enabled: fc.boolean(),
        before: fc.integer({ min: 0, max: 3 }),
        after: fc.integer({ min: 0, max: 3 }),
        opacity: byte,
        falloff: unit,
        tint: fc.boolean(),
        placement,
        withinTag: fc.boolean(),
    }),
    symmetry: fc.record({
        mode: axes,
        axisX: fc.integer({ min: 0, max: 2048 }),
        axisY: fc.integer({ min: 0, max: 2048 }),
    }),
    tiled: axes,
});

const exportSettings: fc.Arbitrary<Omit<ExportSettings, "frames">> = fc.record({
    layout: fc.constantFrom("grid", "row", "column") as fc.Arbitrary<ExportSettings["layout"]>,
    padding: fc.integer({ min: 0, max: 8 }),
    extrude: fc.integer({ min: 0, max: 2 }),
    trim: fc.boolean(),
    mergeDuplicates: fc.boolean(),
    files: fc.record({
        spritesTs: fc.boolean(),
        previewConfig: fc.boolean(),
        asepriteJson: fc.constantFrom("none", "array", "hash") as fc.Arbitrary<
            ExportSettings["files"]["asepriteJson"]
        >,
    }),
    exportOnSave: fc.boolean(),
});

interface RandomProject {
    doc: SpriteDoc;
    sources: Map<string, Uint8Array>;
}

/**
 * Documents of 1×1 to 6×6 pixels with one to four pixel layers, up to three reference
 * layers anywhere in the stack, one to five frames, cels that are empty, own an image or
 * link to an earlier one, up to three tags and any settings.
 */
const projects: fc.Arbitrary<RandomProject> = fc
    .record({
        width: fc.integer({ min: 1, max: 6 }),
        height: fc.integer({ min: 1, max: 6 }),
        pixelLayers: fc.integer({ min: 1, max: 4 }),
        referenceLayers: fc.integer({ min: 0, max: 3 }),
        frames: fc.integer({ min: 1, max: 5 }),
    })
    .chain((shape) => {
        const layerCount = shape.pixelLayers + shape.referenceLayers;
        const pixels = shape.width * shape.height;
        return fc.record({
            shape: fc.constant(shape),
            name: name.filter((value) => value.trim() !== ""),
            // Which positions of the stack hold the reference layers.
            order: fc.shuffledSubarray(
                Array.from({ length: layerCount }, (_, index) => index),
                { minLength: shape.referenceLayers, maxLength: shape.referenceLayers },
            ),
            layers: fc.array(
                fc.record({
                    name,
                    visible: fc.boolean(),
                    locked: fc.boolean(),
                    opacity: byte,
                    blend: fc.constantFrom(...BLEND_MODES),
                    x: offset,
                    y: offset,
                    scale: fc.double({ min: 1e-6, max: 1e6, noNaN: true }),
                    placement,
                    // Two reference layers may share a source.
                    source: fc.integer({ min: 0, max: 1 }),
                }),
                { minLength: layerCount, maxLength: layerCount },
            ),
            durations: fc.array(fc.integer({ min: 1, max: 65535 }), {
                minLength: shape.frames,
                maxLength: shape.frames,
            }),
            // Per cel: nothing, an image of its own, or a link to an image made before.
            cels: fc.array(
                fc.record({
                    kind: fc.constantFrom("empty", "own", "own", "link"),
                    opacity: byte,
                    link: fc.nat(),
                    bytes: fc.uint8Array({ minLength: pixels * 4, maxLength: pixels * 4 }),
                }),
                {
                    minLength: shape.pixelLayers * shape.frames,
                    maxLength: shape.pixelLayers * shape.frames,
                },
            ),
            tags: fc.array(
                fc.record({
                    name,
                    color,
                    a: fc.nat({ max: shape.frames - 1 }),
                    b: fc.nat({ max: shape.frames - 1 }),
                    direction: fc.constantFrom("forward", "reverse", "pingpong") as fc.Arbitrary<
                        Tag["direction"]
                    >,
                    repeat: fc.integer({ min: 0, max: 255 }),
                }),
                { maxLength: 3 },
            ),
            exportTag: fc.option(fc.nat(), { nil: undefined }),
            palette: fc.record({ name, colors: fc.array(color, { maxLength: 256 }) }),
            pivot: fc.record({ x: unit, y: unit }),
            settings,
            exportSettings,
        });
    })
    .map((spec): RandomProject => {
        const { shape } = spec;
        const ids = ["doc", "unused", "unused"];
        const { doc } = createDocument(
            { name: spec.name, width: shape.width, height: shape.height },
            () => ids.shift() ?? "",
        );
        const sources = new Map<string, Uint8Array>();
        let pixelIndex = 0;
        doc.layers = spec.layers.map((layer, index): Layer => {
            const base = {
                name: layer.name,
                visible: layer.visible,
                locked: layer.locked,
                opacity: layer.opacity,
            };
            if (!spec.order.includes(index)) {
                return { ...base, id: `pixel-${pixelIndex++}`, kind: "pixel", blend: layer.blend };
            }
            const sourceId = `source_${layer.source}`;
            sources.set(sourceId, pngFile(1, 1, [[layer.source, index, 7]]));
            return {
                ...base,
                id: `reference-${index}`,
                kind: "reference",
                sourceId,
                x: layer.x,
                y: layer.y,
                scale: layer.scale,
                placement: layer.placement,
            };
        });
        doc.frames = spec.durations.map((durationMs, index) => ({ id: `F${index}`, durationMs }));
        const made: string[] = [];
        spec.cels.forEach((cel, index) => {
            const layer = `pixel-${Math.floor(index / shape.frames)}`;
            const frame = `F${index % shape.frames}`;
            if (cel.kind === "empty" || (cel.kind === "link" && made.length === 0)) return;
            let imageId = made[cel.link % Math.max(1, made.length)];
            if (cel.kind === "own") {
                imageId = `image_${made.length}`;
                made.push(imageId);
                doc.images.set(imageId, {
                    width: shape.width,
                    height: shape.height,
                    data: Uint8ClampedArray.from(cel.bytes),
                });
            }
            doc.cels.set(celKey(layer, frame), { imageId, opacity: cel.opacity });
        });
        doc.tags = spec.tags.map((tag, index) => ({
            id: `tag-${index}`,
            name: tag.name,
            color: tag.color,
            fromFrameId: `F${Math.min(tag.a, tag.b)}`,
            toFrameId: `F${Math.max(tag.a, tag.b)}`,
            direction: tag.direction,
            repeat: tag.repeat,
        }));
        doc.palette = spec.palette;
        doc.pivot = spec.pivot;
        doc.settings = spec.settings;
        const exported = spec.exportTag === undefined ? undefined : doc.tags[spec.exportTag % 4];
        doc.exportSettings = {
            ...spec.exportSettings,
            frames: exported ? { tagId: exported.id } : "all",
        };
        return { doc, sources };
    });

// 150 random projects written and read: more than the default 5 s on a slow or busy machine.
describe("project round trip of random documents", { timeout: 30_000 }, () => {
    it("yields a deep-equal document, identical pixels and sources, and the same bytes again", async () => {
        await fc.assert(
            fc.asyncProperty(projects, async ({ doc, sources }) => {
                const bytes = serialize(doc, sources);
                const project = await deserialize(bytes);

                expect(project.doc).toEqual(doc);
                expectSamePixels(project.doc, doc);
                expect([...project.referenceSources.keys()].sort()).toEqual(
                    [...sources.keys()].sort(),
                );
                for (const [sourceId, source] of sources) {
                    const read = project.referenceSources.get(sourceId) ?? new Uint8Array(0);
                    expect(Buffer.compare(Buffer.from(read), Buffer.from(source)), sourceId).toBe(
                        0,
                    );
                }
                const again = serialize(project.doc, project.referenceSources);
                expect(Buffer.compare(Buffer.from(again), Buffer.from(bytes))).toBe(0);
            }),
            { numRuns: 150 },
        );
    });
});
