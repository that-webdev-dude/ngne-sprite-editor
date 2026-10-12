import { writeOklab } from "../color";
import { clonePixelBuffer } from "../pixels";
import type { PixelBuffer } from "../pixels";
import { ImportError } from "./errors";
import { KeyIndex } from "./keyIndex";
import { nearestColor } from "./nearestColor";

// Steps 7 and 8 of SPEC §8: every pixel replaced by a palette colour, the nearest in OKLab,
// with optional dithering.

/**
 * - `none`: every pixel takes its nearest palette colour.
 * - `bayer`: ordered dithering with the 4×4 Bayer matrix.
 * - `floyd-steinberg`: error diffusion, left to right and top to bottom.
 */
export type DitherMethod = "none" | "bayer" | "floyd-steinberg";

export interface MapOptions {
    dither: DitherMethod;
}

/** The 4×4 Bayer matrix, row-major: the order in which the pixels of a 4×4 tile switch over. */
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The palette colours a pixel can take: three sRGB bytes and three OKLab coordinates each. */
interface Candidates {
    rgb: Uint8Array;
    lab: Float64Array;
}

/** The palette entries with alpha above 0, in palette order; an entry with alpha 0 is no colour. */
function candidatesOf(palette: readonly number[]): Candidates {
    const visible = palette.filter((color) => (color & 0xff) !== 0);
    if (visible.length === 0) {
        throw new ImportError("settings", "The palette has no colour to map to.");
    }
    const rgb = new Uint8Array(visible.length * 3);
    const lab = new Float64Array(visible.length * 3);
    visible.forEach((color, i) => {
        rgb.set([color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff], i * 3);
        writeOklab(lab, i * 3, rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    });
    return { rgb, lab };
}

/**
 * How one source colour is dithered between two candidates: `second` is taken where the
 * Bayer threshold lies below `share`, `first` elsewhere.
 */
interface Mix {
    first: number;
    second: number;
    /** 0..0.5: how far the colour lies from `first` towards `second`. */
    share: number;
}

/**
 * The pair of candidates for a colour: its nearest candidate, and the candidate nearest to
 * the colour's mirror image on the far side (the colour as far again from the first one), so
 * that the two lie on opposite sides of it. A colour that is a candidate itself has share 0.
 */
function mixOf(candidates: Candidates, L: number, a: number, b: number): Mix {
    const { lab } = candidates;
    const first = nearestColor(lab, L, a, b);
    const fL = lab[first * 3];
    const fa = lab[first * 3 + 1];
    const fb = lab[first * 3 + 2];
    const second = nearestColor(lab, 2 * L - fL, 2 * a - fa, 2 * b - fb);
    const dL = lab[second * 3] - fL;
    const da = lab[second * 3 + 1] - fa;
    const db = lab[second * 3 + 2] - fb;
    const length = dL * dL + da * da + db * db;
    if (length === 0) {
        return { first, second: first, share: 0 };
    }
    // The colour projected on the line from the first candidate to the second.
    const share = ((L - fL) * dL + (a - fa) * da + (b - fb) * db) / length;
    return { first, second, share: Math.min(0.5, Math.max(0, share)) };
}

function mapPlain(target: PixelBuffer, candidates: Candidates): void {
    const { data } = target;
    const { rgb } = candidates;
    const lab = new Float64Array(3);
    // One search per distinct colour.
    const colors = new KeyIndex();
    const mapped: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) {
            continue;
        }
        const number = colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
        if (number === mapped.length) {
            writeOklab(lab, 0, data[i], data[i + 1], data[i + 2]);
            mapped.push(nearestColor(candidates.lab, lab[0], lab[1], lab[2]) * 3);
        }
        const c = mapped[number];
        data[i] = rgb[c];
        data[i + 1] = rgb[c + 1];
        data[i + 2] = rgb[c + 2];
    }
}

function mapBayer(target: PixelBuffer, candidates: Candidates): void {
    const { data, width, height } = target;
    const { rgb } = candidates;
    const lab = new Float64Array(3);
    const colors = new KeyIndex();
    const mixes: Mix[] = [];
    for (let y = 0, i = 0; y < height; y++) {
        for (let x = 0; x < width; x++, i += 4) {
            if (data[i + 3] === 0) {
                continue;
            }
            const number = colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
            if (number === mixes.length) {
                writeOklab(lab, 0, data[i], data[i + 1], data[i + 2]);
                mixes.push(mixOf(candidates, lab[0], lab[1], lab[2]));
            }
            const mix = mixes[number];
            // Thresholds 1/32, 3/32, … 31/32, placed by the matrix from the top-left pixel.
            const threshold = (BAYER_4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
            const c = (mix.share > threshold ? mix.second : mix.first) * 3;
            data[i] = rgb[c];
            data[i + 1] = rgb[c + 1];
            data[i + 2] = rgb[c + 2];
        }
    }
}

function mapFloydSteinberg(target: PixelBuffer, candidates: Candidates): void {
    const { data, width, height } = target;
    const { rgb } = candidates;
    const lab = new Float64Array(3);
    const colors = new KeyIndex();
    const mapped: number[] = [];
    // The error carried into each pixel of this row and the next, in sRGB units per channel,
    // with one unused pixel before and after the row.
    let row = new Float64Array((width + 2) * 3);
    let below = new Float64Array((width + 2) * 3);
    /** Passes on the error of the channel at `at`: 7/16 right, 3/16, 5/16 and 1/16 below. */
    const diffuse = (at: number, error: number): void => {
        row[at + 3] += (error * 7) / 16;
        below[at - 3] += (error * 3) / 16;
        below[at] += (error * 5) / 16;
        below[at + 3] += error / 16;
    };
    for (let y = 0, i = 0; y < height; y++) {
        for (let x = 0, e = 3; x < width; x++, i += 4, e += 3) {
            // A fully transparent pixel takes no error and passes none on.
            if (data[i + 3] === 0) {
                continue;
            }
            const red = Math.min(255, Math.max(0, data[i] + row[e]));
            const green = Math.min(255, Math.max(0, data[i + 1] + row[e + 1]));
            const blue = Math.min(255, Math.max(0, data[i + 2] + row[e + 2]));
            const red8 = Math.round(red);
            const green8 = Math.round(green);
            const blue8 = Math.round(blue);
            const number = colors.add((red8 << 16) | (green8 << 8) | blue8);
            if (number === mapped.length) {
                writeOklab(lab, 0, red8, green8, blue8);
                mapped.push(nearestColor(candidates.lab, lab[0], lab[1], lab[2]) * 3);
            }
            const c = mapped[number];
            data[i] = rgb[c];
            data[i + 1] = rgb[c + 1];
            data[i + 2] = rgb[c + 2];
            diffuse(e, red - rgb[c]);
            diffuse(e + 1, green - rgb[c + 1]);
            diffuse(e + 2, blue - rgb[c + 2]);
        }
        const done = row;
        row = below;
        below = done.fill(0);
    }
}

/**
 * Steps 7 and 8: a copy of `source` in which every pixel has the R, G and B of a palette
 * colour (0xRRGGBBAA entries). Alpha is kept, and fully transparent pixels are copied
 * unchanged. Palette entries with alpha 0 are never used.
 *
 * - The nearest palette colour is the one at the smallest distance in OKLab; of equally near
 *   colours, the first in the palette. An image that uses only palette colours is returned
 *   unchanged, with every dither method.
 * - `bayer` mixes, per source colour, its nearest palette colour with the palette colour
 *   nearest to the opposite side of it. The second one is used on the share of the 4×4 tile
 *   that puts the mix closest to the source colour, at most half; the tile starts at the
 *   buffer's top-left pixel.
 * - `floyd-steinberg` visits pixels left to right, top to bottom. The difference between a
 *   pixel (plus the error it received, clipped to 0..255) and its palette colour, per sRGB
 *   channel, goes 7/16 right, 3/16 below left, 5/16 below and 1/16 below right.
 *
 * Throws `ImportError` ("settings") when the palette has no entry with alpha above 0.
 */
export function mapToPalette(
    source: PixelBuffer,
    palette: readonly number[],
    options: MapOptions,
): PixelBuffer {
    const candidates = candidatesOf(palette);
    const target = clonePixelBuffer(source);
    if (options.dither === "bayer") {
        mapBayer(target, candidates);
    } else if (options.dither === "floyd-steinberg") {
        mapFloydSteinberg(target, candidates);
    } else {
        mapPlain(target, candidates);
    }
    return target;
}
