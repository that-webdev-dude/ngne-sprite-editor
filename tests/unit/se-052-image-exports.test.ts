import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { bundle, exportName, ExportError } from "../../src/core/export";
import {
    MAX_FRAME_PNG_SCALE,
    framePngFile,
    framePngName,
    maxFramePngScale,
    pngSequenceFiles,
    spriteSheetFile,
    upscaleNearest,
    zipFiles,
} from "../../src/core/imageExports";
import { compositeFrame } from "../../src/core/composite";
import type { PixelBuffer, SpriteDoc } from "../../src/core/model";
import { decodePng } from "../../src/core/png";
import { FIXTURES } from "../e2e/se-053-documents";

// SE-052: the exports beside the bundle (SPEC §9.6): the frame PNG scaled by a whole number,
// the sprite sheet PNG alone, the PNG sequence, and the zip that carries several files.

/** The pixel at (x, y) as four numbers. */
function pixel(image: PixelBuffer, x: number, y: number): number[] {
    const at = (y * image.width + x) * 4;
    return Array.from(image.data.subarray(at, at + 4));
}

/** A nearest-neighbour upscale written out pixel by pixel, independent of the code under test. */
function blocks(image: PixelBuffer, scale: number): PixelBuffer {
    const width = image.width * scale;
    const height = image.height * scale;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            data.set(
                pixel(image, Math.floor(x / scale), Math.floor(y / scale)),
                (y * width + x) * 4,
            );
        }
    }
    return { width, height, data };
}

function walkerWithTag(tagName: string): SpriteDoc {
    const doc = FIXTURES.a.build();
    const tag = doc.tags.find((entry) => entry.name === tagName);
    if (!tag) throw new Error(`no tag ${tagName}`);
    doc.exportSettings.frames = { tagId: tag.id };
    return doc;
}

describe("the frame PNG", () => {
    it("is an exact nearest-neighbour upscale of the composite at every scale", async () => {
        const doc = FIXTURES.b.build();
        const name = exportName(doc.name);
        for (const [index, frame] of doc.frames.entries()) {
            const composite = compositeFrame(doc, frame.id);
            for (const scale of [1, 2, 4, 7]) {
                const file = framePngFile(doc, name, frame.id, scale);
                expect(file.name).toBe(framePngName(name, index, scale));
                const image = await decodePng(file.bytes);
                expect([image.width, image.height]).toEqual([33 * scale, 17 * scale]);
                expect(
                    Buffer.from(image.data).equals(Buffer.from(blocks(composite, scale).data)),
                ).toBe(true);
            }
        }
    });

    it("is named <name>-<index>.png, with @<scale>x above scale 1", () => {
        expect(framePngName("hero", 0, 1)).toBe("hero-0.png");
        expect(framePngName("hero", 3, 4)).toBe("hero-3@4x.png");
        expect(framePngName("hero-walk", 12, 16)).toBe("hero-walk-12@16x.png");
    });

    it("scales 1 to 16, less where 16 times the longer side would pass 8192 px", () => {
        expect(MAX_FRAME_PNG_SCALE).toBe(16);
        expect(maxFramePngScale({ width: 32, height: 32 })).toBe(16);
        expect(maxFramePngScale({ width: 512, height: 64 })).toBe(16);
        expect(maxFramePngScale({ width: 513, height: 64 })).toBe(15);
        expect(maxFramePngScale({ width: 64, height: 1024 })).toBe(8);
        expect(maxFramePngScale({ width: 1024, height: 1024 })).toBe(8);
        const doc = FIXTURES.a.build();
        const frame = doc.frames[0].id;
        expect(() => framePngFile(doc, "walker", frame, 0)).toThrow(RangeError);
        expect(() => framePngFile(doc, "walker", frame, 17)).toThrow(RangeError);
        expect(() => framePngFile(doc, "walker", frame, 1.5)).toThrow(RangeError);
        expect(() => framePngFile(doc, "walker", "no-such-frame", 1)).toThrow(RangeError);
        expect(() => upscaleNearest(compositeFrame(doc, frame), 0)).toThrow(RangeError);
    });
});

describe("the sprite sheet PNG alone", () => {
    it("is the bundle's <name>.png, byte for byte, for every fixture and for one tag", () => {
        const docs = [
            ...Object.values(FIXTURES).map((fixture) => fixture.build()),
            walkerWithTag("Blink"),
        ];
        for (const doc of docs) {
            const sheet = spriteSheetFile(doc);
            const png = bundle(doc).files[0];
            expect(sheet.name).toBe(`${exportName(doc.name)}.png`);
            expect(png.name).toBe(sheet.name);
            expect(Buffer.from(sheet.bytes).equals(Buffer.from(png.bytes))).toBe(true);
        }
    });
});

describe("the PNG sequence", () => {
    it("holds one file per frame named <name>-<index>.png, each the frame's composite", async () => {
        const doc = FIXTURES.a.build();
        const files = pngSequenceFiles(doc);
        expect(files.map((file) => file.name)).toEqual([
            "walker-0.png",
            "walker-1.png",
            "walker-2.png",
            "walker-3.png",
        ]);
        for (const [index, file] of files.entries()) {
            const image = await decodePng(file.bytes);
            const composite = compositeFrame(doc, doc.frames[index].id);
            expect(Buffer.from(image.data).equals(Buffer.from(composite.data))).toBe(true);
        }
    });

    it("follows the export's frames: one tag gives its frames under their document indices", () => {
        const files = pngSequenceFiles(walkerWithTag("Blink"));
        expect(files.map((file) => file.name)).toEqual(["walker-2.png", "walker-3.png"]);
    });

    it("refuses the documents the bundle refuses", () => {
        const doc = FIXTURES.a.build();
        doc.exportSettings.frames = { tagId: "no-such-tag" };
        expect(() => pngSequenceFiles(doc)).toThrow(ExportError);
        expect(() => spriteSheetFile(doc)).toThrow(ExportError);
    });
});

describe("the zip of several files", () => {
    it("holds the files under their names with their bytes, PNG stored, the rest deflated", () => {
        const doc = FIXTURES.a.build();
        const { files } = bundle(doc);
        const zip = zipFiles(files);
        const entries = unzipSync(zip);
        expect(Object.keys(entries)).toEqual(files.map((file) => file.name));
        for (const file of files) {
            expect(Buffer.from(entries[file.name]).equals(Buffer.from(file.bytes))).toBe(true);
        }
        // The compression method of each local header (offset 8): 0 stored, 8 deflated.
        const methods: Record<string, number> = {};
        const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
        for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
            const nameLength = view.getUint16(at + 26, true);
            const extraLength = view.getUint16(at + 28, true);
            const size = view.getUint32(at + 18, true);
            const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLength));
            methods[name] = view.getUint16(at + 8, true);
            at += 30 + nameLength + extraLength + size;
        }
        expect(methods).toEqual({
            "walker.png": 0,
            "walker.atlas.json": 8,
            "walker.sprites.ts": 8,
            "walker.preview.config.mjs": 8,
        });
    });

    it("is deterministic: the same files give the same bytes", () => {
        const first = zipFiles(bundle(FIXTURES.c.build()).files);
        const second = zipFiles(bundle(FIXTURES.c.build()).files);
        expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    });
});

describe("core/imageExports imports", () => {
    it("imports only core modules, and of core/export only its public index", () => {
        const directory = fileURLToPath(new URL("../../src/core/imageExports", import.meta.url));
        const files = readdirSync(directory)
            .filter((name) => /\.tsx?$/.test(name))
            .sort();
        expect(files).toEqual(["imageExports.ts", "index.ts"]);
        const specifiers = files.flatMap((file) =>
            ts
                .preProcessFile(readFileSync(join(directory, file), "utf8"), true, true)
                .importedFiles.map((entry) => entry.fileName),
        );
        // Its own file, or a module of `core` (`../<module>`; the project's zip writer).
        for (const specifier of specifiers) {
            expect(specifier).toMatch(/^\.\/[a-zA-Z]+$|^\.\.\/[a-z]+$|^\.\.\/project\/zip$/);
        }
        expect(specifiers).toContain("../export");
    });
});
