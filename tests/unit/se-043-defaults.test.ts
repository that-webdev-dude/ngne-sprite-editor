import { describe, expect, it } from "vitest";
import { DEFAULT_ALPHA_THRESHOLD, DEFAULT_COLOR_COUNT, smartDefaults } from "../../src/core/import";
import { createPixelBuffer } from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";
import { noise } from "./se-043-support";

const KEEP_ALPHA = {};
const THRESHOLD_128 = { threshold: 128 };
const KEEP_COLORS = { mode: "keep" };
const REDUCE_TO_16 = { mode: "reduce", count: 16 };

/**
 * A `width` × `height` sprite with binary alpha: the first row is transparent and the other
 * pixels cycle through `colors` opaque colours.
 */
function sprite(width: number, height: number, colors: number): PixelBuffer {
    const buffer = createPixelBuffer(width, height);
    for (let i = width, n = 0; i < width * height; i++, n++) {
        const color = n % colors;
        buffer.data.set([color, (color * 7) & 0xff, color >> 8, 255], i * 4);
    }
    return buffer;
}

describe("smartDefaults", () => {
    it("keeps alpha and colours of a binary-alpha, 12-colour input of the target size", () => {
        const defaults = smartDefaults([sprite(16, 16, 12)], { width: 16, height: 16 });
        expect(defaults.alpha).toEqual(KEEP_ALPHA);
        expect(defaults.colors).toEqual(KEEP_COLORS);
    });

    it("thresholds at 128 and reduces to 16 colours for a photo", () => {
        // Opaque, nearly every pixel a colour of its own, larger than the sprite.
        const photo = noise(96, 64, 4);
        const defaults = smartDefaults([photo], { width: 32, height: 32 });
        expect(defaults.alpha).toEqual(THRESHOLD_128);
        expect(defaults.colors).toEqual(REDUCE_TO_16);
        expect([DEFAULT_ALPHA_THRESHOLD, DEFAULT_COLOR_COUNT]).toEqual([128, 16]);
    });

    it("uses the fixed defaults of the other steps and names no region or cells", () => {
        expect(smartDefaults([sprite(16, 16, 12)], { width: 24, height: 20 })).toEqual({
            size: { width: 24, height: 20, fit: "contain" },
            resample: "area",
            alpha: THRESHOLD_128,
            colors: REDUCE_TO_16,
            dither: "none",
        });
    });

    it("does not keep alpha or colours when a cell has to be resampled", () => {
        // The same pixel-art input as in the first test, at another target size: averaging
        // would leave soft edges and blended colours.
        for (const size of [
            { width: 32, height: 32 },
            { width: 16, height: 15 },
        ]) {
            const defaults = smartDefaults([sprite(16, 16, 12)], size);
            expect(defaults.alpha).toEqual(THRESHOLD_128);
            expect(defaults.colors).toEqual(REDUCE_TO_16);
        }
        // One cell of several is enough.
        const cells = [sprite(16, 16, 12), sprite(16, 8, 12)];
        const defaults = smartDefaults(cells, { width: 16, height: 16 });
        expect(defaults.alpha).toEqual(THRESHOLD_128);
        expect(defaults.colors).toEqual(REDUCE_TO_16);
    });

    it("thresholds soft alpha and still keeps the colours", () => {
        for (const alpha of [1, 127, 128, 254]) {
            const soft = sprite(16, 16, 12);
            soft.data[16 * 4 + 3] = alpha;
            const defaults = smartDefaults([soft], { width: 16, height: 16 });
            expect(defaults.alpha, `alpha ${alpha}`).toEqual(THRESHOLD_128);
            expect(defaults.colors).toEqual(KEEP_COLORS);
        }
    });

    it("keeps up to 256 colours and reduces more, alpha aside", () => {
        const size = { width: 32, height: 32 };
        expect(smartDefaults([sprite(32, 32, 256)], size).colors).toEqual(KEEP_COLORS);
        const defaults = smartDefaults([sprite(32, 32, 257)], size);
        expect(defaults.colors).toEqual(REDUCE_TO_16);
        expect(defaults.alpha).toEqual(KEEP_ALPHA);
    });

    it("counts the colours of all cells together", () => {
        const size = { width: 16, height: 16 };
        const first = sprite(16, 16, 200);
        const second = sprite(16, 16, 200);
        // The same 200 colours twice are 200 colours.
        expect(smartDefaults([first, second], size).colors).toEqual(KEEP_COLORS);
        // Another 200 in the second cell make 400.
        for (let i = 16 * 4; i < second.data.length; i += 4) {
            second.data[i + 2] = 99;
        }
        expect(smartDefaults([first, second], size).colors).toEqual(REDUCE_TO_16);
    });

    it("does not count the colours hidden under alpha 0", () => {
        const size = { width: 32, height: 32 };
        const cell = sprite(32, 32, 256);
        // 32 more colours in the transparent first row.
        for (let x = 0; x < 32; x++) {
            cell.data.set([x, 200, 200], x * 4);
        }
        expect(smartDefaults([cell], size).colors).toEqual(KEEP_COLORS);
    });

    it("keeps everything for no cells at all", () => {
        const defaults = smartDefaults([], { width: 32, height: 32 });
        expect(defaults.alpha).toEqual(KEEP_ALPHA);
        expect(defaults.colors).toEqual(KEEP_COLORS);
    });
});
