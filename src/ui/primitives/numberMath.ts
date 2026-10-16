/** Value rules of the number field (DESIGN §4), kept free of the DOM for unit tests. */
export interface NumberRange {
    min?: number;
    max?: number;
    /** Size of one arrow-key step and the grid values snap to. Default 1. */
    step?: number;
    /**
     * Decimals a value keeps when it is typed or stepped; the default is the decimals of
     * `step`. The field shows the step's decimals at least, and up to these when the value
     * has more (SE-034: a pivot keeps four decimals and steps by 0.01).
     */
    precision?: number;
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

/** Decimals a value of the range keeps: the step's, or `precision` when that is more. */
function keptDecimals({ step = 1, precision = 0 }: NumberRange): number {
    return Math.max(decimals(step), precision);
}

/** Clamps to the range and removes binary noise beyond the decimals the range keeps. */
export function normalizeNumber(value: number, range: NumberRange): number {
    const { min, max } = range;
    let next = value;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return Number(next.toFixed(keptDecimals(range)));
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

/**
 * The value as the field shows it: with the decimals of the step, and with more, up to
 * `precision`, when the value needs them (0.5 → "0.50", 0.9688 → "0.9688" for a step of
 * 0.01 and a precision of 4).
 */
export function formatNumber(value: number, range: NumberRange): string {
    const least = decimals(range.step ?? 1);
    const most = keptDecimals(range);
    const text = value.toFixed(most);
    if (most === least) return text;
    const point = text.indexOf(".");
    const shortest = least === 0 ? point : point + 1 + least;
    let end = text.length;
    while (end > shortest && text[end - 1] === "0") end--;
    // No decimal left: no point either.
    if (end === point + 1) end = point;
    return text.slice(0, end);
}
