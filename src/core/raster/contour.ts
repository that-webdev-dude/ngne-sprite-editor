import type { PixelBuffer, Rect } from "../model";
import type { Brush } from "./brush";
import { Changes } from "./changes";
import type { Ink } from "./ink";
import { forEachLinePixel } from "./line";
import type { PixelPoint } from "./line";
import { forEachPolygonRun } from "./polygon";
import { Stamper } from "./stroke";

// The contour (SPEC §7.1, SE-065): a freehand closed shape, filled. While the button is held
// the pointer's path is drawn as a pencil draws it, the brush stamped along the lines that
// join its points (a point for the press and for every sample on another pixel than the point
// before); the release closes it — the line from the last point back to the first — and inks
// every pixel inside it by the even-odd rule (`polygon.ts`). So the closed contour covers what
// the polygon tool's filled polygon through the same points covers: the brush along the
// sides, and the inside. Every pixel is inked from its value at the stroke's start
// (`original`), so a pixel covered twice is written once.

export interface ContourStrokeOptions {
    brush: Brush;
    ink: Ink;
}

export class ContourStroke {
    readonly #stamper: Stamper;
    readonly #height: number;
    readonly #points: PixelPoint[] = [];
    #closed = false;

    constructor(image: PixelBuffer, original: PixelBuffer, options: ContourStrokeOptions) {
        this.#stamper = new Stamper(image, original, { ...options, pixelPerfect: false });
        this.#height = image.height;
    }

    /** The points of the path so far, the press first. */
    get points(): readonly PixelPoint[] {
        return this.#points;
    }

    /** Whether `close` was called. */
    get closed(): boolean {
        return this.#closed;
    }

    /**
     * The press, then each sample: the path goes on to `pixel` along a line, unless `pixel` is
     * its last point already. Returns the rectangle of the pixels whose bytes changed.
     */
    to(pixel: PixelPoint): Rect | null {
        if (this.#closed) throw new Error("This contour is closed.");
        const last = this.#points[this.#points.length - 1];
        if (last && last.x === pixel.x && last.y === pixel.y) return null;
        const changes = new Changes();
        if (!last) {
            this.#stamper.stamp(pixel.x, pixel.y, changes);
        } else {
            let skip = true;
            forEachLinePixel(last.x, last.y, pixel.x, pixel.y, (x, y) => {
                // The line's first pixel is the path's last, stamped already.
                if (skip) {
                    skip = false;
                    return;
                }
                this.#stamper.stamp(x, y, changes);
            });
        }
        this.#points.push({ x: pixel.x, y: pixel.y });
        return changes.rect();
    }

    /**
     * The release: the line back to the first point, and the inside filled. A path of fewer
     * than 3 points encloses nothing and stays as it is.
     */
    close(): Rect | null {
        if (this.#closed) return null;
        this.#closed = true;
        const points = this.#points;
        if (points.length < 3) return null;
        const changes = new Changes();
        const first = points[0];
        const last = points[points.length - 1];
        forEachLinePixel(last.x, last.y, first.x, first.y, (x, y) => {
            this.#stamper.stamp(x, y, changes);
        });
        forEachPolygonRun(
            points,
            (y, x, end) => this.#stamper.inkRun(y, x, end, changes),
            0,
            this.#height - 1,
        );
        return changes.rect();
    }
}
