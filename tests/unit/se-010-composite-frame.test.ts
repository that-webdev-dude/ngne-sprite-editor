import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BLEND_FUNCTIONS, compositeFrame } from "../../src/core/composite";
import { celKey } from "../../src/core/model";
import type { BlendMode, PixelBuffer, SpriteDoc } from "../../src/core/model";
import { clonePixelBuffer, createPixelBuffer } from "../../src/core/pixels";
import {
    FRAME,
    addFrame,
    assertDocument,
    celImage,
    firstDifference,
    imageOf,
    layerId,
    pixelsOf,
    referenceComposite,
    referenceLayer,
    referencePixel,
    setCel,
    sprite,
    sprites,
} from "./se-010-support";
import type { Rgba } from "./se-010-support";

/** The expected composites of SE-061 (`fixtures/se-061-blend-golden.generate.mjs`). */
const se061Golden = JSON.parse(
    readFileSync(new URL("./fixtures/se-061-blend-golden.json", import.meta.url), "utf8"),
) as { se010: { expected: Record<BlendMode, string[]> } };

const BLUE: Rgba = [0, 0, 255, 255];
const RED: Rgba = [255, 0, 0, 255];
const HALF_RED: Rgba = [255, 0, 0, 128];
const CLEAR: Rgba = [0, 0, 0, 0];
/** `HALF_RED` over `BLUE` (hand-computed in se-010-golden.test.ts). */
const PURPLE = [128, 0, 127, 255];

/** A buffer in which every pixel differs from every other and none is transparent black. */
function marked(width: number, height: number): PixelBuffer {
    const data = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => 1 + (i % 251));
    return { width, height, data };
}

/** 4×3, blue below and half-transparent red above on every pixel: every pixel is `PURPLE`. */
function purple(): SpriteDoc {
    return sprite(4, 3, [
        { pixels: new Array<Rgba>(12).fill(BLUE) },
        { pixels: new Array<Rgba>(12).fill(HALF_RED) },
    ]);
}

function thrownBy(run: () => unknown): unknown {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error("nothing was thrown");
}

describe("compositeFrame, the formulas", () => {
    it("matches a pixel-by-pixel reference for 200 random documents", () => {
        let runs = 0;
        fc.assert(
            fc.property(sprites, ({ width, height, layers }) => {
                runs++;
                const doc = sprite(width, height, layers);
                const expected = referenceComposite(doc, FRAME);
                expect(firstDifference(compositeFrame(doc, FRAME), expected)).toBeNull();
            }),
            { numRuns: 200 },
        );
        expect(runs).toBe(200);
    });

    it("rounds source alpha × opacity to the nearest integer for every pair of values", () => {
        // Column x has alpha x. With nothing below, the result alpha is that product.
        const pixels = Array.from({ length: 256 }, (_, x): Rgba => [200, 100, 50, x]);
        const mismatches: string[] = [];
        for (let opacity = 0; opacity <= 255; opacity++) {
            const result = compositeFrame(sprite(256, 1, [{ opacity, pixels }]), FRAME);
            for (let x = 0; x <= 255; x++) {
                const alpha = Math.round((x * opacity) / 255);
                const expected = alpha === 0 ? [0, 0, 0, 0] : [200, 100, 50, alpha];
                const found = Array.from(result.data.subarray(x * 4, x * 4 + 4));
                if (found.join() !== expected.join()) {
                    mismatches.push(`alpha ${x} at opacity ${opacity}: ${found.join()}`);
                }
            }
        }
        expect(mismatches).toEqual([]);
    });

    it("blends every pair of source alpha and backdrop alpha as the reference does", () => {
        // Row y is the backdrop alpha, column x the source alpha.
        const below: Rgba[] = [];
        const above: Rgba[] = [];
        for (let y = 0; y < 256; y++) {
            for (let x = 0; x < 256; x++) {
                below.push([200, 3, 77, y]);
                above.push([13, 250, 141, x]);
            }
        }
        const doc = sprite(256, 256, [{ pixels: below }, { pixels: above }]);

        const result = compositeFrame(doc, FRAME);

        expect(firstDifference(result, referenceComposite(doc, FRAME))).toBeNull();
        // Spot checks of the reference itself against the hand-computed goldens.
        expect(referencePixel([0, 0, 255, 255], [255, 0, 0, 128], 255)).toEqual(PURPLE);
        expect(referencePixel([250, 100, 100, 128], [10, 200, 99, 128], 255)).toEqual([
            90, 166, 100, 192,
        ]);
        expect(referencePixel([10, 200, 30, 180], [250, 10, 130, 200], 78)).toEqual([
            83, 142, 60, 198,
        ]);
    });

    it("gives every pixel with alpha 0 the bytes 0, 0, 0, 0", () => {
        fc.assert(
            fc.property(sprites, ({ width, height, layers }) => {
                const { data } = compositeFrame(sprite(width, height, layers), FRAME);
                for (let at = 0; at < data.length; at += 4) {
                    if (data[at + 3] === 0) {
                        expect([data[at], data[at + 1], data[at + 2]]).toEqual([0, 0, 0]);
                    }
                }
            }),
            { numRuns: 200 },
        );
    });
});

describe("compositeFrame, the result buffer", () => {
    it("returns a new buffer with the document's dimensions on every call", () => {
        const doc = purple();

        const first = compositeFrame(doc, FRAME);
        const second = compositeFrame(doc, FRAME);

        expect([first.width, first.height, first.data.length]).toEqual([4, 3, 48]);
        expect(first.data).toBeInstanceOf(Uint8ClampedArray);
        expect(second).not.toBe(first);
        expect(second.data.buffer).not.toBe(first.data.buffer);
        for (const image of doc.images.values()) {
            expect(first.data.buffer).not.toBe(image.data.buffer);
        }
    });

    it("does not change the document", () => {
        const doc = purple();
        doc.layers.push(referenceLayer("reference", "front"));
        const before = structuredClone(doc);

        compositeFrame(doc, FRAME);
        compositeFrame(doc, FRAME, {
            rect: { x: 1, y: 1, width: 2, height: 1 },
            into: createPixelBuffer(4, 3),
            overrides: [{ layerId: layerId(1), image: createPixelBuffer(4, 3) }],
        });

        expect(doc).toStrictEqual(before);
    });

    it("writes into `into`, replacing what it held, and returns it", () => {
        const doc = purple();
        const into = marked(4, 3);

        const result = compositeFrame(doc, FRAME, { into });

        expect(result).toBe(into);
        expect(firstDifference(into, compositeFrame(doc, FRAME))).toBeNull();
    });

    it("clears `into` where the frame is transparent", () => {
        const doc = sprite(2, 1, [{ pixels: [RED, CLEAR] }]);
        const into = marked(2, 1);

        compositeFrame(doc, FRAME, { into });

        expect(pixelsOf(into)).toEqual([
            [255, 0, 0, 255],
            [0, 0, 0, 0],
        ]);
    });

    it("rejects `into` with other dimensions than the document, leaving it unchanged", () => {
        const doc = purple();
        for (const into of [marked(3, 4), marked(4, 2), marked(5, 3)]) {
            const before = clonePixelBuffer(into);
            expect(() => compositeFrame(doc, FRAME, { into })).toThrow(RangeError);
            expect(firstDifference(into, before)).toBeNull();
        }
        // Right width and height, wrong amount of storage.
        const short = { width: 4, height: 3, data: new Uint8ClampedArray(44) };
        expect(() => compositeFrame(doc, FRAME, { into: short })).toThrow(/`into` is 4×3 with 44/);
    });

    it("rejects `into` that is an image of the frame, leaving it unchanged", () => {
        const doc = purple();
        const image = celImage(doc, layerId(0), FRAME);
        const before = clonePixelBuffer(image);

        expect(() => compositeFrame(doc, FRAME, { into: image })).toThrow(RangeError);
        // Another view of the same storage is the same image.
        const view = { width: 4, height: 3, data: new Uint8ClampedArray(image.data.buffer) };
        expect(() => compositeFrame(doc, FRAME, { into: view })).toThrow(/image of the frame/);

        expect(firstDifference(image, before)).toBeNull();
    });
});

describe("compositeFrame, rect", () => {
    it("composites only the rectangle and leaves the rest of `into`", () => {
        const doc = purple();
        const into = marked(4, 3);
        const untouched = pixelsOf(into);

        const result = compositeFrame(doc, FRAME, {
            rect: { x: 1, y: 1, width: 2, height: 2 },
            into,
        });

        expect(result).toBe(into);
        const expected = [...untouched];
        for (const index of [5, 6, 9, 10]) expected[index] = PURPLE;
        expect(pixelsOf(into)).toEqual(expected);
    });

    it("clips the rectangle to the canvas", () => {
        const doc = purple();
        const into = marked(4, 3);
        const untouched = pixelsOf(into);

        compositeFrame(doc, FRAME, { rect: { x: -5, y: 2, width: 7, height: 40 }, into });

        // Columns 0 and 1 of the last row.
        const expected = [...untouched];
        for (const index of [8, 9]) expected[index] = PURPLE;
        expect(pixelsOf(into)).toEqual(expected);
    });

    it("writes nothing for a rectangle outside the canvas or without area", () => {
        const doc = purple();
        const into = marked(4, 3);
        const before = clonePixelBuffer(into);

        for (const rect of [
            { x: 4, y: 0, width: 2, height: 2 },
            { x: 0, y: 3, width: 2, height: 2 },
            { x: -2, y: 0, width: 2, height: 3 },
            { x: 0, y: -1, width: 4, height: 1 },
            { x: 1, y: 1, width: 0, height: 2 },
            { x: 1, y: 1, width: 2, height: 0 },
            { x: 2, y: 1, width: -1, height: 1 },
        ]) {
            expect(compositeFrame(doc, FRAME, { rect, into })).toBe(into);
        }

        expect(firstDifference(into, before)).toBeNull();
    });

    it("the whole canvas as rectangle is the whole composite", () => {
        const doc = purple();
        const into = marked(4, 3);

        compositeFrame(doc, FRAME, { rect: { x: 0, y: 0, width: 4, height: 3 }, into });

        expect(firstDifference(into, compositeFrame(doc, FRAME))).toBeNull();
    });

    it("without `into`, leaves the rest of the new buffer transparent", () => {
        const result = compositeFrame(purple(), FRAME, {
            rect: { x: 3, y: 0, width: 1, height: 2 },
        });

        const expected = new Array<number[]>(12).fill([0, 0, 0, 0]);
        for (const index of [3, 7]) expected[index] = PURPLE;
        expect([result.width, result.height]).toEqual([4, 3]);
        expect(pixelsOf(result)).toEqual(expected);
    });

    it("rejects a rectangle that is not made of integers, leaving `into` unchanged", () => {
        const doc = purple();
        const into = marked(4, 3);
        const before = clonePixelBuffer(into);

        for (const rect of [
            { x: 0.5, y: 0, width: 1, height: 1 },
            { x: 0, y: Number.NaN, width: 1, height: 1 },
            { x: 0, y: 0, width: 1.25, height: 1 },
            { x: 0, y: 0, width: 1, height: Number.POSITIVE_INFINITY },
        ]) {
            expect(() => compositeFrame(doc, FRAME, { rect, into })).toThrow(RangeError);
        }

        expect(firstDifference(into, before)).toBeNull();
    });
});

describe("compositeFrame, overrides", () => {
    const green = imageOf(2, 1, [
        [0, 255, 0, 255],
        [0, 255, 0, 128],
    ]);

    it("blends the override in place of the cel's image and leaves the document as it was", () => {
        const doc = sprite(2, 1, [{ pixels: [BLUE, BLUE] }, { pixels: [RED, RED] }]);
        const before = structuredClone(doc);

        const result = compositeFrame(doc, FRAME, {
            overrides: [{ layerId: layerId(1), image: green }],
        });

        expect(pixelsOf(result)).toEqual([
            [0, 255, 0, 255],
            // a = 128 over opaque blue: g = 0 + trunc(255 * 128 / 255) = 128, b = 255 - 128.
            [0, 128, 127, 255],
        ]);
        expect(doc).toStrictEqual(before);
        expect(pixelsOf(compositeFrame(doc, FRAME))).toEqual([
            [255, 0, 0, 255],
            [255, 0, 0, 255],
        ]);
    });

    it("can replace the cel of a lower layer", () => {
        const doc = sprite(2, 1, [{ pixels: [BLUE, BLUE] }, { pixels: [HALF_RED, CLEAR] }]);

        const result = compositeFrame(doc, FRAME, {
            overrides: [{ layerId: layerId(0), image: green }],
        });

        expect(pixelsOf(result)).toEqual([
            // Half red over opaque green: r = 0 + 128, g = 255 + trunc(-255 * 128 / 255) = 127.
            [128, 127, 0, 255],
            [0, 255, 0, 128],
        ]);
    });

    it("keeps the opacity of the cel and of the layer", () => {
        const doc = sprite(2, 1, [{ opacity: 128, celOpacity: 128, pixels: [RED, RED] }]);

        const result = compositeFrame(doc, FRAME, {
            overrides: [{ layerId: layerId(0), image: green }],
        });

        // Opacity mul(128, 128) = 64: a = mul(255, 64) = 64 and mul(128, 64) = round(32.13) = 32.
        expect(pixelsOf(result)).toEqual([
            [0, 255, 0, 64],
            [0, 255, 0, 32],
        ]);
    });

    it("counts as a cel of opacity 255 where the cel is empty", () => {
        const doc = sprite(2, 1, [{ pixels: [BLUE, BLUE] }, { opacity: 128 }]);

        const result = compositeFrame(doc, FRAME, {
            overrides: [{ layerId: layerId(1), image: green }],
        });

        // Opacity mul(128, 255) = 128: a = 128 and a = mul(128, 128) = 64.
        // Second pixel: Ra = 64 + 255 - 64 = 255, g = 0 + trunc(255 * 64 / 255) = 64,
        // b = 255 + trunc(-255 * 64 / 255) = 191.
        expect(pixelsOf(result)).toEqual([
            [0, 128, 127, 255],
            [0, 64, 191, 255],
        ]);
        expect(doc.cels.has(celKey(layerId(1), FRAME))).toBe(false);
    });

    it("applies only to the frame being composited", () => {
        const doc = sprite(2, 1, [{ pixels: [RED, RED] }]);
        addFrame(doc, "frame-1");
        setCel(doc, layerId(0), "frame-1", [BLUE, BLUE]);
        const overrides = [{ layerId: layerId(0), image: green }];

        expect(pixelsOf(compositeFrame(doc, "frame-1", { overrides }))).toEqual(pixelsOf(green));
        expect(pixelsOf(compositeFrame(doc, FRAME, { overrides }))).toEqual(pixelsOf(green));
        expect(pixelsOf(compositeFrame(doc, "frame-1"))).toEqual([
            [0, 0, 255, 255],
            [0, 0, 255, 255],
        ]);
    });

    it("does not show the override of a hidden layer", () => {
        const doc = sprite(2, 1, [
            { pixels: [BLUE, BLUE] },
            { visible: false, pixels: [RED, RED] },
        ]);

        const result = compositeFrame(doc, FRAME, {
            overrides: [{ layerId: layerId(1), image: green }],
        });

        expect(pixelsOf(result)).toEqual([
            [0, 0, 255, 255],
            [0, 0, 255, 255],
        ]);
    });

    it("works together with `rect` and `into`", () => {
        const doc = sprite(2, 1, [{ pixels: [BLUE, BLUE] }, { pixels: [RED, RED] }]);
        const into = compositeFrame(doc, FRAME);

        compositeFrame(doc, FRAME, {
            rect: { x: 1, y: 0, width: 1, height: 1 },
            into,
            overrides: [{ layerId: layerId(1), image: green }],
        });

        expect(pixelsOf(into)).toEqual([
            [255, 0, 0, 255],
            [0, 128, 127, 255],
        ]);
    });

    it("an empty list changes nothing", () => {
        const doc = purple();
        const result = compositeFrame(doc, FRAME, { overrides: [] });
        expect(firstDifference(result, compositeFrame(doc, FRAME))).toBeNull();
    });

    it("rejects an override that names no pixel layer of the document", () => {
        const doc = sprite(2, 1, [{ pixels: [BLUE, BLUE] }]);
        doc.layers.push(referenceLayer("reference", "front"));

        for (const id of ["missing", "reference", FRAME]) {
            const error = thrownBy(() =>
                compositeFrame(doc, FRAME, { overrides: [{ layerId: id, image: green }] }),
            );
            expect(error).toBeInstanceOf(RangeError);
            expect((error as Error).message).toContain(`"${id}"`);
        }
    });

    it("rejects two overrides of one layer", () => {
        const doc = sprite(2, 1, [{ pixels: [BLUE, BLUE] }]);
        const overrides = [
            { layerId: layerId(0), image: green },
            { layerId: layerId(0), image: clonePixelBuffer(green) },
        ];

        expect(() => compositeFrame(doc, FRAME, { overrides })).toThrow(RangeError);
    });

    it("rejects an override with other dimensions than the document", () => {
        const doc = sprite(2, 1, [{ pixels: [BLUE, BLUE] }]);

        for (const image of [createPixelBuffer(1, 2), createPixelBuffer(2, 2)]) {
            expect(() =>
                compositeFrame(doc, FRAME, { overrides: [{ layerId: layerId(0), image }] }),
            ).toThrow(RangeError);
        }
    });

    it("rejects `into` that is the override", () => {
        const doc = sprite(2, 1, [{ pixels: [BLUE, BLUE] }]);
        const image = clonePixelBuffer(green);

        expect(() =>
            compositeFrame(doc, FRAME, {
                into: image,
                overrides: [{ layerId: layerId(0), image }],
            }),
        ).toThrow(RangeError);
        expect(firstDifference(image, green)).toBeNull();
    });
});

describe("compositeFrame, reference layers", () => {
    it("a document with a reference layer composites as the same document without it", () => {
        const pixels = { below: [BLUE, [9, 8, 7, 6]] as Rgba[], above: [HALF_RED, HALF_RED] };
        const without = sprite(2, 1, [{ pixels: pixels.below }, { pixels: pixels.above }]);
        const expected = compositeFrame(without, FRAME);

        // Below, between and above the pixel layers; visible and hidden; one to four of them.
        for (const positions of [[0], [1], [2], [0, 2], [0, 1, 2, 2]]) {
            const doc = sprite(2, 1, [{ pixels: pixels.below }, { pixels: pixels.above }]);
            positions.forEach((position, index) => {
                const layer = referenceLayer(`reference-${index}`, index % 2 ? "front" : "behind");
                layer.visible = index !== 1;
                layer.opacity = 255 - index * 60;
                doc.layers.splice(position + index, 0, layer);
            });
            assertDocument(doc);
            expect(doc.layers.length).toBe(2 + positions.length);

            expect(firstDifference(compositeFrame(doc, FRAME), expected)).toBeNull();
        }
    });

    it("holds for 200 random documents with a reference layer at a random position", () => {
        const cases = sprites.chain((random) =>
            fc.record({
                random: fc.constant(random),
                position: fc.nat({ max: random.layers.length }),
                placement: fc.constantFrom("behind" as const, "front" as const),
            }),
        );
        fc.assert(
            fc.property(cases, ({ random, position, placement }) => {
                const without = sprite(random.width, random.height, random.layers);
                const doc = sprite(random.width, random.height, random.layers);
                doc.layers.splice(position, 0, referenceLayer("reference", placement));
                assertDocument(doc);

                expect(
                    firstDifference(compositeFrame(doc, FRAME), compositeFrame(without, FRAME)),
                ).toBeNull();
            }),
            { numRuns: 200 },
        );
    });
});

describe("compositeFrame, frames", () => {
    it("composites the cels of the frame it is given", () => {
        const doc = sprite(1, 1, [{ pixels: [BLUE] }, { pixels: [HALF_RED] }]);
        addFrame(doc, "frame-1");
        setCel(doc, layerId(1), "frame-1", [[0, 255, 0, 255]]);

        expect(pixelsOf(compositeFrame(doc, FRAME))).toEqual([PURPLE]);
        expect(pixelsOf(compositeFrame(doc, "frame-1"))).toEqual([[0, 255, 0, 255]]);
    });

    it("composites a linked cel from the shared image with the cel's own opacity", () => {
        const doc = sprite(1, 1, [{ pixels: [[10, 20, 30, 200]] }]);
        addFrame(doc, "frame-1");
        const imageId = doc.cels.get(celKey(layerId(0), FRAME))?.imageId ?? "";
        doc.cels.set(celKey(layerId(0), "frame-1"), { imageId, opacity: 100 });
        assertDocument(doc);

        expect(pixelsOf(compositeFrame(doc, FRAME))).toEqual([[10, 20, 30, 200]]);
        // a = mul(200, 100) = round(78.43) = 78.
        expect(pixelsOf(compositeFrame(doc, "frame-1"))).toEqual([[10, 20, 30, 78]]);
    });

    it("rejects a frame the document does not have", () => {
        const doc = purple();
        for (const frame of ["missing", "", layerId(0)]) {
            expect(() => compositeFrame(doc, frame)).toThrow(RangeError);
        }
        expect(() => compositeFrame(doc, "missing")).toThrow(/no frame "missing"/);
    });

    it("composites some of the layers from a copy of the document with those layers", () => {
        const doc = sprite(1, 1, [
            { pixels: [BLUE] },
            { pixels: [[0, 255, 0, 255]] },
            { pixels: [HALF_RED] },
        ]);

        const pair = { ...doc, layers: [doc.layers[0], doc.layers[2]] };

        expect(pixelsOf(compositeFrame(pair, FRAME))).toEqual([PURPLE]);
    });
});

describe("compositeFrame, damaged documents", () => {
    it("throws when a cel names an image the document does not have", () => {
        const doc = purple();
        doc.images.delete(doc.cels.get(celKey(layerId(1), FRAME))?.imageId ?? "");

        expect(() => compositeFrame(doc, FRAME)).toThrow(/names image/);
    });

    it("throws when a cel's image does not have the document's dimensions", () => {
        const doc = purple();
        const imageId = doc.cels.get(celKey(layerId(1), FRAME))?.imageId ?? "";
        doc.images.set(imageId, createPixelBuffer(3, 4));

        expect(() => compositeFrame(doc, FRAME)).toThrow(/is 3×4 with 48 bytes/);
    });
});

describe("blend functions", () => {
    // An object with every mode as key, so that a mode added to `BlendMode` fails to compile
    // here until it is listed.
    const everyMode: Record<BlendMode, true> = {
        normal: true,
        multiply: true,
        screen: true,
        overlay: true,
        darken: true,
        lighten: true,
        "color-dodge": true,
        "color-burn": true,
        "hard-light": true,
        "soft-light": true,
        difference: true,
        exclusion: true,
        hue: true,
        saturation: true,
        color: true,
        luminosity: true,
        addition: true,
        subtract: true,
        divide: true,
    };
    const modes = Object.keys(everyMode) as BlendMode[];

    it("has a function for each of the 19 modes", () => {
        expect(modes.length).toBe(19);
        expect(Object.keys(BLEND_FUNCTIONS).sort()).toEqual([...modes].sort());
        for (const mode of modes) expect(BLEND_FUNCTIONS[mode]).toBeTypeOf("function");
    });

    it("every mode blends by its own function: Aseprite's, as the SE-061 fixture holds it", () => {
        const layers = [
            {
                pixels: [BLUE, [200, 60, 250, 128], CLEAR, [10, 200, 30, 180]] as Rgba[],
            },
            {
                opacity: 200,
                celOpacity: 90,
                pixels: [HALF_RED, [100, 50, 7, 128], RED, [250, 10, 130, 200]] as Rgba[],
            },
        ];
        // Computed from Aseprite's blend functions for these pixels (SE-061).
        const expectedOf = (mode: BlendMode): PixelBuffer => ({
            width: 4,
            height: 1,
            data: Uint8ClampedArray.from(
                se061Golden.se010.expected[mode]
                    .join(" ")
                    .split(" ")
                    .flatMap((pixel) =>
                        [0, 2, 4, 6].map((at) => Number.parseInt(pixel.slice(at, at + 2), 16)),
                    ),
            ),
        });

        for (const mode of modes) {
            const doc = sprite(4, 1, [
                { ...layers[0], blend: mode },
                { ...layers[1], blend: mode },
            ]);
            expect(firstDifference(compositeFrame(doc, FRAME), expectedOf(mode)), mode).toBeNull();
        }
    });

    it("normal blends `count` pixels from the given offsets and no other", () => {
        // Three pixels each; the middle one is blended.
        const target = Uint8ClampedArray.from([1, 2, 3, 4, 0, 0, 255, 255, 5, 6, 7, 8]);
        const source = Uint8ClampedArray.from([9, 9, 9, 9, 9, 9, 9, 9, 255, 0, 0, 128]);

        BLEND_FUNCTIONS.normal(target, 4, source, 8, 1, 255);

        expect(Array.from(target)).toEqual([1, 2, 3, 4, ...PURPLE, 5, 6, 7, 8]);
        expect(Array.from(source)).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 255, 0, 0, 128]);
    });

    it("normal applies the opacity to the source alpha and does nothing for a count of 0", () => {
        const target = Uint8ClampedArray.from([0, 0, 255, 255, 0, 0, 0, 0]);
        const source = Uint8ClampedArray.from([255, 0, 0, 255, 255, 0, 0, 255]);

        BLEND_FUNCTIONS.normal(target, 0, source, 0, 0, 128);
        expect(Array.from(target)).toEqual([0, 0, 255, 255, 0, 0, 0, 0]);

        // a = mul(255, 128) = 128: as half red over blue, and as half red over nothing.
        BLEND_FUNCTIONS.normal(target, 0, source, 0, 2, 128);
        expect(Array.from(target)).toEqual([...PURPLE, 255, 0, 0, 128]);
    });
});
