import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    CompositeCache,
    DEFAULT_COMPOSITE_CACHE_BUDGET_BYTES,
    compositeFrame,
} from "../../src/core/composite";
import { History, pixelPatchCommand } from "../../src/core/history";
import { celAt, celKey } from "../../src/core/model";
import type { DocSession, PixelBuffer, SpriteDoc, Touched } from "../../src/core/model";
import { clonePixelBuffer } from "../../src/core/pixels";
import {
    FRAME,
    addFrame,
    assertDocument,
    celImage,
    firstDifference,
    layerId,
    pixelsOf,
    setCel,
    sprite,
} from "./se-010-support";
import type { Rgba } from "./se-010-support";

const WIDTH = 4;
const HEIGHT = 2;
/** Bytes of one composite of a `filmstrip` document. */
const FRAME_BYTES = WIDTH * HEIGHT * 4;

function frameId(index: number): string {
    return `frame-${index}`;
}

function fill(pixel: Rgba): Rgba[] {
    return new Array<Rgba>(WIDTH * HEIGHT).fill(pixel);
}

/**
 * A 4×2 document with `count` frames, `frame-0` (which is `FRAME`) to `frame-<count - 1>`,
 * and two layers. Every cel has an image of its own, so every frame composites differently.
 */
function filmstrip(count: number): SpriteDoc {
    const doc = sprite(WIDTH, HEIGHT, [
        { pixels: fill([10, 20, 30, 255]) },
        { pixels: fill([255, 0, 0, 128]) },
    ]);
    for (let index = 1; index < count; index++) {
        addFrame(doc, frameId(index));
        setCel(doc, layerId(0), frameId(index), fill([10 + index * 20, 20, 30, 255]));
        setCel(doc, layerId(1), frameId(index), fill([255, index * 20, 0, 128]));
    }
    assertDocument(doc);
    return doc;
}

function sessionOf(doc: SpriteDoc): DocSession {
    return { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
}

function touchedFrames(...indices: number[]): Touched {
    return { frameIds: indices.map(frameId), layerIds: [], structure: false };
}

/** Which of the first `count` frames the cache keeps. */
function kept(cache: CompositeCache, count: number): number[] {
    return Array.from({ length: count }, (_, index) => index).filter((index) =>
        cache.has(frameId(index)),
    );
}

function expectCurrent(buffer: PixelBuffer, doc: SpriteDoc, frame: string): void {
    expect(firstDifference(buffer, compositeFrame(doc, frame))).toBeNull();
}

describe("CompositeCache, get and invalidate", () => {
    it("returns the composite of the frame", () => {
        const doc = filmstrip(3);
        const cache = new CompositeCache(doc);

        for (const index of [0, 1, 2])
            expectCurrent(cache.get(frameId(index)), doc, frameId(index));
        expect(cache.doc).toBe(doc);
    });

    it("returns the identical buffer object until the frame is invalidated", () => {
        const doc = filmstrip(2);
        const cache = new CompositeCache(doc);

        const first = cache.get(FRAME);
        expect(cache.get(FRAME)).toBe(first);
        cache.get(frameId(1));
        expect(cache.get(FRAME)).toBe(first);

        cache.invalidate(touchedFrames(0));
        const second = cache.get(FRAME);
        expect(second).not.toBe(first);
        expect(second.data.buffer).not.toBe(first.data.buffer);
        expect(cache.get(FRAME)).toBe(second);
    });

    it("returns changed pixels in a new buffer once the frame was invalidated", () => {
        const doc = filmstrip(2);
        const cache = new CompositeCache(doc);
        const old = cache.get(FRAME);
        const snapshot = clonePixelBuffer(old);

        celImage(doc, layerId(1), FRAME).data.set([0, 255, 0, 255], 0);
        cache.invalidate(touchedFrames(0));
        const current = cache.get(FRAME);

        expect(pixelsOf(current)[0]).toEqual([0, 255, 0, 255]);
        expectCurrent(current, doc, FRAME);
        // The buffer handed out before is not rewritten.
        expect(firstDifference(old, snapshot)).toBeNull();
    });

    it("drops only the frames `touched` names", () => {
        const doc = filmstrip(4);
        const cache = new CompositeCache(doc);
        const before = [0, 1, 2, 3].map((index) => cache.get(frameId(index)));

        cache.invalidate(touchedFrames(1, 3));

        expect(kept(cache, 4)).toEqual([0, 2]);
        expect(cache.get(frameId(0))).toBe(before[0]);
        expect(cache.get(frameId(2))).toBe(before[2]);
        expect(cache.get(frameId(1))).not.toBe(before[1]);
        expect(cache.get(frameId(3))).not.toBe(before[3]);
    });

    it("ignores frames that are not kept, are named twice or are not in the document", () => {
        const doc = filmstrip(3);
        const cache = new CompositeCache(doc);
        const first = cache.get(FRAME);

        cache.invalidate(touchedFrames(1, 2, 2, 7));
        cache.invalidate({ frameIds: [], layerIds: [layerId(0)], structure: false });

        expect(cache.get(FRAME)).toBe(first);
        expect(cache.bytes).toBe(FRAME_BYTES);

        cache.invalidate(touchedFrames(0, 0));
        expect(cache.bytes).toBe(0);
    });

    it("drops every composite when `touched.structure` is set", () => {
        const doc = filmstrip(3);
        const cache = new CompositeCache(doc);
        const before = [0, 1, 2].map((index) => cache.get(frameId(index)));

        cache.invalidate({ frameIds: [frameId(1)], layerIds: [], structure: true });

        expect(kept(cache, 3)).toEqual([]);
        expect(cache.bytes).toBe(0);
        for (const index of [0, 1, 2]) expect(cache.get(frameId(index))).not.toBe(before[index]);
    });

    it("clear drops every composite", () => {
        const doc = filmstrip(2);
        const cache = new CompositeCache(doc);
        const first = cache.get(FRAME);
        cache.get(frameId(1));

        cache.clear();

        expect(kept(cache, 2)).toEqual([]);
        expect(cache.bytes).toBe(0);
        expect(cache.get(FRAME)).not.toBe(first);
        expect(cache.bytes).toBe(FRAME_BYTES);
    });

    it("rejects a frame the document does not have and keeps nothing for it", () => {
        const doc = filmstrip(1);
        const cache = new CompositeCache(doc);

        expect(() => cache.get("missing")).toThrow(RangeError);

        expect(cache.has("missing")).toBe(false);
        expect(cache.bytes).toBe(0);
    });
});

describe("CompositeCache, byte budget", () => {
    it("has a default budget of 128 MB", () => {
        expect(DEFAULT_COMPOSITE_CACHE_BUDGET_BYTES).toBe(134_217_728);
        expect(new CompositeCache(filmstrip(1)).budgetBytes).toBe(134_217_728);
        expect(new CompositeCache(filmstrip(1), { budgetBytes: 99 }).budgetBytes).toBe(99);
    });

    it("counts the bytes of the kept buffers exactly", () => {
        const doc = filmstrip(3);
        const cache = new CompositeCache(doc);
        expect(cache.bytes).toBe(0);

        const first = cache.get(FRAME);
        expect(first.data.byteLength).toBe(FRAME_BYTES);
        expect(cache.bytes).toBe(FRAME_BYTES);
        cache.get(FRAME);
        expect(cache.bytes).toBe(FRAME_BYTES);
        cache.get(frameId(1));
        cache.get(frameId(2));
        expect(cache.bytes).toBe(3 * FRAME_BYTES);

        cache.invalidate(touchedFrames(1));
        expect(cache.bytes).toBe(2 * FRAME_BYTES);
        cache.get(frameId(1));
        expect(cache.bytes).toBe(3 * FRAME_BYTES);
    });

    it("drops the least recently used composite when another would exceed the budget", () => {
        const doc = filmstrip(5);
        const cache = new CompositeCache(doc, { budgetBytes: 3 * FRAME_BYTES });

        for (const index of [0, 1, 2]) cache.get(frameId(index));
        expect(kept(cache, 5)).toEqual([0, 1, 2]);
        expect(cache.bytes).toBe(3 * FRAME_BYTES);

        cache.get(frameId(3));
        expect(kept(cache, 5)).toEqual([1, 2, 3]);
        cache.get(frameId(4));
        expect(kept(cache, 5)).toEqual([2, 3, 4]);
        expect(cache.bytes).toBe(3 * FRAME_BYTES);
    });

    it("a `get` of a kept frame makes it the most recently used; `has` does not", () => {
        const doc = filmstrip(5);
        const cache = new CompositeCache(doc, { budgetBytes: 3 * FRAME_BYTES });
        const first = cache.get(frameId(0));
        cache.get(frameId(1));
        cache.get(frameId(2));

        expect(cache.get(frameId(0))).toBe(first);
        expect(cache.has(frameId(1))).toBe(true);
        cache.get(frameId(3));

        // Frame 1 was the least recently used, although `has` asked for it last.
        expect(kept(cache, 5)).toEqual([0, 2, 3]);
        expect(cache.get(frameId(0))).toBe(first);
    });

    it("keeps what fits when the budget is not a whole number of composites", () => {
        const doc = filmstrip(4);
        const cache = new CompositeCache(doc, { budgetBytes: 2 * FRAME_BYTES + FRAME_BYTES - 1 });

        for (const index of [0, 1, 2, 3]) cache.get(frameId(index));

        expect(kept(cache, 4)).toEqual([2, 3]);
        expect(cache.bytes).toBe(2 * FRAME_BYTES);
    });

    it("returns a composite larger than the whole budget without keeping it", () => {
        const doc = filmstrip(2);
        for (const budgetBytes of [0, FRAME_BYTES - 1]) {
            const cache = new CompositeCache(doc, { budgetBytes });

            const first = cache.get(FRAME);
            const second = cache.get(FRAME);

            expectCurrent(first, doc, FRAME);
            expectCurrent(second, doc, FRAME);
            expect(second).not.toBe(first);
            expect(cache.has(FRAME)).toBe(false);
            expect(cache.bytes).toBe(0);
        }
    });

    it("holds exactly one composite with a budget of one", () => {
        const doc = filmstrip(2);
        const cache = new CompositeCache(doc, { budgetBytes: FRAME_BYTES });

        const first = cache.get(FRAME);
        expect(cache.get(FRAME)).toBe(first);
        cache.get(frameId(1));

        expect(kept(cache, 2)).toEqual([1]);
        expect(cache.bytes).toBe(FRAME_BYTES);
    });

    it("rejects a budget that is negative or not a number", () => {
        const doc = filmstrip(1);
        for (const budgetBytes of [-1, Number.NaN, Number.NEGATIVE_INFINITY]) {
            expect(() => new CompositeCache(doc, { budgetBytes })).toThrow(RangeError);
        }
    });

    it("for 200 random call sequences, keeps to the budget and returns no old composite", () => {
        const FRAMES = 6;
        const frame = fc.nat({ max: FRAMES - 1 });
        const steps = fc.array(
            fc.oneof(
                // Composite a frame.
                { weight: 6, arbitrary: fc.record({ kind: fc.constant("get" as const), frame }) },
                // Change the pixels of a frame and report it, as a pixel command does.
                {
                    weight: 3,
                    arbitrary: fc.record({
                        kind: fc.constant("paint" as const),
                        frame,
                        byte: fc.nat({ max: 255 }),
                    }),
                },
                { weight: 1, arbitrary: fc.record({ kind: fc.constant("structure" as const) }) },
            ),
            { minLength: 1, maxLength: 40 },
        );
        let runs = 0;
        fc.assert(
            fc.property(fc.nat({ max: 5 * FRAME_BYTES }), steps, (budgetBytes, sequence) => {
                runs++;
                const doc = filmstrip(FRAMES);
                const cache = new CompositeCache(doc, { budgetBytes });
                const capacity = Math.floor(budgetBytes / FRAME_BYTES);
                /** The frames a correct cache keeps now, least recently used first. */
                let model: number[] = [];

                for (const step of sequence) {
                    if (step.kind === "get") {
                        expectCurrent(cache.get(frameId(step.frame)), doc, frameId(step.frame));
                        model = model.filter((index) => index !== step.frame);
                        if (capacity > 0) model.push(step.frame);
                        if (model.length > capacity) model.shift();
                    } else if (step.kind === "paint") {
                        celImage(doc, layerId(1), frameId(step.frame)).data.fill(step.byte);
                        cache.invalidate(touchedFrames(step.frame));
                        model = model.filter((index) => index !== step.frame);
                    } else {
                        cache.invalidate({ frameIds: [], layerIds: [], structure: true });
                        model = [];
                    }

                    expect(kept(cache, FRAMES)).toEqual([...model].sort((a, b) => a - b));
                    expect(cache.bytes).toBe(model.length * FRAME_BYTES);
                    expect(cache.bytes).toBeLessThanOrEqual(budgetBytes);
                }
            }),
            { numRuns: 200 },
        );
        expect(runs).toBe(200);
    });
});

describe("CompositeCache, changes it sees without `invalidate`", () => {
    const GREEN: Rgba = [0, 255, 0, 200];

    function removeCel(doc: SpriteDoc, layer: string, frame: string): void {
        const cel = celAt(doc, layer, frame);
        if (!cel) throw new Error("removeCel: the cel is empty");
        doc.cels.delete(celKey(layer, frame));
        doc.images.delete(cel.imageId);
    }

    const changes: [string, (doc: SpriteDoc) => void][] = [
        [
            "a layer was hidden",
            (doc) => {
                doc.layers[1].visible = false;
            },
        ],
        [
            "a layer's opacity changed",
            (doc) => {
                doc.layers[1].opacity = 77;
            },
        ],
        [
            "a cel's opacity changed",
            (doc) => {
                const cel = celAt(doc, layerId(1), FRAME);
                if (cel) cel.opacity = 77;
            },
        ],
        ["a cel was removed", (doc) => removeCel(doc, layerId(1), FRAME)],
        [
            "a cel got another image",
            (doc) => {
                setCel(doc, layerId(1), FRAME, fill(GREEN));
            },
        ],
        [
            "a cel was linked to the image of another frame",
            (doc) => {
                const other = celAt(doc, layerId(1), frameId(1));
                removeCel(doc, layerId(1), FRAME);
                if (other) doc.cels.set(celKey(layerId(1), FRAME), { ...other });
            },
        ],
        [
            "the layers were reordered",
            (doc) => {
                doc.layers.reverse();
            },
        ],
        [
            "a layer was added with a cel",
            (doc) => {
                doc.layers.push({ ...doc.layers[1], id: "layer-new" });
                setCel(doc, "layer-new", FRAME, fill(GREEN), 200);
            },
        ],
        [
            "a layer was removed",
            (doc) => {
                removeCel(doc, layerId(1), FRAME);
                removeCel(doc, layerId(1), frameId(1));
                doc.layers.pop();
            },
        ],
        [
            "the document was resized",
            (doc) => {
                doc.width = 2;
                doc.height = 3;
                for (const [imageId, image] of doc.images) {
                    const data = image.data.slice(0, 2 * 3 * 4);
                    doc.images.set(imageId, { width: 2, height: 3, data });
                }
            },
        ],
    ];

    it.each(changes)("returns a new, current composite after %s", (_name, change) => {
        const doc = filmstrip(2);
        const cache = new CompositeCache(doc);
        const old = cache.get(FRAME);
        const snapshot = clonePixelBuffer(old);
        cache.get(frameId(1));

        change(doc);
        assertDocument(doc);
        const current = cache.get(FRAME);

        expect(current).not.toBe(old);
        expect(firstDifference(current, snapshot)).not.toBeNull();
        expectCurrent(current, doc, FRAME);
        expect(firstDifference(old, snapshot)).toBeNull();
        expect(cache.get(FRAME)).toBe(current);

        // The other frame is brought up to date in the same way, and the count stays exact.
        const other = cache.get(frameId(1));
        expectCurrent(other, doc, frameId(1));
        expect(cache.bytes).toBe(current.data.byteLength + other.data.byteLength);
    });

    it("returns a new buffer of the new size when an empty frame's document was resized", () => {
        const doc = sprite(WIDTH, HEIGHT, [{}]);
        const cache = new CompositeCache(doc);
        const old = cache.get(FRAME);

        doc.width = 3;
        doc.height = 5;
        const current = cache.get(FRAME);

        expect([old.width, old.height, old.data.length]).toEqual([WIDTH, HEIGHT, FRAME_BYTES]);
        expect([current.width, current.height, current.data.length]).toEqual([3, 5, 60]);
        expect(cache.bytes).toBe(60);
    });

    it("keeps the buffer through changes that do not show in the frame", () => {
        const doc = filmstrip(3);
        doc.layers.push({ ...doc.layers[1], id: "layer-hidden", visible: false });
        setCel(doc, "layer-hidden", FRAME, fill(GREEN));
        const cache = new CompositeCache(doc);
        const first = cache.get(FRAME);

        doc.name = "renamed";
        doc.pivot = { x: 0, y: 1 };
        doc.layers[0].name = "Background";
        doc.layers[0].locked = true;
        doc.layers[2].opacity = 10;
        celImage(doc, "layer-hidden", FRAME).data.fill(9);
        doc.frames[0].durationMs = 500;
        doc.settings.onion.enabled = true;
        doc.settings.tiled = "both";
        doc.settings.symmetry.mode = "x";
        doc.tags.push({
            id: "tag",
            name: "Walk",
            color: 0xff0000ff,
            fromFrameId: FRAME,
            toFrameId: frameId(2),
            direction: "forward",
            repeat: 0,
        });
        const other = celAt(doc, layerId(1), frameId(1));
        if (other) other.opacity = 3;
        assertDocument(doc);

        expect(cache.get(FRAME)).toBe(first);
        expectCurrent(first, doc, FRAME);
    });
});

describe("CompositeCache with a history", () => {
    const WHITE = { width: 1, height: 1, data: new Uint8ClampedArray(4).fill(255) };

    it("follows commands, undo and redo through the `touched` the history reports", () => {
        const doc = filmstrip(3);
        // The bottom cels of frames 0 and 1 are linked: one image shows in both frames.
        const linked = celAt(doc, layerId(0), FRAME)?.imageId ?? "";
        doc.images.delete(celAt(doc, layerId(0), frameId(1))?.imageId ?? "");
        doc.cels.set(celKey(layerId(0), frameId(1)), { imageId: linked, opacity: 255 });
        doc.layers[1].visible = false;
        assertDocument(doc);
        const history = new History(sessionOf(doc));
        const cache = new CompositeCache(doc);
        history.subscribe((change) => cache.invalidate(change.touched));
        const before = [0, 1, 2].map((index) => cache.get(frameId(index)));
        const snapshots = before.map(clonePixelBuffer);

        history.execute(
            pixelPatchCommand(doc, { label: "Dot", imageId: linked, x: 0, y: 0, pixels: WHITE }),
        );

        const after = [0, 1, 2].map((index) => cache.get(frameId(index)));
        expect(after[0]).not.toBe(before[0]);
        expect(after[1]).not.toBe(before[1]);
        expect(after[2]).toBe(before[2]);
        for (const index of [0, 1]) {
            expect(pixelsOf(after[index])[0]).toEqual([255, 255, 255, 255]);
            expectCurrent(after[index], doc, frameId(index));
            expect(firstDifference(before[index], snapshots[index])).toBeNull();
        }

        expect(history.undo()).toBe(true);
        const undone = [0, 1, 2].map((index) => cache.get(frameId(index)));
        expect(undone[0]).not.toBe(after[0]);
        expect(undone[1]).not.toBe(after[1]);
        expect(undone[2]).toBe(before[2]);
        for (const index of [0, 1]) {
            expect(firstDifference(undone[index], snapshots[index])).toBeNull();
        }

        expect(history.redo()).toBe(true);
        for (const index of [0, 1]) {
            expect(firstDifference(cache.get(frameId(index)), after[index])).toBeNull();
        }
    });

    it("shows a committed stroke on an empty cel", () => {
        const doc = sprite(2, 1, [
            {
                pixels: [
                    [0, 0, 255, 255],
                    [0, 0, 255, 255],
                ],
            },
            {},
        ]);
        const history = new History(sessionOf(doc));
        const cache = new CompositeCache(doc);
        history.subscribe((change) => cache.invalidate(change.touched));
        const before = cache.get(FRAME);

        const stroke = history.begin({ layerId: layerId(1), frameId: FRAME }, () => "stroke");
        stroke.image.data.set([255, 0, 0, 128], 4);
        stroke.markDirty({ x: 1, y: 0, width: 1, height: 1 });
        expect(stroke.commit("Pencil")).not.toBeNull();

        const after = cache.get(FRAME);
        expect(after).not.toBe(before);
        // Half red over blue (hand-computed in se-010-golden.test.ts).
        expect(pixelsOf(after)).toEqual([
            [0, 0, 255, 255],
            [128, 0, 127, 255],
        ]);
    });

    it("shows pixels written outside a command once their frames are reported", () => {
        const doc = sprite(2, 1, [
            {
                pixels: [
                    [0, 0, 255, 255],
                    [0, 0, 255, 255],
                ],
            },
        ]);
        const history = new History(sessionOf(doc));
        const cache = new CompositeCache(doc);
        history.subscribe((change) => cache.invalidate(change.touched));
        const clean = cache.get(FRAME);
        const touched = { frameIds: [FRAME], layerIds: [layerId(0)], structure: false };

        // An open transaction writes into the cel's image: no command, so no report yet.
        const stroke = history.begin({ layerId: layerId(0), frameId: FRAME });
        stroke.image.data.set([255, 0, 0, 255], 0);
        stroke.markDirty({ x: 0, y: 0, width: 1, height: 1 });
        expect(cache.get(FRAME)).toBe(clean);

        cache.invalidate(touched);
        const live = cache.get(FRAME);
        expect(pixelsOf(live)[0]).toEqual([255, 0, 0, 255]);

        // The abort puts the pixels back, again without a command.
        stroke.abort();
        cache.invalidate(touched);
        const restored = cache.get(FRAME);
        expect(restored).not.toBe(live);
        expect(pixelsOf(restored)).toEqual(pixelsOf(clean));
        expect(pixelsOf(clean)[0]).toEqual([0, 0, 255, 255]);
    });
});
