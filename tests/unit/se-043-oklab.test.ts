import { describe, expect, it } from "vitest";
import { oklabToSrgb8, srgb8ToOklab, writeOklab } from "../../src/core/color";

describe("srgb8ToOklab", () => {
    // Reference values: the OKLab coordinates of the sRGB primaries and of white, as given by
    // the matrices of Ottosson's article (https://bottosson.github.io/posts/oklab/).
    it("matches the reference values of the primaries, white and black", () => {
        const expected: [number[], number[]][] = [
            [
                [255, 0, 0],
                [0.62796, 0.22486, 0.12585],
            ],
            [
                [0, 255, 0],
                [0.86644, -0.23389, 0.1795],
            ],
            [
                [0, 0, 255],
                [0.45201, -0.03246, -0.31153],
            ],
            [
                [255, 255, 255],
                [1, 0, 0],
            ],
        ];
        for (const [[red, green, blue], lab] of expected) {
            const actual = srgb8ToOklab(red, green, blue);
            for (let axis = 0; axis < 3; axis++) {
                expect(actual[axis], `${red}, ${green}, ${blue} axis ${axis}`).toBeCloseTo(
                    lab[axis],
                    5,
                );
            }
        }
        expect(srgb8ToOklab(0, 0, 0)).toEqual([0, 0, 0]);
    });

    it("puts greys on the lightness axis, lighter greys higher", () => {
        let previous = -1;
        for (let grey = 0; grey < 256; grey++) {
            const [L, a, b] = srgb8ToOklab(grey, grey, grey);
            expect(L).toBeGreaterThan(previous);
            expect(Math.abs(a)).toBeLessThan(1e-6);
            expect(Math.abs(b)).toBeLessThan(1e-6);
            previous = L;
        }
    });

    it("gives different coordinates to colours one step apart", () => {
        expect(srgb8ToOklab(10, 20, 30)).not.toEqual(srgb8ToOklab(10, 20, 31));
        expect(srgb8ToOklab(0, 0, 0)).not.toEqual(srgb8ToOklab(0, 0, 1));
    });
});

describe("writeOklab", () => {
    it("writes the same coordinates at the offset and nothing else", () => {
        const out = new Float64Array(7).fill(-1);
        writeOklab(out, 2, 12, 200, 99);
        expect(Array.from(out.subarray(2, 5))).toEqual(srgb8ToOklab(12, 200, 99));
        expect(Array.from(out.subarray(0, 2))).toEqual([-1, -1]);
        expect(Array.from(out.subarray(5))).toEqual([-1, -1]);
    });
});

describe("oklabToSrgb8", () => {
    it("returns every grey and a lattice of 140 608 colours unchanged after a round trip", () => {
        const failures: string[] = [];
        const check = (red: number, green: number, blue: number): void => {
            const back = oklabToSrgb8(...srgb8ToOklab(red, green, blue));
            if (back[0] !== red || back[1] !== green || back[2] !== blue) {
                failures.push(`${red}, ${green}, ${blue} → ${back.join(", ")}`);
            }
        };
        for (let grey = 0; grey < 256; grey++) {
            check(grey, grey, grey);
        }
        // 0, 5, … 255 on every channel: 52³ colours, corners included.
        for (let red = 0; red < 256; red += 5) {
            for (let green = 0; green < 256; green += 5) {
                for (let blue = 0; blue < 256; blue += 5) {
                    check(red, green, blue);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it("returns integers and clips colours outside the sRGB gamut", () => {
        expect(oklabToSrgb8(2, 0, 0)).toEqual([255, 255, 255]);
        expect(oklabToSrgb8(-1, 0, 0)).toEqual([0, 0, 0]);
        // More saturated than any sRGB red: red stays at its maximum, the others at 0.
        expect(oklabToSrgb8(0.62796, 0.4, 0.2)).toEqual([255, 0, 0]);
        expect(oklabToSrgb8(0.5, 0.01, -0.02).every(Number.isInteger)).toBe(true);
    });
});
