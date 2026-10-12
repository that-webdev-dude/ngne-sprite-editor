import type { BlendMode } from "../model";

// Blend functions of the compositor (SPEC §5.3): straight-alpha RGBA8, integer math, after
// the formulas of Aseprite (`rgba_blender_normal` and pixman's `MUL_UN8`).
//
// One pixel of the normal blend. B is the backdrop (Br, Bg, Bb, Ba), S the source
// (Sr, Sg, Sb, Sa), o the opacity and R the result; every value is an integer 0..255.
//
//     mul(a, b) = ((t >> 8) + t) >> 8   with t = a * b + 128
//
//     a = mul(Sa, o)                                      source alpha after opacity
//
//     1. a = 0        R = B                               the source adds nothing
//     2. Ba = 0       R = (Sr, Sg, Sb, a)                 nothing below: the source, unmixed
//     3. otherwise    Ra = a + Ba - mul(Ba, a)
//                     Rc = Bc + trunc((Sc - Bc) * a / Ra)     for c = r, g, b
//
// The first rule that applies is used. `mul(a, b)` is a * b / 255 rounded to the nearest
// integer (a tie cannot occur) and `trunc` rounds toward zero, as integer division does in C.
//
// What follows from the rules:
// - mul(a, 255) = a: opacity 255 leaves the source alpha as it is.
// - With a = 255, rule 3 gives Ra = 255 and Rc = Sc: an opaque source replaces the backdrop.
//   `blendNormal` takes that shortcut.
// - Ra is at least max(a, Ba) and at most 255, and Rc lies between Bc and Sc.
// - Over a backdrop that starts as transparent black, a result with alpha 0 is always
//   (0, 0, 0, 0): colour stored under alpha 0 never reaches the composite. This is the one
//   place where the rules leave Aseprite's function, which tests Ba = 0 first and so keeps the
//   source colour under a result alpha of 0. Every result with alpha above 0 is the same.

/** `a * b / 255` rounded to the nearest integer, for integers 0..255. */
export function mul255(a: number, b: number): number {
    const t = a * b + 128;
    return ((t >> 8) + t) >> 8;
}

/**
 * Blends `count` pixels of `source`, starting at byte `sourceAt`, onto the pixels of `target`
 * starting at byte `targetAt`, in place. `opacity` (integer 0..255) scales the source alpha.
 * Both arrays are straight RGBA8; the two runs of pixels must not overlap.
 */
export type BlendFunction = (
    target: Uint8ClampedArray,
    targetAt: number,
    source: Uint8ClampedArray,
    sourceAt: number,
    count: number,
    opacity: number,
) => void;

const blendNormal: BlendFunction = (target, targetAt, source, sourceAt, count, opacity) => {
    const end = targetAt + count * 4;
    for (let t = targetAt, s = sourceAt; t < end; t += 4, s += 4) {
        const alpha = mul255(source[s + 3], opacity);
        if (alpha === 0) continue;
        const backdropAlpha = target[t + 3];
        if (backdropAlpha === 0 || alpha === 255) {
            target[t] = source[s];
            target[t + 1] = source[s + 1];
            target[t + 2] = source[s + 2];
            target[t + 3] = alpha;
            continue;
        }
        const resultAlpha = alpha + backdropAlpha - mul255(backdropAlpha, alpha);
        const red = target[t];
        const green = target[t + 1];
        const blue = target[t + 2];
        // The quotient of two integers this small is exact enough in a double for `| 0` to
        // be the integer division; `| 0` truncates toward zero for either sign.
        target[t] = red + ((((source[s] - red) * alpha) / resultAlpha) | 0);
        target[t + 1] = green + ((((source[s + 1] - green) * alpha) / resultAlpha) | 0);
        target[t + 2] = blue + ((((source[s + 2] - blue) * alpha) / resultAlpha) | 0);
        target[t + 3] = resultAlpha;
    }
};

/**
 * The blend function of every mode. Only `normal` is implemented: until SE-061 every other
 * mode blends as `normal`.
 */
export const BLEND_FUNCTIONS: Readonly<Record<BlendMode, BlendFunction>> = {
    normal: blendNormal,
    multiply: blendNormal,
    screen: blendNormal,
    overlay: blendNormal,
    darken: blendNormal,
    lighten: blendNormal,
    "color-dodge": blendNormal,
    "color-burn": blendNormal,
    "hard-light": blendNormal,
    "soft-light": blendNormal,
    difference: blendNormal,
    exclusion: blendNormal,
    hue: blendNormal,
    saturation: blendNormal,
    color: blendNormal,
    luminosity: blendNormal,
    addition: blendNormal,
    subtract: blendNormal,
    divide: blendNormal,
};
