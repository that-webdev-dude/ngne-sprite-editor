// Deterministic test images and the expected device-pixel pattern for integer placements.
// Pure TypeScript: used by the pages and, for screenshot comparison, by the runner.

export type Pixels = Uint8ClampedArray<ArrayBuffer>;

export interface Doc {
    readonly width: number;
    readonly height: number;
    readonly pixels: Pixels;
}

/** A document drawn with its top-left at integer device pixel (x, y), `scale` device px per texel. */
export interface Placement {
    readonly doc: Doc;
    readonly x: number;
    readonly y: number;
    readonly scale: number;
}

export interface Diff {
    readonly count: number;
    readonly first: string;
}

/**
 * Opaque texel colour. Horizontal and vertical neighbours always differ, and the blue channel
 * is odd, so no texel equals a clear colour with an even blue channel.
 */
export function texel(x: number, y: number, seed: number): [number, number, number] {
    return [
        (x * 37 + seed * 61 + 11) & 255,
        (y * 53 + seed * 17 + 7) & 255,
        (((x + y) * 29 + seed * 101 + 3) & 255) | 1,
    ];
}

export function makeDoc(width: number, height: number, seed: number): Doc {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const [r, g, b] = texel(x, y, seed);
            const o = (y * width + x) * 4;
            pixels[o] = r;
            pixels[o + 1] = g;
            pixels[o + 2] = b;
            pixels[o + 3] = 255;
        }
    return { width, height, pixels };
}

/** A document of one colour; `alpha` 0 makes it fully transparent (written as 0,0,0,0). */
export function solidDoc(width: number, height: number, color: number, alpha = 255): Doc {
    const pixels = new Uint8ClampedArray(width * height * 4);
    if (alpha > 0)
        for (let o = 0; o < pixels.length; o += 4) {
            pixels[o] = (color >>> 16) & 255;
            pixels[o + 1] = (color >>> 8) & 255;
            pixels[o + 2] = color & 255;
            pixels[o + 3] = alpha;
        }
    return { width, height, pixels };
}

/** Copies `source` into `target` with its top-left at (x, y). */
export function blit(target: Doc, source: Doc, x: number, y: number): void {
    for (let row = 0; row < source.height; row++) {
        const from = row * source.width * 4;
        target.pixels.set(
            source.pixels.subarray(from, from + source.width * 4),
            ((y + row) * target.width + x) * 4,
        );
    }
}

/** A sub-rectangle of a document; parts outside the source are transparent. */
export function cropDoc(source: Doc, x: number, y: number, width: number, height: number): Doc {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++)
        for (let column = 0; column < width; column++) {
            const sx = x + column;
            const sy = y + row;
            if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
            const from = (sy * source.width + sx) * 4;
            pixels.set(source.pixels.subarray(from, from + 4), (row * width + column) * 4);
        }
    return { width, height, pixels };
}

function packed(r: number, g: number, b: number): number {
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * The image an exact renderer produces: `clear` (0xRRGGBB, opaque) with each placement drawn
 * in order. Texels are opaque or fully transparent (transparent texels show what is below).
 */
export function expectedImage(
    width: number,
    height: number,
    clear: number,
    placements: readonly Placement[],
): Pixels {
    const out = new Uint8ClampedArray(width * height * 4);
    const view = new Uint32Array(out.buffer);
    view.fill(packed((clear >>> 16) & 255, (clear >>> 8) & 255, clear & 255));
    for (const { doc, x, y, scale } of placements) {
        const source = doc.pixels;
        const x0 = Math.max(0, x);
        const y0 = Math.max(0, y);
        const x1 = Math.min(width, x + doc.width * scale);
        const y1 = Math.min(height, y + doc.height * scale);
        for (let py = y0; py < y1; py++) {
            const row = Math.floor((py - y) / scale) * doc.width;
            for (let px = x0; px < x1; px++) {
                const o = (row + Math.floor((px - x) / scale)) * 4;
                if (source[o + 3] === 0) continue;
                view[py * width + px] = packed(
                    source[o] ?? 0,
                    source[o + 1] ?? 0,
                    source[o + 2] ?? 0,
                );
            }
        }
    }
    return out;
}

/** Number of RGBA pixels that differ between two images of the same size. */
export function diffImages(
    actual: Uint8ClampedArray | Uint8Array,
    expected: Uint8ClampedArray | Uint8Array,
    width: number,
): Diff {
    if (actual.length !== expected.length)
        return { count: -1, first: `size ${actual.length} bytes, expected ${expected.length}` };
    let count = 0;
    let first = "";
    for (let o = 0; o < expected.length; o += 4) {
        if (
            actual[o] === expected[o] &&
            actual[o + 1] === expected[o + 1] &&
            actual[o + 2] === expected[o + 2] &&
            actual[o + 3] === expected[o + 3]
        )
            continue;
        if (!count) {
            const index = o / 4;
            first =
                `(${index % width}, ${Math.floor(index / width)}) is ` +
                `${actual[o]},${actual[o + 1]},${actual[o + 2]},${actual[o + 3]}, expected ` +
                `${expected[o]},${expected[o + 1]},${expected[o + 2]},${expected[o + 3]}`;
        }
        count++;
    }
    return { count, first };
}

/** Sub-rectangle of an RGBA image. */
export function cropImage(
    image: Uint8ClampedArray | Uint8Array,
    width: number,
    x: number,
    y: number,
    w: number,
    h: number,
): Uint8ClampedArray {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
        const from = ((y + row) * width + x) * 4;
        out.set(image.subarray(from, from + w * 4), row * w * 4);
    }
    return out;
}

/** True when every pixel has the same RGBA value (a blank image). */
export function isUniform(image: Uint8ClampedArray | Uint8Array): boolean {
    for (let o = 4; o < image.length; o += 4)
        if (
            image[o] !== image[0] ||
            image[o + 1] !== image[1] ||
            image[o + 2] !== image[2] ||
            image[o + 3] !== image[3]
        )
            return false;
    return true;
}
