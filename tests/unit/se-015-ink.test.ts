import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { createPixelBuffer } from "../../src/core/pixels";
import { eraseInk, FreehandStroke, createBrush, inkPixel, paintInk } from "../../src/core/raster";
import type { Ink } from "../../src/core/raster";
import { FRAME, pixelsOf, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";

// SE-015: inks. Simple replaces, alpha compositing matches the compositor, lock alpha never
// changes a pixel's alpha, the eraser lowers alpha by its opacity; and within one stroke a
// pixel is inked from its value at the start of the stroke, so it does not build up.

const RED_HALF: Rgba = [255, 0, 0, 128];
const BLUE_HALF = 0x0000ff80;
const rgba = fc.tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
);
const colour = fc.integer({ min: 0, max: 0xffffffff });
const opacity = fc.integer({ min: 0, max: 255 });

describe("alpha compositing", () => {
    it("50% blue over 50% red matches the compositor's result for the same two layers", () => {
        // Two layers composited: 50% red below, 50% blue above.
        const doc = sprite(1, 1, [{ pixels: [RED_HALF] }, { pixels: [[0, 0, 255, 128]] }]);
        const [composited] = pixelsOf(compositeFrame(doc, FRAME));
        // The same blue painted with the alpha ink on the red pixel.
        const painted = inkPixel(paintInk("alpha", BLUE_HALF, 255), RED_HALF);
        expect(painted).toEqual(composited);
        // Worked out by the rules of core/composite/blend.ts: a = 128, Ra = 128 + 128 -
        // mul(128, 128) = 192, R = 255 + trunc(-255 * 128 / 192) = 85, B = trunc(255 * 128 /
        // 192) = 170.
        expect(painted).toEqual([85, 0, 170, 192]);
    });

    it("equals the compositor for any colour, opacity and pixel", () => {
        fc.assert(
            fc.property(rgba, colour, opacity, (below, paint, alpha) => {
                const above: Rgba = [
                    paint >>> 24,
                    (paint >>> 16) & 255,
                    (paint >>> 8) & 255,
                    paint & 255,
                ];
                const doc = sprite(1, 1, [
                    { pixels: [below] },
                    { pixels: [above], opacity: alpha },
                ]);
                const [expected] = pixelsOf(compositeFrame(doc, FRAME));
                expect(inkPixel(paintInk("alpha", paint, alpha), below)).toEqual(expected);
            }),
        );
    });
});

describe("lock alpha", () => {
    it("never changes any pixel's alpha", () => {
        fc.assert(
            fc.property(rgba, colour, opacity, (pixel, paint, alpha) => {
                const result = inkPixel(paintInk("lockAlpha", paint, alpha), pixel);
                expect(result[3]).toBe(pixel[3]);
                // A transparent pixel is left as it was.
                if (pixel[3] === 0) expect(result).toEqual(pixel);
            }),
        );
    });

    it("paints the colour over an opaque or translucent pixel", () => {
        expect(inkPixel(paintInk("lockAlpha", 0x0000ffff, 255), [255, 0, 0, 128])).toEqual([
            0, 0, 255, 128,
        ]);
        expect(inkPixel(paintInk("lockAlpha", 0x00ff00ff, 255), [9, 9, 9, 255])).toEqual([
            0, 255, 0, 255,
        ]);
    });
});

describe("simple", () => {
    it("replaces the pixel with the colour, its alpha scaled by the opacity", () => {
        fc.assert(
            fc.property(rgba, colour, opacity, (pixel, paint, alpha) => {
                const result = inkPixel(paintInk("simple", paint, alpha), pixel);
                const a = Math.round(((paint & 255) * alpha) / 255);
                expect(result).toEqual(
                    a === 0
                        ? [0, 0, 0, 0]
                        : [paint >>> 24, (paint >>> 16) & 255, (paint >>> 8) & 255, a],
                );
            }),
        );
    });
});

describe("eraser", () => {
    it("makes a pixel transparent at 255 and lowers its alpha by a lower opacity", () => {
        expect(inkPixel(eraseInk(255), [10, 20, 30, 200])).toEqual([0, 0, 0, 0]);
        // 200 - mul(200, 128) = 200 - 100 = 100.
        expect(inkPixel(eraseInk(128), [10, 20, 30, 200])).toEqual([10, 20, 30, 100]);
        expect(inkPixel(eraseInk(0), [10, 20, 30, 200])).toEqual([10, 20, 30, 200]);
        fc.assert(
            fc.property(rgba, opacity, (pixel, alpha) => {
                const result = inkPixel(eraseInk(alpha), pixel);
                expect(result[3]).toBeLessThanOrEqual(pixel[3]);
                if (result[3] === 0) expect(result).toEqual([0, 0, 0, 0]);
                else expect(result.slice(0, 3)).toEqual(pixel.slice(0, 3));
            }),
        );
    });

    it("refuses an opacity outside 0–255", () => {
        expect(() => eraseInk(256)).toThrow(RangeError);
        expect(() => paintInk("simple", 0, -1)).toThrow(RangeError);
    });
});

describe("within one stroke", () => {
    /** Strokes `path` with `ink` across a 4 × 1 image of `pixel`; returns its pixels. */
    function strokeOver(ink: Ink, pixel: readonly number[], path: number[]): number[][] {
        const image = createPixelBuffer(4, 1);
        for (let x = 0; x < 4; x++) image.data.set(pixel, x * 4);
        const original = { ...image, data: image.data.slice() };
        const stroke = new FreehandStroke(image, original, {
            brush: createBrush("square", 1),
            ink,
        });
        const [first, ...rest] = path;
        stroke.start({ x: first!, y: 0 });
        for (const x of rest) stroke.to({ x, y: 0 });
        return Array.from({ length: 4 }, (_, x) => Array.from(image.data.slice(x * 4, x * 4 + 4)));
    }

    it("a translucent colour does not build up where the stroke crosses itself", () => {
        const ink = paintInk("alpha", BLUE_HALF, 255);
        const once = inkPixel(ink, RED_HALF);
        // Back and forth over the same pixels.
        const pixels = strokeOver(ink, RED_HALF, [0, 3, 0, 3, 1]);
        expect(pixels).toEqual([once, once, once, once]);
    });

    it("the eraser at half opacity halves a pixel's alpha once per stroke", () => {
        const pixels = strokeOver(eraseInk(128), [1, 2, 3, 200], [0, 3, 0]);
        expect(pixels).toEqual(Array.from({ length: 4 }, () => [1, 2, 3, 100]));
    });
});
