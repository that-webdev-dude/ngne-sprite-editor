// Writes `se-061-blend-golden.json`, the expected composites of the SE-061 golden tests:
//
//     node tests/unit/fixtures/se-061-blend-golden.generate.mjs
//
// The values come from Aseprite's published blend functions, transcribed here line by line
// from its source, not from the editor's compositor (`src/core/composite`), which this file
// does not import:
//
// - `src/doc/blend_funcs.cpp` of aseprite/aseprite (main, 2025): `rgba_blender_normal`,
//   `rgba_blender_merge`, the separable `blend_*` macros and functions, the `rgba_blender_*`
//   of each mode, the HSL helpers (`lum`, `sat`, `clip_color`, `set_lum`, `set_sat`) and the
//   macro `RGBA_BLENDER_N`, the "new blending method" that `get_rgba_blender` returns while
//   the preference `experimental.new_blend` is true, its default (`data/pref.xml`).
// - pixman's `MUL_UN8` and `DIV_UN8` (`pixman-combine32.h`), and the packing of `color_t` in
//   `src/doc/color.h`: r in bits 0-7, g 8-15, b 16-23, a 24-31; `rgba()` takes `uint8_t`.
// - Pixels are written "rrggbbaa", one string per row with the pixels separated by spaces.
// - The opacity of a cel in a composite is `MUL_UN8(cel opacity, layer opacity)` (Aseprite's
//   renderer); the layers are blended bottom to top over a transparent canvas.
//
// C semantics kept: `int` arithmetic with shifts that keep the sign, integer division that
// truncates toward zero, `uint8_t` conversion modulo 256, `int(double)` truncation.
//
// One documented difference from Aseprite (SPEC §5.3, `blend.ts`): a composite pixel with
// alpha 0 is stored as (0, 0, 0, 0). Aseprite keeps the colour there; no blend reads the
// colour of a backdrop with alpha 0, so every pixel with alpha above 0 is Aseprite's.

import { writeFileSync } from "node:fs";

// --- C helpers -----------------------------------------------------------------------------

const u8 = (value) => value & 0xff;
const cdiv = (a, b) => Math.trunc(a / b);
const MUL_UN8 = (a, b) => {
    const t = a * (b & 0xffff) + 0x80;
    return ((t >> 8) + t) >> 8;
};
const DIV_UN8 = (a, b) => cdiv((a & 0xffff) * 0xff + cdiv(b, 2), b);
const ABS = Math.abs;

const rgba_a_mask = 0xff000000;
const rgba_rgb_mask = 0x00ffffff;
const rgba = (r, g, b, a) => (u8(r) | (u8(g) << 8) | (u8(b) << 16) | (u8(a) << 24)) >>> 0;
const rgba_getr = (c) => c & 0xff;
const rgba_getg = (c) => (c >>> 8) & 0xff;
const rgba_getb = (c) => (c >>> 16) & 0xff;
const rgba_geta = (c) => (c >>> 24) & 0xff;
/** `rgba(r, g, b, 0) | (src & rgba_a_mask)` */
const withAlphaOf = (src, r, g, b) => (rgba(r, g, b, 0) | (src & rgba_a_mask)) >>> 0;

// --- blend_funcs.cpp -------------------------------------------------------------------------

const blend_multiply = (b, s) => MUL_UN8(b, s);
const blend_screen = (b, s) => b + s - MUL_UN8(b, s);
const blend_hard_light = (b, s) =>
    s < 128 ? blend_multiply(b, s << 1) : blend_screen(b, (s << 1) - 255);
const blend_overlay = (b, s) => blend_hard_light(s, b);
const blend_darken = (b, s) => Math.min(b, s);
const blend_lighten = (b, s) => Math.max(b, s);
const blend_difference = (b, s) => ABS(b - s);
const blend_exclusion = (b, s) => {
    const t = MUL_UN8(b, s);
    return b + s - 2 * t;
};

function blend_divide(b, s) {
    if (b === 0) return 0;
    else if (b >= s) return 255;
    else return DIV_UN8(b, s);
}

function blend_color_dodge(b, s) {
    if (b === 0) return 0;
    s = 255 - s;
    if (b >= s) return 255;
    else return DIV_UN8(b, s);
}

function blend_color_burn(b, s) {
    if (b === 255) return 255;
    b = 255 - b;
    if (b >= s) return 0;
    else return 255 - DIV_UN8(b, s);
}

function blend_soft_light(_b, _s) {
    const b = _b / 255.0;
    const s = _s / 255.0;
    let r, d;
    if (b <= 0.25) d = ((16 * b - 12) * b + 4) * b;
    else d = Math.sqrt(b);
    if (s <= 0.5) r = b - (1.0 - 2.0 * s) * b * (1.0 - b);
    else r = b + (2.0 * s - 1.0) * (d - b);
    return Math.trunc(r * 255 + 0.5) >>> 0;
}

function rgba_blender_merge(backdrop, src, opacity) {
    const Br = rgba_getr(backdrop);
    const Bg = rgba_getg(backdrop);
    const Bb = rgba_getb(backdrop);
    const Ba = rgba_geta(backdrop);
    const Sr = rgba_getr(src);
    const Sg = rgba_getg(src);
    const Sb = rgba_getb(src);
    const Sa = rgba_geta(src);
    let Rr, Rg, Rb;
    if (Ba === 0) {
        Rr = Sr;
        Rg = Sg;
        Rb = Sb;
    } else if (Sa === 0) {
        Rr = Br;
        Rg = Bg;
        Rb = Bb;
    } else {
        Rr = Br + MUL_UN8(Sr - Br, opacity);
        Rg = Bg + MUL_UN8(Sg - Bg, opacity);
        Rb = Bb + MUL_UN8(Sb - Bb, opacity);
    }
    const Ra = Ba + MUL_UN8(Sa - Ba, opacity);
    if (Ra === 0) Rr = Rg = Rb = 0;
    return rgba(Rr, Rg, Rb, Ra);
}

function rgba_blender_normal(backdrop, src, opacity) {
    if (!(backdrop & rgba_a_mask)) {
        let a = rgba_geta(src);
        a = MUL_UN8(a, opacity);
        return ((src & rgba_rgb_mask) | (a << 24)) >>> 0;
    } else if (!(src & rgba_a_mask)) {
        return backdrop;
    }
    const Br = rgba_getr(backdrop);
    const Bg = rgba_getg(backdrop);
    const Bb = rgba_getb(backdrop);
    const Ba = rgba_geta(backdrop);
    const Sr = rgba_getr(src);
    const Sg = rgba_getg(src);
    const Sb = rgba_getb(src);
    let Sa = rgba_geta(src);
    Sa = MUL_UN8(Sa, opacity);
    const Ra = Sa + Ba - MUL_UN8(Ba, Sa);
    const Rr = Br + cdiv((Sr - Br) * Sa, Ra);
    const Rg = Bg + cdiv((Sg - Bg) * Sa, Ra);
    const Rb = Bb + cdiv((Sb - Bb) * Sa, Ra);
    return rgba(Rr, Rg, Rb, Ra);
}

/** `rgba_blender_<name>` of a separable mode: blend each channel, then the normal blend. */
const separable = (blend) => (backdrop, src, opacity) => {
    const r = blend(rgba_getr(backdrop), rgba_getr(src));
    const g = blend(rgba_getg(backdrop), rgba_getg(src));
    const b = blend(rgba_getb(backdrop), rgba_getb(src));
    return rgba_blender_normal(backdrop, withAlphaOf(src, r, g, b), opacity);
};

const rgba_blender_addition = (backdrop, src, opacity) => {
    const r = rgba_getr(backdrop) + rgba_getr(src);
    const g = rgba_getg(backdrop) + rgba_getg(src);
    const b = rgba_getb(backdrop) + rgba_getb(src);
    src = withAlphaOf(src, Math.min(r, 255), Math.min(g, 255), Math.min(b, 255));
    return rgba_blender_normal(backdrop, src, opacity);
};

const rgba_blender_subtract = (backdrop, src, opacity) => {
    const r = rgba_getr(backdrop) - rgba_getr(src);
    const g = rgba_getg(backdrop) - rgba_getg(src);
    const b = rgba_getb(backdrop) - rgba_getb(src);
    src = withAlphaOf(src, Math.max(r, 0), Math.max(g, 0), Math.max(b, 0));
    return rgba_blender_normal(backdrop, src, opacity);
};

// HSV blenders. A colour is an array [r, g, b] of doubles, changed in place where C takes
// `double&`.

const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
const sat = (r, g, b) => Math.max(r, Math.max(g, b)) - Math.min(r, Math.min(g, b));

function clip_color(c) {
    const l = lum(c[0], c[1], c[2]);
    const n = Math.min(c[0], Math.min(c[1], c[2]));
    const x = Math.max(c[0], Math.max(c[1], c[2]));
    if (n < 0) {
        c[0] = l + ((c[0] - l) * l) / (l - n);
        c[1] = l + ((c[1] - l) * l) / (l - n);
        c[2] = l + ((c[2] - l) * l) / (l - n);
    }
    if (x > 1) {
        c[0] = l + ((c[0] - l) * (1 - l)) / (x - l);
        c[1] = l + ((c[1] - l) * (1 - l)) / (x - l);
        c[2] = l + ((c[2] - l) * (1 - l)) / (x - l);
    }
}

function set_lum(c, l) {
    const d = l - lum(c[0], c[1], c[2]);
    c[0] += d;
    c[1] += d;
    c[2] += d;
    clip_color(c);
}

function set_sat(c, s) {
    const minv = Math.min(Math.min(c[0], c[1]), c[2]);
    const maxv = Math.max(Math.max(c[0], c[1]), c[2]);
    const range = maxv - minv;
    if (range > 0.0) {
        c[0] = ((c[0] - minv) * s) / range;
        c[1] = ((c[1] - minv) * s) / range;
        c[2] = ((c[2] - minv) * s) / range;
    } else c[0] = c[1] = c[2] = 0.0;
}

const unit = (color) => [
    rgba_getr(color) / 255.0,
    rgba_getg(color) / 255.0,
    rgba_getb(color) / 255.0,
];
const hslResult = (src, c, backdrop, opacity) =>
    rgba_blender_normal(
        backdrop,
        withAlphaOf(
            src,
            Math.trunc(255.0 * c[0]),
            Math.trunc(255.0 * c[1]),
            Math.trunc(255.0 * c[2]),
        ),
        opacity,
    );

function rgba_blender_hsl_hue(backdrop, src, opacity) {
    const below = unit(backdrop);
    const s = sat(...below);
    const l = lum(...below);
    const c = unit(src);
    set_sat(c, s);
    set_lum(c, l);
    return hslResult(src, c, backdrop, opacity);
}

function rgba_blender_hsl_saturation(backdrop, src, opacity) {
    const above = unit(src);
    const s = sat(...above);
    const c = unit(backdrop);
    const l = lum(...c);
    set_sat(c, s);
    set_lum(c, l);
    return hslResult(src, c, backdrop, opacity);
}

function rgba_blender_hsl_color(backdrop, src, opacity) {
    const below = unit(backdrop);
    const l = lum(...below);
    const c = unit(src);
    set_lum(c, l);
    return hslResult(src, c, backdrop, opacity);
}

function rgba_blender_hsl_luminosity(backdrop, src, opacity) {
    const above = unit(src);
    const l = lum(...above);
    const c = unit(backdrop);
    set_lum(c, l);
    return hslResult(src, c, backdrop, opacity);
}

/** `RGBA_BLENDER_N(name)` */
const newBlender = (blender) => (backdrop, src, opacity) => {
    if (backdrop & rgba_a_mask) {
        const normal = rgba_blender_normal(backdrop, src, opacity);
        const blend = blender(backdrop, src, opacity);
        const Ba = rgba_geta(backdrop);
        const normalToBlendMerge = rgba_blender_merge(normal, blend, Ba);
        const srcTotalAlpha = MUL_UN8(rgba_geta(src), opacity);
        const compositeAlpha = MUL_UN8(Ba, srcTotalAlpha);
        return rgba_blender_merge(normalToBlendMerge, blend, compositeAlpha);
    } else return rgba_blender_normal(backdrop, src, opacity);
};

/** `get_rgba_blender(mode, newBlend = true)`, by the editor's names of the modes. */
const BLENDERS = {
    normal: rgba_blender_normal,
    multiply: newBlender(separable(blend_multiply)),
    screen: newBlender(separable(blend_screen)),
    overlay: newBlender(separable(blend_overlay)),
    darken: newBlender(separable(blend_darken)),
    lighten: newBlender(separable(blend_lighten)),
    "color-dodge": newBlender(separable(blend_color_dodge)),
    "color-burn": newBlender(separable(blend_color_burn)),
    "hard-light": newBlender(separable(blend_hard_light)),
    "soft-light": newBlender(separable(blend_soft_light)),
    difference: newBlender(separable(blend_difference)),
    exclusion: newBlender(separable(blend_exclusion)),
    hue: newBlender(rgba_blender_hsl_hue),
    saturation: newBlender(rgba_blender_hsl_saturation),
    color: newBlender(rgba_blender_hsl_color),
    luminosity: newBlender(rgba_blender_hsl_luminosity),
    addition: newBlender(rgba_blender_addition),
    subtract: newBlender(rgba_blender_subtract),
    divide: newBlender(separable(blend_divide)),
};

// --- composites ------------------------------------------------------------------------------

/** "rrggbbaa" → color_t */
const parse = (hex) =>
    rgba(...[0, 2, 4, 6].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)));
/** color_t → "rrggbbaa", alpha 0 stored as transparent black (see the top of this file). */
const format = (color) =>
    rgba_geta(color) === 0
        ? "00000000"
        : [rgba_getr(color), rgba_getg(color), rgba_getb(color), rgba_geta(color)]
              .map((value) => value.toString(16).padStart(2, "0"))
              .join("");

/**
 * The composite of layers over a transparent canvas, bottom first; each layer is
 * { mode, opacity, celOpacity, pixels: ["rrggbbaa", …] }.
 */
function composite(layers) {
    const count = layers[0].pixels.length;
    const canvas = new Array(count).fill(0);
    for (const layer of layers) {
        const blender = BLENDERS[layer.mode];
        const opacity = MUL_UN8(layer.celOpacity, layer.opacity);
        for (let index = 0; index < count; index++) {
            canvas[index] = blender(canvas[index], parse(layer.pixels[index]), opacity);
        }
    }
    return canvas.map(format);
}

// --- the fixture -----------------------------------------------------------------------------

// 4 × 4, row by row. Alpha 0 (one with colour stored under it), half (128), other translucent
// values and 255; colours chosen to reach each branch of the mixing functions (0 and 255,
// both sides of 128, b >= s and b < s, greys for the HSL modes' SetSat of a grey).
const BACKDROP = [
    ["00000000", "c8643200", "ffffffff", "000000ff"],
    ["80402080", "0ac8fa80", "ff0080ff", "3cb45aff"],
    ["7f8081ff", "fa058040", "222222ff", "dcdc0ac8"],
    ["0080ffff", "64646480", "fffe01ff", "11f0811e"],
].flat();
const SOURCE = [
    ["ff0000ff", "00ff00ff", "0000ff80", "5a5a5a00"],
    ["ffffffff", "00000080", "808080ff", "c81ea0ff"],
    ["0afa7f80", "8040ffff", "4d4d4d00", "f0108001"],
    ["ff800080", "40c020ff", "01fe7fc8", "6432c8ff"],
].flat();

/** Layer opacity and cel opacity of the source layer. */
const OPACITIES = [
    [255, 255],
    [255, 128],
    [200, 90],
];

const cases = [];
for (const mode of Object.keys(BLENDERS)) {
    for (const [opacity, celOpacity] of OPACITIES) {
        const layers = [
            { mode: "normal", opacity: 255, celOpacity: 255, pixels: BACKDROP },
            { mode, opacity, celOpacity, pixels: SOURCE },
        ];
        cases.push({ mode, opacity, celOpacity, expected: composite(layers) });
    }
}

// The pixels of the SE-010 test that this ticket's modes replace (se-010-composite-frame,
// "blend functions"): 4 × 1, both layers in the mode, the upper at opacity 200 and cel 90.
const SE010 = {
    lower: ["0000ffff", "c83cfa80", "00000000", "0ac81eb4"],
    upper: ["ff000080", "64320780", "ff0000ff", "fa0a82c8"],
};
const se010 = Object.fromEntries(
    Object.keys(BLENDERS).map((mode) => [
        mode,
        composite([
            { mode, opacity: 255, celOpacity: 255, pixels: SE010.lower },
            { mode, opacity: 200, celOpacity: 90, pixels: SE010.upper },
        ]),
    ]),
);

/** Pixels as one string per row of `width`, the pixels of a row separated by spaces. */
const rows = (pixels, width) =>
    Array.from({ length: pixels.length / width }, (_, row) =>
        pixels.slice(row * width, (row + 1) * width).join(" "),
    );

const fixture = {
    about: "Generated by se-061-blend-golden.generate.mjs from Aseprite's blend functions; do not edit.",
    width: 4,
    height: 4,
    backdrop: rows(BACKDROP, 4),
    source: rows(SOURCE, 4),
    cases: cases.map(({ expected, ...rest }) => ({ ...rest, expected: rows(expected, 4) })),
    se010: {
        lower: rows(SE010.lower, 4),
        upper: rows(SE010.upper, 4),
        expected: Object.fromEntries(
            Object.entries(se010).map(([mode, pixels]) => [mode, rows(pixels, 4)]),
        ),
    },
};
writeFileSync(
    new URL("./se-061-blend-golden.json", import.meta.url),
    `${JSON.stringify(fixture, null, 4)}\n`,
);
