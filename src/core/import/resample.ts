import { clonePixelBuffer, createPixelBuffer } from "../pixels";
import type { PixelBuffer } from "../pixels";
import { assertInteger } from "./errors";
import { fitAxes, roundDivide } from "./fit";
import type { FitAxis as Axis, ResampleFit } from "./fit";
import { KeyIndex } from "./keyIndex";

// Step 5 of SPEC §8: a cell resampled to the target sprite size, placed as `fit.ts` says. All
// positions and weights are integers, so results are exact and the same on every machine.

/**
 * - `nearest`: the source pixel under the centre of each target pixel.
 * - `area`: the average of the source area each target pixel covers, colours weighted by alpha.
 * - `dominant`: the colour that covers most of that area.
 */
export type ResampleMethod = "nearest" | "area" | "dominant";

export interface ResampleOptions {
    method: ResampleMethod;
    fit: ResampleFit;
}

/**
 * The source pixels each target pixel of an axis covers: pixel `d` covers `first[d]` and the
 * following pixels, one per entry of `weight` from `offset[d]` up to `offset[d + 1]`. A
 * weight is the covered length of that source pixel in units of 1 / `unit`; the weights of
 * one target pixel add up to `step`.
 */
interface Spans {
    first: Int32Array;
    offset: Int32Array;
    weight: Float64Array;
}

function spansOf(axis: Axis): Spans {
    const first = new Int32Array(axis.count);
    const offset = new Int32Array(axis.count + 1);
    const weights: number[] = [];
    for (let d = 0; d < axis.count; d++) {
        const from = axis.origin + d * axis.step;
        const to = from + axis.step;
        first[d] = Math.floor(from / axis.unit);
        for (let i = first[d]; i * axis.unit < to; i++) {
            weights.push(Math.min((i + 1) * axis.unit, to) - Math.max(i * axis.unit, from));
        }
        offset[d + 1] = weights.length;
    }
    return { first, offset, weight: Float64Array.from(weights) };
}

function nearestInto(source: PixelBuffer, target: PixelBuffer, x: Axis, y: Axis): void {
    // The source pixel holding the centre of target pixel `d`.
    const pick = (axis: Axis, d: number): number =>
        Math.floor((2 * (axis.origin + d * axis.step) + axis.step) / (2 * axis.unit));
    const columns = Int32Array.from({ length: x.count }, (_, d) => pick(x, d));
    const from = source.data;
    const to = target.data;
    for (let dy = 0; dy < y.count; dy++) {
        const row = pick(y, dy) * source.width;
        let t = ((y.start + dy) * target.width + x.start) * 4;
        for (let dx = 0; dx < x.count; dx++, t += 4) {
            const s = (row + columns[dx]) * 4;
            to[t] = from[s];
            to[t + 1] = from[s + 1];
            to[t + 2] = from[s + 2];
            to[t + 3] = from[s + 3];
        }
    }
}

function averageInto(source: PixelBuffer, target: PixelBuffer, x: Axis, y: Axis): void {
    const columns = spansOf(x);
    const rows = spansOf(y);
    const area = x.step * y.step;
    const from = source.data;
    const to = target.data;
    for (let dy = 0; dy < y.count; dy++) {
        let t = ((y.start + dy) * target.width + x.start) * 4;
        for (let dx = 0; dx < x.count; dx++, t += 4) {
            // Sums of weight × alpha and of weight × alpha × colour: integers below 2^53.
            let alpha = 0;
            let red = 0;
            let green = 0;
            let blue = 0;
            let sourceRow = rows.first[dy] * source.width;
            for (let j = rows.offset[dy]; j < rows.offset[dy + 1]; j++, sourceRow += source.width) {
                const rowWeight = rows.weight[j];
                let s = (sourceRow + columns.first[dx]) * 4;
                for (let i = columns.offset[dx]; i < columns.offset[dx + 1]; i++, s += 4) {
                    const sourceAlpha = from[s + 3];
                    if (sourceAlpha !== 0) {
                        const weight = rowWeight * columns.weight[i] * sourceAlpha;
                        alpha += weight;
                        red += weight * from[s];
                        green += weight * from[s + 1];
                        blue += weight * from[s + 2];
                    }
                }
            }
            const targetAlpha = roundDivide(alpha, area);
            if (targetAlpha !== 0) {
                to[t] = roundDivide(red, alpha);
                to[t + 1] = roundDivide(green, alpha);
                to[t + 2] = roundDivide(blue, alpha);
                to[t + 3] = targetAlpha;
            }
        }
    }
}

/** The pixel at `i` as 0xRRGGBBAA; every fully transparent pixel is 0, whatever its RGB. */
function keyAt(data: Uint8ClampedArray, i: number): number {
    if (data[i + 3] === 0) {
        return 0;
    }
    return ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
}

function dominantInto(source: PixelBuffer, target: PixelBuffer, x: Axis, y: Axis): void {
    const columns = spansOf(x);
    const rows = spansOf(y);
    const from = source.data;
    const to = target.data;
    // The colours of one block, numbered in the order met, and the area each covers.
    const colors = new KeyIndex();
    const areas: number[] = [];
    for (let dy = 0; dy < y.count; dy++) {
        let t = ((y.start + dy) * target.width + x.start) * 4;
        for (let dx = 0; dx < x.count; dx++, t += 4) {
            colors.clear();
            areas.length = 0;
            let sourceRow = rows.first[dy] * source.width;
            for (let j = rows.offset[dy]; j < rows.offset[dy + 1]; j++, sourceRow += source.width) {
                const rowWeight = rows.weight[j];
                let s = (sourceRow + columns.first[dx]) * 4;
                for (let i = columns.offset[dx]; i < columns.offset[dx + 1]; i++, s += 4) {
                    const number = colors.add(keyAt(from, s));
                    const weight = rowWeight * columns.weight[i];
                    if (number === areas.length) {
                        areas.push(weight);
                    } else {
                        areas[number] += weight;
                    }
                }
            }
            // Strictly larger only: of colours covering the same area, the first met wins.
            let best = 0;
            for (let number = 1; number < areas.length; number++) {
                if (areas[number] > areas[best]) {
                    best = number;
                }
            }
            const color = colors.keys[best];
            to[t] = color >>> 24;
            to[t + 1] = (color >>> 16) & 0xff;
            to[t + 2] = (color >>> 8) & 0xff;
            to[t + 3] = color & 0xff;
        }
    }
}

/**
 * Steps 4 and 5: a copy of `source` at exactly `width` × `height` pixels.
 *
 * - A source that already has that size is returned as an unchanged copy, whatever the
 *   options say (SPEC §8: step 5 is skipped).
 * - `area` rounds halves up. A pixel's colour is the average of the colours it covers
 *   weighted by their alpha, so fully transparent pixels contribute no colour; a result with
 *   alpha 0 is transparent black.
 * - `dominant` treats all fully transparent pixels as one colour (transparent black). Among
 *   colours covering the same area, the one met first wins, reading the covered source
 *   pixels left to right, then top to bottom.
 * - `nearest` with fit `stretch` equals `resizeNearest` of `core/pixels`.
 * - The image lands on the rectangle `fitRect` reports for the same sizes and fit.
 *
 * Throws `ImportError` ("settings") when a side is not a positive integer.
 */
export function resample(
    source: PixelBuffer,
    width: number,
    height: number,
    options: ResampleOptions,
): PixelBuffer {
    assertInteger("Target width", width, 1);
    assertInteger("Target height", height, 1);
    if (source.width === width && source.height === height) {
        return clonePixelBuffer(source);
    }
    const target = createPixelBuffer(width, height);
    const [x, y] = fitAxes(source.width, source.height, width, height, options.fit);
    if (options.method === "nearest") {
        nearestInto(source, target, x, y);
    } else if (options.method === "area") {
        averageInto(source, target, x, y);
    } else {
        dominantInto(source, target, x, y);
    }
    return target;
}
