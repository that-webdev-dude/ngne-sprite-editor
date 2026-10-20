import type { BitMask, DocSettings, PixelBuffer, TiledMode } from "../model";
import { floodMask } from "./flood";
import type { FloodOptions } from "./flood";
import type { PixelPoint } from "./line";

// Symmetry and tiled mode of the paint tools (SPEC §2.3 View, §5.1 `DocSettings`; SE-062).
//
// Symmetry mirrors what a stroke paints about a vertical axis (mode "x", horizontal symmetry:
// left and right), a horizontal axis (mode "y", vertical symmetry: top and bottom) or both.
// An axis is kept in half pixels from the canvas's left or top edge (`axisX`, `axisY`), so it
// lies on a pixel boundary (an even value) or through the middle of a pixel (an odd one): the
// mirror of pixel `x` is `axisX - 1 - x`, and with an odd value the pixel the axis runs
// through is its own mirror. Tiled mode wraps paint around the canvas's edges on X, Y or
// both: a pixel at `x` lands on `x mod width`.
//
// The paint goes through two write paths, which both map their rows of pixels here: the brush
// stamps and the filled runs of `Stamper` (`stroke.ts`: the brush tools, the contour, the
// spray) and the mark pass of `ShapeStroke` (`shapeStroke.ts`: line, rectangle, ellipse,
// curve, polygon). A run of a row becomes up to four runs (itself and its mirror images),
// each wrapped or clipped to the canvas, with integer arithmetic over the caller's buffers and
// nothing allocated. A run may come out twice where copies overlap (the centre column): the
// inks compute every pixel from the stroke's start, so a pixel written twice gets one value.
// The bucket mirrors its seed instead (`symmetricFloodMask`).

/** The symmetry and wrap a stroke paints with; null for none (`strokeSymmetry`). */
export interface StrokeSymmetry {
    /** Mirror left and right about the vertical axis at `axisX` half pixels. */
    readonly mirrorX: boolean;
    /** Mirror top and bottom about the horizontal axis at `axisY` half pixels. */
    readonly mirrorY: boolean;
    readonly axisX: number;
    readonly axisY: number;
    /** Wrap around the left and right edges (tiled mode X or both). */
    readonly wrapX: boolean;
    /** Wrap around the top and bottom edges (tiled mode Y or both). */
    readonly wrapY: boolean;
}

/**
 * The copies tiled mode draws around the canvas, in canvas sizes: (-1..1, -1..1) on the tiled
 * axes, the canvas's own (0, 0) left out. Two for X or Y, eight for both, none for "none".
 * The viewport's quads (`tiledCopies`) and the stroke echo (`tiledOffsets`) share it.
 */
export function tiledCopyOffsets(tiled: TiledMode): { x: number; y: number }[] {
    if (tiled === "none") return [];
    const across = tiled === "x" || tiled === "both" ? [-1, 0, 1] : [0];
    const down = tiled === "y" || tiled === "both" ? [-1, 0, 1] : [0];
    const offsets: { x: number; y: number }[] = [];
    for (const y of down) {
        for (const x of across) if (x !== 0 || y !== 0) offsets.push({ x, y });
    }
    return offsets;
}

/** Receives one run of a row inside the canvas: pixels `[from, to)` of row `y`. */
export type RunVisitor = (y: number, from: number, to: number) => void;

/** The symmetry and wrap of `settings`, or null when they mirror and wrap nothing. */
export function strokeSymmetry(
    settings: Pick<DocSettings, "symmetry" | "tiled">,
): StrokeSymmetry | null {
    const { mode, axisX, axisY } = settings.symmetry;
    const { tiled } = settings;
    const symmetry: StrokeSymmetry = {
        mirrorX: mode === "x" || mode === "both",
        mirrorY: mode === "y" || mode === "both",
        axisX,
        axisY,
        wrapX: tiled === "x" || tiled === "both",
        wrapY: tiled === "y" || tiled === "both",
    };
    return symmetry.mirrorX || symmetry.mirrorY || symmetry.wrapX || symmetry.wrapY
        ? symmetry
        : null;
}

/** `value` modulo `size`, from 0 to `size` - 1. */
function wrap(value: number, size: number): number {
    // Through `+ size`: a multiple of `size` below 0 gives 0, not -0.
    return ((value % size) + size) % size;
}

/** Visits the run `[from, to)` of row `y` wrapped (tiled) or clipped to the canvas. */
function placeRun(
    symmetry: StrokeSymmetry,
    width: number,
    height: number,
    y: number,
    from: number,
    to: number,
    visit: RunVisitor,
): void {
    if (symmetry.wrapY) y = wrap(y, height);
    else if (y < 0 || y >= height) return;
    if (!symmetry.wrapX) {
        const start = from < 0 ? 0 : from;
        const end = to > width ? width : to;
        if (start < end) visit(y, start, end);
        return;
    }
    const length = to - from;
    if (length <= 0) return;
    if (length >= width) {
        visit(y, 0, width);
        return;
    }
    const start = wrap(from, width);
    const end = start + length;
    if (end <= width) {
        visit(y, start, end);
    } else {
        visit(y, start, width);
        visit(y, 0, end - width);
    }
}

/**
 * Visits the runs the run `[from, to)` of row `y` paints with `symmetry` on a canvas of
 * `width` × `height`: the run and its mirror images, each wrapped around the edges in tiled
 * mode or clipped to the canvas. A mirror image equal to the run is left out; runs that only
 * overlap are each visited. On a tiled axis the run is first cut to the copies the viewport
 * draws, `[-size, 2 × size)`. Without symmetry the run is only clipped.
 */
export function forEachSymmetricRun(
    symmetry: StrokeSymmetry | null,
    width: number,
    height: number,
    y: number,
    from: number,
    to: number,
    visit: RunVisitor,
): void {
    if (!symmetry) {
        if (y < 0 || y >= height) return;
        const start = from < 0 ? 0 : from;
        const end = to > width ? width : to;
        if (start < end) visit(y, start, end);
        return;
    }
    const { mirrorX, mirrorY, axisX, axisY } = symmetry;
    // Tiled mode wraps what the viewport draws, the 3 × 3 of copies: on a tiled axis the
    // pointer's pixels beyond them paint nothing (SE-062 review E). Mirror images are made
    // from what is left, and wrapped wherever they land.
    if (symmetry.wrapY && (y < -height || y >= 2 * height)) return;
    if (symmetry.wrapX) {
        if (from < -width) from = -width;
        if (to > 2 * width) to = 2 * width;
        if (from >= to) return;
    }
    placeRun(symmetry, width, height, y, from, to, visit);
    const mirroredFrom = axisX - to;
    const mirroredTo = axisX - from;
    const mirrorsRun = mirrorX && mirroredFrom !== from;
    if (mirrorsRun) placeRun(symmetry, width, height, y, mirroredFrom, mirroredTo, visit);
    const mirroredY = axisY - 1 - y;
    if (!mirrorY || mirroredY === y) return;
    placeRun(symmetry, width, height, mirroredY, from, to, visit);
    if (mirrorsRun) placeRun(symmetry, width, height, mirroredY, mirroredFrom, mirroredTo, visit);
}

/**
 * The rows a filled shape's runs must be looked at in, for its pixels and their mirror images
 * on a canvas `height` pixels high: the canvas's rows, those whose mirror image lies on the
 * canvas, or in tiled mode Y the rows of the three copies drawn in a column.
 */
export function symmetricRows(
    symmetry: StrokeSymmetry | null,
    height: number,
): { first: number; last: number } {
    if (!symmetry) return { first: 0, last: height - 1 };
    if (symmetry.wrapY) return { first: -height, last: 2 * height - 1 };
    if (!symmetry.mirrorY) return { first: 0, last: height - 1 };
    // Row `y` mirrors to `axisY - 1 - y`, which lies on the canvas for these rows.
    return {
        first: Math.min(0, symmetry.axisY - height),
        last: Math.max(height - 1, symmetry.axisY - 1),
    };
}

/**
 * The pixels a press at `point` names with `symmetry` on a canvas of `width` × `height`: the
 * point wrapped onto the canvas in tiled mode, then its mirror images that lie on it (wrapped
 * too), each once. Empty when the point is off the canvas and not wrapped onto it: on a tiled
 * axis a point beyond the copies the viewport draws, `[-size, 2 × size)`, names nothing.
 */
export function symmetricPoints(
    symmetry: StrokeSymmetry | null,
    width: number,
    height: number,
    point: PixelPoint,
): PixelPoint[] {
    let { x, y } = point;
    if (symmetry?.wrapX && (x < -width || x >= 2 * width)) return [];
    if (symmetry?.wrapY && (y < -height || y >= 2 * height)) return [];
    if (symmetry?.wrapX) x = wrap(x, width);
    if (symmetry?.wrapY) y = wrap(y, height);
    if (x < 0 || x >= width || y < 0 || y >= height) return [];
    const points: PixelPoint[] = [{ x, y }];
    if (!symmetry) return points;
    const add = (px: number, py: number) => {
        if (symmetry.wrapX) px = wrap(px, width);
        if (symmetry.wrapY) py = wrap(py, height);
        if (px < 0 || px >= width || py < 0 || py >= height) return;
        if (points.some((seen) => seen.x === px && seen.y === py)) return;
        points.push({ x: px, y: py });
    };
    const mx = symmetry.axisX - 1 - x;
    const my = symmetry.axisY - 1 - y;
    if (symmetry.mirrorX) add(mx, y);
    if (symmetry.mirrorY) add(x, my);
    if (symmetry.mirrorX && symmetry.mirrorY) add(mx, my);
    return points;
}

/**
 * The bucket's area with symmetric seeds (SE-062): the flood mask of every seed
 * `symmetricPoints` names, each found in `source` before any paint, as their union. Painting
 * the union once keeps a later seed from reading what an earlier one wrote. Empty when the
 * press names no pixel of the canvas.
 */
export function symmetricFloodMask(
    source: PixelBuffer,
    seed: PixelPoint,
    options: FloodOptions,
    symmetry: StrokeSymmetry | null,
): BitMask {
    const seeds = symmetricPoints(symmetry, source.width, source.height, seed);
    const [first, ...others] = seeds;
    if (!first) {
        const { width, height } = source;
        return { width, height, data: new Uint8Array(Math.ceil((width * height) / 8)) };
    }
    const mask = floodMask(source, first, options);
    for (const other of others) {
        const more = floodMask(source, other, options).data;
        const data = mask.data;
        for (let index = 0; index < data.length; index++) data[index] = data[index] | more[index];
    }
    return mask;
}
