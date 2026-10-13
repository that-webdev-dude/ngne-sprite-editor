import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import {
    AtlasError,
    bundle,
    bundleFileNames,
    exportIdentifiers,
    exportName,
    validateAtlas,
} from "../../src/core/export";
import type { AtlasMeta, Bundle } from "../../src/core/export";
import { celKey } from "../../src/core/model";
import { clonePixelBuffer, cropPixels, pixelBuffersEqual } from "../../src/core/pixels";
import { decodePng } from "../../src/core/png";
import {
    FIXTURES,
    FIXTURE_IDS,
    fileOf,
    fromBase64,
    textOf,
    toBase64,
    withRectOutsideImage,
} from "../e2e/se-053-documents";
import type { FixtureId } from "../e2e/se-053-documents";
import { errorOf } from "./se-051-support";

// SE-053: the fixture documents of the conformance checks, and condition 1 of SPEC §9.7 on
// their bundles: `<name>.atlas.json` validates against the schema and its rectangles lie
// inside the PNG. The specs repeat the condition on the files a browser wrote; here the
// bundle is made in Node, and what each fixture is for is checked against its atlas.

const BUNDLES = new Map<FixtureId, Bundle>(
    FIXTURE_IDS.map((id) => [id, bundle(FIXTURES[id].build())]),
);

function made(id: FixtureId): Bundle {
    const result = BUNDLES.get(id);
    if (!result) throw new Error(`No bundle of fixture ${id}`);
    return result;
}

/** The atlas as a reader gets it: the JSON text parsed, checked against the decoded PNG. */
async function read(files: Bundle["files"]): Promise<AtlasMeta> {
    const json: unknown = JSON.parse(textOf(files, ".atlas.json"));
    return validateAtlas(json, await decodePng(fileOf(files, ".png").bytes));
}

/** The frames of an atlas as `x,y w×h @offsetX,offsetY`. */
function rectangles(meta: AtlasMeta): string[] {
    return Object.values(meta.frames).map(
        ({ x, y, w, h, offsetX, offsetY }) => `${x},${y} ${w}×${h} @${offsetX},${offsetY}`,
    );
}

/** The animations of an atlas as `id playback duration: frame:ms …`, frames by their index. */
function animations(meta: AtlasMeta): string[] {
    return Object.entries(meta.animations).map(
        ([id, { playback, durationMs, entries }]) =>
            `${id} ${playback} ${durationMs}: ` +
            entries.map(({ frame, ms }) => `${frame.split("-").pop()}:${ms}`).join(" "),
    );
}

describe.each(FIXTURE_IDS)("the bundle of fixture (%s)", (id) => {
    const fixture = FIXTURES[id];
    const doc = fixture.build();
    const { files, atlas, meta } = made(id);

    it("has the names the specs use for it", () => {
        expect(exportName(doc.name)).toBe(fixture.name);
        expect(exportIdentifiers(doc.name)).toEqual({
            camel: fixture.camel,
            pascal: fixture.pascal,
        });
        expect(files.map((file) => file.name)).toEqual(
            bundleFileNames(doc.name, doc.exportSettings.files),
        );
        expect(files.map((file) => file.name)).toEqual([
            `${fixture.name}.png`,
            `${fixture.name}.atlas.json`,
            `${fixture.name}.sprites.ts`,
            `${fixture.name}.preview.config.mjs`,
        ]);
        // The names the consumer page asks the generated module for.
        const module = textOf(files, ".sprites.ts");
        for (const name of [
            `export const ${fixture.camel}Image: ImageAsset`,
            `export function draw${fixture.pascal}(`,
            `export function draw${fixture.pascal}TopLeft(`,
            `export function ${fixture.camel}AnimationFrame(`,
            `export function ${fixture.camel}AnimationDone(`,
        ]) {
            expect(module).toContain(name);
        }
    });

    it("validates: the atlas JSON against the schema and its rectangles inside the PNG", async () => {
        const image = await decodePng(fileOf(files, ".png").bytes);
        expect(pixelBuffersEqual(image, atlas)).toBe(true);
        // What the reader makes of the file is what the writer described.
        expect(await read(files)).toEqual(meta);
        expect(meta.image).toBe(`${fixture.name}.png`);
        expect(Object.keys(meta.frames)).toEqual(
            doc.frames.map((_, index) => `${fixture.name}-${index}`),
        );
        for (const [frame, { x, y, w, h }] of Object.entries(meta.frames)) {
            expect(x >= 0 && y >= 0 && x + w <= image.width && y + h <= image.height, frame).toBe(
                true,
            );
            expect([w % 2, h % 2], frame).toEqual([0, 0]);
        }
    });

    it("holds every frame's composite in its rectangle", () => {
        Object.entries(meta.frames).forEach(([frame, rect], index) => {
            const composite = compositeFrame(doc, doc.frames[index].id);
            expect([rect.sourceW, rect.sourceH], frame).toEqual([doc.width, doc.height]);
            const inAtlas = cropPixels(atlas, {
                x: rect.x,
                y: rect.y,
                width: rect.w,
                height: rect.h,
            });
            // The part of the source frame the rectangle covers; past the frame it is clear.
            const inFrame = cropPixels(composite, {
                x: rect.offsetX,
                y: rect.offsetY,
                width: rect.w,
                height: rect.h,
            });
            expect(pixelBuffersEqual(inAtlas, inFrame), frame).toBe(true);
            // And nothing of the frame lies outside the rectangle.
            const outside = clonePixelBuffer(composite);
            for (let y = 0; y < rect.h; y++) {
                for (let x = 0; x < rect.w; x++) {
                    const sx = rect.offsetX + x;
                    const sy = rect.offsetY + y;
                    if (sx < doc.width && sy < doc.height) {
                        outside.data.fill(
                            0,
                            (sy * doc.width + sx) * 4,
                            (sy * doc.width + sx) * 4 + 4,
                        );
                    }
                }
            }
            expect(
                outside.data.every((value) => value === 0),
                frame,
            ).toBe(true);
        });
    });
});

describe("the fixtures of ticket SE-053", () => {
    it("(a) is 32 × 32 with four frames, untrimmed, with a loop, a repeat written out and a ping-pong", () => {
        const doc = FIXTURES.a.build();
        const { meta } = made("a");
        expect([doc.width, doc.height, doc.frames.length]).toEqual([32, 32, 4]);
        expect(doc.exportSettings).toMatchObject({ trim: false, extrude: 0, padding: 1 });
        // Two columns of 32 with padding 1: 2 × 33 + 1.
        expect([meta.width, meta.height]).toEqual([67, 67]);
        expect(rectangles(meta)).toEqual([
            "1,1 32×32 @0,0",
            "34,1 32×32 @0,0",
            "1,34 32×32 @0,0",
            "34,34 32×32 @0,0",
        ]);
        expect(animations(meta)).toEqual([
            "walk loop 300: 0:100 1:50 2:150",
            "blink once 460: 2:150 3:80 2:150 3:80",
            "turn once 580: 0:100 1:50 2:150 3:80 2:150 1:50",
        ]);
        // The hidden layer does not show; the half-transparent one is blended in.
        expect(doc.layers.map((layer) => [layer.visible, layer.opacity])).toEqual([
            [true, 255],
            [true, 160],
            [false, 255],
        ]);
    });

    it("(b) is 33 × 17 with trim and extrude 1: rectangles of every kind, a half-pixel pivot", () => {
        const doc = FIXTURES.b.build();
        const { meta, atlas } = made("b");
        expect([doc.width, doc.height]).toEqual([33, 17]);
        expect(doc.exportSettings).toMatchObject({ trim: true, extrude: 1 });
        expect(doc.pivot).toEqual({ x: 0.5, y: 0.5 });
        expect(rectangles(meta)).toEqual([
            // The whole canvas: even, so one pixel past the frame on both axes.
            "2,2 34×18 @0,0",
            // 30 × 13 inside the frame: the fourteenth row is a transparent one of the frame.
            "39,2 30×14 @3,2",
            // 27 × 16 against the right edge: one column past the frame.
            "76,2 28×16 @6,1",
            // 5 × 3 inside the frame.
            "2,23 6×4 @1,1",
            // Nothing: 2 × 2 at the corner.
            "39,23 2×2 @0,0",
        ]);
        // Extruded: the pixel left of a rectangle repeats its first one.
        const { x, y } = meta.frames["odd-bird-1"];
        const pixel = (px: number, py: number) => [
            ...atlas.data.subarray((py * atlas.width + px) * 4, (py * atlas.width + px) * 4 + 4),
        ];
        expect(pixel(x, y + 1)[3]).toBeGreaterThan(0);
        expect(pixel(x - 1, y + 1)).toEqual(pixel(x, y + 1));
        expect(animations(meta)).toEqual(["flap loop 300: 3:60 2:120 1:60 0:60"]);
    });

    it("(c) has merged duplicate frames: five frames in two rectangles, under five IDs", () => {
        const doc = FIXTURES.c.build();
        const { meta } = made("c");
        expect(doc.exportSettings).toMatchObject({ mergeDuplicates: true, trim: false });
        // Frames 0 and 2 have images of their own with equal pixels; frame 4 is linked to 0.
        const imageOf = (index: number) =>
            doc.cels.get(celKey("layer-0", `frame-${index}`))?.imageId;
        expect([0, 1, 2, 3, 4].map(imageOf)).toEqual([
            "image-0-0",
            "image-0-1",
            "image-0-2",
            "image-0-3",
            "image-0-0",
        ]);
        expect(rectangles(meta)).toEqual([
            "2,2 10×8 @0,0",
            "14,2 10×8 @0,0",
            "2,2 10×8 @0,0",
            "14,2 10×8 @0,0",
            "2,2 10×8 @0,0",
        ]);
        // One row of two rectangles with padding 2; the frame is 9 × 7, the rectangle even.
        expect([meta.width, meta.height]).toEqual([26, 12]);
        // Without merging the same document needs five rectangles.
        const apart = bundle(doc, { ...doc.exportSettings, mergeDuplicates: false });
        expect(new Set(rectangles(apart.meta)).size).toBe(5);
        // No tag: one loop over all frames, named like the document.
        expect(animations(meta)).toEqual(["twice loop 300: 0:70 1:30 2:70 3:30 4:100"]);
    });

    it("(d) has the pivot [0.5, 1] on trimmed frames, and a name that starts with a digit", () => {
        const doc = FIXTURES.d.build();
        const { meta } = made("d");
        expect(doc.pivot).toEqual({ x: 0.5, y: 1 });
        expect(Object.values(meta.frames).map((frame) => frame.pivot)).toEqual([
            [0.5, 1],
            [0.5, 1],
            [0.5, 1],
        ]);
        // A column without padding: the full frame and the one below it touch.
        expect(rectangles(meta)).toEqual([
            "0,0 24×26 @4,6",
            "0,32 32×32 @0,0",
            "0,64 14×18 @10,12",
        ]);
        expect(FIXTURES.d).toMatchObject({ name: "2d-feet", camel: "sprite2dFeet" });
        expect(animations(meta)).toEqual(["idle loop 200: 1:110 0:90"]);
    });

    it("build the same document every time", () => {
        for (const id of FIXTURE_IDS) {
            const again = bundle(FIXTURES[id].build());
            expect(again.meta).toEqual(made(id).meta);
            again.files.forEach((file, index) => {
                expect(Buffer.compare(file.bytes, made(id).files[index].bytes), file.name).toBe(0);
            });
        }
    });

    it("pass through base64 unchanged, as the export page hands them to a spec", () => {
        for (const file of made("a").files) {
            expect(Buffer.compare(fromBase64(toBase64(file.bytes)), file.bytes), file.name).toBe(0);
        }
        expect(toBase64(Uint8Array.from([0, 255, 16, 128]))).toBe("AP8QgA==");
    });
});

// --- the corrupted bundle -------------------------------------------------------------------------

interface PreviewModel {
    validate(value: unknown): unknown;
    validateBounds(
        preview: unknown,
        dimensions: Map<string, { width: number; height: number }>,
    ): void;
}
interface PreviewHost {
    loadAdapter(filename: string): Promise<unknown>;
}

const PREVIEW = new URL("../../node_modules/@ngne/core/dist/preview/", import.meta.url);
const imported = <T>(file: string) =>
    import(pathToFileURL(fileURLToPath(new URL(file, PREVIEW))).href) as Promise<T>;

const directories: string[] = [];
afterAll(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/** Writes files to a new temporary folder and returns the path of the adapter among them. */
function written(files: readonly { name: string; bytes: Uint8Array }[]): string {
    const directory = mkdtempSync(join(tmpdir(), "se-053-unit-"));
    directories.push(directory);
    for (const file of files) writeFileSync(join(directory, file.name), file.bytes);
    return join(directory, fileOf(files, ".preview.config.mjs").name);
}

describe("a bundle with a rectangle outside the image", { timeout: 60_000 }, () => {
    const fixture = FIXTURES.a;
    const whole = made("a");
    const corrupted = withRectOutsideImage(whole.files, fixture.name);

    it("differs from the bundle in the rectangle of one frame, in the two files that state it", () => {
        expect(corrupted.frame).toBe("walker-0");
        expect(corrupted.x).toBe(66);
        const changed = corrupted.files.filter((file, index) => file !== whole.files[index]);
        expect(changed.map((file) => file.name)).toEqual([
            "walker.atlas.json",
            "walker.preview.config.mjs",
        ]);
        const atlas = JSON.parse(textOf(corrupted.files, ".atlas.json")) as AtlasMeta;
        expect(atlas).toEqual({
            ...whole.meta,
            frames: {
                ...whole.meta.frames,
                "walker-0": { ...whole.meta.frames["walker-0"], x: 66 },
            },
        });
        expect(textOf(corrupted.files, ".preview.config.mjs")).toBe(
            textOf(whole.files, ".preview.config.mjs").replace(
                '{ id: "walker-0", image: "walker", x: 1, y: 1,',
                '{ id: "walker-0", image: "walker", x: 66, y: 1,',
            ),
        );
        expect(textOf(corrupted.files, ".preview.config.mjs")).toContain(
            '{ id: "walker-0", image: "walker", x: 66, y: 1, width: 32, height: 32,',
        );
    });

    it("is rejected by validateAtlas, which accepts the bundle it was made from", async () => {
        expect(await read(whole.files)).toEqual(whole.meta);

        const image = await decodePng(fileOf(corrupted.files, ".png").bytes);
        const json: unknown = JSON.parse(textOf(corrupted.files, ".atlas.json"));
        const error = errorOf(AtlasError, () => validateAtlas(json, image));
        expect(error.code).toBe("bounds");
        expect(error.path).toBe('frames["walker-0"]');
        expect(error.message).toBe(
            '`frames["walker-0"]` covers 66, 1 to 98, 33, outside the image of 67x67 px.',
        );
    });

    it("is rejected by the check NGNE's preview page makes before it draws", async () => {
        // `ngne-preview` itself starts on such a bundle: its command checks the adapter's
        // shape and that the image is a file. The page it serves loads the image and then
        // checks every source rectangle against it (dist/preview/browser.js); the spec sees
        // the page stop there. The same two functions, on the same files, in Node:
        const { loadAdapter } = await imported<PreviewHost>("host.js");
        const { validateBounds } = await imported<PreviewModel>("model.js");
        const size = new Map([
            ["walker", { width: whole.atlas.width, height: whole.atlas.height }],
        ]);

        const intact = await loadAdapter(written(whole.files));
        expect(() => validateBounds(intact, size)).not.toThrow();

        const preview = await loadAdapter(written(corrupted.files));
        expect(() => validateBounds(preview, size)).toThrow(
            "frame walker-0: source rectangle outside image walker (67x67)",
        );
    });

    it("needs a bundle that states the frame once", () => {
        const twice = whole.files.map((file) =>
            file.name.endsWith(".mjs")
                ? { name: file.name, bytes: new Uint8Array([...file.bytes, ...file.bytes]) }
                : file,
        );
        expect(() => withRectOutsideImage(twice, fixture.name)).toThrow(/does not state frame/);
        expect(() => withRectOutsideImage(whole.files.slice(0, 2), fixture.name)).toThrow(
            /no file ending in/,
        );
    });
});
