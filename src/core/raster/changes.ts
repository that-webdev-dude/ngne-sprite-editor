import type { Rect } from "../model";

// The rectangle a raster call reports (SE-015, SE-017): the bounding rectangle of the pixels
// whose bytes it changed, null when none did. Brush strokes, rubber-band shapes and the flood
// fill's paint return it, so the caller reports to its transaction only what changed.
//
// With symmetry or tiled mode (SE-062) one call writes copies far apart — a dab and its mirror
// images near the four corners — and their bounding rectangle covers most of the canvas,
// which the live composite would composite again at every move. A `Changes` made with `split`
// also keeps where the changes lie apart, as up to `MAX_PARTS` rectangles, and the rectangle
// it reports carries them (`DirtyRect.parts`) for the caller to composite each alone. Without
// `split` it is the bounding rectangle alone, as before: no part is kept and nothing is
// allocated per pixel.

/** At most this many separate rectangles are kept by a splitting `Changes`. */
export const MAX_PARTS = 4;
/** Pixels this close to a part (in either direction) join it rather than start another. */
const JOIN_DISTANCE = 4;

/**
 * The bounding rectangle of what a call changed; with symmetry or tiled mode, also the
 * rectangles of the parts that lie apart (more than one), whose bounds it is. Each part
 * holds changed pixels only near each other, so the caller may composite the parts in place
 * of the whole.
 */
export interface DirtyRect extends Rect {
    readonly parts?: readonly Rect[];
}

/** The bounding rectangle of the pixels changed by one call. */
export class Changes {
    #minX = Infinity;
    #minY = Infinity;
    #maxX = -Infinity;
    #maxY = -Infinity;
    /** Min x, min y, max x, max y of each part, `#count` of them; null without `split`. */
    readonly #parts: Int32Array | null;
    #count = 0;

    constructor(split = false) {
        this.#parts = split ? new Int32Array(4 * MAX_PARTS) : null;
    }

    add(x: number, y: number): void {
        if (x < this.#minX) this.#minX = x;
        if (x > this.#maxX) this.#maxX = x;
        if (y < this.#minY) this.#minY = y;
        if (y > this.#maxY) this.#maxY = y;
        if (this.#parts) this.#addToPart(this.#parts, x, y);
    }

    #addToPart(parts: Int32Array, x: number, y: number): void {
        let nearest = -1;
        let nearestDistance = Infinity;
        for (let part = 0; part < this.#count; part++) {
            const at = part * 4;
            const dx = Math.max(parts[at]! - x, 0, x - parts[at + 2]!);
            const dy = Math.max(parts[at + 1]! - y, 0, y - parts[at + 3]!);
            const distance = dx > dy ? dx : dy;
            if (distance < nearestDistance) {
                nearest = part;
                nearestDistance = distance;
            }
        }
        if (nearest === -1 || (nearestDistance > JOIN_DISTANCE && this.#count < MAX_PARTS)) {
            const at = this.#count++ * 4;
            parts[at] = x;
            parts[at + 1] = y;
            parts[at + 2] = x;
            parts[at + 3] = y;
            return;
        }
        const at = nearest * 4;
        if (x < parts[at]!) parts[at] = x;
        if (y < parts[at + 1]!) parts[at + 1] = y;
        if (x > parts[at + 2]!) parts[at + 2] = x;
        if (y > parts[at + 3]!) parts[at + 3] = y;
    }

    rect(): DirtyRect | null {
        if (this.#maxX < this.#minX) return null;
        const bounds = {
            x: this.#minX,
            y: this.#minY,
            width: this.#maxX - this.#minX + 1,
            height: this.#maxY - this.#minY + 1,
        };
        const parts = this.#parts ? this.#separateParts(this.#parts) : null;
        return parts && parts.length > 1 ? { ...bounds, parts } : bounds;
    }

    /** The parts as rectangles, those that grew into each other merged. */
    #separateParts(parts: Int32Array): Rect[] {
        const rects: Rect[] = [];
        for (let part = 0; part < this.#count; part++) {
            const at = part * 4;
            rects.push({
                x: parts[at]!,
                y: parts[at + 1]!,
                width: parts[at + 2]! - parts[at]! + 1,
                height: parts[at + 3]! - parts[at + 1]! + 1,
            });
        }
        for (let merged = true; merged;) {
            merged = false;
            outer: for (let a = 0; a < rects.length; a++) {
                for (let b = a + 1; b < rects.length; b++) {
                    const p = rects[a]!;
                    const q = rects[b]!;
                    const apart =
                        p.x + p.width + JOIN_DISTANCE <= q.x ||
                        q.x + q.width + JOIN_DISTANCE <= p.x ||
                        p.y + p.height + JOIN_DISTANCE <= q.y ||
                        q.y + q.height + JOIN_DISTANCE <= p.y;
                    if (apart) continue;
                    const x = Math.min(p.x, q.x);
                    const y = Math.min(p.y, q.y);
                    rects[a] = {
                        x,
                        y,
                        width: Math.max(p.x + p.width, q.x + q.width) - x,
                        height: Math.max(p.y + p.height, q.y + q.height) - y,
                    };
                    rects.splice(b, 1);
                    merged = true;
                    break outer;
                }
            }
        }
        return rects;
    }
}
