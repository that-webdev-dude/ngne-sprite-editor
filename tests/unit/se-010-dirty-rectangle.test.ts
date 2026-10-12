import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { celAt } from "../../src/core/model";
import type { PixelBuffer, Rect } from "../../src/core/model";
import { clonePixelBuffer } from "../../src/core/pixels";
import {
    FRAME,
    assertDocument,
    celImage,
    firstDifference,
    imageBytes,
    layerId,
    setCel,
    sprite,
    sprites,
} from "./se-010-support";
import type { RandomSprite } from "./se-010-support";

function contains(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/** `inside` where the rectangle is, `outside` everywhere else; all three have one size. */
function patched(outside: PixelBuffer, inside: PixelBuffer, rect: Rect): PixelBuffer {
    const result = clonePixelBuffer(outside);
    for (let y = 0; y < result.height; y++) {
        for (let x = 0; x < result.width; x++) {
            if (!contains(rect, x, y)) continue;
            const at = (y * result.width + x) * 4;
            result.data.set(inside.data.subarray(at, at + 4), at);
        }
    }
    return result;
}

interface RectangleCase {
    random: RandomSprite;
    /** Covers at least one pixel of the canvas and may reach up to three pixels outside it. */
    rect: Rect;
    /** What the buffer holds before the call: any bytes. */
    held: Uint8ClampedArray;
}

const rectangleCases: fc.Arbitrary<RectangleCase> = sprites.chain((random) => {
    const { width, height } = random;
    // One pixel of the canvas, then how far the rectangle reaches from it on each side.
    const rect = fc.tuple(fc.nat({ max: width - 1 }), fc.nat({ max: height - 1 })).chain(([x, y]) =>
        fc
            .record({
                left: fc.nat({ max: x + 3 }),
                top: fc.nat({ max: y + 3 }),
                right: fc.nat({ max: width - 1 - x + 3 }),
                bottom: fc.nat({ max: height - 1 - y + 3 }),
            })
            .map(({ left, top, right, bottom }) => ({
                x: x - left,
                y: y - top,
                width: left + 1 + right,
                height: top + 1 + bottom,
            })),
    );
    return fc.record({ random: fc.constant(random), rect, held: imageBytes(width * height) });
});

interface EditCase {
    random: RandomSprite;
    /** Inside the canvas, at least one pixel. */
    rect: Rect;
    /** Index of the layer whose cel is edited. */
    layer: number;
    /** New pixels of the rectangle, row-major. */
    bytes: Uint8ClampedArray;
}

const editCases: fc.Arbitrary<EditCase> = sprites.chain((random) => {
    const { width, height, layers } = random;
    return fc
        .tuple(fc.nat({ max: width - 1 }), fc.nat({ max: height - 1 }))
        .chain(([x, y]) =>
            fc.record({
                x: fc.constant(x),
                y: fc.constant(y),
                width: fc.integer({ min: 1, max: width - x }),
                height: fc.integer({ min: 1, max: height - y }),
            }),
        )
        .chain((rect) =>
            fc.record({
                random: fc.constant(random),
                rect: fc.constant(rect),
                layer: fc.nat({ max: layers.length - 1 }),
                bytes: imageBytes(rect.width * rect.height),
            }),
        );
});

describe("compositeFrame, dirty rectangle", () => {
    it("for 200 random cases, the rectangle equals the same region of a full composite", () => {
        let runs = 0;
        let clipped = 0;
        let partial = 0;
        fc.assert(
            fc.property(rectangleCases, ({ random, rect, held }) => {
                runs++;
                const { width, height } = random;
                const doc = sprite(width, height, random.layers);
                const full = compositeFrame(doc, FRAME);
                const into = { width, height, data: held.slice() };
                const before = clonePixelBuffer(into);

                const result = compositeFrame(doc, FRAME, { rect, into });

                expect(result).toBe(into);
                expect(firstDifference(into, patched(before, full, rect))).toBeNull();

                const right = rect.x + rect.width;
                const bottom = rect.y + rect.height;
                if (rect.x < 0 || rect.y < 0 || right > width || bottom > height) clipped++;
                if (rect.x > 0 || rect.y > 0 || right < width || bottom < height) partial++;
            }),
            { numRuns: 200 },
        );
        expect(runs).toBe(200);
        // Some rectangles reach outside the canvas and some leave part of it alone.
        expect(clipped).toBeGreaterThan(0);
        expect(partial).toBeGreaterThan(0);
    });

    it("for 200 random edits, recompositing the edited rectangle equals a new composite", () => {
        let runs = 0;
        fc.assert(
            fc.property(editCases, ({ random, rect, layer, bytes }) => {
                runs++;
                const { width, height } = random;
                const doc = sprite(width, height, random.layers);
                const buffer = compositeFrame(doc, FRAME);

                // The edit: new pixels in the rectangle of one cel, as a stroke leaves them.
                // An empty cel gets a transparent image first.
                if (!celAt(doc, layerId(layer), FRAME)) {
                    setCel(doc, layerId(layer), FRAME, new Uint8ClampedArray(width * height * 4));
                }
                const image = celImage(doc, layerId(layer), FRAME);
                for (let row = 0; row < rect.height; row++) {
                    const from = row * rect.width * 4;
                    image.data.set(
                        bytes.subarray(from, from + rect.width * 4),
                        ((rect.y + row) * width + rect.x) * 4,
                    );
                }
                assertDocument(doc);

                expect(compositeFrame(doc, FRAME, { rect, into: buffer })).toBe(buffer);

                expect(firstDifference(buffer, compositeFrame(doc, FRAME))).toBeNull();
            }),
            { numRuns: 200 },
        );
        expect(runs).toBe(200);
    });

    it("recomposites one pixel", () => {
        const doc = sprite(3, 3, [
            { pixels: new Uint8ClampedArray(36).fill(255) },
            { pixels: new Uint8ClampedArray(36) },
        ]);
        const buffer = compositeFrame(doc, FRAME);

        celImage(doc, layerId(1), FRAME).data.set([255, 0, 0, 128], (1 * 3 + 2) * 4);
        compositeFrame(doc, FRAME, { rect: { x: 2, y: 1, width: 1, height: 1 }, into: buffer });

        // Half red over opaque white: Ra = 255, g and b are 255 + trunc(-255 * 128 / 255) = 127.
        const expected = new Uint8ClampedArray(36).fill(255);
        expected.set([255, 127, 127, 255], (1 * 3 + 2) * 4);
        expect(Array.from(buffer.data)).toEqual(Array.from(expected));
    });
});
