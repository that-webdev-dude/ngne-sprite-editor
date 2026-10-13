// How wheel travel becomes zoom steps and pan distance (SE-012). Pure: the numbers of a
// wheel event in, a decision out.

/** CSS pixels of wheel travel that make one zoom step. A notch of a mouse wheel is more. */
export const WHEEL_ZOOM_TRAVEL = 50;
/** Travel short of a step is forgotten after this pause, so it cannot add up over minutes. */
export const WHEEL_PAUSE_MS = 400;

const LINE_PIXELS = 16;
const PAGE_PIXELS = 800;

/** The travel of a wheel event in CSS pixels, whatever unit the device reports it in. */
export function wheelPixels(delta: number, deltaMode: number): number {
    if (deltaMode === 1) return delta * LINE_PIXELS;
    if (deltaMode === 2) return delta * PAGE_PIXELS;
    return delta;
}

/**
 * Turns the vertical travel of successive wheel events into zoom steps: `1` in (the wheel
 * turned away from the user, negative travel), `-1` out, `0` not yet. One notch of a mouse
 * wheel is one step; the small deltas of a touchpad add up to one step per
 * `WHEEL_ZOOM_TRAVEL`. An event never gives more than one step.
 */
export function createWheelZoom(): (travel: number, timeMs: number) => -1 | 0 | 1 {
    let pending = 0;
    let last = -Infinity;
    return (travel, timeMs) => {
        if (travel === 0 || !Number.isFinite(travel)) return 0;
        const turned = pending !== 0 && Math.sign(travel) !== Math.sign(pending);
        if (turned || timeMs - last > WHEEL_PAUSE_MS) pending = 0;
        last = timeMs;
        pending += travel;
        if (Math.abs(pending) < WHEEL_ZOOM_TRAVEL) return 0;
        const direction = pending < 0 ? 1 : -1;
        pending = 0;
        return direction;
    };
}

/**
 * Turns wheel travel into whole device pixels of panning and carries the fraction over to
 * the next event, so slow travel is not lost to rounding.
 */
export function createWheelPan(): (travel: number, ratio: number) => number {
    let carried = 0;
    return (travel, ratio) => {
        if (!Number.isFinite(travel)) return 0;
        const exact = travel * ratio + carried;
        // `+ 0`: never a negative zero.
        const whole = Math.round(exact) + 0;
        carried = exact - whole;
        return whole;
    };
}
