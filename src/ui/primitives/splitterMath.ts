/** Size rules of the splitter (DESIGN §4, §8), kept free of the DOM for unit tests. */
export interface SplitterAxis {
    /** Direction of the visible line: `vertical` divides left from right. */
    orientation: "vertical" | "horizontal";
    /** +1: the pane grows as the pointer moves right or down. −1: it grows moving left or up. */
    growth: 1 | -1;
    min: number;
    max: number;
}

/** One arrow-key press, in CSS pixels; with Shift four times that. */
export const SPLITTER_KEY_STEP = 8;
export const SPLITTER_SHIFT_MULTIPLIER = 4;

export function clampSize(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

/** The size after the pointer moved `delta` pixels along the splitter's axis from `start`. */
export function resizeByDrag(start: number, delta: number, axis: SplitterAxis): number {
    return clampSize(Math.round(start + axis.growth * delta), axis.min, axis.max);
}

/**
 * The size after a key press, or null when the key does not resize. Arrows move the line the
 * way they point; Home and End go to the smallest and largest size.
 */
export function resizeByKey(
    value: number,
    key: string,
    axis: SplitterAxis,
    shift = false,
): number | null {
    const [backward, forward] =
        axis.orientation === "vertical" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const step = SPLITTER_KEY_STEP * (shift ? SPLITTER_SHIFT_MULTIPLIER : 1);
    if (key === forward) return resizeByDrag(value, step, axis);
    if (key === backward) return resizeByDrag(value, -step, axis);
    if (key === "Home") return axis.min;
    if (key === "End") return Math.max(axis.min, axis.max);
    return null;
}
