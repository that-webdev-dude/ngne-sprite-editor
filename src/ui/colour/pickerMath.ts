import type { Hsv } from "../../core/color";

// What the controls of the colour panel (DESIGN §5.3) do with the pointer and the keys, kept
// free of the DOM for unit tests. The keys are those of a number field (DESIGN §4): arrows
// step by one unit, with Shift by ten; Home and End go to the ends; Page Up and Page Down step
// by ten. Saturation and value step in whole percent, the hue in whole degrees, alpha by 1 of
// 255.

/** How far `position` lies along a box that starts at `start` and is `size` long, 0..1. */
export function fractionAlong(position: number, start: number, size: number): number {
    if (!(size > 0)) return 0;
    return Math.min(1, Math.max(0, (position - start) / size));
}

/** One unit, or ten with Shift. */
function stepOf(shift: boolean): number {
    return shift ? 10 : 1;
}

/**
 * A value of `min..max` in whole units after `key`; null for a key the control does not take.
 * `increase` and `decrease` are the keys that step up and down.
 */
function stepValue(
    value: number,
    key: string,
    shift: boolean,
    min: number,
    max: number,
    increase: readonly string[],
    decrease: readonly string[],
): number | null {
    const whole = Math.round(value);
    let next: number;
    if (increase.includes(key)) next = whole + stepOf(shift);
    else if (decrease.includes(key)) next = whole - stepOf(shift);
    else if (key === "PageUp") next = whole + 10;
    else if (key === "PageDown") next = whole - 10;
    else if (key === "Home") next = min;
    else if (key === "End") next = max;
    else return null;
    return Math.min(max, Math.max(min, next));
}

const UP = ["ArrowRight", "ArrowUp"];
const DOWN = ["ArrowLeft", "ArrowDown"];

/** The hue strip: degrees 0..360. */
export function hueAfterKey(hue: number, key: string, shift: boolean): number | null {
    return stepValue(hue, key, shift, 0, 360, UP, DOWN);
}

/** The alpha strip: 0..255. */
export function alphaAfterKey(alpha: number, key: string, shift: boolean): number | null {
    return stepValue(alpha, key, shift, 0, 255, UP, DOWN);
}

/**
 * The saturation/value field: left and right change the saturation, up and down the value
 * (Page Up and Page Down by ten); Home and End take the saturation to 0 and 100%. Null for a
 * key the field does not take.
 */
export function svAfterKey(hsv: Hsv, key: string, shift: boolean): Hsv | null {
    if (key === "ArrowUp" || key === "ArrowDown" || key === "PageUp" || key === "PageDown") {
        const value = stepValue(hsv.v * 100, key, shift, 0, 100, ["ArrowUp"], ["ArrowDown"]);
        return value === null ? null : { ...hsv, v: value / 100 };
    }
    const saturation = stepValue(hsv.s * 100, key, shift, 0, 100, ["ArrowRight"], ["ArrowLeft"]);
    return saturation === null ? null : { ...hsv, s: saturation / 100 };
}

/** A colour 0xRRGGBBAA as a CSS colour. */
export function cssColour(colour: number, alpha = (colour & 0xff) / 255): string {
    const r = colour >>> 24;
    const g = (colour >>> 16) & 0xff;
    const b = (colour >>> 8) & 0xff;
    return `rgb(${r} ${g} ${b} / ${Number(alpha.toFixed(4))})`;
}
