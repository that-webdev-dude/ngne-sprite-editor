import type { PixelBuffer, Rect } from "../model";
import type { Brush } from "./brush";
import { Changes } from "./changes";
import { forEachLinePixel } from "./line";
import type { PixelPoint } from "./line";
import { Stamper } from "./stroke";
import type { BrushStrokeOptions } from "./stroke";

// The spray (SPEC §7.1, SE-065): dots of the brush scattered over a disk around the pointer.
// The disk is every offset (dx, dy) with dx² + dy² ≤ radius². The density is the share of the
// area under the spray that the dots cover, counted before they overlap, whatever the brush:
// a dot covers the brush's pixels, so the press sprays density % of the disk's offsets divided
// by the brush's pixels in dots, and each pixel the pointer's path moves on (the path joins
// the samples with Bresenham lines, as a pencil stroke's) density % of the disk's width,
// 2 · radius + 1, the area it sweeps anew, divided the same way. Fractions of a dot are
// carried to the next pixel. A dot costs the brush's pixels, so the cost of a spray grows with
// its area and density, not with the brush.
//
// Each dot falls on an offset drawn uniformly from the disk (two whole numbers drawn from
// −radius..radius until they lie in it) by a pseudo-random generator seeded per stroke
// (mulberry32): the same seed and the same samples give the same dots, in Node and in every
// browser, with integer arithmetic only. Dots are stamped with the brush and inked from the
// stroke's start (`original`), so dots that overlap write a pixel once.

/** The radius and density a spray takes (SPEC §7.1). */
export const SPRAY_MIN_RADIUS = 1;
export const SPRAY_MAX_RADIUS = 64;
export const SPRAY_MIN_DENSITY = 1;
export const SPRAY_MAX_DENSITY = 100;

/** A brush stroke's options, without pixel-perfect, and the spray's own. */
export interface SprayStrokeOptions extends Omit<BrushStrokeOptions, "pixelPerfect"> {
    /** Whole pixels, `SPRAY_MIN_RADIUS..SPRAY_MAX_RADIUS`. */
    radius: number;
    /** Percent, a whole number `SPRAY_MIN_DENSITY..SPRAY_MAX_DENSITY`. */
    density: number;
    /** The generator's seed: any number, taken as an unsigned 32-bit integer. */
    seed: number;
}

/**
 * A pseudo-random generator: mulberry32 (Tommy Ettinger, public domain), numbers in [0, 1)
 * that are multiples of 2^−32, the same for the same seed everywhere.
 */
export function createRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** How many offsets lie in the disk of `radius`: (dx, dy) with dx² + dy² ≤ radius². */
export function sprayDiskArea(radius: number): number {
    const limit = radius * radius;
    let area = 0;
    // The half-width of the row `dy`, which grows as `dy` falls to 0.
    let half = 0;
    for (let dy = radius; dy >= 0; dy--) {
        while ((half + 1) * (half + 1) + dy * dy <= limit) half++;
        area += (dy === 0 ? 1 : 2) * (2 * half + 1);
    }
    return area;
}

/** How many pixels `brush` covers. */
export function brushArea(brush: Brush): number {
    let area = 0;
    for (let row = 0; row < brush.size; row++) area += brush.ends[row] - brush.starts[row];
    return area;
}

function assertWhole(name: string, value: number, min: number, max: number): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`A spray's ${name} is a whole number ${min}..${max}, got ${value}.`);
    }
}

export class SprayStroke {
    readonly #stamper: Stamper;
    readonly #random: () => number;
    readonly #radius: number;
    readonly #density: number;
    /** What one dot costs in the units of `#owed`: 100 × the brush's pixels. */
    readonly #perDot: number;
    /** The dots owed, as density × area: a dot per `#perDot`. */
    #owed = 0;
    #last: PixelPoint | null = null;

    constructor(image: PixelBuffer, original: PixelBuffer, options: SprayStrokeOptions) {
        const { radius, density, seed, ...brushOptions } = options;
        assertWhole("radius", radius, SPRAY_MIN_RADIUS, SPRAY_MAX_RADIUS);
        assertWhole("density", density, SPRAY_MIN_DENSITY, SPRAY_MAX_DENSITY);
        this.#stamper = new Stamper(image, original, { ...brushOptions, pixelPerfect: false });
        this.#random = createRandom(seed);
        this.#radius = radius;
        this.#density = density;
        this.#perDot = 100 * brushArea(options.brush);
    }

    /** The last pixel of the path; null before the press. */
    get last(): PixelPoint | null {
        return this.#last;
    }

    /** The press: density % of the disk's area in dots around `pixel`. */
    start(pixel: PixelPoint): Rect | null {
        if (this.#last) return this.to(pixel);
        const changes = new Changes();
        this.#last = { x: pixel.x, y: pixel.y };
        this.#spray(pixel, sprayDiskArea(this.#radius), changes);
        return changes.rect();
    }

    /** The next sample: the path goes on to `pixel`, each pixel of it spraying anew. */
    to(pixel: PixelPoint): Rect | null {
        const from = this.#last;
        if (!from) return this.start(pixel);
        if (from.x === pixel.x && from.y === pixel.y) return null;
        const changes = new Changes();
        const width = 2 * this.#radius + 1;
        let skip = true;
        forEachLinePixel(from.x, from.y, pixel.x, pixel.y, (x, y) => {
            // The line's first pixel is the path's last, sprayed already.
            if (skip) {
                skip = false;
                return;
            }
            this.#spray({ x, y }, width, changes);
        });
        this.#last = { x: pixel.x, y: pixel.y };
        return changes.rect();
    }

    /** Sprays the dots that `area` pixels owe at the density, around `centre`. */
    #spray(centre: PixelPoint, area: number, changes: Changes): void {
        this.#owed += this.#density * area;
        const count = Math.floor(this.#owed / this.#perDot);
        this.#owed -= count * this.#perDot;
        const radius = this.#radius;
        const side = 2 * radius + 1;
        const limit = radius * radius;
        for (let dot = 0; dot < count; dot++) {
            let dx: number;
            let dy: number;
            do {
                dx = Math.floor(this.#random() * side) - radius;
                dy = Math.floor(this.#random() * side) - radius;
            } while (dx * dx + dy * dy > limit);
            this.#stamper.stamp(centre.x + dx, centre.y + dy, changes);
        }
    }
}
