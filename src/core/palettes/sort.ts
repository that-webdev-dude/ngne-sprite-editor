import { rgbToHsv, writeOklab } from "../color";
import type { Command } from "../history";
import type { DocSession } from "../model";
import { setPaletteCommand } from "./commands";

// Sorting the palette (SPEC §7.1, Palette; SE-066). A sort is a palette command like the
// others of SE-060: one undo step that touches no frame, layer or structure, and none when the
// order would not change. "Original order" is the order a sort found; the app keeps it per
// document (`app/palette/paletteOrder.ts`) and puts it back with `restoreOrderCommand`.

/** What a sort orders by: hue (HSV), or lightness (OKLab L), dark to light. */
export type PaletteSortKey = "hue" | "lightness";

interface Keyed {
    colour: number;
    /** Index in the palette: equal colours keep their order. */
    index: number;
    keys: number[];
}

function compareKeyed(a: Keyed, b: Keyed): number {
    for (let at = 0; at < a.keys.length; at++) {
        const difference = a.keys[at] - b.keys[at];
        if (difference !== 0) return difference;
    }
    return a.index - b.index;
}

/**
 * The keys of a colour, compared in order:
 * - hue: greys (saturation 0, black included) first, then hue 0–360°; then saturation, value
 *   and alpha, each ascending.
 * - lightness: OKLab L ascending (dark to light), then alpha, as Palette from Sprite orders
 *   its colours.
 * Colours with the same keys keep their order; so do equal colours.
 */
function keysOf(colour: number, key: PaletteSortKey, lab: Float64Array): number[] {
    const r = colour >>> 24;
    const g = (colour >>> 16) & 0xff;
    const b = (colour >>> 8) & 0xff;
    const a = colour & 0xff;
    if (key === "lightness") {
        writeOklab(lab, 0, r, g, b);
        return [lab[0], a];
    }
    const { h, s, v } = rgbToHsv(r, g, b);
    return s === 0 ? [0, v, 0, 0, a] : [1, h, s, v, a];
}

/** The colours sorted by `key`; a new array. */
export function sortedColours(colors: readonly number[], key: PaletteSortKey): number[] {
    const lab = new Float64Array(3);
    return colors
        .map((colour, index): Keyed => ({ colour, index, keys: keysOf(colour, key, lab) }))
        .sort(compareKeyed)
        .map((entry) => entry.colour);
}

/** Whether `a` and `b` hold the same colours as often each, in any order. */
export function isPermutation(a: readonly number[], b: readonly number[]): boolean {
    if (a.length !== b.length) return false;
    const counts = new Map<number, number>();
    for (const colour of a) counts.set(colour, (counts.get(colour) ?? 0) + 1);
    for (const colour of b) {
        const left = counts.get(colour) ?? 0;
        if (left === 0) return false;
        counts.set(colour, left - 1);
    }
    return true;
}

const SORT_LABELS: Readonly<Record<PaletteSortKey, string>> = {
    hue: "Sort Palette by Hue",
    lightness: "Sort Palette by Lightness",
};

/** Sorts the palette by `key`, its name kept; null when it is in that order already. */
export function sortPaletteCommand(
    session: DocSession,
    key: PaletteSortKey,
    label = SORT_LABELS[key],
): Command | null {
    const { palette } = session.doc;
    return setPaletteCommand(
        session,
        { name: palette.name, colors: sortedColours(palette.colors, key) },
        label,
    );
}

/**
 * Puts the palette's colours in `order`, its name kept. Null when they are in that order
 * already, or when `order` does not hold the palette's colours (a colour was added, removed
 * or edited since the order was taken).
 */
export function restoreOrderCommand(
    session: DocSession,
    order: readonly number[],
    label = "Original Palette Order",
): Command | null {
    const { palette } = session.doc;
    if (!isPermutation(palette.colors, order)) return null;
    return setPaletteCommand(session, { name: palette.name, colors: [...order] }, label);
}
