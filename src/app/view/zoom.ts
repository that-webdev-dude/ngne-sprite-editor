// The zoom steps of SPEC §6.4 and the choices made among them. Pure: no DOM, no store.

/**
 * Device pixels per sprite pixel, ascending. At the steps of 1 and above texels are square
 * and aligned to device pixels at any device pixel ratio. The three below 1 are for overview
 * only: nearest minification, not pixel-exact.
 */
export const ZOOM_STEPS: readonly number[] = [
    1 / 8,
    1 / 4,
    1 / 2,
    1,
    2,
    3,
    4,
    5,
    6,
    8,
    10,
    12,
    16,
    20,
    24,
    32,
    48,
    64,
];

export const MIN_ZOOM = 1 / 8;
export const MAX_ZOOM = 64;

/** The zoom of the keys 1 to 6, in key order (SPEC §7.8). */
export const KEY_ZOOMS: readonly number[] = [1, 2, 4, 8, 16, 32];

/** The next step above `scale`; the largest step when there is none. */
export function zoomStepAbove(scale: number): number {
    return ZOOM_STEPS.find((step) => step > scale) ?? MAX_ZOOM;
}

/** The next step below `scale`; the smallest step when there is none. */
export function zoomStepBelow(scale: number): number {
    let below = MIN_ZOOM;
    for (const step of ZOOM_STEPS) {
        if (step >= scale) break;
        below = step;
    }
    return below;
}

/** One step in (`1`) or out (`-1`) from `scale`, which need not be a step itself. */
export function zoomStep(scale: number, direction: 1 | -1): number {
    return direction === 1 ? zoomStepAbove(scale) : zoomStepBelow(scale);
}

/**
 * The side of an image of `length` document pixels at `scale`, in device pixels: a whole
 * number, at least 1. The same rounding as the document rectangle the engine draws
 * (`engine/viewport/geometry`).
 */
export function scaledLength(length: number, scale: number): number {
    return Math.max(1, Math.round(length * scale));
}

/**
 * The largest zoom step at which a document of `width` × `height` pixels lies inside a
 * viewport of `viewWidth` × `viewHeight` device pixels; the smallest step when it fits at
 * none.
 */
export function fitZoom(
    width: number,
    height: number,
    viewWidth: number,
    viewHeight: number,
): number {
    let fit = MIN_ZOOM;
    for (const step of ZOOM_STEPS) {
        if (scaledLength(width, step) > viewWidth || scaledLength(height, step) > viewHeight) break;
        fit = step;
    }
    return fit;
}
