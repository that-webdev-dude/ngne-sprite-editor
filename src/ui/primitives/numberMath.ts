/** Value rules of the number field (DESIGN §4), kept free of the DOM for unit tests. */
export interface NumberRange {
    min?: number;
    max?: number;
    /** Size of one arrow-key step and the grid values snap to. Default 1. */
    step?: number;
}

/** Arrow keys move by one step, with Shift by ten. */
export const SHIFT_MULTIPLIER = 10;
/** Pointer travel on the label per step while scrubbing, in CSS pixels. */
export const SCRUB_PIXELS_PER_STEP = 2;
/** Pointer travel before a press on the label counts as a scrub rather than a click. */
export const SCRUB_THRESHOLD_PX = 3;

function decimals(step: number): number {
    const text = String(step);
    const point = text.indexOf(".");
    return point < 0 ? 0 : text.length - point - 1;
}

/** Clamps to the range and removes binary noise beyond the step's decimals. */
export function normalizeNumber(value: number, { min, max, step = 1 }: NumberRange): number {
    let next = value;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return Number(next.toFixed(decimals(step)));
}

/** The value after `steps` arrow presses (negative for down). */
export function stepNumber(
    value: number,
    steps: number,
    range: NumberRange,
    shift = false,
): number {
    const size = (range.step ?? 1) * (shift ? SHIFT_MULTIPLIER : 1);
    return normalizeNumber(value + steps * size, range);
}

/** The value after dragging the label `dx` pixels from a press at `start`. */
export function scrubNumber(start: number, dx: number, range: NumberRange, shift = false): number {
    return stepNumber(start, Math.trunc(dx / SCRUB_PIXELS_PER_STEP), range, shift);
}

/** Parses typed text; null when it is not a finite number. A decimal comma is accepted. */
export function parseNumber(text: string, range: NumberRange): number | null {
    const trimmed = text.trim().replace(",", ".");
    if (trimmed === "") return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? normalizeNumber(value, range) : null;
}

export function formatNumber(value: number, { step = 1 }: NumberRange): string {
    return value.toFixed(decimals(step));
}
