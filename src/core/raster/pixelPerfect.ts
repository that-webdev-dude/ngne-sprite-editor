import type { PixelPoint } from "./line";

// Pixel-perfect freehand paths (SPEC §7.1, SE-015), the behaviour of Aseprite's Pixel-perfect
// option. A path drawn by hand one pixel at a time leaves an L-shaped corner wherever it
// turns: a pixel that lines up with the one before it and with the one after it, while those
// two lie diagonally from each other. The filter drops such corner pixels so the path reads as
// a clean diagonal. The first and last pixels always stay, each inner pixel is judged against
// its neighbours in the path as drawn (not as filtered), and the pixel right after a dropped
// one always stays, so two neighbouring pixels are never both dropped.

/**
 * Whether `middle` is the corner of an L between `before` and `after`: it shares a row or a
 * column with each of them, while they share neither a row nor a column with each other.
 */
export function isLCorner(before: PixelPoint, middle: PixelPoint, after: PixelPoint): boolean {
    const linedUpWithBefore = middle.x === before.x || middle.y === before.y;
    const linedUpWithAfter = middle.x === after.x || middle.y === after.y;
    const endsApart = before.x !== after.x && before.y !== after.y;
    return linedUpWithBefore && linedUpWithAfter && endsApart;
}

/**
 * The pixels of `path` that pixel-perfect keeps, in order, as a new array: the ends, and each
 * inner pixel that is not an L corner of its neighbours or that follows a dropped pixel.
 */
export function pixelPerfectPath(path: readonly PixelPoint[]): PixelPoint[] {
    if (path.length <= 2) return [...path];
    const kept: PixelPoint[] = [path[0]!];
    let followsDropped = false;
    for (let i = 1; i < path.length - 1; i++) {
        const pixel = path[i]!;
        if (!followsDropped && isLCorner(path[i - 1]!, pixel, path[i + 1]!)) {
            followsDropped = true;
            continue;
        }
        followsDropped = false;
        kept.push(pixel);
    }
    kept.push(path[path.length - 1]!);
    return kept;
}

/** What one `PixelPerfectFilter.add` decided. */
export interface PixelPerfectStep {
    /** The pixel added just before, now found to be a corner and to take back; or null. */
    readonly removed: PixelPoint | null;
}

/**
 * Pixel-perfect as a stroke goes. Each pixel is drawn as soon as it is added; adding the next
 * one decides whether it stays. `add` reports at most one pixel to take back, always the one
 * added just before. Keeps only the last two pixels, so each call does constant work.
 */
export class PixelPerfectFilter {
    /** The pixel added before `#last`, as drawn; null until two pixels came. */
    #beforeLast: PixelPoint | null = null;
    /** The pixel added last; null before the first. */
    #last: PixelPoint | null = null;
    /** Whether `#last` follows a pixel taken back, which keeps it whatever its neighbours. */
    #lastKept = false;

    /** Adds the next pixel of the path; returns the pixel added before it when it is a corner. */
    add(pixel: PixelPoint): PixelPerfectStep {
        const before = this.#beforeLast;
        const middle = this.#last;
        const removed =
            before && middle && !this.#lastKept && isLCorner(before, middle, pixel) ? middle : null;
        this.#beforeLast = middle;
        this.#last = pixel;
        this.#lastKept = removed !== null;
        return { removed };
    }
}
