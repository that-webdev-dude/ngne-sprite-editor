import type { BitMask, Selection } from "../model";
import { copyMask, createMask, selectionOf } from "./mask";

// The operations on a selection (SPEC §7.2, SE-030): set, add, subtract, intersect, invert,
// all and none. Each returns a new selection, or null when no pixel is left selected; none
// changes the selection or the mask it was given.

/** How a new shape combines with the selection (SPEC §7.1: Shift add, Alt subtract, both intersect). */
export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

function assertSameSize(a: BitMask, b: BitMask, caller: string): void {
    if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
        throw new RangeError(
            `${caller}: the masks are ${a.width}×${a.height} and ${b.width}×${b.height}.`,
        );
    }
}

/** The pixels set in `a` or in `b`. */
export function unionMask(a: BitMask, b: BitMask): BitMask {
    assertSameSize(a, b, "unionMask");
    const out = createMask(a.width, a.height);
    for (let index = 0; index < out.data.length; index++)
        out.data[index] = a.data[index] | b.data[index];
    return out;
}

/** The pixels set in `a` and not in `b`. */
export function subtractMask(a: BitMask, b: BitMask): BitMask {
    assertSameSize(a, b, "subtractMask");
    const out = createMask(a.width, a.height);
    for (let index = 0; index < out.data.length; index++)
        out.data[index] = a.data[index] & ~b.data[index];
    return out;
}

/** The pixels set in both `a` and `b`. */
export function intersectMask(a: BitMask, b: BitMask): BitMask {
    assertSameSize(a, b, "intersectMask");
    const out = createMask(a.width, a.height);
    for (let index = 0; index < out.data.length; index++)
        out.data[index] = a.data[index] & b.data[index];
    return out;
}

/** The pixels not set in `mask`; the unused bits of the last byte stay 0. */
export function invertMask(mask: BitMask): BitMask {
    const out = createMask(mask.width, mask.height);
    for (let index = 0; index < out.data.length; index++)
        out.data[index] = ~mask.data[index] & 0xff;
    const used = (mask.width * mask.height) & 7;
    if (used !== 0) out.data[out.data.length - 1] &= (1 << used) - 1;
    return out;
}

/** A mask with every pixel of a `width` × `height` canvas set. */
export function fullMask(width: number, height: number): BitMask {
    return invertMask(createMask(width, height));
}

/** Every pixel of a `width` × `height` canvas: Select All. */
export function selectAll(width: number, height: number): Selection {
    const mask = fullMask(width, height);
    return { mask, bounds: { x: 0, y: 0, width, height } };
}

/**
 * `shape` combined with `current` by `mode`: `replace` is the shape alone, `add` the union,
 * `subtract` what `current` keeps outside the shape, `intersect` what both select. Without a
 * current selection, `add` acts as `replace` and `subtract` and `intersect` select nothing.
 * The result does not share `shape`'s memory. Null when no pixel is selected.
 */
export function combineSelection(
    current: Selection | null,
    shape: BitMask,
    mode: SelectionMode,
): Selection | null {
    if (current) assertSameSize(current.mask, shape, "combineSelection");
    switch (mode) {
        case "replace":
            return selectionOf(copyMask(shape));
        case "add":
            return selectionOf(current ? unionMask(current.mask, shape) : copyMask(shape));
        case "subtract":
            return current ? selectionOf(subtractMask(current.mask, shape)) : null;
        case "intersect":
            return current ? selectionOf(intersectMask(current.mask, shape)) : null;
    }
}

/**
 * The pixels of a `width` × `height` canvas outside `current`: Invert Selection. With no
 * selection every pixel is selected, as in Aseprite; a selection of every pixel inverts to
 * none (null).
 */
export function invertSelection(
    current: Selection | null,
    width: number,
    height: number,
): Selection | null {
    if (!current) return selectAll(width, height);
    if (current.mask.width !== width || current.mask.height !== height) {
        throw new RangeError(
            `invertSelection: the mask is ${current.mask.width}×${current.mask.height}, ` +
                `the canvas ${width}×${height}.`,
        );
    }
    return selectionOf(invertMask(current.mask));
}
