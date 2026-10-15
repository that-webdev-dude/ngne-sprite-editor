import type { PixelPoint } from "./line";

// The pixel-perfect filter (SPEC §7.1, SE-015): a freehand path whose pixels step one at a
// time leaves L-shaped corners where it turns (a horizontal step followed by a vertical one);
// the filter removes the pixel in the corner, so the path reads as a clean diagonal. The rule
// is Aseprite's (`IntertwineAsPixelPerfect`): walking the path, a pixel that shares a row or a
// column with the pixel before it and with the pixel after it, while those two share neither,
// is left out; the pixel after it is then kept without being looked at, and the walk goes on
// from the one after that. The first and the last pixel are always kept.

/**
 * Whether `middle` is the corner of an L between `before` and `after`: it shares a row or a
 * column with each of them, and they share neither with each other.
 */
export function isLCorner(before: PixelPoint, middle: PixelPoint, after: PixelPoint): boolean {
    return (
        (before.x === middle.x || before.y === middle.y) &&
        (after.x === middle.x || after.y === middle.y) &&
        before.x !== after.x &&
        before.y !== after.y
    );
}

/**
 * The pixels of a whole path that the filter keeps, in order. `path` lists pixels as a stroke
 * visits them, each different from the one before it.
 */
export function pixelPerfectPath(path: readonly PixelPoint[]): PixelPoint[] {
    const kept: PixelPoint[] = [];
    for (let index = 0; index < path.length; index++) {
        const before = path[index - 1];
        const middle = path[index];
        const after = path[index + 1];
        if (!middle) continue;
        if (before && after && isLCorner(before, middle, after)) {
            // The corner is left out and the pixel after it kept as it is.
            kept.push(after);
            index++;
            continue;
        }
        kept.push(middle);
    }
    return kept;
}

/** What the filter decides when a pixel is added to the path. */
export interface PixelPerfectStep {
    /** The pixel drawn before, which turned out to be a corner: it is taken back. */
    readonly removed: PixelPoint | null;
}

/**
 * The filter as a stroke goes: each pixel of the path is drawn when it comes, and taken back
 * when the next one shows it to be a corner. After the last pixel, the pixels drawn and not
 * taken back are those of `pixelPerfectPath` for the whole path.
 */
export class PixelPerfectFilter {
    #before: PixelPoint | null = null;
    #last: PixelPoint | null = null;
    /** Pixels added so far. */
    #count = 0;
    /** The index of the next pixel to be looked at once the pixel after it comes. */
    #examine = 1;

    /** Adds the next pixel of the path, which differs from the one before it. */
    add(pixel: PixelPoint): PixelPerfectStep {
        const index = this.#count;
        let removed: PixelPoint | null = null;
        if (this.#examine === index - 1 && this.#before && this.#last) {
            if (isLCorner(this.#before, this.#last, pixel)) {
                removed = this.#last;
                // The pixel just added is kept unexamined; the next one is looked at.
                this.#examine = index + 1;
            } else {
                this.#examine = index;
            }
        }
        this.#before = this.#last;
        this.#last = pixel;
        this.#count++;
        return { removed };
    }
}
