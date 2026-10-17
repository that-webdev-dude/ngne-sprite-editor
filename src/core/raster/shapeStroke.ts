import type { PixelBuffer, Rect } from "../model";
import type { Brush } from "./brush";
import { Changes } from "./changes";
import type { Ink } from "./ink";
import { copyShape, forEachFilledRun, forEachOutlinePixel, sameShape } from "./shape";
import type { PathShape, Shape } from "./shape";

// Rubber-band shapes (SPEC §7.1, SE-017): the stroke of a shape tool. Each pointer sample
// draws the whole shape again in place of the one drawn before, into the image of the stroke's
// transaction, so the preview is the stroke's own pixels and the release keeps the last one.
// The curve and the polygon of SE-065 (`PathShape`) are drawn the same way.
//
// A draw marks the pixels the new shape covers — the brush stamped at every pixel of its
// outline, and for a filled shape every pixel inside it — then gives each pixel of the
// previous shape that the new one does not cover its value at the stroke's start back, and
// inks each covered pixel from that value (`original`, a copy the caller keeps), so the ink
// never builds up and a pixel covered twice is written once. It returns the rectangle of the
// pixels whose bytes changed (null when none did): the previous shape's pixels that were put
// back are in it, so the caller reports them dirty and the live composite clears them.

export interface ShapeStrokeOptions {
    brush: Brush;
    ink: Ink;
}

export class ShapeStroke {
    readonly #image: PixelBuffer;
    readonly #original: Uint8ClampedArray;
    readonly #brush: Brush;
    readonly #ink: Ink;
    /**
     * For each pixel of the image, the generation of the draw that covered it last; the
     * pixels the current draw covers carry `#generation`. Made at the first draw.
     */
    #marks: Uint8Array | null = null;
    #generation = 0;
    /** The rectangle of the image the shape drawn last covers; null when none. */
    #covered: Rect | null = null;
    #shape: Shape | PathShape | null = null;

    constructor(image: PixelBuffer, original: PixelBuffer, options: ShapeStrokeOptions) {
        if (
            original.width !== image.width ||
            original.height !== image.height ||
            original.data.length !== image.data.length
        ) {
            throw new RangeError(
                `A stroke's original is ${original.width}×${original.height}; its image is ` +
                    `${image.width}×${image.height}.`,
            );
        }
        this.#image = image;
        this.#original = original.data;
        this.#brush = options.brush;
        this.#ink = options.ink;
    }

    /** The shape drawn last; null before the first draw. */
    get shape(): Shape | PathShape | null {
        return this.#shape;
    }

    /** Draws `shape` in place of the shape drawn before. */
    draw(shape: Shape | PathShape): Rect | null {
        if (this.#shape && sameShape(this.#shape, shape)) return null;
        const { width, height, data } = this.#image;
        const original = this.#original;
        const ink = this.#ink;
        const generation = this.#nextGeneration();
        const marks = this.#marks ?? (this.#marks = new Uint8Array(width * height));

        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        const mark = (y: number, from: number, to: number) => {
            if (y < 0 || y >= height) return;
            const start = from < 0 ? 0 : from;
            const end = to > width ? width : to;
            if (start >= end) return;
            marks.fill(generation, y * width + start, y * width + end);
            if (start < minX) minX = start;
            if (end - 1 > maxX) maxX = end - 1;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        };
        const brush = this.#brush;
        const { origin, size, starts, ends } = brush;
        forEachOutlinePixel(shape, (x, y) => {
            const left = x + origin;
            const top = y + origin;
            for (let row = 0; row < size; row++)
                mark(top + row, left + starts[row], left + ends[row]);
        });
        forEachFilledRun(shape, mark, 0, height - 1);

        const changes = new Changes();
        const previous = this.#covered;
        if (previous) {
            for (let y = previous.y; y < previous.y + previous.height; y++) {
                for (let x = previous.x; x < previous.x + previous.width; x++) {
                    const index = y * width + x;
                    if (marks[index] !== generation && restore(data, original, index * 4)) {
                        changes.add(x, y);
                    }
                }
            }
        }
        const covered =
            maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
        if (covered) {
            for (let y = covered.y; y < covered.y + covered.height; y++) {
                for (let x = covered.x; x < covered.x + covered.width; x++) {
                    const index = y * width + x;
                    if (marks[index] === generation && ink.apply(data, original, index * 4)) {
                        changes.add(x, y);
                    }
                }
            }
        }
        this.#covered = covered;
        this.#shape = copyShape(shape);
        return changes.rect();
    }

    /** The next draw's generation, 1 to 255; the marks start over after 255. */
    #nextGeneration(): number {
        if (this.#generation === 255) {
            this.#marks?.fill(0);
            this.#generation = 0;
        }
        return ++this.#generation;
    }
}

/** Gives the pixel at byte `at` its original value; returns whether a byte changed. */
function restore(data: Uint8ClampedArray, original: Uint8ClampedArray, at: number): boolean {
    if (
        data[at] === original[at] &&
        data[at + 1] === original[at + 1] &&
        data[at + 2] === original[at + 2] &&
        data[at + 3] === original[at + 3]
    ) {
        return false;
    }
    data[at] = original[at];
    data[at + 1] = original[at + 1];
    data[at + 2] = original[at + 2];
    data[at + 3] = original[at + 3];
    return true;
}
