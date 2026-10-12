import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import type { SpriteDoc } from "../../src/core/model";
import { FRAME, addFrame, layerId, pixelsOf, setCel, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";

// Every expected buffer below was computed by hand from the rules in
// `src/core/composite/blend.ts`; the arithmetic is written next to it. In the comments
// mul(a, b) is a * b / 255 rounded to the nearest integer, B is the pixel below, S the pixel
// above, a the alpha of S after opacity and R the result:
//
//     a = mul(Sa, mul(layer opacity, cel opacity))
//     a = 0      R = B
//     Ba = 0     R = (Sr, Sg, Sb, a)
//     otherwise  Ra = a + Ba - mul(Ba, a),  Rc = Bc + trunc((Sc - Bc) * a / Ra)

const BLUE: Rgba = [0, 0, 255, 255];
const GREEN: Rgba = [0, 255, 0, 255];
const RED: Rgba = [255, 0, 0, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

function composite(doc: SpriteDoc, frame = FRAME): number[][] {
    return pixelsOf(compositeFrame(doc, frame));
}

describe("compositeFrame, golden buffers", () => {
    it("opaque over opaque: the upper pixel replaces the lower", () => {
        const doc = sprite(2, 1, [
            { pixels: [BLUE, [10, 20, 30, 255]] },
            { pixels: [RED, [200, 100, 50, 255]] },
        ]);

        // a = 255: Ra = 255 + 255 - mul(255, 255) = 255, Rc = Bc + (Sc - Bc) = Sc.
        expect(composite(doc)).toEqual([
            [255, 0, 0, 255],
            [200, 100, 50, 255],
        ]);
    });

    it("50% over opaque", () => {
        const doc = sprite(3, 1, [
            { pixels: [BLUE, [200, 60, 250, 255], [100, 50, 7, 255]] },
            {
                pixels: [
                    [255, 0, 0, 128],
                    [100, 50, 7, 128],
                    [200, 60, 250, 128],
                ],
            },
        ]);

        // In all three a = 128 and Ra = 128 + 255 - mul(255, 128) = 383 - 128 = 255.
        expect(composite(doc)).toEqual([
            // r: 0 + trunc(255 * 128 / 255) = 128
            // b: 255 + trunc(-255 * 128 / 255) = 255 - 128 = 127
            [128, 0, 127, 255],
            // r: 200 + trunc(-100 * 128 / 255) = 200 + trunc(-50.196) = 150 (not 149: toward 0)
            // g: 60 + trunc(-10 * 128 / 255) = 60 + trunc(-5.02) = 55
            // b: 250 + trunc(-243 * 128 / 255) = 250 + trunc(-121.98) = 129
            [150, 55, 129, 255],
            // The same two colours the other way round: the fractions are cut, not rounded.
            // r: 100 + trunc(50.196) = 150, g: 50 + trunc(5.02) = 55, b: 7 + trunc(121.98) = 128
            [150, 55, 128, 255],
        ]);
    });

    it("50% over 50%", () => {
        const doc = sprite(2, 1, [
            {
                pixels: [
                    [0, 0, 255, 128],
                    [250, 100, 100, 128],
                ],
            },
            {
                pixels: [
                    [255, 0, 0, 128],
                    [10, 200, 99, 128],
                ],
            },
        ]);

        // a = 128, Ba = 128, mul(128, 128) = round(64.25) = 64, Ra = 128 + 128 - 64 = 192.
        expect(composite(doc)).toEqual([
            // r: 0 + trunc(255 * 128 / 192) = 170
            // b: 255 + trunc(-255 * 128 / 192) = 255 - 170 = 85
            [170, 0, 85, 192],
            // r: 250 + trunc(-240 * 128 / 192) = 250 - 160 = 90
            // g: 100 + trunc(100 * 128 / 192) = 100 + trunc(66.67) = 166
            // b: 100 + trunc(-1 * 128 / 192) = 100 + trunc(-0.67) = 100
            [90, 166, 100, 192],
        ]);
    });

    it("layer opacity scales the alpha of every pixel of the layer", () => {
        const doc = sprite(2, 1, [{ pixels: [BLUE, CLEAR] }, { opacity: 128, pixels: [RED, RED] }]);

        // Opacity mul(128, 255) = 128, so a = mul(255, 128) = 128.
        expect(composite(doc)).toEqual([
            // Over opaque blue, as "50% over opaque": Ra = 255, r = 128, b = 127.
            [128, 0, 127, 255],
            // Over nothing: the source colour with alpha a.
            [255, 0, 0, 128],
        ]);

        // A single layer: opacity mul(100, 255) = 100, a = mul(200, 100) = round(78.43) = 78.
        expect(composite(sprite(1, 1, [{ opacity: 100, pixels: [[10, 20, 30, 200]] }]))).toEqual([
            [10, 20, 30, 78],
        ]);
    });

    it("cel opacity scales the alpha of every pixel of the cel", () => {
        const doc = sprite(2, 1, [
            { pixels: [BLACK, CLEAR] },
            { celOpacity: 64, pixels: [WHITE, WHITE] },
        ]);

        // Opacity mul(255, 64) = 64, so a = mul(255, 64) = 64.
        expect(composite(doc)).toEqual([
            // Ra = 64 + 255 - mul(255, 64) = 255; each channel 0 + trunc(255 * 64 / 255) = 64.
            [64, 64, 64, 255],
            [255, 255, 255, 64],
        ]);
    });

    it("layer opacity × cel opacity is one rounded product, applied to the alpha", () => {
        const doc = sprite(1, 1, [
            { pixels: [[10, 200, 30, 180]] },
            { opacity: 100, celOpacity: 200, pixels: [[250, 10, 130, 200]] },
        ]);

        // Opacity mul(100, 200) = round(78.43) = 78; a = mul(200, 78) = round(61.18) = 61.
        // mul(180, 61) = round(43.06) = 43; Ra = 61 + 180 - 43 = 198.
        // r: 10 + trunc(240 * 61 / 198) = 10 + trunc(73.94) = 83
        // g: 200 + trunc(-190 * 61 / 198) = 200 + trunc(-58.54) = 142
        // b: 30 + trunc(100 * 61 / 198) = 30 + trunc(30.81) = 60
        expect(composite(doc)).toEqual([[83, 142, 60, 198]]);

        // Opacity mul(50, 60) = round(11.76) = 12; a = mul(140, 12) = round(6.59) = 7.
        // Scaling the alpha by one opacity after the other would give 6 in either order:
        // mul(mul(140, 50), 60) = mul(27, 60) = 6 and mul(mul(140, 60), 50) = mul(33, 50) = 6.
        const faint = { pixels: [[1, 2, 3, 140]] as Rgba[] };
        expect(composite(sprite(1, 1, [{ ...faint, opacity: 50, celOpacity: 60 }]))).toEqual([
            [1, 2, 3, 7],
        ]);
        expect(composite(sprite(1, 1, [{ ...faint, opacity: 60, celOpacity: 50 }]))).toEqual([
            [1, 2, 3, 7],
        ]);
    });

    it("a hidden layer adds nothing", () => {
        const doc = sprite(1, 1, [
            { pixels: [BLUE] },
            { visible: false, pixels: [GREEN] },
            { pixels: [[255, 0, 0, 128]] },
        ]);

        // Red at 50% directly over blue, as in "50% over opaque".
        expect(composite(doc)).toEqual([[128, 0, 127, 255]]);
    });

    it("an empty cel adds nothing", () => {
        const doc = sprite(2, 1, [
            { pixels: [BLUE, [9, 8, 7, 6]] },
            // Empty at both frames.
            {},
            // A cel at FRAME, none at "frame-1".
            {
                pixels: [
                    [255, 0, 0, 128],
                    [255, 0, 0, 128],
                ],
            },
        ]);
        addFrame(doc, "frame-1");
        setCel(doc, layerId(0), "frame-1", [BLUE, [9, 8, 7, 6]]);

        // At "frame-1" only the bottom layer has a cel: its pixels, byte for byte.
        expect(composite(doc, "frame-1")).toEqual([
            [0, 0, 255, 255],
            [9, 8, 7, 6],
        ]);
        // At FRAME the top cel is there. Second pixel: a = 128, Ba = 6,
        // mul(6, 128) = round(3.01) = 3, Ra = 128 + 6 - 3 = 131.
        // r: 9 + trunc(246 * 128 / 131) = 9 + trunc(240.37) = 249
        // g: 8 + trunc(-8 * 128 / 131) = 8 + trunc(-7.82) = 1
        // b: 7 + trunc(-7 * 128 / 131) = 7 + trunc(-6.84) = 1
        expect(composite(doc)).toEqual([
            [128, 0, 127, 255],
            [249, 1, 1, 131],
        ]);
    });

    it("a fully transparent result is all zero bytes", () => {
        const zeros = [CLEAR, CLEAR];
        const colour: Rgba[] = [
            [200, 100, 50, 255],
            [1, 2, 3, 77],
        ];

        // No cel at all.
        expect(composite(sprite(2, 1, [{}, {}]))).toEqual(zeros);
        // Every layer hidden.
        expect(composite(sprite(2, 1, [{ visible: false, pixels: colour }]))).toEqual(zeros);
        // Layer opacity 0 and cel opacity 0: a = mul(Sa, 0) = 0 for every pixel.
        expect(composite(sprite(2, 1, [{ opacity: 0, pixels: colour }]))).toEqual(zeros);
        expect(composite(sprite(2, 1, [{ celOpacity: 0, pixels: colour }]))).toEqual(zeros);
        // Colour stored under alpha 0 does not reach the composite, alone or over another
        // transparent layer.
        const hidden: Rgba[] = [
            [200, 100, 50, 0],
            [255, 255, 255, 0],
        ];
        expect(composite(sprite(2, 1, [{ pixels: hidden }]))).toEqual(zeros);
        expect(composite(sprite(2, 1, [{ pixels: hidden }, { pixels: hidden }]))).toEqual(zeros);
        // An alpha that rounds to 0: a = mul(1, 127) = round(0.498) = 0.
        const faint: Rgba[] = [
            [9, 8, 7, 1],
            [9, 8, 7, 1],
        ];
        expect(composite(sprite(2, 1, [{ opacity: 127, pixels: faint }]))).toEqual(zeros);
        // One step more is visible: a = mul(1, 128) = round(0.502) = 1.
        expect(composite(sprite(2, 1, [{ opacity: 128, pixels: faint }]))).toEqual([
            [9, 8, 7, 1],
            [9, 8, 7, 1],
        ]);
    });

    it("a transparent pixel keeps the pixel below, byte for byte", () => {
        const doc = sprite(2, 1, [
            {
                pixels: [
                    [1, 2, 3, 4],
                    [250, 251, 252, 253],
                ],
            },
            {
                pixels: [
                    [200, 200, 200, 0],
                    [200, 200, 200, 0],
                ],
            },
        ]);

        expect(composite(doc)).toEqual([
            [1, 2, 3, 4],
            [250, 251, 252, 253],
        ]);
    });

    it("layers are blended bottom to top", () => {
        const green: Rgba = [0, 255, 0, 128];
        const red: Rgba = [255, 0, 0, 128];

        // Green over blue: Ra = 255, g = 0 + trunc(255 * 128 / 255) = 128, b = 255 - 128 = 127
        // gives (0, 128, 127, 255). Red over that: r = 0 + 128 = 128,
        // g = 128 + trunc(-128 * 128 / 255) = 128 + trunc(-64.25) = 64,
        // b = 127 + trunc(-127 * 128 / 255) = 127 + trunc(-63.75) = 64.
        expect(
            composite(sprite(1, 1, [{ pixels: [BLUE] }, { pixels: [green] }, { pixels: [red] }])),
        ).toEqual([[128, 64, 64, 255]]);

        // Red over blue is (128, 0, 127, 255). Green over that:
        // r = 128 + trunc(-64.25) = 64, g = 0 + 128 = 128, b = 127 + trunc(-63.75) = 64.
        expect(
            composite(sprite(1, 1, [{ pixels: [BLUE] }, { pixels: [red] }, { pixels: [green] }])),
        ).toEqual([[64, 128, 64, 255]]);
    });
});
