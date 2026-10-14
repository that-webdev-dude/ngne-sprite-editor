import { describe, expect, it } from "vitest";
import { CompositeCache, compositeFrame, compositeOrigin } from "../../src/core/composite";
import { createPixelBuffer } from "../../src/core/pixels";
import type { Rgba } from "./se-010-support";
import {
    FRAME,
    addFrame,
    celImage,
    firstDifference,
    layerId,
    setCel,
    sprite,
} from "./se-010-support";

// SE-014: `CompositeCache.adopt` (REVIEW.md D6). A composite made outside the cache — the live
// composite of a stroke — is kept as the frame's composite only when the frame's layer stack is
// the one it was composited from, so that a stroke's end does not composite the frame again.

const WIDTH = 4;
const HEIGHT = 3;

function fill(pixel: Rgba): Rgba[] {
    return new Array<Rgba>(WIDTH * HEIGHT).fill(pixel);
}

/** Three layers at `FRAME`: opaque, half-transparent and a quarter-opacity layer on top. */
function stack() {
    return sprite(WIDTH, HEIGHT, [
        { pixels: fill([10, 20, 30, 255]) },
        { pixels: fill([200, 0, 0, 128]), opacity: 200 },
        { pixels: fill([0, 0, 250, 255]), opacity: 64, celOpacity: 128 },
    ]);
}

describe("compositeOrigin", () => {
    it("names the stack a whole composite was made from, and none for a part of one", () => {
        const doc = stack();
        const whole = compositeFrame(doc, FRAME);
        expect(compositeOrigin(whole)?.layers).toHaveLength(3);
        const part = compositeFrame(doc, FRAME, { rect: { x: 1, y: 1, width: 2, height: 1 } });
        expect(compositeOrigin(part)).toBeNull();
        expect(compositeOrigin(createPixelBuffer(WIDTH, HEIGHT))).toBeNull();
    });

    it("keeps the origin when a rectangle is brought up to date from the same stack", () => {
        const doc = stack();
        const live = compositeFrame(doc, FRAME);
        const origin = compositeOrigin(live);
        celImage(doc, layerId(1), FRAME).data.fill(77, 0, 8);
        compositeFrame(doc, FRAME, { rect: { x: 0, y: 0, width: 2, height: 1 }, into: live });
        expect(compositeOrigin(live)).toBe(origin);
    });

    it("drops it when a rectangle is composited from another stack", () => {
        const doc = stack();
        const live = compositeFrame(doc, FRAME);
        doc.layers[2]!.visible = false;
        compositeFrame(doc, FRAME, { rect: { x: 0, y: 0, width: 1, height: 1 }, into: live });
        expect(compositeOrigin(live)).toBeNull();
        // A whole composite from the new stack gives it an origin again.
        compositeFrame(doc, FRAME, { into: live });
        expect(compositeOrigin(live)?.layers).toHaveLength(2);
    });
});

describe("CompositeCache.adopt", () => {
    it("keeps a composite of the frame's stack and returns it without compositing again", () => {
        const doc = stack();
        const cache = new CompositeCache(doc);
        const old = cache.get(FRAME);
        const live = compositeFrame(doc, FRAME);
        expect(cache.adopt(FRAME, live)).toBe(true);
        expect(cache.has(FRAME)).toBe(true);
        // A composite of the cache's own would be a new buffer: this is the adopted one.
        expect(cache.get(FRAME)).toBe(live);
        expect(cache.get(FRAME)).not.toBe(old);
        expect(cache.bytes).toBe(WIDTH * HEIGHT * 4);
        expect(firstDifference(cache.get(FRAME), compositeFrame(doc, FRAME))).toBeNull();
    });

    it("keeps a composite made with an override that is the cel's own image", () => {
        const doc = stack();
        const cache = new CompositeCache(doc);
        const image = celImage(doc, layerId(1), FRAME);
        const live = compositeFrame(doc, FRAME, { overrides: [{ layerId: layerId(1), image }] });
        expect(cache.adopt(FRAME, live)).toBe(true);
        expect(cache.get(FRAME)).toBe(live);
    });

    it("refuses a composite of another stack and leaves the kept one", () => {
        const doc = stack();
        const cache = new CompositeCache(doc);
        const kept = cache.get(FRAME);
        // Another image in place of a cel's (a floating selection, a stroke on an empty cel).
        const other = createPixelBuffer(WIDTH, HEIGHT, 0xff00ff80);
        const floating = compositeFrame(doc, FRAME, {
            overrides: [{ layerId: layerId(1), image: other }],
        });
        expect(cache.adopt(FRAME, floating)).toBe(false);
        expect(cache.get(FRAME)).toBe(kept);

        // The stack changed after the composite was made.
        const before = compositeFrame(doc, FRAME);
        doc.layers[1]!.opacity = 10;
        expect(cache.adopt(FRAME, before)).toBe(false);
        const after = compositeFrame(doc, FRAME);
        expect(cache.adopt(FRAME, after)).toBe(true);
        expect(cache.get(FRAME)).toBe(after);
    });

    it("refuses a buffer it cannot tell the origin of", () => {
        const doc = stack();
        const cache = new CompositeCache(doc);
        const copy = { ...compositeFrame(doc, FRAME) };
        copy.data = copy.data.slice();
        expect(cache.adopt(FRAME, copy)).toBe(false);
        const part = compositeFrame(doc, FRAME, { rect: { x: 0, y: 0, width: 1, height: 1 } });
        expect(cache.adopt(FRAME, part)).toBe(false);
        expect(cache.has(FRAME)).toBe(false);
    });

    it("refuses a composite of a frame other than its own, and an unknown frame", () => {
        const doc = stack();
        addFrame(doc, "frame-1");
        setCel(doc, layerId(0), "frame-1", fill([1, 2, 3, 255]));
        const cache = new CompositeCache(doc);
        expect(cache.adopt("frame-1", compositeFrame(doc, FRAME))).toBe(false);
        expect(() => cache.adopt("missing", compositeFrame(doc, FRAME))).toThrow(RangeError);
    });

    it("respects the byte budget: a buffer larger than the budget is refused", () => {
        const doc = stack();
        const small = new CompositeCache(doc, { budgetBytes: WIDTH * HEIGHT * 4 - 1 });
        expect(small.adopt(FRAME, compositeFrame(doc, FRAME))).toBe(false);
        expect(small.bytes).toBe(0);

        addFrame(doc, "frame-1");
        setCel(doc, layerId(0), "frame-1", fill([1, 2, 3, 255]));
        const one = new CompositeCache(doc, { budgetBytes: WIDTH * HEIGHT * 4 });
        const first = one.get("frame-1");
        expect(one.adopt(FRAME, compositeFrame(doc, FRAME))).toBe(true);
        // The least recently used composite made room.
        expect(one.has("frame-1")).toBe(false);
        expect(one.bytes).toBe(WIDTH * HEIGHT * 4);
        expect(one.get("frame-1")).not.toBe(first);
    });

    it("is dropped by `invalidate` like any kept composite", () => {
        const doc = stack();
        const cache = new CompositeCache(doc);
        const live = compositeFrame(doc, FRAME);
        cache.adopt(FRAME, live);
        cache.invalidate({ frameIds: [FRAME], layerIds: [], structure: false });
        expect(cache.has(FRAME)).toBe(false);
        expect(cache.get(FRAME)).not.toBe(live);
    });
});
