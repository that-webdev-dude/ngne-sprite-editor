import { describe, expect, it } from "vitest";
import { MAX_CEL_OPACITY } from "../../src/core/cels";
import { MAX_FRAME_DURATION_MS } from "../../src/core/frames";
import { MAX_REFERENCE_LAYERS, celKey, createDocument } from "../../src/core/model";
import type { Layer, PixelBuffer, SpriteDoc } from "../../src/core/model";
import {
    IMAGE_ENTRY_OVERHEAD_BYTES,
    MAX_DOC_JSON_BYTES,
    MAX_ID_LENGTH,
    MAX_MANIFEST_BYTES,
    MAX_NAME_LENGTH,
    MAX_PROJECT_CELS,
    MAX_PROJECT_CONTENT_BYTES,
    MAX_PROJECT_ENTRIES,
    MAX_PROJECT_FRAMES,
    MAX_PROJECT_IMAGES,
    MAX_PROJECT_LAYERS,
    MAX_PROJECT_PALETTE_COLORS,
    MAX_PROJECT_PIXEL_BYTES,
    MAX_PROJECT_REFERENCE_LAYERS,
    MAX_PROJECT_TAGS,
    MAX_REFERENCE_OFFSET,
    MAX_REFERENCE_SCALE,
    MAX_REFERENCE_SOURCE_BYTES,
    MIN_REFERENCE_SCALE,
    ProjectError,
    deserialize,
    docFromJson,
    docToJson,
    maxImageEntryBytes,
    serialize,
} from "../../src/core/project";
import { encodeJson } from "../../src/core/project/json";
import { projectManifest } from "../../src/core/project/manifest";
import { openZip, writeZip } from "../../src/core/project/zip";
import { MAX_TAG_REPEAT } from "../../src/core/tags";
import { fixtureDocument, fixtureSources, pngFile, zipHeaders } from "./se-040-support";

// The limits of docs/FORMAT.md §1.8 hold together: a document that is at every limit of a
// count and of a length at once is written inside every limit of a size. That document is
// built here, with IDs and texts of full length, and saved and opened for real; what it does
// not reach, the limits of the pixel data and of all entries together, is in the sums.

const MIB = 1024 * 1024;

/** An ID of full length: the prefix and the number, then filled up. */
function longId(prefix: string, index: number): string {
    return `${prefix}${index}`.padEnd(MAX_ID_LENGTH, "_");
}

/**
 * A text of full length that takes the most room in JSON: a control character is written
 * `\u0001`, six bytes for one UTF-16 code unit. No character takes more.
 */
const LONG_NAME = "\u0001".repeat(MAX_NAME_LENGTH);

/** A number whose JSON form is as long as that of any double: 23 characters, 24 with a sign. */
const LONG_NUMBER = 1.2345678901234568e-300;

/**
 * A document at every count limit at once: 1024 layers of which four are reference layers,
 * 65 535 frames, 131 072 cels on 65 527 images, 1024 tags and 256 palette colours. Every ID
 * and every text has full length, every number its longest form and every choice its longest
 * word. All images are `image`, under their different IDs.
 */
function documentAtEveryLimit(image: PixelBuffer): SpriteDoc {
    const { doc } = createDocument({ name: LONG_NAME, width: image.width, height: image.height });
    doc.id = longId("document", 0);
    doc.layers = Array.from({ length: MAX_PROJECT_LAYERS }, (_, index): Layer => {
        const base = { name: LONG_NAME, visible: false, locked: false, opacity: 255 };
        if (index >= MAX_PROJECT_REFERENCE_LAYERS) {
            return { ...base, id: longId("layer", index), kind: "pixel", blend: "color-dodge" };
        }
        return {
            ...base,
            id: longId("layer", index),
            kind: "reference",
            sourceId: longId("source", index),
            x: -LONG_NUMBER,
            y: -LONG_NUMBER,
            scale: 1.2345678901234567e-6,
            placement: "behind",
        };
    });
    doc.frames = Array.from({ length: MAX_PROJECT_FRAMES }, (_, index) => ({
        id: longId("frame", index),
        durationMs: MAX_FRAME_DURATION_MS,
    }));
    // The cels fill the pixel layers from the bottom, frame by frame. The first 65 527 have
    // an image each; the others are linked to the last of those.
    for (let index = 0; index < MAX_PROJECT_CELS; index++) {
        const layer =
            doc.layers[MAX_PROJECT_REFERENCE_LAYERS + Math.floor(index / MAX_PROJECT_FRAMES)];
        const frame = doc.frames[index % MAX_PROJECT_FRAMES];
        const imageId = longId("image", Math.min(index, MAX_PROJECT_IMAGES - 1));
        doc.images.set(imageId, image);
        doc.cels.set(celKey(layer.id, frame.id), { imageId, opacity: MAX_CEL_OPACITY });
    }
    // Every tag over the last two frames: the farthest to look for in the frame list.
    doc.tags = Array.from({ length: MAX_PROJECT_TAGS }, (_, index) => ({
        id: longId("tag", index),
        name: LONG_NAME,
        color: 0xffffffff,
        fromFrameId: doc.frames[MAX_PROJECT_FRAMES - 2].id,
        toFrameId: doc.frames[MAX_PROJECT_FRAMES - 1].id,
        direction: "pingpong",
        repeat: MAX_TAG_REPEAT,
    }));
    doc.palette = {
        name: LONG_NAME,
        colors: Array<number>(MAX_PROJECT_PALETTE_COLORS).fill(0xffffffff),
    };
    doc.pivot = { x: LONG_NUMBER, y: LONG_NUMBER };
    doc.settings = {
        grid: { width: 1024, height: 1024, offsetX: -1024, offsetY: -1024, visible: false },
        pixelGrid: false,
        onion: {
            enabled: false,
            before: 3,
            after: 3,
            opacity: 255,
            falloff: LONG_NUMBER,
            tint: false,
            placement: "behind",
            withinTag: false,
        },
        symmetry: { mode: "none", axisX: 2048, axisY: 2048 },
        tiled: "none",
    };
    doc.exportSettings = {
        layout: "column",
        padding: 8,
        extrude: 2,
        trim: false,
        mergeDuplicates: false,
        frames: { tagId: doc.tags[0].id },
        files: { spritesTs: false, previewConfig: false, asepriteJson: "array" },
        exportOnSave: false,
    };
    return doc;
}

describe("limits of a project file", () => {
    it("are exported, each as a named constant with the value docs/FORMAT.md states", () => {
        expect({
            MAX_PROJECT_LAYERS,
            MAX_PROJECT_REFERENCE_LAYERS,
            MAX_PROJECT_FRAMES,
            MAX_PROJECT_TAGS,
            MAX_PROJECT_CELS,
            MAX_PROJECT_IMAGES,
            MAX_PROJECT_PALETTE_COLORS,
            MAX_ID_LENGTH,
            MAX_NAME_LENGTH,
            MAX_REFERENCE_OFFSET,
            MIN_REFERENCE_SCALE,
            MAX_REFERENCE_SCALE,
            MAX_MANIFEST_BYTES,
            MAX_DOC_JSON_BYTES,
            IMAGE_ENTRY_OVERHEAD_BYTES,
            MAX_REFERENCE_SOURCE_BYTES,
            MAX_PROJECT_PIXEL_BYTES,
            MAX_PROJECT_CONTENT_BYTES,
            MAX_PROJECT_ENTRIES,
        }).toEqual({
            MAX_PROJECT_LAYERS: 1024,
            MAX_PROJECT_REFERENCE_LAYERS: 4,
            MAX_PROJECT_FRAMES: 65_535,
            MAX_PROJECT_TAGS: 1024,
            MAX_PROJECT_CELS: 131_072,
            MAX_PROJECT_IMAGES: 65_527,
            MAX_PROJECT_PALETTE_COLORS: 256,
            MAX_ID_LENGTH: 64,
            MAX_NAME_LENGTH: 255,
            MAX_REFERENCE_OFFSET: 1_000_000,
            MIN_REFERENCE_SCALE: 0.000001,
            MAX_REFERENCE_SCALE: 1_000_000,
            MAX_MANIFEST_BYTES: 64 * 1024,
            MAX_DOC_JSON_BYTES: 64 * MIB,
            IMAGE_ENTRY_OVERHEAD_BYTES: 64 * 1024,
            MAX_REFERENCE_SOURCE_BYTES: 64 * MIB,
            MAX_PROJECT_PIXEL_BYTES: 1024 * MIB,
            MAX_PROJECT_CONTENT_BYTES: 2048 * MIB,
            MAX_PROJECT_ENTRIES: 65_534,
        });
        // The model's own limit on reference layers, and the image entry limit as a function.
        expect(MAX_PROJECT_REFERENCE_LAYERS).toBe(MAX_REFERENCE_LAYERS);
        expect(maxImageEntryBytes(1024, 1024)).toBe(1024 * (4 * 1024 + 1) + 65_536);
    });

    it("take the bounds of a frame, a cel and a tag from the modules that own them", () => {
        expect([MAX_FRAME_DURATION_MS, MAX_CEL_OPACITY, MAX_TAG_REPEAT]).toEqual([
            65_535, 255, 255,
        ]);

        const accepted = (change: (json: ReturnType<typeof docToJson>) => void): boolean => {
            const doc = fixtureDocument();
            const json = docToJson(doc);
            change(json);
            try {
                docFromJson(json, doc.images);
            } catch (error) {
                expect(error).toBeInstanceOf(ProjectError);
                return false;
            }
            return true;
        };
        expect(accepted((json) => void (json.tags[0].repeat = MAX_TAG_REPEAT))).toBe(true);
        expect(accepted((json) => void (json.tags[0].repeat = MAX_TAG_REPEAT + 1))).toBe(false);
        expect(accepted((json) => void (json.frames[0].durationMs = MAX_FRAME_DURATION_MS))).toBe(
            true,
        );
        expect(
            accepted((json) => void (json.frames[0].durationMs = MAX_FRAME_DURATION_MS + 1)),
        ).toBe(false);
        expect(accepted((json) => void (json.cels[0].opacity = MAX_CEL_OPACITY))).toBe(true);
        expect(accepted((json) => void (json.cels[0].opacity = MAX_CEL_OPACITY + 1))).toBe(false);
    });

    it("leave room in the archive for every image and every reference source", () => {
        // manifest.json, doc.json and thumb.png beside the images and the sources.
        expect(MAX_PROJECT_IMAGES + MAX_PROJECT_REFERENCE_LAYERS + 3).toBe(MAX_PROJECT_ENTRIES);
        // One below the count that announces a zip64 record.
        expect(MAX_PROJECT_ENTRIES).toBe(0xffff - 1);
        // 128 full layers of 1024 frames can be saved, with reference layers beside them.
        expect(128 * 1024).toBeLessThanOrEqual(MAX_PROJECT_CELS);
        expect(128 + MAX_PROJECT_REFERENCE_LAYERS).toBeLessThanOrEqual(MAX_PROJECT_LAYERS);

        // What the sum counts, on a file: the entries are the images, the sources and three.
        const doc = fixtureDocument();
        const names = zipHeaders(serialize(doc, fixtureSources())).map((header) => header.name);
        expect(names).toHaveLength(doc.images.size + 1 + 3);
    });

    it("an archive of 65 534 entries is read, and one of 65 535 is not", () => {
        const entries = Array.from({ length: MAX_PROJECT_ENTRIES + 1 }, (_, index) => ({
            name: `entry-${index}`,
            data: Uint8Array.of(index & 0xff),
            stored: true,
        }));
        const archive = openZip(writeZip(entries.slice(0, MAX_PROJECT_ENTRIES)), MIB);
        expect(Array.from(archive.read("entry-65533", 16) ?? [])).toEqual([65_533 & 0xff]);
        expect(archive.read("entry-65534", 16)).toBeUndefined();

        let thrown: unknown;
        try {
            openZip(writeZip(entries), MIB);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(ProjectError);
        expect((thrown as ProjectError).code).toBe("unsupported-zip");
        expect((thrown as ProjectError).message).toMatch(/states 65 535 entries/);
    });

    it("keep the sizes of all entries together below their limit", () => {
        // The most scanline data 1 GiB of pixels has: a canvas one pixel wide, with a filter
        // byte for every four bytes of pixels.
        const scanlines = MAX_PROJECT_PIXEL_BYTES * 1.25;
        // What a PNG file adds to its scanlines, measured below and rounded far up.
        const framing = MAX_PROJECT_IMAGES * 200;
        const sources = MAX_PROJECT_REFERENCE_LAYERS * MAX_REFERENCE_SOURCE_BYTES;
        const thumbnail = maxImageEntryBytes(128, 128);
        const total =
            scanlines + framing + sources + thumbnail + MAX_DOC_JSON_BYTES + MAX_MANIFEST_BYTES;
        expect(total).toBeLessThan(MAX_PROJECT_CONTENT_BYTES);
        expect(encodeJson(projectManifest()).length).toBeLessThan(MAX_MANIFEST_BYTES);

        // The largest canvas on which the most images are within the pixel limit: 64 × 64.
        expect(MAX_PROJECT_IMAGES * 64 * 64 * 4).toBeLessThanOrEqual(MAX_PROJECT_PIXEL_BYTES);
        expect(MAX_PROJECT_IMAGES * 64 * 65 * 4).toBeGreaterThan(MAX_PROJECT_PIXEL_BYTES);
        // And the largest canvas has room for 256 images.
        expect(256 * 1024 * 1024 * 4).toBe(MAX_PROJECT_PIXEL_BYTES);

        // On a real file: an image entry is its scanlines and less than 200 bytes more, also
        // when the pixels do not compress.
        for (const [width, height] of [
            [1, 1],
            [1, 64],
            [64, 64],
        ]) {
            const { doc } = createDocument({ name: "noise", width, height });
            const data = new Uint8ClampedArray(width * height * 4);
            let state = 12345;
            for (let i = 0; i < data.length; i++) {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                data[i] = state >>> 24;
            }
            doc.images.set("image", { width, height, data });
            doc.cels.set(celKey(doc.layers[0].id, doc.frames[0].id), {
                imageId: "image",
                opacity: 255,
            });
            const header = zipHeaders(serialize(doc, new Map())).find(
                (entry) => entry.name === "images/image.png",
            );
            expect(header?.size).toBeLessThanOrEqual(height * (4 * width + 1) + 200);
        }
    });

    it("a doc.json at every count limit at once, with full-length IDs and texts, is within its size limit and is read", () => {
        const image: PixelBuffer = {
            width: 1024,
            height: 1024,
            data: new Uint8ClampedArray(1024 * 1024 * 4),
        };
        const doc = documentAtEveryLimit(image);
        expect([doc.layers.length, doc.frames.length, doc.tags.length]).toEqual([
            MAX_PROJECT_LAYERS,
            MAX_PROJECT_FRAMES,
            MAX_PROJECT_TAGS,
        ]);
        expect([doc.cels.size, doc.images.size]).toEqual([MAX_PROJECT_CELS, MAX_PROJECT_IMAGES]);
        expect(doc.layers.filter((layer) => layer.kind === "reference")).toHaveLength(4);
        expect(doc.palette.colors).toHaveLength(MAX_PROJECT_PALETTE_COLORS);
        expect(doc.layers[0].id).toHaveLength(MAX_ID_LENGTH);

        // The text `serialize` would put into the archive.
        const bytes = encodeJson(docToJson(doc));
        expect(bytes.length).toBeLessThanOrEqual(MAX_DOC_JSON_BYTES);
        // The figure docs/FORMAT.md §1.8 gives. The limit is not far above it.
        expect((bytes.length / MIB).toFixed(1)).toBe("52.5");
        // Each text is written with six bytes for every code unit.
        const text = new TextDecoder().decode(bytes);
        expect(text).toContain(`"name": "${"\\u0001".repeat(MAX_NAME_LENGTH)}"`);

        // And the reader takes it, in time that does not grow with tags × frames.
        const started = performance.now();
        const read = docFromJson(JSON.parse(text), doc.images);
        expect(performance.now() - started).toBeLessThan(10_000);
        expect([read.layers.length, read.frames.length, read.tags.length]).toEqual([
            MAX_PROJECT_LAYERS,
            MAX_PROJECT_FRAMES,
            MAX_PROJECT_TAGS,
        ]);
        expect([read.cels.size, read.images.size]).toEqual([MAX_PROJECT_CELS, MAX_PROJECT_IMAGES]);
        expect(read.layers[0]).toEqual(doc.layers[0]);
        expect(read.layers[1023]).toEqual(doc.layers[1023]);
        expect(read.frames[65_534]).toEqual(doc.frames[65_534]);
        expect(read.tags[1023]).toEqual(doc.tags[1023]);
        expect(read.palette).toEqual(doc.palette);
        expect(read.settings).toEqual(doc.settings);
        expect(read.exportSettings).toEqual(doc.exportSettings);
    }, 120_000);

    it("a document at every count limit at once is saved inside every size limit and opened again", async () => {
        // The whole file: 65 534 entries. The canvas is one pixel, so that the 65 527 images
        // are small; their size is bounded by the pixel limit, which has a test above.
        const image: PixelBuffer = { width: 1, height: 1, data: Uint8ClampedArray.of(1, 2, 3, 4) };
        const doc = documentAtEveryLimit(image);
        const sources = new Map(
            doc.layers.flatMap((layer): [string, Uint8Array][] =>
                layer.kind === "reference" ? [[layer.sourceId, pngFile(1, 1, [[1, 2, 3]])]] : [],
            ),
        );
        expect(sources.size).toBe(MAX_PROJECT_REFERENCE_LAYERS);

        const file = serialize(doc, sources);
        const headers = zipHeaders(file);
        expect(headers).toHaveLength(MAX_PROJECT_ENTRIES);
        expect(headers.filter((header) => header.name.startsWith("images/"))).toHaveLength(
            MAX_PROJECT_IMAGES,
        );
        const docJson = headers.find((header) => header.name === "doc.json")?.size ?? Infinity;
        expect(docJson).toBeLessThanOrEqual(MAX_DOC_JSON_BYTES);
        expect((docJson / MIB).toFixed(1)).toBe("52.5");
        const total = headers.reduce((sum, header) => sum + header.size, 0);
        expect(total).toBeLessThan(MAX_PROJECT_CONTENT_BYTES);

        const project = await deserialize(file);
        expect(project.doc.cels.size).toBe(MAX_PROJECT_CELS);
        expect(project.doc.images.size).toBe(MAX_PROJECT_IMAGES);
        expect(project.referenceSources.size).toBe(MAX_PROJECT_REFERENCE_LAYERS);
        expect(project.doc.layers).toEqual(doc.layers);
        expect(project.doc.frames).toEqual(doc.frames);
        expect(project.doc.tags).toEqual(doc.tags);
        expect(project.doc.cels).toEqual(doc.cels);
        expect(project.doc.settings).toEqual(doc.settings);
        expect(project.doc.exportSettings).toEqual(doc.exportSettings);
    }, 300_000);

    it("one more of anything is refused", () => {
        const image: PixelBuffer = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
        const code = (change: (doc: SpriteDoc) => void): string => {
            const { doc } = createDocument({ name: "one more", width: 1, height: 1 });
            doc.images.set("image", image);
            change(doc);
            try {
                docToJson(doc);
                docFromJson(docToJson(doc), doc.images);
            } catch (error) {
                expect(error).toBeInstanceOf(ProjectError);
                return `${(error as ProjectError).code}: ${(error as ProjectError).message}`;
            }
            return "accepted";
        };
        const layers = (count: number) => (doc: SpriteDoc) => {
            doc.layers = Array.from({ length: count }, (_, i) => ({
                ...doc.layers[0],
                id: `l${i}`,
            }));
        };
        const frames = (count: number) => (doc: SpriteDoc) => {
            doc.frames = Array.from({ length: count }, (_, i) => ({
                id: `f${i}`,
                durationMs: 100,
            }));
        };
        /** `count` cels on `images` images, over three layers of 65 535 frames. */
        const cels = (count: number, images: number) => (doc: SpriteDoc) => {
            layers(3)(doc);
            frames(MAX_PROJECT_FRAMES)(doc);
            for (let i = 0; i < count; i++) {
                const imageId = `i${Math.min(i, images - 1)}`;
                doc.images.set(imageId, image);
                doc.cels.set(
                    celKey(`l${Math.floor(i / MAX_PROJECT_FRAMES)}`, `f${i % MAX_PROJECT_FRAMES}`),
                    {
                        imageId,
                        opacity: 255,
                    },
                );
            }
        };

        expect(code(layers(MAX_PROJECT_LAYERS))).toBe("accepted");
        expect(code(layers(MAX_PROJECT_LAYERS + 1))).toMatch(
            /invalid-document: .*`layers` holds 1025 items; at most 1024/,
        );
        expect(code(frames(MAX_PROJECT_FRAMES))).toBe("accepted");
        expect(code(frames(MAX_PROJECT_FRAMES + 1))).toMatch(
            /invalid-document: .*`frames` holds 65536 items; at most 65535/,
        );
        expect(code(cels(MAX_PROJECT_CELS, 1))).toBe("accepted");
        expect(code(cels(MAX_PROJECT_CELS + 1, 1))).toMatch(
            /invalid-document: .*`cels` holds 131073 items; at most 131072/,
        );
        expect(code(cels(MAX_PROJECT_IMAGES, MAX_PROJECT_IMAGES))).toBe("accepted");
        expect(code(cels(MAX_PROJECT_IMAGES + 1, MAX_PROJECT_IMAGES + 1))).toMatch(
            /invalid-document: .*`cels` names more than 65527 images/,
        );
    }, 120_000);
});
