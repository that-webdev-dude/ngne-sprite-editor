import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import {
    GIF_ALPHA_THRESHOLD,
    MAX_GIF_SCALE,
    MIN_GIF_DELAY_MS,
    gifDelayMs,
    gifFile,
    gifFileName,
    gifFrameImage,
    gifLoopCount,
    gifSequence,
} from "../../src/core/gif";
import { buildPalette } from "../../src/core/import";
import type { PixelBuffer, SpriteDoc } from "../../src/core/model";
import {
    FOUR_FRAME_DELAYS,
    FOUR_FRAME_DURATIONS,
    fourFrames,
    manyColours,
} from "../e2e/se-063-documents";
import { blocks, decodeGif, expectedImage, renderGif } from "./se-063-support";

// SE-063: the GIF export of `core/gif` (SPEC §9.6), read back with a decoder of the tests'
// own: frames, delays, loop count, colour tables, transparency and the exact colours shown.

const tagId = (doc: SpriteDoc, name: string) => doc.tags.find((tag) => tag.name === name)!.id;

/** The images the GIF shows, and what the document's frames `frameIndices` should show. */
function shownAndExpected(doc: SpriteDoc, bytes: Uint8Array, frameIndices: number[]) {
    const shown = renderGif(decodeGif(bytes));
    const expected = frameIndices.map((index) => expectedImage(doc, doc.frames[index]!.id));
    return { shown, expected };
}

function sameImages(actual: Uint8ClampedArray[], expected: Uint8ClampedArray[]): void {
    expect(actual.length).toBe(expected.length);
    actual.forEach((image, index) => {
        expect(Buffer.from(image).equals(Buffer.from(expected[index]!)), `frame ${index}`).toBe(
            true,
        );
    });
}

describe("delays and loop counts", () => {
    it("round durations to 10 ms, at least 20 ms", () => {
        expect(MIN_GIF_DELAY_MS).toBe(20);
        const cases: [number, number][] = [
            [1, 20],
            [14, 20],
            [15, 20],
            [24, 20],
            [25, 30],
            [84, 80],
            [100, 100],
            [155, 160],
            [65535, 65540],
        ];
        for (const [ms, delay] of cases) expect(gifDelayMs(ms), `${ms} ms`).toBe(delay);
    });

    it("loop without end for 0 plays; write no loop block for one; repeat n - 1 times for n", () => {
        expect(gifLoopCount(0)).toBe(0);
        expect(gifLoopCount(1)).toBe(-1);
        expect(gifLoopCount(2)).toBe(1);
        expect(gifLoopCount(255)).toBe(254);
    });
});

describe("gifSequence", () => {
    it("is every frame forward for all frames, looping without end", () => {
        const doc = fourFrames();
        expect(gifSequence(doc, "all")).toEqual({
            entries: doc.frames.map((frame) => ({ frameId: frame.id, ms: frame.durationMs })),
            plays: 0,
        });
    });

    it("is one pass of a tag (expandTag), playing as often as the tag repeats", () => {
        const doc = fourFrames();
        const ids = (name: string) =>
            gifSequence(doc, { tagId: tagId(doc, name) }).entries.map((entry) => entry.frameId);
        expect(ids("Bounce")).toEqual([
            "frame-0",
            "frame-1",
            "frame-2",
            "frame-3",
            "frame-2",
            "frame-1",
        ]);
        expect(ids("Twice")).toEqual(["frame-2", "frame-3"]);
        expect(ids("Back")).toEqual(["frame-3", "frame-2", "frame-1"]);
        expect(gifSequence(doc, { tagId: tagId(doc, "Bounce") }).plays).toBe(0);
        expect(gifSequence(doc, { tagId: tagId(doc, "Twice") }).plays).toBe(2);
        expect(gifSequence(doc, { tagId: tagId(doc, "Back") }).plays).toBe(1);
        expect(() => gifSequence(doc, { tagId: "gone" })).toThrow(RangeError);
    });
});

describe("gifFrameImage", () => {
    const pixels = (rows: number[][]): PixelBuffer => ({
        width: rows.length,
        height: 1,
        data: Uint8ClampedArray.from(rows.flat()),
    });

    it("shows a pixel from alpha 128 as opaque; below it, transparent", () => {
        expect(GIF_ALPHA_THRESHOLD).toBe(128);
        const frame = gifFrameImage(
            pixels([
                [10, 20, 30, 127],
                [40, 50, 60, 128],
                [40, 50, 60, 255],
                [0, 0, 0, 0],
            ]),
        );
        expect(frame.colors).toEqual([0x28323cff]);
        expect(frame.transparentIndex).toBe(1);
        expect(Array.from(frame.indices)).toEqual([1, 0, 0, 1]);
        expect(frame.reduced).toBe(false);
    });

    it("has no transparent index when every pixel shows; colours are buildPalette's", () => {
        const image = pixels([
            [255, 255, 255, 255],
            [0, 0, 0, 255],
            [255, 0, 0, 200],
        ]);
        const frame = gifFrameImage(image);
        expect(frame.transparentIndex).toBe(-1);
        expect(frame.colors).toEqual(buildPalette([image], 3));
        expect(frame.colors).toEqual([0x000000ff, 0xff0000ff, 0xffffffff]);
    });

    it("holds 256 colours without transparency, 255 with it; more are reduced to that many", () => {
        const colours = (count: number) =>
            Array.from({ length: count }, (_, index) => [index, 255 - index, index * 3, 255]);
        expect(gifFrameImage(pixels(colours(256))).reduced).toBe(false);
        expect(gifFrameImage(pixels(colours(256))).colors).toHaveLength(256);
        expect(gifFrameImage(pixels([...colours(255), [0, 0, 0, 0]])).reduced).toBe(false);
        const over = gifFrameImage(pixels([...colours(256), [0, 0, 0, 0]]));
        expect(over.reduced).toBe(true);
        expect(over.colors).toHaveLength(255);
        expect(over.transparentIndex).toBe(255);
        expect(over.indices[256]).toBe(255);
        expect(Math.max(...over.indices.subarray(0, 256))).toBeLessThan(255);
    });
});

describe("gifFile", () => {
    it("writes every frame with its delay, its colours exactly and one-bit transparency", () => {
        const doc = fourFrames();
        const { file, frameCount, reducedFrames } = gifFile(doc, { frames: "all", scale: 1 });
        expect(file.name).toBe("four-frames.gif");
        expect([frameCount, reducedFrames]).toEqual([4, 0]);
        const gif = decodeGif(file.bytes);
        expect([gif.width, gif.height]).toEqual([16, 16]);
        expect(gif.loopCount).toBe(0);
        expect(gif.frames.map((frame) => frame.delay * 10)).toEqual([...FOUR_FRAME_DELAYS]);
        expect(FOUR_FRAME_DURATIONS.map(gifDelayMs)).toEqual([...FOUR_FRAME_DELAYS]);
        // Each frame covers the canvas and is cleared after it shows.
        for (const frame of gif.frames) {
            expect([frame.left, frame.top, frame.width, frame.height]).toEqual([0, 0, 16, 16]);
            expect(frame.disposal).toBe(2);
        }
        // The first frame's table is the global one; the others have their own.
        expect(gif.frames.map((frame) => frame.local)).toEqual([false, true, true, true]);
        expect(gif.frames.map((frame) => frame.transparentIndex)).toEqual([null, 255, 4, 0]);
        // Per-frame palettes from buildPalette, in its order.
        doc.frames.forEach((frame, index) => {
            const colours = gifFrameImage(compositeFrame(doc, frame.id)).colors;
            const table = gif.frames[index]!.table.slice(0, colours.length);
            expect(
                table.map(([r, g, b]) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0),
            ).toEqual(colours);
        });
        expect(gif.frames[0]!.table).toHaveLength(256);
        const { shown, expected } = shownAndExpected(doc, file.bytes, [0, 1, 2, 3]);
        sameImages(shown, expected);
        // The fixture holds what the test is about: a frame of 256 colours, a transparent pixel.
        expect(new Set(gifFrameImage(compositeFrame(doc, "frame-0")).colors).size).toBe(256);
        expect(shown[1]![(9 * 16 + 5) * 4 + 3]).toBe(0);
    });

    it("writes a ping-pong tag's expanded pass, looping as the tag does", () => {
        const doc = fourFrames();
        const { file, frameCount } = gifFile(doc, {
            frames: { tagId: tagId(doc, "Bounce") },
            scale: 1,
        });
        expect(file.name).toBe("four-frames-bounce.gif");
        expect(frameCount).toBe(6);
        const gif = decodeGif(file.bytes);
        expect(gif.loopCount).toBe(0);
        const order = [0, 1, 2, 3, 2, 1];
        expect(gif.frames.map((frame) => frame.delay * 10)).toEqual(
            order.map((index) => FOUR_FRAME_DELAYS[index]),
        );
        const { shown, expected } = shownAndExpected(doc, file.bytes, order);
        sameImages(shown, expected);
    });

    it("plays a tag that repeats n times with n - 1 loops, and one that plays once without a loop block", () => {
        const doc = fourFrames();
        const twice = decodeGif(
            gifFile(doc, { frames: { tagId: tagId(doc, "Twice") }, scale: 1 }).file.bytes,
        );
        expect(twice.loopCount).toBe(1);
        expect(twice.frames).toHaveLength(2);
        const back = gifFile(doc, { frames: { tagId: tagId(doc, "Back") }, scale: 1 }).file.bytes;
        expect(decodeGif(back).loopCount).toBeNull();
        sameImages(
            shownAndExpected(doc, back, [3, 2, 1]).shown,
            shownAndExpected(doc, back, [3, 2, 1]).expected,
        );
    });

    it("scales by a whole number from 1 to 8 with nearest-neighbour sampling", () => {
        const doc = fourFrames();
        const { file } = gifFile(doc, { frames: "all", scale: 3 });
        expect(file.name).toBe("four-frames@3x.gif");
        const gif = decodeGif(file.bytes);
        expect([gif.width, gif.height]).toEqual([48, 48]);
        const { shown, expected } = shownAndExpected(doc, file.bytes, [0, 1, 2, 3]);
        sameImages(
            shown,
            expected.map((image) => blocks(image, 16, 3)),
        );
        expect(MAX_GIF_SCALE).toBe(8);
        expect(decodeGif(gifFile(doc, { frames: "all", scale: 8 }).file.bytes).width).toBe(128);
        for (const scale of [0, 9, 1.5]) {
            expect(() => gifFile(doc, { frames: "all", scale }), `${scale}`).toThrow(RangeError);
        }
    });

    it("reduces a frame of more than 256 colours to 256 and counts it; the others stay exact", () => {
        const doc = manyColours();
        const first = gifFile(doc, { frames: "all", scale: 1 });
        expect(first.reducedFrames).toBe(1);
        const gif = decodeGif(first.file.bytes);
        expect(gif.frames).toHaveLength(2);
        const [reduced, exact] = renderGif(gif);
        // The table is buildPalette's 256 colours of the frame; every pixel shows one of them.
        const palette = buildPalette([compositeFrame(doc, "frame-0")], 256);
        expect(palette).toHaveLength(256);
        const table = gif.frames[0]!.table.map(
            ([r, g, b]) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0,
        );
        expect(table).toEqual(palette);
        expect(gif.frames[0]!.transparentIndex).toBeNull();
        const allowed = new Set(palette);
        for (let at = 0; at < reduced!.length; at += 4) {
            expect(reduced![at + 3]).toBe(255);
            const colour =
                ((reduced![at]! << 24) |
                    (reduced![at + 1]! << 16) |
                    (reduced![at + 2]! << 8) |
                    0xff) >>>
                0;
            expect(allowed.has(colour)).toBe(true);
        }
        expect(Buffer.from(exact!).equals(Buffer.from(expectedImage(doc, "frame-1")))).toBe(true);
        // Deterministic: the same document gives the same bytes.
        const again = gifFile(doc, { frames: "all", scale: 1 }).file.bytes;
        expect(Buffer.from(again).equals(Buffer.from(first.file.bytes))).toBe(true);
    });

    it("names the file after the export name and the tag's animation ID", () => {
        const doc = fourFrames();
        doc.tags[1]!.name = "Bounce";
        expect(gifFileName(doc, "four-frames", { tagId: doc.tags[1]!.id }, 2)).toBe(
            "four-frames-bounce-2@2x.gif",
        );
        expect(gifFileName(doc, "four-frames", "all", 1)).toBe("four-frames.gif");
        expect(() => gifFile(doc, { frames: { tagId: "gone" }, scale: 1 })).toThrow(RangeError);
    });
});
