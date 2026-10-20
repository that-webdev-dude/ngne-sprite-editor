import type { BlendMode } from "../model";

// Blend functions of the compositor (SPEC §5.3): straight-alpha RGBA8, integer math, after
// the formulas of Aseprite (`rgba_blender_normal` and pixman's `MUL_UN8`). The normal blend
// first; the other modes (SE-061) after it.
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

/**
 * `a * b / 255` rounded to the nearest integer, for integers 0..255. With `a` from -255 to -1
 * it is pixman's `MUL_UN8` of a negative `int` (the blend modes' merge, below).
 */
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

// The other 18 modes (SE-061) follow Aseprite's "new blending method", `RGBA_BLENDER_N` in its
// `doc/blend_funcs.cpp`, which Aseprite uses by default (preference `experimental.new_blend`,
// default true). Each mode has a mixing function X that gives a colour from the backdrop's
// colour and the source's colour (below). Then, with a, B, S and R as for the normal blend:
//
//     1. a = 0        R = B
//     2. Ba = 0       R = (Sr, Sg, Sb, a)                 nothing below: the source, unmixed
//     3. otherwise    Ra = a + Ba - mul(Ba, a)
//                     Nc = Bc + trunc((Sc - Bc) * a / Ra)     the normal blend of S
//                     Lc = Bc + trunc((Xc - Bc) * a / Ra)     the normal blend of X, alpha of S
//                     Mc = Nc + mul(Lc - Nc, Ba)              `rgba_blender_merge` of the two
//                     Rc = Mc + mul(Lc - Mc, mul(Ba, a))      and of that and L once more
//
// mul of a negative product is pixman's `MUL_UN8` on a C `int`: its shifts keep the sign, as
// `>>` does, so `mul255` computes it for either sign. Over an opaque backdrop with an opaque
// source R = X. Over a translucent backdrop the mixed colour weighs more than in the W3C
// compositing formula Rc = (1 - Ba) * Sc + Ba * Xc: that is Aseprite's function, and so the
// editor's. Rules 1 and 2 leave Aseprite's function as the normal blend does (a result with
// alpha 0 is (0, 0, 0, 0)); every result with alpha above 0 is the same.
//
// The mixing functions, per channel for all but the last four (b of the backdrop, s of the
// source, integers 0..255; div(x, y) = trunc((x * 255 + trunc(y / 2)) / y), pixman's `DIV_UN8`):
//
//     multiply      mul(b, s)
//     screen        b + s - mul(b, s)
//     overlay       hard-light with b and s exchanged
//     darken        min(b, s)
//     lighten       max(b, s)
//     color-dodge   b = 0: 0; b >= 255 - s: 255; otherwise div(b, 255 - s)
//     color-burn    b = 255: 255; 255 - b >= s: 0; otherwise 255 - div(255 - b, s)
//     hard-light    s < 128: mul(b, 2s); otherwise screen of b and 2s - 255
//     soft-light    in doubles, b and s divided by 255:
//                   d = b <= 0.25 ? ((16b - 12)b + 4)b : sqrt(b)
//                   r = s <= 0.5 ? b - (1 - 2s)b(1 - b) : b + (2s - 1)(d - b)
//                   trunc(r * 255 + 0.5)
//     difference    |b - s|
//     exclusion     b + s - 2 mul(b, s)
//     addition      min(b + s, 255)
//     subtract      max(b - s, 0)
//     divide        b = 0: 0; b >= s: 255; otherwise div(b, s)
//
// hue, saturation, color and luminosity are the W3C non-separable modes in doubles, as
// Aseprite writes them (`rgba_blender_hsl_*`): channels divided by 255, Lum = 0.3r + 0.59g +
// 0.11b, the W3C ClipColor (both of its tests read the colour as it was before either), SetLum
// and SetSat (SetSat of a grey gives black), and each result channel trunc(255 * c):
//
//     hue           SetLum(SetSat(S, Sat(B)), Lum(B))
//     saturation    SetLum(SetSat(B, Sat(S)), Lum(B))
//     color         SetLum(S, Lum(B))
//     luminosity    SetLum(B, Lum(S))

/** pixman's `DIV_UN8`: `x * 255 / y` rounded, for 0 <= x < y <= 255. */
function div255(x: number, y: number): number {
    return ((x * 255 + (y >> 1)) / y) | 0;
}

/** The mixing function of a separable mode, for one channel. */
type ChannelMix = (b: number, s: number) => number;

const screen: ChannelMix = (b, s) => b + s - mul255(b, s);
const hardLight: ChannelMix = (b, s) => (s < 128 ? mul255(b, s << 1) : screen(b, (s << 1) - 255));

function softLight(backdrop: number, source: number): number {
    const b = backdrop / 255;
    const s = source / 255;
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
    const r = s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b);
    return (r * 255 + 0.5) | 0;
}

/**
 * The mixed colour of one pixel: from the backdrop's colour (br, bg, bb) and the source's (sr,
 * sg, sb), written into `out` (r, g, b; integers 0..255).
 */
type PixelMix = (
    br: number,
    bg: number,
    bb: number,
    sr: number,
    sg: number,
    sb: number,
    out: Int32Array,
) => void;

function separable(mix: ChannelMix): PixelMix {
    return (br, bg, bb, sr, sg, sb, out) => {
        out[0] = mix(br, sr);
        out[1] = mix(bg, sg);
        out[2] = mix(bb, sb);
    };
}

// The non-separable modes work on this colour in place: r, g, b from 0 to 1.
const colour = new Float64Array(3);

function lum(r: number, g: number, b: number): number {
    return 0.3 * r + 0.59 * g + 0.11 * b;
}

function sat(r: number, g: number, b: number): number {
    return Math.max(r, Math.max(g, b)) - Math.min(r, Math.min(g, b));
}

function loadColour(r: number, g: number, b: number): void {
    colour[0] = r / 255;
    colour[1] = g / 255;
    colour[2] = b / 255;
}

function clipColour(): void {
    const l = lum(colour[0], colour[1], colour[2]);
    const n = Math.min(colour[0], Math.min(colour[1], colour[2]));
    const x = Math.max(colour[0], Math.max(colour[1], colour[2]));
    if (n < 0) {
        for (let c = 0; c < 3; c++) colour[c] = l + ((colour[c] - l) * l) / (l - n);
    }
    if (x > 1) {
        for (let c = 0; c < 3; c++) colour[c] = l + ((colour[c] - l) * (1 - l)) / (x - l);
    }
}

function setLum(l: number): void {
    const d = l - lum(colour[0], colour[1], colour[2]);
    colour[0] += d;
    colour[1] += d;
    colour[2] += d;
    clipColour();
}

function setSat(s: number): void {
    const min = Math.min(Math.min(colour[0], colour[1]), colour[2]);
    const range = Math.max(Math.max(colour[0], colour[1]), colour[2]) - min;
    if (range > 0) {
        for (let c = 0; c < 3; c++) colour[c] = ((colour[c] - min) * s) / range;
    } else {
        colour.fill(0);
    }
}

function storeColour(out: Int32Array): void {
    out[0] = (255 * colour[0]) | 0;
    out[1] = (255 * colour[1]) | 0;
    out[2] = (255 * colour[2]) | 0;
}

const hue: PixelMix = (br, bg, bb, sr, sg, sb, out) => {
    loadColour(br, bg, bb);
    const s = sat(colour[0], colour[1], colour[2]);
    const l = lum(colour[0], colour[1], colour[2]);
    loadColour(sr, sg, sb);
    setSat(s);
    setLum(l);
    storeColour(out);
};

const saturation: PixelMix = (br, bg, bb, sr, sg, sb, out) => {
    loadColour(sr, sg, sb);
    const s = sat(colour[0], colour[1], colour[2]);
    loadColour(br, bg, bb);
    const l = lum(colour[0], colour[1], colour[2]);
    setSat(s);
    setLum(l);
    storeColour(out);
};

const color: PixelMix = (br, bg, bb, sr, sg, sb, out) => {
    loadColour(br, bg, bb);
    const l = lum(colour[0], colour[1], colour[2]);
    loadColour(sr, sg, sb);
    setLum(l);
    storeColour(out);
};

const luminosity: PixelMix = (br, bg, bb, sr, sg, sb, out) => {
    loadColour(sr, sg, sb);
    const l = lum(colour[0], colour[1], colour[2]);
    loadColour(br, bg, bb);
    setLum(l);
    storeColour(out);
};

/** One channel of rule 3 above: Rc from Bc, Sc and Xc. */
function mixChannel(
    b: number,
    s: number,
    x: number,
    alpha: number,
    resultAlpha: number,
    backdropAlpha: number,
    mergeAlpha: number,
): number {
    const normal = b + ((((s - b) * alpha) / resultAlpha) | 0);
    const mixed = b + ((((x - b) * alpha) / resultAlpha) | 0);
    const merged = normal + mul255(mixed - normal, backdropAlpha);
    return merged + mul255(mixed - merged, mergeAlpha);
}

// The mixed colour of the pixel being blended.
const mixed = new Int32Array(3);

/** The blend function of a mode other than normal, from its mixing function. */
function mixedBlend(mix: PixelMix): BlendFunction {
    return (target, targetAt, source, sourceAt, count, opacity) => {
        const end = targetAt + count * 4;
        for (let t = targetAt, s = sourceAt; t < end; t += 4, s += 4) {
            const alpha = mul255(source[s + 3], opacity);
            if (alpha === 0) continue;
            const backdropAlpha = target[t + 3];
            if (backdropAlpha === 0) {
                target[t] = source[s];
                target[t + 1] = source[s + 1];
                target[t + 2] = source[s + 2];
                target[t + 3] = alpha;
                continue;
            }
            const red = target[t];
            const green = target[t + 1];
            const blue = target[t + 2];
            mix(red, green, blue, source[s], source[s + 1], source[s + 2], mixed);
            const resultAlpha = alpha + backdropAlpha - mul255(backdropAlpha, alpha);
            const mergeAlpha = mul255(backdropAlpha, alpha);
            target[t] = mixChannel(
                red,
                source[s],
                mixed[0],
                alpha,
                resultAlpha,
                backdropAlpha,
                mergeAlpha,
            );
            target[t + 1] = mixChannel(
                green,
                source[s + 1],
                mixed[1],
                alpha,
                resultAlpha,
                backdropAlpha,
                mergeAlpha,
            );
            target[t + 2] = mixChannel(
                blue,
                source[s + 2],
                mixed[2],
                alpha,
                resultAlpha,
                backdropAlpha,
                mergeAlpha,
            );
            target[t + 3] = resultAlpha;
        }
    };
}

/** The blend function of every mode (SPEC §5.1 `BlendMode`), each one its own. */
export const BLEND_FUNCTIONS: Readonly<Record<BlendMode, BlendFunction>> = {
    normal: blendNormal,
    multiply: mixedBlend(separable(mul255)),
    screen: mixedBlend(separable(screen)),
    overlay: mixedBlend(separable((b, s) => hardLight(s, b))),
    darken: mixedBlend(separable(Math.min)),
    lighten: mixedBlend(separable(Math.max)),
    "color-dodge": mixedBlend(
        separable((b, s) => (b === 0 ? 0 : b >= 255 - s ? 255 : div255(b, 255 - s))),
    ),
    "color-burn": mixedBlend(
        separable((b, s) => (b === 255 ? 255 : 255 - b >= s ? 0 : 255 - div255(255 - b, s))),
    ),
    "hard-light": mixedBlend(separable(hardLight)),
    "soft-light": mixedBlend(separable(softLight)),
    difference: mixedBlend(separable((b, s) => Math.abs(b - s))),
    exclusion: mixedBlend(separable((b, s) => b + s - 2 * mul255(b, s))),
    hue: mixedBlend(hue),
    saturation: mixedBlend(saturation),
    color: mixedBlend(color),
    luminosity: mixedBlend(luminosity),
    addition: mixedBlend(separable((b, s) => Math.min(b + s, 255))),
    subtract: mixedBlend(separable((b, s) => Math.max(b - s, 0))),
    divide: mixedBlend(separable((b, s) => (b === 0 ? 0 : b >= s ? 255 : div255(b, s)))),
};
