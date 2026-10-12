import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pack } from "../../src/core/export";
import type { PackOptions, PackedRect } from "../../src/core/export";
import { clonePixelBuffer, cropPixels, pixelBuffersEqual } from "../../src/core/pixels";
import type { PixelBuffer } from "../../src/core/pixels";
import { atlasOf, contentOf, firstDifference, normalizedCopy, sourceOf } from "./se-050-support";

// The invariants of SPEC §9.2 and §9.4 over random frames and options. Sizes and positions
// are checked against the formulas of the SPEC, pixels against `atlasOf`, which builds an
// atlas from the rects one pixel at a time.

const RUNS = { numRuns: 300 };

const byte = fc.integer({ min: 0, max: 255 });

/** A pixel inside the drawn part of a frame: mostly opaque; some transparent, clean or not. */
const pixel = fc.oneof(
    { weight: 5, arbitrary: fc.tuple(byte, byte, byte, fc.constant(255)) },
    { weight: 2, arbitrary: fc.tuple(byte, byte, byte, byte) },
    { weight: 2, arbitrary: fc.constant([0, 0, 0, 0]) },
    { weight: 1, arbitrary: fc.tuple(byte, byte, byte, fc.constant(0)) },
);

/**
 * A `width` × `height` frame that is transparent outside a random window, so that trimming
 * finds borders of every width; the window may be empty or the whole frame.
 */
function drawing(width: number, height: number): fc.Arbitrary<PixelBuffer> {
    return fc
        .record({
            columns: fc.tuple(fc.nat(width), fc.nat(width)),
            rows: fc.tuple(fc.nat(height), fc.nat(height)),
            pixels: fc.array(pixel, { minLength: width * height, maxLength: width * height }),
        })
        .map(({ columns, rows, pixels }) => {
            const data = new Uint8ClampedArray(width * height * 4);
            pixels.forEach((color, index) => {
                const x = index % width;
                const y = (index - x) / width;
                const inside =
                    x >= Math.min(...columns) &&
                    x < Math.max(...columns) &&
                    y >= Math.min(...rows) &&
                    y < Math.max(...rows);
                if (inside) data.set(color, index * 4);
            });
            return { width, height, data };
        });
}

const side = fc.integer({ min: 1, max: 9 });

/** One to five drawings: of one size, as the frames of a document are, or of any sizes. */
const drawings = fc.oneof(
    fc
        .tuple(side, side)
        .chain(([width, height]) =>
            fc.array(drawing(width, height), { minLength: 1, maxLength: 5 }),
        ),
    fc.array(
        fc.tuple(side, side).chain(([width, height]) => drawing(width, height)),
        { minLength: 1, maxLength: 5 },
    ),
);

/** A copy that differs from `frame` only in the colour under alpha 0. */
function withHiddenColor(frame: PixelBuffer): PixelBuffer {
    const copy = clonePixelBuffer(frame);
    for (let i = 0; i < copy.data.length; i += 4) {
        if (copy.data[i + 3] === 0) copy.data.set([9, 8, 7], i);
    }
    return copy;
}

/**
 * A copy that differs from `frame` in one colour channel of one visible pixel, the one
 * numbered `which` among them; a copy of a fully transparent frame is the same frame.
 */
function withOtherPixel(frame: PixelBuffer, which: number): PixelBuffer {
    const copy = clonePixelBuffer(frame);
    const visible: number[] = [];
    for (let i = 0; i < copy.data.length; i += 4) {
        if (copy.data[i + 3] !== 0) visible.push(i);
    }
    if (visible.length > 0) copy.data[visible[which % visible.length] + (which % 3)] ^= 1;
    return copy;
}

/**
 * One to twelve frames drawn from a few drawings, so that some frames are identical. Some
 * copies carry colour under alpha 0, which leaves them identical; some differ from their
 * drawing in a single pixel, which does not.
 */
const frameLists: fc.Arbitrary<PixelBuffer[]> = drawings.chain((pool) =>
    fc
        .array(
            fc.record({
                source: fc.nat(pool.length - 1),
                hidden: fc.boolean(),
                other: fc.option(fc.nat(99), { nil: undefined, freq: 4 }),
            }),
            { minLength: 1, maxLength: 12 },
        )
        .map((picks) =>
            picks.map(({ source, hidden, other }) => {
                const frame =
                    other === undefined ? pool[source] : withOtherPixel(pool[source], other);
                return hidden ? withHiddenColor(frame) : clonePixelBuffer(frame);
            }),
        ),
);

const optionSets: fc.Arbitrary<PackOptions> = fc.record({
    layout: fc.constantFrom("grid", "row", "column"),
    padding: fc.integer({ min: 0, max: 8 }),
    extrude: fc.integer({ min: 0, max: 2 }),
    trim: fc.boolean(),
    mergeDuplicates: fc.boolean(),
});

const cases = fc.record({ frames: frameLists, options: optionSets });

/** What makes two frames identical: their size and their pixels after normalization. */
function identity(frame: PixelBuffer): string {
    return `${frame.width}x${frame.height}:${normalizedCopy(frame).data.join()}`;
}

/** The bounds of the pixels with alpha above 0 as [left, top, right, bottom), or null. */
function visibleBounds(frame: PixelBuffer): [number, number, number, number] | null {
    let bounds: [number, number, number, number] | null = null;
    for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
            if (frame.data[(y * frame.width + x) * 4 + 3] === 0) continue;
            bounds = bounds
                ? [
                      Math.min(bounds[0], x),
                      Math.min(bounds[1], y),
                      Math.max(bounds[2], x + 1),
                      Math.max(bounds[3], y + 1),
                  ]
                : [x, y, x + 1, y + 1];
        }
    }
    return bounds;
}

/** `size` rounded up to an even number. */
function even(size: number): number {
    return size % 2 === 0 ? size : size + 1;
}

/** Columns and rows of a layout for `count` rects; ⌈√count⌉ is found without a square root. */
function cells(layout: PackOptions["layout"], count: number): [number, number] {
    if (layout === "row") return [count, 1];
    if (layout === "column") return [1, count];
    let columns = 1;
    while (columns * columns < count) columns++;
    let rows = 1;
    while (columns * rows < count) rows++;
    return [columns, rows];
}

describe("pack, invariants over random frames and options", () => {
    it("generates frames that exercise trimming, merging and normalization", () => {
        const seen = { trimmed: 0, empty: 0, odd: 0, duplicate: 0, alike: 0, hidden: 0, mixed: 0 };
        fc.assert(
            fc.property(frameLists, (frames) => {
                const bounds = frames.map(visibleBounds);
                if (bounds.some((b) => b && (b[0] > 0 || b[1] > 0))) seen.trimmed++;
                if (bounds.some((b) => b === null)) seen.empty++;
                if (bounds.some((b) => b && (b[2] - b[0]) % 2 === 1)) seen.odd++;
                if (new Set(frames.map(identity)).size < frames.length) seen.duplicate++;
                // Different frames of one size with the same bounds: only pixels tell them apart.
                const shapes = frames.map((f, i) => `${f.width}x${f.height}:${String(bounds[i])}`);
                const different = new Set(frames.map(identity)).size;
                if (new Set(shapes).size < different) seen.alike++;
                if (frames.some((f) => !pixelBuffersEqual(f, normalizedCopy(f)))) seen.hidden++;
                if (new Set(frames.map((f) => `${f.width}x${f.height}`)).size > 1) seen.mixed++;
            }),
            // A fixed seed: this test is about the generator, the others take a new one.
            { ...RUNS, seed: 50 },
        );
        for (const [kind, count] of Object.entries(seen)) {
            expect(count, kind).toBeGreaterThanOrEqual(RUNS.numRuns / 10);
        }
    });

    it("every rect has even sides and lies inside the atlas, gutter and padding included", () => {
        fc.assert(
            fc.property(cases, ({ frames, options }) => {
                const { atlas, rects } = pack(frames, options);
                const margin = options.extrude + options.padding;
                for (const rect of rects) {
                    const { x, y, w, h } = rect;
                    expect([x, y, w, h].every(Number.isInteger)).toBe(true);
                    expect([w % 2, h % 2]).toEqual([0, 0]);
                    expect(Math.min(w, h)).toBeGreaterThanOrEqual(2);
                    expect(Math.min(x, y)).toBeGreaterThanOrEqual(margin);
                    expect(x + w + margin).toBeLessThanOrEqual(atlas.width);
                    expect(y + h + margin).toBeLessThanOrEqual(atlas.height);
                }
                expect(atlas.data).toHaveLength(atlas.width * atlas.height * 4);
            }),
            RUNS,
        );
    });

    it("no two rects overlap: their gutters stay at least the padding apart", () => {
        fc.assert(
            fc.property(cases, ({ frames, options }) => {
                const { rects } = pack(frames, options);
                // From the end of one rect to the start of the next: two gutters and the padding.
                const gap = 2 * options.extrude + options.padding;
                rects.forEach((a, i) => {
                    for (const b of rects.slice(i + 1)) {
                        const apart =
                            a.x + a.w + gap <= b.x ||
                            b.x + b.w + gap <= a.x ||
                            a.y + a.h + gap <= b.y ||
                            b.y + b.h + gap <= a.y;
                        expect(apart).toBe(true);
                    }
                });
            }),
            RUNS,
        );
    });

    it("the atlas has the size of SPEC §9.4 and every rect starts at its cell", () => {
        fc.assert(
            fc.property(cases, ({ frames, options }) => {
                const { layout, padding, extrude } = options;
                const { atlas, rects } = pack(frames, options);
                const [columns, rows] = cells(layout, rects.length);
                // The cell is the largest rect.
                const pitchX = Math.max(...rects.map((rect) => rect.w)) + padding + 2 * extrude;
                const pitchY = Math.max(...rects.map((rect) => rect.h)) + padding + 2 * extrude;

                expect([atlas.width, atlas.height]).toEqual([
                    columns * pitchX + padding,
                    rows * pitchY + padding,
                ]);
                rects.forEach((rect, i) => {
                    expect([rect.x, rect.y]).toEqual([
                        padding + extrude + (i % columns) * pitchX,
                        padding + extrude + Math.floor(i / columns) * pitchY,
                    ]);
                });
            }),
            RUNS,
        );
    });

    it("every rect, cropped to its content size, equals its source frame byte-exactly", () => {
        fc.assert(
            fc.property(cases, ({ frames, options }) => {
                const { atlas, rects } = pack(frames, options);
                for (const rect of rects) {
                    // The content size of SPEC §9.2.
                    expect([rect.contentW, rect.contentH]).toEqual([
                        Math.min(rect.w, rect.sourceW - rect.offsetX),
                        Math.min(rect.h, rect.sourceH - rect.offsetY),
                    ]);
                    expect(rect.w - rect.contentW).toBeLessThanOrEqual(1);
                    expect(rect.h - rect.contentH).toBeLessThanOrEqual(1);
                    const content = contentOf(atlas, rect);
                    for (const index of rect.frameIndices) {
                        const frame = frames[index];
                        expect([rect.sourceW, rect.sourceH]).toEqual([frame.width, frame.height]);
                        expect(firstDifference(content, sourceOf(frame, rect))).toBeNull();
                    }
                    // What lies past the content is the transparent padding of an odd side.
                    const whole = cropPixels(atlas, {
                        x: rect.x,
                        y: rect.y,
                        width: rect.w,
                        height: rect.h,
                    });
                    const padded = cropPixels(content, {
                        x: 0,
                        y: 0,
                        width: rect.w,
                        height: rect.h,
                    });
                    expect(firstDifference(whole, padded)).toBeNull();
                }
            }),
            RUNS,
        );
    });

    it("a rect is the whole frame, or with trim the even bounds of its visible pixels", () => {
        fc.assert(
            fc.property(cases, ({ frames, options }) => {
                const { rects } = pack(frames, options);
                for (const rect of rects) {
                    const frame = frames[rect.frameIndices[0]];
                    const bounds = options.trim
                        ? visibleBounds(frame)
                        : [0, 0, frame.width, frame.height];
                    // Nothing visible: 2×2 at the top-left corner.
                    const [left, top, right, bottom] = bounds ?? [0, 0, 2, 2];
                    expect([rect.offsetX, rect.offsetY, rect.w, rect.h]).toEqual([
                        left,
                        top,
                        even(right - left),
                        even(bottom - top),
                    ]);
                    // It reaches at most one pixel past its frame (SPEC §9.2).
                    expect(rect.offsetX + rect.w).toBeLessThanOrEqual(rect.sourceW + 1);
                    expect(rect.offsetY + rect.h).toBeLessThanOrEqual(rect.sourceH + 1);
                }
            }),
            RUNS,
        );
    });

    it("the atlas is its rects, their extruded edges and transparent pixels, nothing else", () => {
        fc.assert(
            fc.property(cases, ({ frames, options }) => {
                const { atlas, rects } = pack(frames, options);
                // `atlasOf` throws when two rects, gutters included, share a pixel.
                const expected = atlasOf(atlas.width, atlas.height, rects, frames, options.extrude);
                expect(firstDifference(atlas, expected)).toBeNull();
                // Fully transparent pixels are 0,0,0,0.
                const { data } = atlas;
                let hiddenColors = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] === 0 && (data[i] | data[i + 1] | data[i + 2]) !== 0) {
                        hiddenColors++;
                    }
                }
                expect(hiddenColors).toBe(0);
            }),
            RUNS,
        );
    });

    it("with merge on, frames share a rect exactly when they are identical", () => {
        fc.assert(
            fc.property(cases, ({ frames, options }) => {
                const { rects } = pack(frames, { ...options, mergeDuplicates: true });
                // Groups of identical frames, in the order of their first frame.
                const groups = new Map<string, number[]>();
                frames.forEach((frame, index) => {
                    const key = identity(frame);
                    groups.set(key, [...(groups.get(key) ?? []), index]);
                });
                expect(rects.map((rect) => rect.frameIndices)).toEqual([...groups.values()]);
            }),
            RUNS,
        );
    });

    it("with merge off, rect i serves frame i alone", () => {
        fc.assert(
            fc.property(cases, ({ frames, options }) => {
                const { rects } = pack(frames, { ...options, mergeDuplicates: false });
                expect(rects.map((rect) => rect.frameIndices)).toEqual(frames.map((_, i) => [i]));
            }),
            RUNS,
        );
    });

    it("merging changes which rect a frame has, not what the rect shows", () => {
        fc.assert(
            fc.property(cases, ({ frames, options }) => {
                const shape = ({ w, h, sourceW, sourceH, offsetX, offsetY }: PackedRect) => [
                    w,
                    h,
                    sourceW,
                    sourceH,
                    offsetX,
                    offsetY,
                ];
                const merged = pack(frames, { ...options, mergeDuplicates: true });
                const separate = pack(frames, { ...options, mergeDuplicates: false });
                for (const rect of merged.rects) {
                    for (const index of rect.frameIndices) {
                        const own = separate.rects[index];
                        expect(shape(rect)).toEqual(shape(own));
                        expect(
                            firstDifference(
                                contentOf(merged.atlas, rect),
                                contentOf(separate.atlas, own),
                            ),
                        ).toBeNull();
                    }
                }
            }),
            RUNS,
        );
    });

    it("is deterministic and leaves the frames as they were", () => {
        fc.assert(
            fc.property(cases, ({ frames, options }) => {
                const copies = frames.map(clonePixelBuffer);
                const first = pack(frames, options);
                const second = pack(copies, { ...options });

                expect(second.rects).toEqual(first.rects);
                expect(firstDifference(second.atlas, first.atlas)).toBeNull();
                frames.forEach((frame, i) => {
                    expect(pixelBuffersEqual(frame, copies[i])).toBe(true);
                    expect(first.atlas.data.buffer).not.toBe(frame.data.buffer);
                });
            }),
            RUNS,
        );
    });
});
