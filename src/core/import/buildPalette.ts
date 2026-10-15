import { oklabToSrgb8, writeOklab } from "../color";
import type { PixelBuffer } from "../pixels";
import { MAX_PALETTE_COLORS, assertInteger } from "./errors";
import { KeyIndex } from "./keyIndex";
import { nearestColor } from "./nearestColor";

// Step 7 of SPEC §8, "reduce": one palette for all cells by median cut, refined by a fixed
// number of k-means iterations, with colour distance measured in OKLab.
//
// Determinism: the result depends only on which colours the buffers hold and how often, not
// on where the pixels are or how the buffers are split. Pixels are counted with integer sums,
// the colours are then processed in ascending order, and every choice between equals has a
// stated rule.

/** Lloyd iterations after the median cut (SPEC §8). */
const KMEANS_ITERATIONS = 8;

/** Largest number of points clustered; more distinct colours than this are merged first. */
const MAX_POINTS = 32768;

/**
 * The colours to cluster. A point is one distinct colour, or several close ones merged. Points
 * are in ascending order of their colour (merged ones: of the bits they have in common).
 */
interface Points {
    count: number;
    /** The point's colour as 0xRRGGBB; of merged colours, their mean. No two points share one. */
    rgb: Uint32Array;
    /** The OKLab coordinates of `rgb`, three per point. */
    lab: Float64Array;
    /** Number of pixels. */
    weight: Float64Array;
}

/**
 * Counts the pixels of each colour. While there are more than `MAX_POINTS` different
 * colours, colours are merged by their top 7, then 6, then 5 bits per channel; with 5 bits
 * there are never more. Bins hold integer sums, so their content does not depend on the
 * order in which the pixels arrive, and neither does the number of bits: a bit is dropped
 * exactly when all pixels together have too many colours at the current precision.
 */
class Histogram {
    /** The bins by their colour with the dropped bits cleared. */
    index = new KeyIndex();
    /** Per bin: the sums of red, green and blue over its pixels, and their number. */
    sums: number[] = [];
    private mask = 0xffffff;
    private dropped = 0;

    add(red: number, green: number, blue: number): void {
        const bin = this.index.add(((red << 16) | (green << 8) | blue) & this.mask) * 4;
        if (bin < this.sums.length) {
            this.sums[bin] += red;
            this.sums[bin + 1] += green;
            this.sums[bin + 2] += blue;
            this.sums[bin + 3]++;
            return;
        }
        this.sums.push(red, green, blue, 1);
        while (this.index.size > MAX_POINTS) {
            this.dropBit();
        }
    }

    /** Merges the bins that agree once another low bit of every channel is cleared. */
    private dropBit(): void {
        this.dropped++;
        this.mask = ((0xff << this.dropped) & 0xff) * 0x010101;
        const { index, sums } = this;
        this.index = new KeyIndex();
        this.sums = [];
        for (let old = 0; old < index.size; old++) {
            const bin = this.index.add(index.keys[old] & this.mask) * 4;
            if (bin === this.sums.length) {
                this.sums.push(0, 0, 0, 0);
            }
            for (let field = 0; field < 4; field++) {
                this.sums[bin + field] += sums[old * 4 + field];
            }
        }
    }
}

/**
 * The points of all pixels with alpha above 0. A point's colour is the mean of its pixels,
 * rounded: for one distinct colour that colour itself, and for merged colours a colour that
 * agrees with them in the bits they share, so no two points have the same colour.
 *
 * Merging by one more bit puts at most eight bins into one, so more than `MAX_POINTS` / 8
 * points remain after it: more than any palette size.
 */
function pointsOf(buffers: Iterable<PixelBuffer>): Points {
    const histogram = new Histogram();
    for (const { data } of buffers) {
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] !== 0) {
                histogram.add(data[i], data[i + 1], data[i + 2]);
            }
        }
    }
    const { index, sums } = histogram;
    const count = index.size;
    const bins = Uint32Array.from({ length: count }, (_, bin) => bin).sort(
        (first, second) => index.keys[first] - index.keys[second],
    );
    const rgb = new Uint32Array(count);
    const lab = new Float64Array(count * 3);
    const weight = new Float64Array(count);
    for (let p = 0; p < count; p++) {
        const bin = bins[p] * 4;
        const pixels = sums[bin + 3];
        const red = Math.round(sums[bin] / pixels);
        const green = Math.round(sums[bin + 1] / pixels);
        const blue = Math.round(sums[bin + 2] / pixels);
        rgb[p] = (red << 16) | (green << 8) | blue;
        writeOklab(lab, p * 3, red, green, blue);
        weight[p] = pixels;
    }
    return { count, rgb, lab, weight };
}

/** A range `start` to `end - 1` of the point order, its mean and the axis to cut it on. */
interface Box {
    start: number;
    end: number;
    mean: [number, number, number];
    /** The OKLab axis (0 L, 1 a, 2 b) with the largest `spread`; the first of equals. */
    axis: number;
    /** Sum over the points of weight × squared distance from the mean, along `axis`. */
    spread: number;
}

function boxOf(points: Points, order: Uint32Array, start: number, end: number): Box {
    const { lab, weight } = points;
    const mean: [number, number, number] = [0, 0, 0];
    let total = 0;
    for (let i = start; i < end; i++) {
        const p = order[i];
        mean[0] += lab[p * 3] * weight[p];
        mean[1] += lab[p * 3 + 1] * weight[p];
        mean[2] += lab[p * 3 + 2] * weight[p];
        total += weight[p];
    }
    mean[0] /= total;
    mean[1] /= total;
    mean[2] /= total;
    let axis = 0;
    let spread = -1;
    for (let candidate = 0; candidate < 3; candidate++) {
        let sum = 0;
        for (let i = start; i < end; i++) {
            const p = order[i];
            const distance = lab[p * 3 + candidate] - mean[candidate];
            sum += distance * distance * weight[p];
        }
        if (sum > spread) {
            axis = candidate;
            spread = sum;
        }
    }
    return { start, end, mean, axis, spread };
}

/**
 * Median cut: `count` boxes of points, as their means (OKLab, three per box).
 *
 * The box cut next is the one with the largest spread among boxes of two or more points (of
 * equals, the one created first). It is cut across its axis, where the points sorted along
 * that axis (equal coordinates by ascending 0xRRGGBB) reach half of the box's pixels, always
 * leaving at least one point on each side. The lower half keeps the box's place; the upper
 * half becomes the last box.
 */
function medianCut(points: Points, count: number): Float64Array {
    const { lab, weight, rgb } = points;
    const order = Uint32Array.from({ length: points.count }, (_, i) => i);
    const boxes = [boxOf(points, order, 0, points.count)];
    while (boxes.length < count) {
        // There are more points than boxes, so some box holds two.
        let widest = -1;
        for (let i = 0; i < boxes.length; i++) {
            const splittable = boxes[i].end - boxes[i].start > 1;
            if (splittable && (widest === -1 || boxes[i].spread > boxes[widest].spread)) {
                widest = i;
            }
        }
        const { start, end, axis } = boxes[widest];
        order
            .subarray(start, end)
            .sort((p, q) => lab[p * 3 + axis] - lab[q * 3 + axis] || rgb[p] - rgb[q]);
        let total = 0;
        for (let i = start; i < end; i++) {
            total += weight[order[i]];
        }
        let cut = start + 1;
        for (let below = weight[order[start]]; cut < end - 1 && below < total / 2; cut++) {
            below += weight[order[cut]];
        }
        boxes[widest] = boxOf(points, order, start, cut);
        boxes.push(boxOf(points, order, cut, end));
    }
    return Float64Array.from(boxes.flatMap((box) => box.mean));
}

/**
 * k-means, in place: every point joins its nearest centre (of equally near centres, the one
 * with the lowest index), then every centre moves to the mean of its points weighted by
 * pixels. A centre without points stays where it is.
 */
function refine(points: Points, centres: Float64Array): void {
    const { lab, weight } = points;
    const sums = new Float64Array((centres.length / 3) * 4);
    for (let iteration = 0; iteration < KMEANS_ITERATIONS; iteration++) {
        sums.fill(0);
        for (let p = 0; p < points.count; p++) {
            const c = nearestColor(centres, lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]);
            sums[c * 4] += lab[p * 3] * weight[p];
            sums[c * 4 + 1] += lab[p * 3 + 1] * weight[p];
            sums[c * 4 + 2] += lab[p * 3 + 2] * weight[p];
            sums[c * 4 + 3] += weight[p];
        }
        for (let c = 0; c * 3 < centres.length; c++) {
            if (sums[c * 4 + 3] > 0) {
                centres[c * 3] = sums[c * 4] / sums[c * 4 + 3];
                centres[c * 3 + 1] = sums[c * 4 + 1] / sums[c * 4 + 3];
                centres[c * 3 + 2] = sums[c * 4 + 2] / sums[c * 4 + 3];
            }
        }
    }
}

/**
 * The centres as 0xRRGGBB colours, all different. Two centres that round to one sRGB colour
 * would leave the palette short, so the later one is replaced by the colour of a point that
 * is not in the palette yet: the point the centres represent worst (largest pixels × squared
 * distance to its nearest centre; of equals, the smallest 0xRRGGBB).
 */
function colorsOf(points: Points, centres: Float64Array): number[] {
    const colors = new Set<number>();
    let missing = 0;
    for (let c = 0; c * 3 < centres.length; c++) {
        const [red, green, blue] = oklabToSrgb8(
            centres[c * 3],
            centres[c * 3 + 1],
            centres[c * 3 + 2],
        );
        const color = (red << 16) | (green << 8) | blue;
        if (colors.has(color)) {
            missing++;
        } else {
            colors.add(color);
        }
    }
    if (missing > 0) {
        const { lab, weight, rgb } = points;
        const error = Float64Array.from({ length: points.count }, (_, p) => {
            const c = nearestColor(centres, lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]);
            const dL = centres[c * 3] - lab[p * 3];
            const da = centres[c * 3 + 1] - lab[p * 3 + 1];
            const db = centres[c * 3 + 2] - lab[p * 3 + 2];
            return (dL * dL + da * da + db * db) * weight[p];
        });
        const worstFirst = Uint32Array.from({ length: points.count }, (_, p) => p).sort(
            (p, q) => error[q] - error[p] || rgb[p] - rgb[q],
        );
        // There are at least as many points as centres, each with a colour of its own.
        for (let i = 0; missing > 0; i++) {
            if (!colors.has(rgb[worstFirst[i]])) {
                colors.add(rgb[worstFirst[i]]);
                missing--;
            }
        }
    }
    return [...colors];
}

/** 0xRRGGBB colours as opaque 0xRRGGBBAA, darkest first (OKLab L; of equals, ascending value). */
function sortedPalette(colors: ArrayLike<number>): number[] {
    const lab = new Float64Array(3);
    const entries = Array.from(colors, (color) => {
        writeOklab(lab, 0, color >>> 16, (color >>> 8) & 0xff, color & 0xff);
        return { color, lightness: lab[0] };
    });
    entries.sort((x, y) => x.lightness - y.lightness || x.color - y.color);
    return entries.map(({ color }) => ((color << 8) | 0xff) >>> 0);
}

/**
 * Step 7, "reduce": one palette of at most `count` colours for all `buffers` together.
 *
 * - Fully transparent pixels are ignored; of every other pixel only R, G and B count.
 * - When the buffers hold at most `count` distinct colours the palette is exactly those
 *   colours. Otherwise it has exactly `count` colours, all different: the buffers' colours
 *   are split into `count` groups by median cut in OKLab, and the group means are refined
 *   by 8 k-means iterations.
 * - Colours are opaque 0xRRGGBBAA, ordered from dark to light.
 * - Deterministic: the same pixels give the same palette, in any order and split over any
 *   number of buffers.
 * - `buffers` is read once, in order, so an iterable can hand them out one at a time (the
 *   palette from the sprite of SE-060 reads the composite of each frame).
 *
 * Throws `ImportError` ("settings") when `count` is not an integer 1..256.
 */
export function buildPalette(buffers: Iterable<PixelBuffer>, count: number): number[] {
    assertInteger("Palette size", count, 1, MAX_PALETTE_COLORS);
    const points = pointsOf(buffers);
    // So few points are never merged ones: they are the buffers' own colours.
    if (points.count <= count) {
        return sortedPalette(points.rgb);
    }
    const centres = medianCut(points, count);
    refine(points, centres);
    return sortedPalette(colorsOf(points, centres));
}
