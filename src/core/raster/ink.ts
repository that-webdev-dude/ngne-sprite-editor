import { BLEND_FUNCTIONS, mul255 } from "../composite/blend";

// Inks (SPEC §7.1, SE-015): what a brush writes into a pixel it covers. Every ink computes the
// new value of a pixel from the value it had when the stroke began (its original), never from
// what the stroke already wrote there, so a stroke that crosses itself writes each pixel once:
// a translucent colour does not build up within one stroke, as in Aseprite. Values are
// straight RGBA8, colours 0xRRGGBBAA, opacity an integer 0..255.
//
//   simple       the colour replaces the pixel, its alpha scaled by the opacity
//   alpha        the colour is composited over the pixel at the opacity, with the
//                compositor's normal blend (`core/composite/blend.ts`)
//   lock alpha   as `alpha`, then the pixel keeps its alpha; a transparent pixel stays
//                exactly as it is
//   erase        the pixel's alpha falls by the opacity: a - mul(a, opacity)
//
// Other than a transparent pixel under lock alpha, a result with alpha 0 is written as
// 0, 0, 0, 0: the ink leaves no colour under transparency.

export type InkKind = "simple" | "alpha" | "lockAlpha";

export interface Ink {
    /**
     * Writes the inked value of the pixel at byte `at` (a multiple of 4) into `target`,
     * computed from the same pixel of `original`. Returns whether a byte of `target` changed.
     */
    apply(target: Uint8ClampedArray, original: Uint8ClampedArray, at: number): boolean;
}

function assertOpacity(opacity: number): void {
    if (!Number.isInteger(opacity) || opacity < 0 || opacity > 255) {
        throw new RangeError(`An opacity must be a whole number from 0 to 255, got ${opacity}.`);
    }
}

/** Writes `r, g, b, a` at `at`, or 0, 0, 0, 0 when `a` is 0; returns whether a byte changed. */
function write(
    target: Uint8ClampedArray,
    at: number,
    r: number,
    g: number,
    b: number,
    a: number,
): boolean {
    if (a === 0) r = g = b = 0;
    if (target[at] === r && target[at + 1] === g && target[at + 2] === b && target[at + 3] === a) {
        return false;
    }
    target[at] = r;
    target[at + 1] = g;
    target[at + 2] = b;
    target[at + 3] = a;
    return true;
}

/** Writes the original value of the pixel at `at`; returns whether a byte changed. */
function keep(target: Uint8ClampedArray, original: Uint8ClampedArray, at: number): boolean {
    if (
        target[at] === original[at] &&
        target[at + 1] === original[at + 1] &&
        target[at + 2] === original[at + 2] &&
        target[at + 3] === original[at + 3]
    ) {
        return false;
    }
    target.set(original.subarray(at, at + 4), at);
    return true;
}

const blendNormal = BLEND_FUNCTIONS.normal;

/** The ink that paints `colour` (0xRRGGBBAA) at `opacity` in the manner of `kind`. */
export function paintInk(kind: InkKind, colour: number, opacity: number): Ink {
    assertOpacity(opacity);
    const source = new Uint8ClampedArray([
        colour >>> 24,
        (colour >>> 16) & 0xff,
        (colour >>> 8) & 0xff,
        colour & 0xff,
    ]);
    switch (kind) {
        case "simple": {
            const [r = 0, g = 0, b = 0, a = 0] = source;
            const alpha = mul255(a, opacity);
            return { apply: (target, _original, at) => write(target, at, r, g, b, alpha) };
        }
        case "alpha": {
            const pixel = new Uint8ClampedArray(4);
            return {
                apply(target, original, at) {
                    pixel.set(original.subarray(at, at + 4));
                    blendNormal(pixel, 0, source, 0, 1, opacity);
                    return write(target, at, pixel[0], pixel[1], pixel[2], pixel[3]);
                },
            };
        }
        case "lockAlpha": {
            const pixel = new Uint8ClampedArray(4);
            return {
                apply(target, original, at) {
                    const alpha = original[at + 3];
                    // A transparent pixel stays exactly as it was.
                    if (alpha === 0) return keep(target, original, at);
                    pixel.set(original.subarray(at, at + 4));
                    blendNormal(pixel, 0, source, 0, 1, opacity);
                    return write(target, at, pixel[0], pixel[1], pixel[2], alpha);
                },
            };
        }
        default:
            throw new RangeError(`Unknown ink "${String(kind)}".`);
    }
}

/** The ink of the eraser: the pixel's alpha falls by `opacity`; at 255 it becomes transparent. */
export function eraseInk(opacity: number): Ink {
    assertOpacity(opacity);
    return {
        apply(target, original, at) {
            const alpha = original[at + 3];
            return write(
                target,
                at,
                original[at],
                original[at + 1],
                original[at + 2],
                alpha - mul255(alpha, opacity),
            );
        },
    };
}

/** What `ink` makes of one pixel `rgba`: a convenience for tests and previews. */
export function inkPixel(ink: Ink, rgba: readonly number[]): number[] {
    const original = new Uint8ClampedArray(rgba.slice(0, 4));
    const target = original.slice();
    ink.apply(target, original, 0);
    return Array.from(target);
}
