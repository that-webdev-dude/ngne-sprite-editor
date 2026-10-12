import type { Rect } from "../model";
import type { PixelRect } from "../pixels";
import { assertInteger } from "./errors";

// Step 4 of SPEC §8: which part of a cell lands on which part of the target sprite size. The
// one place that knows this geometry: `resample` draws by `fitAxes`, and `fitRect` reports the
// same axes as rectangles to callers that align something with the result.

/**
 * - `stretch`: the whole source fills the target; the aspect ratio is not kept.
 * - `contain`: the whole source, as large as fits, centred; the rest of the target is
 *   transparent.
 * - `cover`: the source fills the target, centred; what overflows is cut off.
 */
export type ResampleFit = "stretch" | "contain" | "cover";

/**
 * One axis of the mapping from target to source, in integers. The target pixels `start` to
 * `start + count - 1` receive the image; pixel `start + d` covers the source interval from
 * `(origin + d · step) / unit` to `(origin + (d + 1) · step) / unit`, in source pixels.
 */
export interface FitAxis {
    start: number;
    count: number;
    origin: number;
    step: number;
    unit: number;
}

/** `numerator / denominator` rounded to the nearest integer, halves up; both are integers ≥ 0. */
export function roundDivide(numerator: number, denominator: number): number {
    const remainder = numerator % denominator;
    return (numerator - remainder) / denominator + (2 * remainder >= denominator ? 1 : 0);
}

/** The whole source side over the whole target side. */
function whole(source: number, target: number): FitAxis {
    return { start: 0, count: target, origin: 0, step: source, unit: target };
}

/** The x and y axes of a fit; every size is a positive integer. */
export function fitAxes(
    sourceWidth: number,
    sourceHeight: number,
    width: number,
    height: number,
    fit: ResampleFit,
): [FitAxis, FitAxis] {
    // Positive when the target is the wider shape: the source then fits it by height.
    const wider = width * sourceHeight - height * sourceWidth;
    if (fit === "stretch" || wider === 0) {
        return [whole(sourceWidth, width), whole(sourceHeight, height)];
    }
    if (fit === "contain") {
        // The side that does not fill the target is rounded to whole pixels and centred; an
        // odd margin leaves the extra pixel after the image.
        if (wider > 0) {
            const count = Math.max(1, roundDivide(sourceWidth * height, sourceHeight));
            const start = Math.floor((width - count) / 2);
            return [{ ...whole(sourceWidth, count), start }, whole(sourceHeight, height)];
        }
        const count = Math.max(1, roundDivide(sourceHeight * width, sourceWidth));
        const start = Math.floor((height - count) / 2);
        return [whole(sourceWidth, width), { ...whole(sourceHeight, count), start }];
    }
    // Cover: the centred part of the source that has the target's aspect ratio. Its margin is
    // half of |wider| / target side source pixels, hence the unit of twice the target side.
    if (wider > 0) {
        const step = 2 * sourceWidth;
        const y = { start: 0, count: height, origin: wider, step, unit: 2 * width };
        return [whole(sourceWidth, width), y];
    }
    const step = 2 * sourceHeight;
    const x = { start: 0, count: width, origin: -wider, step, unit: 2 * height };
    return [x, whole(sourceHeight, height)];
}

/** Where a fit puts an image: `source` is what `target` shows. */
export interface FitRect {
    /**
     * The part of the source that is shown, in source pixels. The whole source for `stretch`
     * and `contain`. For `cover` the centred part with the target's aspect ratio, which may
     * begin and end inside a pixel, so its numbers need not be integers.
     */
    source: Rect;
    /**
     * The target pixels that show it, in whole pixels. The whole target for `stretch` and
     * `cover`. For `contain` the centred image; the target pixels outside it are transparent.
     */
    target: PixelRect;
}

/**
 * The rectangles `resample` works with for a source of `sourceWidth` × `sourceHeight` pixels
 * and a target of `width` × `height`: target pixel (`target.x + i`, `target.y + j`) shows the
 * source from `source.x + i · source.width / target.width` over the next
 * `source.width / target.width` source pixels, and likewise down the rows.
 *
 * - When both have one aspect ratio, every fit gives the whole source on the whole target.
 * - `contain` rounds the side that does not fill the target to whole pixels (halves up, at
 *   least 1) and centres it; of an odd margin the smaller half comes first. The two sides
 *   may therefore be scaled by slightly different factors.
 * - `cover` scales both sides by the same factor exactly.
 *
 * Throws `ImportError` ("settings") when a size is not a positive integer.
 */
export function fitRect(
    sourceWidth: number,
    sourceHeight: number,
    width: number,
    height: number,
    fit: ResampleFit,
): FitRect {
    assertInteger("Source width", sourceWidth, 1);
    assertInteger("Source height", sourceHeight, 1);
    assertInteger("Target width", width, 1);
    assertInteger("Target height", height, 1);
    const [x, y] = fitAxes(sourceWidth, sourceHeight, width, height, fit);
    return {
        source: {
            x: x.origin / x.unit,
            y: y.origin / y.unit,
            width: (x.count * x.step) / x.unit,
            height: (y.count * y.step) / y.unit,
        },
        target: { x: x.start, y: y.start, width: x.count, height: y.count },
    };
}
