import type { PixelBuffer, Rect } from "../model";
import type { Brush } from "./brush";
import { Changes } from "./changes";
import type { Ink } from "./ink";
import { forEachLinePixel } from "./line";
import type { PixelPoint } from "./line";
import { PixelPerfectFilter } from "./pixelPerfect";
import { forEachPolygonRun } from "./polygon";

// Brush strokes (SPEC §7.1, SE-015): a path of pixels drawn with a brush and an ink into an
// image. The pointer gives a stroke one sample at a time; between two samples the path follows
// a Bresenham line (`line.ts`), so a fast stroke leaves no gap. The brush is stamped at every
// pixel of the path. Pure: the tools of `app` feed it pointer samples.
//
// The ink reads the value each pixel had when the stroke began (`original`, a copy the caller
// keeps), so stamping a pixel twice writes the same value twice and a stamp can be taken back
// exactly: the pixel-perfect filter takes back the corner pixels it removes (a pixel keeps the
// stroke's value while another stamp of the path still covers it), and a straight stroke
// takes back its previous line at each move.
//
// Every call returns the rectangle of the pixels whose bytes it changed (null when none did):
// what the caller reports to its transaction, so a stroke that changes nothing records nothing.

export interface BrushStrokeOptions {
    brush: Brush;
    ink: Ink;
    /** Removes the corner pixels of L-shaped turns (`pixelPerfect.ts`); freehand strokes only. */
    pixelPerfect?: boolean;
}

/**
 * Stamps a brush with an ink into an image, clipped to the image. The brush strokes here, the
 * contour and the spray (SE-065) write through it; the shapes draw through `ShapeStroke`.
 */
export class Stamper {
    readonly #image: PixelBuffer;
    readonly #original: Uint8ClampedArray;
    readonly #brush: Brush;
    readonly #ink: Ink;
    /** How many stamps of the path cover each pixel; kept only where stamps are taken back. */
    readonly #coverage: Uint32Array | null;

    constructor(image: PixelBuffer, original: PixelBuffer, options: BrushStrokeOptions) {
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
        this.#coverage = options.pixelPerfect ? new Uint32Array(image.width * image.height) : null;
    }

    /** Calls `visit` with each pixel of the brush placed at `x, y` that lies in the image. */
    #forEach(x: number, y: number, visit: (index: number, px: number, py: number) => void) {
        const { width, height } = this.#image;
        const brush = this.#brush;
        const left = x + brush.origin;
        const top = y + brush.origin;
        for (let row = 0; row < brush.size; row++) {
            const py = top + row;
            if (py < 0 || py >= height) continue;
            const from = Math.max(0, left + brush.starts[row]);
            const to = Math.min(width, left + brush.ends[row]);
            for (let px = from; px < to; px++) visit(py * width + px, px, py);
        }
    }

    stamp(x: number, y: number, changes: Changes): void {
        const data = this.#image.data;
        const original = this.#original;
        const ink = this.#ink;
        const coverage = this.#coverage;
        this.#forEach(x, y, (index, px, py) => {
            if (coverage) coverage[index]++;
            if (ink.apply(data, original, index * 4)) changes.add(px, py);
        });
    }

    /**
     * Inks the pixels `[from, to)` of row `y` (clipped to the image) without the brush: the
     * inside of a filled shape (SE-065, the contour).
     */
    inkRun(y: number, from: number, to: number, changes: Changes): void {
        const { width, height, data } = this.#image;
        if (y < 0 || y >= height) return;
        const original = this.#original;
        const ink = this.#ink;
        const end = Math.min(width, to);
        for (let px = Math.max(0, from); px < end; px++) {
            if (ink.apply(data, original, (y * width + px) * 4)) changes.add(px, y);
        }
    }

    /**
     * Inks the inside of the polygon through `points` without the brush (the pixels whose
     * centres lie inside it by the even-odd rule, `polygon.ts`): the contour's fill (SE-065).
     * Only the image's rows are looked at.
     */
    inkPolygon(points: readonly PixelPoint[], changes: Changes): void {
        forEachPolygonRun(
            points,
            (y, x, end) => this.inkRun(y, x, end, changes),
            0,
            this.#image.height - 1,
        );
    }

    /** Takes back a stamp: a pixel no other stamp covers gets its original value back. */
    unstamp(x: number, y: number, changes: Changes): void {
        const coverage = this.#coverage;
        if (!coverage) throw new Error("This stroke keeps no coverage to take a stamp back.");
        this.#forEach(x, y, (index, px, py) => {
            coverage[index]--;
            if (coverage[index] === 0 && this.#restore(index)) changes.add(px, py);
        });
    }

    /** Gives every pixel of `rect` (clipped to the image) its original value back. */
    restoreRect(rect: Rect, changes: Changes): void {
        const { width, height } = this.#image;
        const fromX = Math.max(0, rect.x);
        const toX = Math.min(width, rect.x + rect.width);
        const fromY = Math.max(0, rect.y);
        const toY = Math.min(height, rect.y + rect.height);
        for (let py = fromY; py < toY; py++) {
            for (let px = fromX; px < toX; px++) {
                if (this.#restore(py * width + px)) changes.add(px, py);
            }
        }
    }

    #restore(index: number): boolean {
        const data = this.#image.data;
        const original = this.#original;
        const at = index * 4;
        if (
            data[at] === original[at] &&
            data[at + 1] === original[at + 1] &&
            data[at + 2] === original[at + 2] &&
            data[at + 3] === original[at + 3]
        ) {
            return false;
        }
        data.set(original.subarray(at, at + 4), at);
        return true;
    }
}

/**
 * A freehand stroke: the brush stamped along the pointer's path, each sample joined to the one
 * before it by a line, the corners of L-shaped turns removed when `pixelPerfect` is set.
 * `original` holds the image as it was when the stroke began; it is read, never written.
 */
export class FreehandStroke {
    readonly #stamper: Stamper;
    readonly #filter: PixelPerfectFilter | null;
    #last: PixelPoint | null = null;

    constructor(image: PixelBuffer, original: PixelBuffer, options: BrushStrokeOptions) {
        this.#stamper = new Stamper(image, original, options);
        this.#filter = options.pixelPerfect ? new PixelPerfectFilter() : null;
    }

    /** The last pixel of the path; null before the stroke began. */
    get last(): PixelPoint | null {
        return this.#last;
    }

    /** The first sample: the brush is stamped at `pixel`. */
    start(pixel: PixelPoint): Rect | null {
        if (this.#last) return this.to(pixel);
        const changes = new Changes();
        this.#add({ x: pixel.x, y: pixel.y }, changes);
        return changes.rect();
    }

    /** The next sample: the path goes on to `pixel` along a line. */
    to(pixel: PixelPoint): Rect | null {
        const from = this.#last;
        if (!from) return this.start(pixel);
        if (from.x === pixel.x && from.y === pixel.y) return null;
        const changes = new Changes();
        let first = true;
        forEachLinePixel(from.x, from.y, pixel.x, pixel.y, (x, y) => {
            // The line's first pixel is the path's last, stamped already.
            if (first) {
                first = false;
                return;
            }
            this.#add({ x, y }, changes);
        });
        return changes.rect();
    }

    #add(pixel: PixelPoint, changes: Changes): void {
        this.#stamper.stamp(pixel.x, pixel.y, changes);
        this.#last = pixel;
        const removed = this.#filter?.add(pixel).removed;
        if (removed) this.#stamper.unstamp(removed.x, removed.y, changes);
    }
}

/**
 * A straight stroke: a line of brush stamps from a fixed `anchor` to the pointer, drawn again
 * at each sample (the previous line is taken back first), as Shift-click draws one from the
 * end of the last stroke. `original` holds the image as it was when the stroke began.
 */
export class StraightStroke {
    readonly #stamper: Stamper;
    readonly #brush: Brush;
    readonly #anchor: PixelPoint;
    /** The square the line drawn last covers; null before the first sample. */
    #covered: Rect | null = null;
    #last: PixelPoint | null = null;

    constructor(
        image: PixelBuffer,
        original: PixelBuffer,
        options: BrushStrokeOptions,
        anchor: PixelPoint,
    ) {
        this.#stamper = new Stamper(image, original, { ...options, pixelPerfect: false });
        this.#brush = options.brush;
        this.#anchor = { x: anchor.x, y: anchor.y };
    }

    /** The end of the line drawn last; null before the first sample. */
    get last(): PixelPoint | null {
        return this.#last;
    }

    /** Draws the line from the anchor to `pixel`, in place of the one drawn before. */
    to(pixel: PixelPoint): Rect | null {
        const last = this.#last;
        if (last && last.x === pixel.x && last.y === pixel.y) return null;
        const changes = new Changes();
        if (this.#covered) this.#stamper.restoreRect(this.#covered, changes);
        const { x: ax, y: ay } = this.#anchor;
        const brush = this.#brush;
        forEachLinePixel(ax, ay, pixel.x, pixel.y, (x, y) => {
            this.#stamper.stamp(x, y, changes);
        });
        const left = Math.min(ax, pixel.x) + brush.origin;
        const top = Math.min(ay, pixel.y) + brush.origin;
        this.#covered = {
            x: left,
            y: top,
            width: Math.abs(pixel.x - ax) + brush.size,
            height: Math.abs(pixel.y - ay) + brush.size,
        };
        this.#last = { x: pixel.x, y: pixel.y };
        return changes.rect();
    }
}
