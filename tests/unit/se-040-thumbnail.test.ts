import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { celKey, createDocument } from "../../src/core/model";
import type { PixelBuffer, SpriteDoc } from "../../src/core/model";
import { decodePng } from "../../src/core/png";
import { THUMBNAIL_MAX_SIDE, projectThumbnail, serialize } from "../../src/core/project";
import {
    FIRST_FRAME_COMPOSITE,
    HEIGHT,
    WIDTH,
    entriesOf,
    fixtureDocument,
    fixtureSources,
} from "./se-040-support";

/**
 * A one-layer document whose only cel holds, at pixel (x, y), the opaque colour
 * (x mod 256, y mod 256, x div 256 + 16 · (y div 256)): every pixel says where it is.
 */
function coordinates(width: number, height: number): SpriteDoc {
    const ids = ["doc", "layer", "frame"];
    const { doc } = createDocument({ name: "coordinates", width, height }, () => ids.shift() ?? "");
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            data.set([x & 255, y & 255, (x >> 8) + 16 * (y >> 8), 255], (y * width + x) * 4);
        }
    }
    doc.images.set("image", { width, height, data });
    doc.cels.set(celKey("layer", "frame"), { imageId: "image", opacity: 255 });
    return doc;
}

/** The document pixel a thumbnail pixel shows, read back from its colour. */
function sourceOf(thumbnail: PixelBuffer, x: number, y: number): [number, number] {
    const at = (y * thumbnail.width + x) * 4;
    const [red, green, blue, alpha] = thumbnail.data.subarray(at, at + 4);
    expect(alpha).toBe(255);
    return [red + 256 * (blue & 15), green + 256 * (blue >> 4)];
}

describe("projectThumbnail", () => {
    it("is the composite of the first frame", () => {
        const thumbnail = projectThumbnail(fixtureDocument());

        expect([thumbnail.width, thumbnail.height]).toEqual([WIDTH, HEIGHT]);
        expect(Array.from(thumbnail.data)).toEqual(FIRST_FRAME_COMPOSITE.flat());
        expect(Array.from(thumbnail.data)).toEqual(
            Array.from(compositeFrame(fixtureDocument(), "frame-1").data),
        );
        // Not of another frame: the body differs at frame 2.
        expect(Array.from(thumbnail.data)).not.toEqual(
            Array.from(compositeFrame(fixtureDocument(), "frame-2").data),
        );
    });

    it("shows neither hidden layers nor reference layers, and no colour under alpha 0", () => {
        const doc = fixtureDocument();
        doc.layers = doc.layers.filter((layer) => layer.id === "layer-bg");
        const background = Array.from(projectThumbnail(doc).data);

        // The transparent last column of the background keeps a colour in the document.
        expect(background.slice(12, 16)).toEqual([0, 0, 0, 0]);
        const hidden = fixtureDocument();
        for (const layer of hidden.layers) {
            if (layer.id === "layer-body") layer.visible = false;
        }
        expect(Array.from(projectThumbnail(hidden).data)).toEqual(background);
    });

    it("is transparent when the first frame is empty", () => {
        const { doc } = createDocument({ name: "empty", width: 3, height: 2 });
        const thumbnail = projectThumbnail(doc);

        expect([thumbnail.width, thumbnail.height]).toEqual([3, 2]);
        expect(thumbnail.data.every((value) => value === 0)).toBe(true);
    });

    it("keeps the size of a document up to 128 px and does not enlarge a small one", () => {
        expect(THUMBNAIL_MAX_SIDE).toBe(128);
        for (const [width, height] of [
            [1, 1],
            [16, 16],
            [128, 128],
            [128, 1],
            [7, 128],
        ]) {
            const doc = coordinates(width, height);
            const thumbnail = projectThumbnail(doc);
            expect([thumbnail.width, thumbnail.height]).toEqual([width, height]);
            expect(Array.from(thumbnail.data)).toEqual(
                Array.from(doc.images.get("image")?.data ?? []),
            );
        }
    });

    it.each([
        // The longer side becomes 128; the other keeps the proportion, rounded, at least 1.
        [129, 129, 128, 128],
        [129, 64, 128, 64],
        [300, 200, 128, 85],
        [200, 300, 85, 128],
        [256, 256, 128, 128],
        [1024, 1024, 128, 128],
        [1024, 768, 128, 96],
        [1024, 1, 128, 1],
        [1, 1024, 1, 128],
        [1024, 3, 128, 1],
        [1000, 12, 128, 2],
        [130, 128, 128, 126],
    ])("scales %i × %i down to %i × %i", (width, height, thumbWidth, thumbHeight) => {
        const thumbnail = projectThumbnail(coordinates(width, height));

        expect([thumbnail.width, thumbnail.height]).toEqual([thumbWidth, thumbHeight]);
        expect(thumbnail.data).toHaveLength(thumbWidth * thumbHeight * 4);
        // Nearest neighbour: every pixel is the document pixel under its centre.
        const wrong: string[] = [];
        for (let y = 0; y < thumbHeight; y++) {
            for (let x = 0; x < thumbWidth; x++) {
                const expected = [
                    Math.floor(((x + 0.5) * width) / thumbWidth),
                    Math.floor(((y + 0.5) * height) / thumbHeight),
                ];
                const found = sourceOf(thumbnail, x, y);
                if (found.join() !== expected.join()) {
                    wrong.push(`(${x}, ${y}) shows ${found.join()}, expected ${expected.join()}`);
                }
            }
        }
        expect(wrong).toEqual([]);
    });

    it("never exceeds 128 px on a side, whatever the document's size", () => {
        for (const width of [1, 2, 127, 128, 129, 255, 513, 1023, 1024]) {
            for (const height of [1, 2, 127, 128, 129, 255, 513, 1023, 1024]) {
                const { doc } = createDocument({ name: "size", width, height });
                const thumbnail = projectThumbnail(doc);
                const longer = Math.max(width, height);
                const label = `${width} × ${height}`;

                expect(Math.max(thumbnail.width, thumbnail.height), label).toBe(
                    Math.min(longer, 128),
                );
                expect(Math.min(thumbnail.width, thumbnail.height), label).toBeGreaterThanOrEqual(
                    1,
                );
                // The proportion is kept to within the rounding of one pixel; a side that
                // would round to nothing is one pixel.
                const scale = Math.min(1, 128 / longer);
                for (const [side, scaled] of [
                    [width, thumbnail.width],
                    [height, thumbnail.height],
                ]) {
                    const exact = side * scale;
                    expect(
                        exact < 0.5 ? scaled === 1 : Math.abs(scaled - exact) <= 0.5,
                        label,
                    ).toBe(true);
                }
            }
        }
    });

    it("throws for a document without frames", () => {
        const { doc } = createDocument({ name: "none", width: 2, height: 2 });
        doc.frames = [];
        expect(() => projectThumbnail(doc)).toThrow(RangeError);
    });
});

describe("thumb.png of a project file", () => {
    it("is projectThumbnail of the document, as an 8-bit RGBA PNG", async () => {
        for (const doc of [fixtureDocument(), coordinates(300, 200), coordinates(1024, 3)]) {
            const sources = doc.name === "coordinates" ? new Map() : fixtureSources();
            const png = entriesOf(serialize(doc, sources)).get("thumb.png") ?? new Uint8Array(0);
            const expected = projectThumbnail(doc);

            // Bit depth 8, colour type 6.
            expect([png[24], png[25]]).toEqual([8, 6]);
            const decoded = await decodePng(png);
            expect([decoded.width, decoded.height]).toEqual([expected.width, expected.height]);
            expect(Array.from(decoded.data)).toEqual(Array.from(expected.data));
        }
    });
});
