import type { Rect } from "../model";

// The rectangle a raster call reports (SE-015, SE-017): the bounding rectangle of the pixels
// whose bytes it changed, null when none did. Brush strokes, rubber-band shapes and the flood
// fill's paint return it, so the caller reports to its transaction only what changed.

/** The bounding rectangle of the pixels changed by one call. */
export class Changes {
    #minX = Infinity;
    #minY = Infinity;
    #maxX = -Infinity;
    #maxY = -Infinity;

    add(x: number, y: number): void {
        if (x < this.#minX) this.#minX = x;
        if (x > this.#maxX) this.#maxX = x;
        if (y < this.#minY) this.#minY = y;
        if (y > this.#maxY) this.#maxY = y;
    }

    rect(): Rect | null {
        if (this.#maxX < this.#minX) return null;
        return {
            x: this.#minX,
            y: this.#minY,
            width: this.#maxX - this.#minX + 1,
            height: this.#maxY - this.#minY + 1,
        };
    }
}
