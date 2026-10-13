// How wheel travel becomes zoom steps and pan distance (SE-012). Pure: the numbers of a
// wheel event in, a decision out.

/**
 * CSS pixels of wheel travel that make one zoom step. A notch of most mouse wheels is more
 * (100 at a page zoom of 100%); at a page zoom of 250% or 300% it is 40 or 33.
 */
export const WHEEL_ZOOM_TRAVEL = 50;

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
 * wheel is one step; smaller travel — the deltas of a touchpad, or notches of less than
 * `WHEEL_ZOOM_TRAVEL` — adds up to one step per `WHEEL_ZOOM_TRAVEL`, however long the
 * events are apart. Travel short of a step is forgotten when the wheel turns the other way.
 * An event never gives more than one step.
 */
export function createWheelZoom(): (travel: number) => -1 | 0 | 1 {
    let pending = 0;
    return (travel) => {
        if (travel === 0 || !Number.isFinite(travel)) return 0;
        const turned = pending !== 0 && Math.sign(travel) !== Math.sign(pending);
        if (turned) pending = 0;
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
