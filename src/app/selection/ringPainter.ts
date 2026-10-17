import type { Rect } from "../../core/model";
import type { SelectionBoundary } from "../../core/selection";
import type { DeviceRect } from "../../engine/viewport/geometry";
import type { DeviceSize } from "../../engine/viewport/types";
import { axesOf } from "../overlay/gridLines";
import {
    ANTS_PERIOD,
    dashShift,
    dashTile,
    intersection,
    paintRing,
    ringBounds,
} from "./antsGeometry";

// The painter of a ring of ants (DESIGN §6; SE-030, shared with SE-031's preview): the ring of
// a mask on the overlay, black and white dashes by x + y at a phase. What a redraw costs does
// not grow with the ring:
//
//   - The ring's pixels are painted, opaque white, into a buffer that covers `ringBounds` —
//     the mask's bounds on the canvas grown by 1 pixel, found in constant time — and put on a
//     surface of its own, no larger than the canvas. Only then is the boundary walked, and
//     only its part in the buffer.
//   - A new phase recolours the surface in one fill: a 4 × 4 tile of the dashes, composited
//     `source-atop`, so it lands on the ring's pixels only. Each redraw is one `drawImage`.
//   - A pan (the same mask, zoom and canvas size, the document moved by whole device pixels)
//     moves the pixels kept by as much and paints only the strips it uncovered, whose part
//     of the boundary is all that is walked. A zoom, a resize or another mask paints afresh.
//
// The overlay of the app does not hold NGNE's pixels, so the ring is opaque, never inverted.

/** The two colours of the dashes (0xRRGGBB). */
export const ANTS_DARK = 0x000000;
export const ANTS_LIGHT = 0xffffff;

/** The 2D calls the painter makes on a surface of its own. */
export type AntsSurfaceContext = Pick<
    OffscreenCanvasRenderingContext2D,
    | "createImageData"
    | "putImageData"
    | "createPattern"
    | "save"
    | "restore"
    | "translate"
    | "fillRect"
    | "globalCompositeOperation"
    | "fillStyle"
    | "imageSmoothingEnabled"
>;

/** A surface of `width` × `height` pixels, transparent when made: an OffscreenCanvas in the app. */
export interface AntsSurface {
    readonly width: number;
    readonly height: number;
    /** What `drawImage` and `createPattern` take. */
    readonly image: CanvasImageSource;
    readonly context: AntsSurfaceContext;
}

/** Makes a surface: when the ring's area changes size, and once for the tile. */
export type SurfaceFactory = (width: number, height: number) => AntsSurface;

/** The ring to draw: of what, where its texels lie, and its boundary. */
export interface RingSource {
    /** The ring is kept, or moved with a pan, while this is the same object (a mask). */
    readonly key: object;
    /** Document pixels that hold every texel the ring surrounds; not necessarily tight. */
    readonly bounds: Readonly<Rect>;
    /** The boundary, asked for only when pixels are to be painted. */
    boundary(): SelectionBoundary;
}

/** Where the document is on the canvas: its device rectangle, its size, the canvas's. */
export interface RingView {
    readonly rect: DeviceRect;
    readonly doc: { readonly width: number; readonly height: number };
    readonly size: DeviceSize;
}

/** What a draw did to the ring's pixels: nothing, moved them, painted them afresh, or none on the canvas. */
export type RingWork = "kept" | "moved" | "painted" | "none";

export interface RingPainter {
    /** Draws the ring of `source` at `view` with the dashes of `phase` (0 to 3). */
    draw(
        context: Pick<CanvasRenderingContext2D, "drawImage" | "imageSmoothingEnabled">,
        source: RingSource,
        view: RingView,
        phase: number,
    ): void;
    /** Lets go of the ring kept (the surface stays for the next one of its size). */
    release(): void;
    /** What the last draw did, and how many runs of the ring it painted. */
    readonly last: { readonly work: RingWork; readonly runs: number };
    /** The ring's pixels as kept, opaque white, and where they lie; null when none is kept. */
    readonly kept: { readonly area: DeviceRect; readonly pixels: Uint8ClampedArray } | null;
}

interface Kept {
    readonly key: object;
    /** The zoom and the sizes the ring was painted for. */
    readonly scale: string;
    /** The document's device origin it was painted for. */
    readonly x: number;
    readonly y: number;
    /** Where the buffer lies on the canvas; null when the ring cannot be on it. */
    readonly area: DeviceRect | null;
    readonly buffer: Uint8ClampedArray | null;
    /** The buffer may hold ring pixels (after a move, kept from before). */
    readonly painted: boolean;
}

/** The pieces of `area` outside `inner` (which lies in it): above, below, left, right. */
function strips(area: DeviceRect, inner: DeviceRect): DeviceRect[] {
    const parts: DeviceRect[] = [];
    const right = area.x + area.width;
    const bottom = area.y + area.height;
    const innerRight = inner.x + inner.width;
    const innerBottom = inner.y + inner.height;
    if (inner.y > area.y)
        parts.push({ x: area.x, y: area.y, width: area.width, height: inner.y - area.y });
    if (innerBottom < bottom) {
        parts.push({ x: area.x, y: innerBottom, width: area.width, height: bottom - innerBottom });
    }
    if (inner.x > area.x)
        parts.push({ x: area.x, y: inner.y, width: inner.x - area.x, height: inner.height });
    if (innerRight < right) {
        parts.push({ x: innerRight, y: inner.y, width: right - innerRight, height: inner.height });
    }
    return parts;
}

/** Clears the pixels of `rect` (canvas coordinates) in `buffer`, the pixels of `area`. */
function clear(buffer: Uint8ClampedArray, area: DeviceRect, rect: DeviceRect): void {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        const start = ((y - area.y) * area.width + rect.x - area.x) * 4;
        buffer.fill(0, start, start + rect.width * 4);
    }
}

/**
 * Copies the pixels `to` shows (canvas coordinates in `area`) from `from`, where they were at
 * `to` less `dx, dy` (in `before`). The two may be one buffer: rows are taken in the order
 * that leaves none overwritten before it is read.
 */
function move(
    from: Uint8ClampedArray,
    before: DeviceRect,
    into: Uint8ClampedArray,
    area: DeviceRect,
    to: DeviceRect,
    dx: number,
    dy: number,
): void {
    const length = to.width * 4;
    const row = (y: number) => {
        const target = ((y - area.y) * area.width + to.x - area.x) * 4;
        const source = ((y - dy - before.y) * before.width + to.x - dx - before.x) * 4;
        if (from === into) into.copyWithin(target, source, source + length);
        else into.set(from.subarray(source, source + length), target);
    };
    // In one buffer, a row that moves down is written below the rows it is read from.
    if (from === into && dy + before.y - area.y > 0) {
        for (let y = to.y + to.height - 1; y >= to.y; y--) row(y);
    } else {
        for (let y = to.y; y < to.y + to.height; y++) row(y);
    }
}

/** A painter that makes its surfaces with `makeSurface`. */
export function createRingPainter(makeSurface: SurfaceFactory): RingPainter {
    let kept: Kept | null = null;
    let surface: AntsSurface | null = null;
    let pixels: ImageData | null = null;
    /** The phase the surface is coloured for; -1 before its first colouring. */
    let shown = -1;
    /** The 4 × 4 tile of the dashes, and the pattern of it for the surface. */
    let tile: AntsSurface | null = null;
    let pattern: CanvasPattern | null = null;
    let last: { work: RingWork; runs: number } = { work: "none", runs: 0 };

    const patternFor = (target: AntsSurface): CanvasPattern => {
        if (!tile) {
            tile = makeSurface(ANTS_PERIOD, ANTS_PERIOD);
            const image = tile.context.createImageData(ANTS_PERIOD, ANTS_PERIOD);
            image.data.set(dashTile(ANTS_DARK, ANTS_LIGHT));
            tile.context.putImageData(image, 0, 0);
        }
        if (!pattern) {
            pattern = target.context.createPattern(tile.image, "repeat");
            if (!pattern) throw new Error("The marching ants' pattern could not be made.");
        }
        return pattern;
    };

    /** Puts the buffer on a surface of its size, which is coloured again before it is shown. */
    const upload = (area: DeviceRect, buffer: Uint8ClampedArray) => {
        if (!surface || !pixels || surface.width !== area.width || surface.height !== area.height) {
            surface = makeSurface(area.width, area.height);
            pixels = surface.context.createImageData(area.width, area.height);
            pattern = null;
        }
        pixels.data.set(buffer);
        surface.context.putImageData(pixels, 0, 0);
        shown = -1;
    };

    /** Paints the ring afresh in `area`; returns the buffer and the runs painted. */
    const paintAll = (
        source: RingSource,
        axes: ReturnType<typeof axesOf>,
        size: DeviceSize,
        area: DeviceRect,
    ) => {
        const reuse = kept?.buffer && kept.buffer.length === area.width * area.height * 4;
        const buffer = reuse ? kept!.buffer! : new Uint8ClampedArray(area.width * area.height * 4);
        if (reuse) buffer.fill(0);
        const runs = paintRing(source.boundary(), axes, size, area, buffer);
        return { buffer, runs };
    };

    return {
        draw(context, source, view, phase) {
            const { rect, doc, size } = view;
            const scale = `${rect.width}x${rect.height}|${doc.width}x${doc.height}|${size.width}x${size.height}`;
            const same = kept !== null && kept.key === source.key && kept.scale === scale;
            if (!same || kept!.x !== rect.x || kept!.y !== rect.y) {
                const axes = axesOf(rect, doc, size);
                const area = ringBounds(source.bounds, axes, size);
                const dx = rect.x - (kept?.x ?? 0);
                const dy = rect.y - (kept?.y ?? 0);
                const before = same ? kept!.area : null;
                const overlap =
                    area && before && Number.isInteger(dx) && Number.isInteger(dy)
                        ? intersection(area, {
                              x: before.x + dx,
                              y: before.y + dy,
                              width: before.width,
                              height: before.height,
                          })
                        : null;
                if (!area) {
                    kept = {
                        key: source.key,
                        scale,
                        x: rect.x,
                        y: rect.y,
                        area: null,
                        buffer: null,
                        painted: false,
                    };
                    last = { work: "none", runs: 0 };
                } else if (overlap && before && kept?.buffer) {
                    // A pan: the pixels kept move with the document; the strips it uncovered
                    // are painted.
                    const old = kept.buffer;
                    const sameSize = area.width === before.width && area.height === before.height;
                    const buffer = sameSize
                        ? old
                        : new Uint8ClampedArray(area.width * area.height * 4);
                    move(old, before, buffer, area, overlap, dx, dy);
                    let runs = 0;
                    const boundary = source.boundary();
                    for (const strip of strips(area, overlap)) {
                        if (sameSize) clear(buffer, area, strip);
                        runs += paintRing(boundary, axes, size, area, buffer, strip);
                    }
                    kept = {
                        key: source.key,
                        scale,
                        x: rect.x,
                        y: rect.y,
                        area,
                        buffer,
                        painted: kept.painted || runs > 0,
                    };
                    last = { work: "moved", runs };
                    if (kept.painted) upload(area, buffer);
                } else {
                    const { buffer, runs } = paintAll(source, axes, size, area);
                    kept = {
                        key: source.key,
                        scale,
                        x: rect.x,
                        y: rect.y,
                        area,
                        buffer,
                        painted: runs > 0,
                    };
                    last = { work: "painted", runs };
                    if (runs > 0) upload(area, buffer);
                }
            } else {
                last = { work: "kept", runs: 0 };
            }
            const { area, painted } = kept!;
            if (!area || !painted || !surface) return;
            if (shown !== phase) {
                // The dashes of this phase, on the ring's pixels only.
                const target = surface.context;
                const shift = dashShift(phase, area.x, area.y);
                target.save();
                target.globalCompositeOperation = "source-atop";
                target.imageSmoothingEnabled = false;
                target.fillStyle = patternFor(surface);
                target.translate(shift, 0);
                target.fillRect(-shift, 0, area.width, area.height);
                target.restore();
                shown = phase;
            }
            context.imageSmoothingEnabled = false;
            context.drawImage(surface.image, area.x, area.y);
        },
        release() {
            kept = null;
            shown = -1;
            last = { work: "none", runs: 0 };
        },
        get last() {
            return last;
        },
        get kept() {
            return kept?.area && kept.buffer ? { area: kept.area, pixels: kept.buffer } : null;
        },
    };
}
