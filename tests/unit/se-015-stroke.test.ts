import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clonePixelBuffer, createPixelBuffer } from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";
import {
    createBrush,
    FreehandStroke,
    linePixels,
    paintInk,
    pixelPerfectPath,
    StraightStroke,
} from "../../src/core/raster";
import type { Brush, BrushShape, PixelPoint } from "../../src/core/raster";

// SE-015: brush strokes in `core/raster`. Samples are joined by lines, so a fast stroke leaves
// no gap; the brush is stamped at every pixel of the path; pixel-perfect takes back corner
// pixels as the stroke goes and ends with exactly the pixels of the whole path's filter; a
// straight stroke keeps only its last line; every call reports the pixels it changed.

const BLACK = 0x000000ff;
const p = (x: number, y: number): PixelPoint => ({ x, y });

/** A `width` × `height` image of one colour (0xRRGGBBAA), with a copy as its original. */
function canvas(width: number, height: number, colour = 0): [PixelBuffer, PixelBuffer] {
    const image = createPixelBuffer(width, height, colour);
    return [image, clonePixelBuffer(image)];
}

/** The pixels of `image` whose alpha is 255 and colour black: what a black stroke painted. */
function painted(image: PixelBuffer): PixelPoint[] {
    const result: PixelPoint[] = [];
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const at = (y * image.width + x) * 4;
            const [r, g, b, a] = image.data.subarray(at, at + 4);
            if (r === 0 && g === 0 && b === 0 && a === 255) result.push(p(x, y));
        }
    }
    return result;
}

/** `points` stamped with `brush` into a fresh image: what a stroke along them should leave. */
function stamped(
    points: readonly PixelPoint[],
    brush: Brush,
    width: number,
    height: number,
    colour = 0,
) {
    const [image, original] = canvas(width, height, colour);
    const ink = paintInk("simple", BLACK, 255);
    for (const point of points) {
        // A one-point stroke per pixel: stamps only, no line between them.
        new FreehandStroke(image, original, { brush, ink }).start(point);
    }
    return image;
}

/** Whether `pixels` form one 8-connected group. */
function connected(pixels: readonly PixelPoint[]): boolean {
    const keys = new Set(pixels.map(({ x, y }) => `${x},${y}`));
    const first = pixels[0];
    if (!first) return true;
    const seen = new Set([`${first.x},${first.y}`]);
    const queue = [first];
    while (queue.length > 0) {
        const { x, y } = queue.pop()!;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const key = `${x + dx},${y + dy}`;
                if (keys.has(key) && !seen.has(key)) {
                    seen.add(key);
                    queue.push(p(x + dx, y + dy));
                }
            }
        }
    }
    return seen.size === keys.size;
}

/**
 * The texels a drag from client `from` to `to` (CSS px, ratio 1, zoom `scale`, document at
 * the origin) reports at `speed` px/s with one sample every `intervalMs`.
 */
function drag(from: PixelPoint, to: PixelPoint, scale: number, speed: number, intervalMs: number) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(length / ((speed * intervalMs) / 1000)));
    const samples: PixelPoint[] = [];
    for (let step = 0; step <= steps; step++) {
        const x = from.x + ((to.x - from.x) * step) / steps;
        const y = from.y + ((to.y - from.y) * step) / steps;
        samples.push(p(Math.floor(x / scale), Math.floor(y / scale)));
    }
    return samples;
}

describe("freehand strokes", () => {
    it("a diagonal drag across 64 × 64 at 2000 px/s leaves no gap", () => {
        const scale = 8;
        // From the centre of texel 0, 0 to that of texel 63, 63; a sample every 16 ms (60 Hz)
        // is 32 px, four texels.
        const samples = drag(p(4, 4), p(63 * scale + 4, 63 * scale + 4), scale, 2000, 16);
        expect(samples.length).toBeGreaterThan(10);
        expect(samples[1]!.x - samples[0]!.x).toBeGreaterThanOrEqual(3);
        const [image, original] = canvas(64, 64);
        const stroke = new FreehandStroke(image, original, {
            brush: createBrush("square", 1),
            ink: paintInk("simple", BLACK, 255),
        });
        stroke.start(samples[0]!);
        for (const sample of samples.slice(1)) stroke.to(sample);
        expect(painted(image)).toEqual(Array.from({ length: 64 }, (_, index) => p(index, index)));
    });

    it("any drag at any speed leaves one connected path from the first sample to the last", () => {
        const coordinate = fc.integer({ min: 0, max: 63 });
        const point = fc.record({ x: coordinate, y: coordinate });
        fc.assert(
            fc.property(fc.array(point, { minLength: 1, maxLength: 12 }), (samples) => {
                const [image, original] = canvas(64, 64);
                const stroke = new FreehandStroke(image, original, {
                    brush: createBrush("square", 1),
                    ink: paintInk("simple", BLACK, 255),
                });
                stroke.start(samples[0]!);
                for (const sample of samples.slice(1)) stroke.to(sample);
                // Exactly the lines between consecutive samples.
                const expected = new Set(
                    samples.flatMap((sample, index) =>
                        (index === 0 ? [sample] : linePixels(samples[index - 1]!, sample)).map(
                            ({ x, y }) => `${x},${y}`,
                        ),
                    ),
                );
                const result = painted(image);
                expect(new Set(result.map(({ x, y }) => `${x},${y}`))).toEqual(expected);
                expect(connected(result)).toBe(true);
            }),
        );
    });

    it("stamps the brush at every pixel of the path, clipped to the image", () => {
        for (const shape of ["square", "circle"] as BrushShape[]) {
            const brush = createBrush(shape, 5);
            const [image, original] = canvas(20, 12);
            const stroke = new FreehandStroke(image, original, {
                brush,
                ink: paintInk("simple", BLACK, 255),
            });
            stroke.start(p(-1, 2));
            stroke.to(p(17, 9));
            const path = linePixels(p(-1, 2), p(17, 9));
            expect(image.data, shape).toEqual(stamped(path, brush, 20, 12).data);
        }
    });

    it("reports the bounding rectangle of the pixels each call changed, and null when none did", () => {
        const [image, original] = canvas(16, 16);
        const stroke = new FreehandStroke(image, original, {
            brush: createBrush("square", 3),
            ink: paintInk("simple", BLACK, 255),
        });
        expect(stroke.start(p(0, 0))).toEqual({ x: 0, y: 0, width: 2, height: 2 });
        expect(stroke.to(p(4, 2))).toEqual({ x: 0, y: 0, width: 6, height: 4 });
        // The same pixel again: nothing to do.
        expect(stroke.to(p(4, 2))).toBeNull();
        // Back over pixels already painted: nothing changes.
        expect(stroke.to(p(3, 2))).toBeNull();
        expect(stroke.last).toEqual(p(3, 2));
        // A colour the image has already changes nothing at all.
        const [same, sameOriginal] = canvas(8, 8, BLACK);
        const unchanged = new FreehandStroke(same, sameOriginal, {
            brush: createBrush("circle", 4),
            ink: paintInk("simple", BLACK, 255),
        });
        expect(unchanged.start(p(3, 3))).toBeNull();
        expect(unchanged.to(p(6, 1))).toBeNull();
    });

    it("never writes the original", () => {
        const [image, original] = canvas(8, 8);
        const before = original.data.slice();
        const stroke = new FreehandStroke(image, original, {
            brush: createBrush("circle", 3),
            ink: paintInk("alpha", 0xff000080, 200),
            pixelPerfect: true,
        });
        stroke.start(p(1, 1));
        stroke.to(p(6, 6));
        expect(original.data).toEqual(before);
    });

    it("refuses an original of another size", () => {
        expect(
            () =>
                new FreehandStroke(createPixelBuffer(4, 4), createPixelBuffer(4, 5), {
                    brush: createBrush("square", 1),
                    ink: paintInk("simple", BLACK, 255),
                }),
        ).toThrow(RangeError);
    });
});

describe("pixel-perfect strokes", () => {
    it("leave the pixels of the whole path's filter, stamped with the brush, whatever the path and brush", () => {
        const step = fc.constantFrom(p(1, 0), p(-1, 0), p(0, 1), p(0, -1), p(1, 1), p(1, -1));
        fc.assert(
            fc.property(
                fc.array(step, { maxLength: 40 }),
                fc.constantFrom(1, 2, 3),
                fc.constantFrom<BrushShape>("square", "circle"),
                (steps, size, shape) => {
                    // Unit steps, as a slow stroke gives: each sample one pixel from the last.
                    const path = [p(10, 10)];
                    for (const { x, y } of steps) {
                        const last = path.at(-1)!;
                        path.push(p(last.x + x, last.y + y));
                    }
                    const brush = createBrush(shape, size);
                    const [image, original] = canvas(24, 24);
                    const stroke = new FreehandStroke(image, original, {
                        brush,
                        ink: paintInk("simple", BLACK, 255),
                        pixelPerfect: true,
                    });
                    stroke.start(path[0]!);
                    for (const pixel of path.slice(1)) stroke.to(pixel);
                    expect(image.data).toEqual(stamped(pixelPerfectPath(path), brush, 24, 24).data);
                },
            ),
        );
    });

    it("show the newest pixel at once and take a corner back when the next one shows it", () => {
        const [image, original] = canvas(4, 4);
        const stroke = new FreehandStroke(image, original, {
            brush: createBrush("square", 1),
            ink: paintInk("simple", BLACK, 255),
            pixelPerfect: true,
        });
        stroke.start(p(0, 0));
        expect(stroke.to(p(1, 0))).toEqual({ x: 1, y: 0, width: 1, height: 1 });
        expect(painted(image)).toEqual([p(0, 0), p(1, 0)]);
        // 1, 0 is the corner of an L: taken back as 1, 1 is drawn.
        expect(stroke.to(p(1, 1))).toEqual({ x: 1, y: 0, width: 1, height: 2 });
        expect(painted(image)).toEqual([p(0, 0), p(1, 1)]);
        expect(Array.from(image.data.subarray(4, 8))).toEqual([0, 0, 0, 0]);
    });
});

describe("straight strokes", () => {
    it("keep only the line from the anchor to the latest sample", () => {
        const brush = createBrush("circle", 3);
        const [image, original] = canvas(24, 16, 0x336699ff);
        const stroke = new StraightStroke(
            image,
            original,
            { brush, ink: paintInk("simple", BLACK, 255) },
            p(2, 2),
        );
        expect(stroke.to(p(20, 3))).not.toBeNull();
        expect(stroke.to(p(9, 13))).not.toBeNull();
        expect(stroke.last).toEqual(p(9, 13));
        const expected = stamped(linePixels(p(2, 2), p(9, 13)), brush, 24, 16, 0x336699ff);
        expect(image.data).toEqual(expected.data);
        // The same end again changes nothing.
        expect(stroke.to(p(9, 13))).toBeNull();
    });
});
