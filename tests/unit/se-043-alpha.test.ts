import { describe, expect, it } from "vitest";
import { ImportError, applyAlpha } from "../../src/core/import";
import type { AlphaOptions } from "../../src/core/import";
import { clonePixelBuffer, pixelBuffersEqual } from "../../src/core/pixels";
import { hex, image } from "./se-043-support";

// Alpha 0 with a hidden colour, 1, 127, 128, 254 and 255.
const RAMP = image(6, [0x11223300, 0x11223301, 0x1122337f, 0x11223380, 0x112233fe, 0x112233ff]);

describe("applyAlpha", () => {
    it("returns an unchanged copy when alpha is kept", () => {
        const result = applyAlpha(RAMP, {});
        expect(pixelBuffersEqual(result, RAMP)).toBe(true);
        expect(result.data.buffer).not.toBe(RAMP.data.buffer);
    });

    it("thresholds to binary alpha: 255 at or above, transparent black below", () => {
        expect(hex(applyAlpha(RAMP, { threshold: 128 }))).toEqual([
            "00000000 00000000 00000000 112233ff 112233ff 112233ff",
        ]);
        expect(hex(applyAlpha(RAMP, { threshold: 1 }))).toEqual([
            "00000000 112233ff 112233ff 112233ff 112233ff 112233ff",
        ]);
        expect(hex(applyAlpha(RAMP, { threshold: 255 }))).toEqual([
            "00000000 00000000 00000000 00000000 00000000 112233ff",
        ]);
    });

    it("makes the key colour transparent black and leaves the rest alone", () => {
        const source = image(4, [0xff00ffff, 0xff00fe80, 0xff00ff40, 0xff00ff00]);
        // Exact colour only; the half-transparent copy of it matches too. The last pixel is
        // fully transparent already and keeps its hidden colour.
        const colorKey = { color: 0xff00ffff, tolerance: 0 };
        expect(hex(applyAlpha(source, { colorKey }))).toEqual([
            "00000000 ff00fe80 00000000 ff00ff00",
        ]);
    });

    it("ignores the alpha byte of the key colour", () => {
        const source = image(2, [0x102030ff, 0x10203080]);
        const colorKey = { color: 0x10203000, tolerance: 0 };
        expect(hex(applyAlpha(source, { colorKey }))).toEqual(["00000000 00000000"]);
    });

    it("matches within the tolerance on every channel, limits included", () => {
        const source = image(6, [
            ...[0x646464ff, 0x6e5a64ff, 0x6f6464ff, 0x645964ff, 0x64646fff, 0x5a5a5aff],
        ]);
        // Key 100, 100, 100 with tolerance 10: 110 and 90 match, 111 and 89 do not.
        const colorKey = { color: 0x646464ff, tolerance: 10 };
        expect(hex(applyAlpha(source, { colorKey }))).toEqual([
            "00000000 00000000 6f6464ff 645964ff 64646fff 00000000",
        ]);
        // Tolerance 255 matches every colour.
        expect(hex(applyAlpha(source, { colorKey: { color: 0, tolerance: 255 } }))).toEqual([
            "00000000 00000000 00000000 00000000 00000000 00000000",
        ]);
    });

    it("applies the colour key and the threshold together", () => {
        const source = image(4, [0x00ff00ff, 0x00ff0010, 0x808080c0, 0x80808040]);
        const options: AlphaOptions = {
            threshold: 128,
            colorKey: { color: 0x00ff00ff, tolerance: 0 },
        };
        expect(hex(applyAlpha(source, options))).toEqual(["00000000 00000000 808080ff 00000000"]);
    });

    it("does not change the source", () => {
        const before = clonePixelBuffer(RAMP);
        applyAlpha(RAMP, { threshold: 128, colorKey: { color: 0x112233ff, tolerance: 3 } });
        expect(pixelBuffersEqual(RAMP, before)).toBe(true);
    });

    it("rejects a threshold outside 1..255 and a tolerance outside 0..255", () => {
        const invalid: AlphaOptions[] = [
            { threshold: 0 },
            { threshold: 256 },
            { threshold: 127.5 },
            { threshold: Number.NaN },
            { colorKey: { color: 0, tolerance: -1 } },
            { colorKey: { color: 0, tolerance: 256 } },
            { colorKey: { color: 0, tolerance: 0.5 } },
        ];
        for (const options of invalid) {
            const run = () => applyAlpha(RAMP, options);
            expect(run, JSON.stringify(options)).toThrow(ImportError);
            expect(run).toThrow(expect.objectContaining({ code: "settings" }));
        }
    });
});
