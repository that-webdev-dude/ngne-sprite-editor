import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { setCelOpacityCommand } from "../../src/core/cels";
import {
    BLEND_FUNCTIONS,
    CompositeCache,
    compositeFrame,
    layerStack,
    sameStack,
} from "../../src/core/composite";
import { History } from "../../src/core/history";
import { flattenCommand, mergeDownCommand, setLayerBlendModeCommand } from "../../src/core/layers";
import { celAt, frameIndex, sequentialIds } from "../../src/core/model";
import type { BlendMode, DocSession, PixelBuffer, Rect, SpriteDoc } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";
import {
    FRAME,
    addFrame,
    firstDifference,
    layerId,
    setCel,
    sprite,
    sprites,
} from "./se-010-support";
import type { LayerSpec, RandomSprite } from "./se-010-support";

// SE-061: blend modes and cel opacity in the compositor (SPEC §5.1 `BlendMode`, §5.3).

// --- golden composites -----------------------------------------------------------------------

/**
 * Expected composites computed from Aseprite's published blend functions by
 * `fixtures/se-061-blend-golden.generate.mjs` (a transcription of its C source, independent of
 * `src/core/composite`), stored as a fixture. Pixels "rrggbbaa", one string per row.
 */
interface GoldenFixture {
    width: number;
    height: number;
    backdrop: string[];
    source: string[];
    cases: { mode: BlendMode; opacity: number; celOpacity: number; expected: string[] }[];
    se010: { lower: string[]; upper: string[]; expected: Record<BlendMode, string[]> };
}

const golden = JSON.parse(
    readFileSync(new URL("./fixtures/se-061-blend-golden.json", import.meta.url), "utf8"),
) as GoldenFixture;

const MODES = Object.keys(BLEND_FUNCTIONS) as BlendMode[];

/** Rows of "rrggbbaa" pixels as RGBA bytes. */
function bytesOf(rows: readonly string[]): Uint8ClampedArray {
    const hex = rows.flatMap((row) => row.split(" "));
    return Uint8ClampedArray.from(
        hex.flatMap((pixel) =>
            [0, 2, 4, 6].map((at) => Number.parseInt(pixel.slice(at, at + 2), 16)),
        ),
    );
}

function bufferOf(width: number, height: number, rows: readonly string[]): PixelBuffer {
    return { width, height, data: bytesOf(rows) };
}

describe("golden composites of every blend mode", () => {
    it("the fixture has three cases of each mode, and the 4×4 matrices hold transparent, half-transparent and opaque pixels", () => {
        expect(golden.cases.map((entry) => entry.mode).sort()).toEqual(
            MODES.flatMap((mode) => [mode, mode, mode]).sort(),
        );
        for (const rows of [golden.backdrop, golden.source]) {
            const alphas = Array.from(bytesOf(rows).filter((_, at) => at % 4 === 3));
            expect(alphas).toHaveLength(16);
            expect(alphas).toEqual(expect.arrayContaining([0, 128, 255]));
            expect(alphas.some((alpha) => alpha > 0 && alpha < 255 && alpha !== 128)).toBe(true);
        }
        // Each mode other than normal gives another composite than normal over these pixels.
        const normal = golden.cases.find((entry) => entry.mode === "normal")!.expected.join();
        for (const mode of MODES.filter((entry) => entry !== "normal")) {
            const own = golden.cases.find((entry) => entry.mode === mode)!.expected.join();
            expect(own, mode).not.toBe(normal);
        }
    });

    it.each(MODES)(
        "%s: the source layer over the backdrop at layer × cel opacity 255 × 255, 255 × 128 and 200 × 90",
        (mode) => {
            const { width, height } = golden;
            for (const entry of golden.cases.filter((candidate) => candidate.mode === mode)) {
                const doc = sprite(width, height, [
                    { pixels: bytesOf(golden.backdrop) },
                    {
                        pixels: bytesOf(golden.source),
                        blend: mode,
                        opacity: entry.opacity,
                        celOpacity: entry.celOpacity,
                    },
                ]);
                const expected = bufferOf(width, height, entry.expected);
                expect(
                    firstDifference(compositeFrame(doc, FRAME), expected),
                    `${mode} ${entry.opacity} × ${entry.celOpacity}`,
                ).toBeNull();
            }
        },
    );

    it("cel opacity scales the source as layer opacity does: their product is what counts", () => {
        const { width, height } = golden;
        for (const mode of MODES) {
            const doc = (opacity: number, celOpacity: number) =>
                sprite(width, height, [
                    { pixels: bytesOf(golden.backdrop) },
                    { pixels: bytesOf(golden.source), blend: mode, opacity, celOpacity },
                ]);
            const expected = compositeFrame(doc(255, 128), FRAME);
            expect(
                firstDifference(compositeFrame(doc(128, 255), FRAME), expected),
                mode,
            ).toBeNull();
        }
    });
});

// --- normal at 255: the compositor before SE-061 ---------------------------------------------

/**
 * The compositor as it was before SE-061 (`core/composite`, commit 8e014a2), kept here only:
 * `layerStack` with every mode blending as normal, `blendStack` and the normal blend.
 */
function preTicketComposite(doc: SpriteDoc, frameId: string, rect?: Rect, into?: PixelBuffer) {
    const mul = (a: number, b: number) => {
        const t = a * b + 128;
        return ((t >> 8) + t) >> 8;
    };
    const blend = (
        target: Uint8ClampedArray,
        targetAt: number,
        source: Uint8ClampedArray,
        sourceAt: number,
        count: number,
        opacity: number,
    ) => {
        const end = targetAt + count * 4;
        for (let t = targetAt, s = sourceAt; t < end; t += 4, s += 4) {
            const alpha = mul(source[s + 3], opacity);
            if (alpha === 0) continue;
            const backdropAlpha = target[t + 3];
            if (backdropAlpha === 0 || alpha === 255) {
                target[t] = source[s];
                target[t + 1] = source[s + 1];
                target[t + 2] = source[s + 2];
                target[t + 3] = alpha;
                continue;
            }
            const resultAlpha = alpha + backdropAlpha - mul(backdropAlpha, alpha);
            const red = target[t];
            const green = target[t + 1];
            const blue = target[t + 2];
            target[t] = red + ((((source[s] - red) * alpha) / resultAlpha) | 0);
            target[t + 1] = green + ((((source[s + 1] - green) * alpha) / resultAlpha) | 0);
            target[t + 2] = blue + ((((source[s + 2] - blue) * alpha) / resultAlpha) | 0);
            target[t + 3] = resultAlpha;
        }
    };
    const layers: { data: Uint8ClampedArray; opacity: number }[] = [];
    for (const layer of doc.layers) {
        if (layer.kind !== "pixel" || !layer.visible) continue;
        const cel = celAt(doc, layer.id, frameId);
        const image = cel && doc.images.get(cel.imageId);
        if (!image) continue;
        const opacity = mul(layer.opacity, cel ? cel.opacity : 255);
        if (opacity === 0) continue;
        layers.push({ data: image.data, opacity });
    }
    const area = rect ?? { x: 0, y: 0, width: doc.width, height: doc.height };
    const out = into ?? createPixelBuffer(doc.width, doc.height);
    const rowBytes = doc.width * 4;
    const first = area.y * rowBytes + area.x * 4;
    const end = first + area.height * rowBytes;
    if (into) {
        for (let row = first; row < end; row += rowBytes) {
            out.data.fill(0, row, row + area.width * 4);
        }
    }
    for (const { data, opacity } of layers) {
        for (let row = first; row < end; row += rowBytes) {
            blend(out.data, row, data, row, area.width, opacity);
        }
    }
    return out;
}

/** The SE-010 random documents with every cel at opacity 255 (layers are normal there). */
const normalAt255: fc.Arbitrary<RandomSprite> = sprites.map((random) => ({
    ...random,
    layers: random.layers.map((layer) => ({ ...layer, celOpacity: 255 })),
}));

describe("every layer normal and every cel at 255", () => {
    it("compositeFrame is byte-identical to the compositor before SE-061 on the SE-010 regression documents", () => {
        fc.assert(
            fc.property(normalAt255, (random) => {
                const doc = sprite(random.width, random.height, random.layers);
                expect(
                    doc.layers.every((layer) => layer.kind === "pixel" && layer.blend === "normal"),
                ).toBe(true);
                expect(
                    firstDifference(compositeFrame(doc, FRAME), preTicketComposite(doc, FRAME)),
                ).toBeNull();
            }),
            { numRuns: 400 },
        );
    });

    it("and a dirty rectangle written into a composite is byte-identical too", () => {
        fc.assert(
            fc.property(
                normalAt255,
                fc.nat(),
                fc.nat(),
                fc.nat(),
                fc.nat(),
                (random, x, y, w, h) => {
                    const doc = sprite(random.width, random.height, random.layers);
                    const rect = {
                        x: x % random.width,
                        y: y % random.height,
                        width: 1 + (w % (random.width - (x % random.width))),
                        height: 1 + (h % (random.height - (y % random.height))),
                    };
                    // A stale buffer: the rectangle is brought up to date, the rest kept.
                    const stale = () => {
                        const buffer = createPixelBuffer(doc.width, doc.height);
                        buffer.data.fill(77);
                        return buffer;
                    };
                    const actual = compositeFrame(doc, FRAME, { rect, into: stale() });
                    const expected = preTicketComposite(doc, FRAME, rect, stale());
                    expect(firstDifference(actual, expected)).toBeNull();
                },
            ),
            { numRuns: 300 },
        );
    });

    it("so the 255 × 255 golden case of normal is the pre-SE-061 composite as well", () => {
        const { width, height } = golden;
        const doc = sprite(width, height, [
            { pixels: bytesOf(golden.backdrop) },
            { pixels: bytesOf(golden.source) },
        ]);
        const entry = golden.cases.find(
            (candidate) =>
                candidate.mode === "normal" &&
                candidate.opacity === 255 &&
                candidate.celOpacity === 255,
        )!;
        expect(
            firstDifference(
                preTicketComposite(doc, FRAME),
                bufferOf(width, height, entry.expected),
            ),
        ).toBeNull();
    });
});

// --- one compositor for every path -----------------------------------------------------------

/** The SE-010 random documents with a random blend mode on each layer. */
const blendedSprites: fc.Arbitrary<RandomSprite> = sprites.chain((random) =>
    fc
        .array(fc.constantFrom(...MODES), {
            minLength: random.layers.length,
            maxLength: random.layers.length,
        })
        .map((modes) => ({
            ...random,
            layers: random.layers.map((layer, index): LayerSpec => ({
                ...layer,
                blend: modes[index],
            })),
        })),
);

describe("blend modes through every path of the compositor", () => {
    it("a dirty rectangle brought up to date equals the whole composite, in any mix of modes", () => {
        fc.assert(
            fc.property(blendedSprites, fc.nat(), fc.nat(), (random, x, y) => {
                const doc = sprite(random.width, random.height, random.layers);
                const whole = compositeFrame(doc, FRAME);
                const into = createPixelBuffer(doc.width, doc.height);
                into.data.set(whole.data);
                // Garbage in the rectangle; bringing it up to date restores the composite.
                const rect = {
                    x: x % doc.width,
                    y: y % doc.height,
                    width: doc.width - (x % doc.width),
                    height: doc.height - (y % doc.height),
                };
                for (let row = rect.y; row < rect.y + rect.height; row++) {
                    const at = (row * doc.width + rect.x) * 4;
                    into.data.fill(201, at, at + rect.width * 4);
                }
                compositeFrame(doc, FRAME, { rect, into });
                expect(firstDifference(into, whole)).toBeNull();
            }),
            { numRuns: 300 },
        );
    });

    it("a mode never adds colour under alpha 0, and a hidden layer or a cel at opacity 0 adds nothing", () => {
        fc.assert(
            fc.property(blendedSprites, (random) => {
                const doc = sprite(random.width, random.height, random.layers);
                const result = compositeFrame(doc, FRAME);
                for (let at = 0; at < result.data.length; at += 4) {
                    if (result.data[at + 3] === 0) {
                        expect(Array.from(result.data.subarray(at, at + 4))).toEqual([0, 0, 0, 0]);
                    }
                }
                const contributing = random.layers.filter(
                    (layer) =>
                        layer.visible !== false &&
                        layer.pixels !== undefined &&
                        layer.opacity !== 0 &&
                        layer.celOpacity !== 0,
                );
                if (contributing.length > 0) {
                    const without = sprite(random.width, random.height, contributing);
                    expect(firstDifference(compositeFrame(without, FRAME), result)).toBeNull();
                }
            }),
            { numRuns: 200 },
        );
    });

    it("a live stroke's image (an override) blends by its layer's mode and cel opacity, as the cel's image would", () => {
        fc.assert(
            fc.property(
                blendedSprites.filter((random) => random.layers.some((layer) => layer.pixels)),
                fc.nat(),
                (random, pick) => {
                    const doc = sprite(random.width, random.height, random.layers);
                    const index = random.layers.findIndex(
                        (layer, at) => layer.pixels && at >= pick % random.layers.length,
                    );
                    const target = index === -1 ? random.layers.findIndex((l) => l.pixels) : index;
                    // The stroke's image: the cel's pixels, inverted, held outside the document.
                    const stroke = createPixelBuffer(doc.width, doc.height);
                    const cel = celAt(doc, layerId(target), FRAME)!;
                    const original = doc.images.get(cel.imageId)!;
                    stroke.data.set(
                        original.data.map((value, at) => (at % 4 === 3 ? value : 255 - value)),
                    );
                    const live = compositeFrame(doc, FRAME, {
                        overrides: [{ layerId: layerId(target), image: stroke }],
                    });
                    original.data.set(stroke.data);
                    expect(firstDifference(live, compositeFrame(doc, FRAME))).toBeNull();
                },
            ),
            { numRuns: 200 },
        );
    });

    it("the layer stack tells the modes apart: the composite cache and the preview see a change of mode", () => {
        const doc = sprite(2, 1, [
            {
                pixels: [
                    [10, 20, 30, 255],
                    [40, 50, 60, 255],
                ],
            },
            {
                pixels: [
                    [200, 100, 50, 255],
                    [7, 8, 9, 128],
                ],
            },
        ]);
        const before = layerStack(doc, FRAME);
        const upper = doc.layers[1];
        if (upper.kind !== "pixel") throw new Error("a pixel layer");
        for (const mode of MODES.filter((entry) => entry !== "normal")) {
            upper.blend = mode;
            expect(sameStack(before, layerStack(doc, FRAME)), mode).toBe(false);
        }
        upper.blend = "normal";
        expect(sameStack(before, layerStack(doc, FRAME))).toBe(true);
    });
});

// --- commands --------------------------------------------------------------------------------

function sessionOf(doc: SpriteDoc): DocSession {
    return { doc, selection: null, activeLayerId: doc.layers[1].id, activeFrameId: FRAME };
}

/** Two layers with translucent and opaque pixels at `FRAME` and at a second frame. */
function twoLayers(upper: Partial<LayerSpec> = {}): SpriteDoc {
    const lower: LayerSpec = {
        pixels: [
            [200, 60, 250, 128],
            [10, 200, 30, 255],
            [0, 0, 0, 0],
            [90, 90, 90, 255],
        ],
        opacity: 230,
        celOpacity: 200,
    };
    const doc = sprite(2, 2, [
        lower,
        {
            pixels: [
                [100, 50, 7, 255],
                [250, 10, 130, 200],
                [255, 0, 0, 128],
                [0, 0, 0, 0],
            ],
            opacity: 180,
            celOpacity: 150,
            ...upper,
        },
    ]);
    addFrame(doc, "frame-1");
    setCel(doc, layerId(0), "frame-1", [
        [1, 2, 3, 255],
        [4, 5, 6, 64],
        [7, 8, 9, 255],
        [10, 11, 12, 0],
    ]);
    setCel(
        doc,
        layerId(1),
        "frame-1",
        [
            [250, 250, 250, 255],
            [128, 128, 128, 255],
            [0, 0, 0, 255],
            [60, 70, 80, 90],
        ],
        77,
    );
    return doc;
}

describe("commands that change a mode or a cel opacity", () => {
    it("merge down of a multiply layer equals compositeFrame of the two layers, pixel for pixel, at every frame", () => {
        const doc = twoLayers({ blend: "multiply" });
        // A layer below that is not merged: the target's image is the two layers alone.
        const expected = doc.frames.map((frame) => compositeFrame(doc, frame.id));
        const session = sessionOf(doc);
        const history = new History(session);

        history.execute(mergeDownCommand(session, layerId(1), { newId: sequentialIds("merged") }));

        expect(doc.layers).toHaveLength(1);
        expect(doc.layers[0]).toMatchObject({ id: layerId(0), blend: "normal", opacity: 255 });
        doc.frames.forEach((frame, index) => {
            const cel = celAt(doc, layerId(0), frame.id);
            expect(cel?.opacity).toBe(255);
            const image = doc.images.get(cel?.imageId ?? "")!;
            expect(firstDifference(image, expected[index]), frame.id).toBeNull();
            expect(firstDifference(compositeFrame(doc, frame.id), expected[index])).toBeNull();
        });
        expect(history.undo()).toBe(true);
        expect(doc.layers[1]).toMatchObject({ blend: "multiply", opacity: 180 });
    });

    it("merge down of a layer in any mode over a layer in any mode bakes what compositeFrame shows", () => {
        for (const lowerMode of ["normal", "screen"] as const) {
            for (const mode of MODES) {
                const doc = twoLayers({ blend: mode });
                const lower = doc.layers[0];
                if (lower.kind === "pixel") lower.blend = lowerMode;
                const expected = doc.frames.map((frame) => compositeFrame(doc, frame.id));
                const session = sessionOf(doc);
                new History(session).execute(
                    mergeDownCommand(session, layerId(1), { newId: sequentialIds("merged") }),
                );
                doc.frames.forEach((frame, index) => {
                    expect(
                        firstDifference(compositeFrame(doc, frame.id), expected[index]),
                        `${lowerMode} under ${mode} at ${frame.id}`,
                    ).toBeNull();
                });
            }
        }
    });

    it("flatten keeps every frame's composite byte-identical in any mix of modes and cel opacities", () => {
        fc.assert(
            fc.property(blendedSprites, (random) => {
                const doc = sprite(random.width, random.height, random.layers);
                const before = compositeFrame(doc, FRAME);
                const session = {
                    doc,
                    selection: null,
                    activeLayerId: doc.layers[0].id,
                    activeFrameId: FRAME,
                };
                const command = flattenCommand(session, { newId: sequentialIds("flat") });
                if (command) new History(session).execute(command);
                expect(firstDifference(compositeFrame(doc, FRAME), before)).toBeNull();
            }),
            { numRuns: 150 },
        );
    });

    it("a blend mode change and a cel opacity change reach the composite cache through `touched`, and undo restores the composite", () => {
        const doc = twoLayers();
        const session = sessionOf(doc);
        const history = new History(session);
        const cache = new CompositeCache(doc);
        const shown = () => doc.frames.map((frame) => Array.from(cache.get(frame.id).data));
        const fresh = () =>
            doc.frames.map((frame) => Array.from(compositeFrame(doc, frame.id).data));
        history.subscribe((change) => cache.invalidate(change.touched));
        const original = shown();

        history.execute(setLayerBlendModeCommand(session, layerId(1), "difference")!);
        expect(shown()).toEqual(fresh());
        expect(shown()[0]).not.toEqual(original[0]);
        expect(shown()[1]).not.toEqual(original[1]);
        const blended = shown();

        history.execute(
            setCelOpacityCommand(doc, { layerIds: [layerId(1)], frameIds: ["frame-1"] }, 255)!,
        );
        expect(shown()).toEqual(fresh());
        // Only the cel's frame changed.
        expect(shown()[0]).toEqual(blended[0]);
        expect(shown()[1]).not.toEqual(blended[1]);

        expect(history.undo()).toBe(true);
        expect(shown()).toEqual(blended);
        expect(history.undo()).toBe(true);
        expect(shown()).toEqual(original);
        expect(frameIndex(doc, "frame-1")).toBe(1);
    });
});
