// sRGB8 ↔ OKLab (Björn Ottosson, "A perceptual color space for image processing", 2020,
// https://bottosson.github.io/posts/oklab/). The import pipeline measures colour distance in
// this space (SPEC §8). The matrices are the ones published there, for linear sRGB with a D65
// white point.
//
// The conversions use `**` and `Math.cbrt`, whose last bit the language leaves to the engine:
// the same colour always gets the same coordinates in one engine, which is what the pipeline's
// determinism rests on.

/**
 * OKLab coordinates: lightness `L` from 0 (black) to 1 (white), then the green–red axis `a`
 * and the blue–yellow axis `b`, both 0 for greys.
 */
export type Oklab = [L: number, a: number, b: number];

/** Linear light (0..1) of every sRGB8 value, by the sRGB transfer function. */
const LINEAR = new Float64Array(256);
for (let value = 0; value < 256; value++) {
    const encoded = value / 255;
    LINEAR[value] = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

/** Linear light to sRGB8, rounded; values outside 0..1 are clipped. */
function encode(linear: number): number {
    const clipped = Math.min(1, Math.max(0, linear));
    const encoded = clipped <= 0.0031308 ? clipped * 12.92 : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
}

/**
 * Writes the OKLab coordinates of an sRGB colour to `out[offset..offset + 2]` as L, a, b.
 * `red`, `green` and `blue` are integers 0..255. Allocates nothing, for use per pixel.
 */
export function writeOklab(
    out: Float64Array | number[],
    offset: number,
    red: number,
    green: number,
    blue: number,
): void {
    const r = LINEAR[red];
    const g = LINEAR[green];
    const b = LINEAR[blue];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    out[offset] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    out[offset + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    out[offset + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

/** The OKLab coordinates of an sRGB colour; `red`, `green` and `blue` are integers 0..255. */
export function srgb8ToOklab(red: number, green: number, blue: number): Oklab {
    const lab: Oklab = [0, 0, 0];
    writeOklab(lab, 0, red, green, blue);
    return lab;
}

/**
 * The sRGB colour nearest to OKLab coordinates, as integers 0..255. A colour outside the sRGB
 * gamut is clipped per channel. Every sRGB8 colour survives the round trip through
 * `srgb8ToOklab` unchanged.
 */
export function oklabToSrgb8(
    L: number,
    a: number,
    b: number,
): [red: number, green: number, blue: number] {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
}
