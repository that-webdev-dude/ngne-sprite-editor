import type { Frame } from "@ngne/core";
import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { bundle, spriteAt, spriteAtTopLeft } from "../../src/core/export";
import type { Bundle, DrawOptions, SheetSprite, SpriteSink } from "../../src/core/export";
import type { PixelBuffer, SpriteDoc } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";
import { FIXTURES, FIXTURE_IDS } from "../e2e/se-053-documents";
import {
    ANCHOR,
    CANVAS,
    CLEAR,
    SMALL_ANCHORS,
    alphaCounts,
    canvasOf,
    compareCanvas,
    expectedCanvas,
    expectedSprite,
    frameDraws,
    sceneAnchors,
} from "../e2e/se-053-expected";
import type { DrawCommand } from "../e2e/se-053-expected";
import { firstDifference, ngneFrame, rasterize } from "./se-051-support";

// SE-053: the expectations of the consumer spec, checked without a GPU.
// - `compareCanvas` is the tolerance of the ticket, and it does refuse what lies outside it.
// - `expectedSprite` says where a frame must appear. Every draw the spec makes is made here
//   on NGNE's own `Frame` with the sprite runtime, and rasterized the way NGNE's shader
//   samples a quad (`rasterize` of se-051-support.ts): the result is the expectation, pixel
//   for pixel. So the spec compares the GPU with what NGNE's arithmetic gives.
// - The draws near the corner of the canvas do find a turn that is not exact.

interface Exported {
    doc: SpriteDoc;
    made: Bundle;
    /** The composite of each frame, by its ID in the atlas. */
    composites: Map<string, PixelBuffer>;
}

function exported(doc: SpriteDoc): Exported {
    const made = bundle(doc);
    const composites = new Map(
        Object.keys(made.meta.frames).map((id, index) => [
            id,
            compositeFrame(doc, doc.frames[index].id),
        ]),
    );
    return { doc, made, composites };
}

const EXPORTS = new Map(FIXTURE_IDS.map((id) => [id, exported(FIXTURES[id].build())]));

/** The options the consumer page passes for a command (tests/e2e/harness/se-053-consumer.ts). */
function optionsOf(command: DrawCommand): DrawOptions {
    return {
        ...(command.quarters ? { rotation: (command.quarters * Math.PI) / 2 } : {}),
        ...(command.scale === undefined ? {} : { scale: command.scale }),
        ...(command.flipX ? { flipX: true } : {}),
        ...(command.flipY ? { flipY: true } : {}),
    };
}

/** What NGNE's default camera shows of the commands on a canvas of the consumer's size. */
function shown(made: Bundle, commands: readonly DrawCommand[]): PixelBuffer {
    const frame = ngneFrame();
    for (const command of commands) {
        const draw = command.topLeft ? spriteAtTopLeft : spriteAt;
        draw(frame, made.meta, "atlas", command.frame, command.x, command.y, optionsOf(command));
    }
    return rasterize(frame, made.atlas, CANVAS.width, CANVAS.height);
}

/** A canvas as a GPU gives it: `image` over the clear colour, every pixel opaque. */
function blended(image: PixelBuffer, clear: number = CLEAR): PixelBuffer {
    const canvas = createPixelBuffer(image.width, image.height);
    const background = [(clear >>> 16) & 255, (clear >>> 8) & 255, clear & 255];
    for (let at = 0; at < image.data.length; at += 4) {
        const alpha = image.data[at + 3];
        for (let channel = 0; channel < 3; channel++) {
            canvas.data[at + channel] = Math.round(
                (image.data[at + channel] * alpha + background[channel] * (255 - alpha)) / 255,
            );
        }
        canvas.data[at + 3] = 255;
    }
    return canvas;
}

describe("compareCanvas", () => {
    // One pixel of each kind: opaque, half transparent, transparent.
    const image: PixelBuffer = {
        width: 3,
        height: 1,
        data: Uint8ClampedArray.from([200, 100, 50, 255, 200, 100, 50, 128, 0, 0, 0, 0]),
    };
    const canvas = () => blended(image);
    /** The canvas with `delta` added to one byte. */
    const off = (pixel: number, channel: number, delta: number) => {
        const changed = canvas();
        changed.data[pixel * 4 + channel] += delta;
        return changed;
    };

    it("accepts the image blended over the clear colour", () => {
        expect(compareCanvas(canvas(), image)).toEqual([]);
        // 200·128/255 + 42·127/255 = 121.3: the half-transparent pixel is 121, 80, 63.
        expect([...canvas().data.subarray(4, 8)]).toEqual([121, 80, 63, 255]);
        expect([...canvas().data.subarray(8, 12)]).toEqual([0x2a, 0x3b, 0x4c, 255]);
    });

    it("wants an opaque pixel exact", () => {
        for (const delta of [-1, 1]) {
            for (const channel of [0, 1, 2]) {
                expect(compareCanvas(off(0, channel, delta), image)).toHaveLength(1);
            }
        }
        expect(compareCanvas(off(0, 1, 1), image)).toEqual([
            "pixel (0, 0) is 200,101,50 with alpha 255, expected 200,100,50 (opaque, ±0)",
        ]);
    });

    it("gives a partly transparent pixel 1 per channel, and no more", () => {
        for (const channel of [0, 1, 2]) {
            expect(compareCanvas(off(1, channel, 1), image)).toEqual([]);
            expect(compareCanvas(off(1, channel, -1), image)).toEqual([]);
            expect(compareCanvas(off(1, channel, 2), image)).toHaveLength(1);
            expect(compareCanvas(off(1, channel, -2), image)).toHaveLength(1);
        }
        expect(compareCanvas(off(1, 0, 2), image)).toEqual([
            "pixel (1, 0) is 123,80,63 with alpha 255, expected 121,80,63 (alpha 128, ±1)",
        ]);
    });

    it("wants a transparent pixel to be the clear colour, exact", () => {
        for (const delta of [-1, 1]) {
            for (const channel of [0, 1, 2]) {
                expect(compareCanvas(off(2, channel, delta), image)).toHaveLength(1);
            }
        }
        expect(compareCanvas(off(2, 2, -1), image)).toEqual([
            "pixel (2, 0) is 42,59,75 with alpha 255, expected 42,59,76 (clear, ±0)",
        ]);
        // Another clear colour is another expectation.
        expect(compareCanvas(blended(image, 0x102030), image, 0x102030)).toEqual([]);
        expect(compareCanvas(blended(image, 0x102030), image)).not.toEqual([]);
    });

    it("wants every pixel of the canvas opaque", () => {
        for (const pixel of [0, 1, 2]) {
            expect(compareCanvas(off(pixel, 3, -1), image)).toHaveLength(1);
        }
    });

    it("refuses a canvas of another size", () => {
        const wide = blended({ width: 1, height: 3, data: image.data });
        expect(compareCanvas(wide, image)).toEqual(["the canvas is 1×3, expected 3×1"]);
        expect(compareCanvas({ width: 3, height: 1, data: [1, 2, 3, 4] }, image)).toEqual([
            "the canvas has 4 bytes, expected 12",
        ]);
    });

    it("lists the first pixels at fault and counts the rest", () => {
        const { made, composites } = EXPORTS.get("a") ?? exported(FIXTURES.a.build());
        const [[frame, composite]] = [...composites];
        const pivot = { x: 0.5, y: 0.5 };
        const right = expectedCanvas(composite, pivot, { frame, x: 64, y: 64 });
        const moved = expectedCanvas(composite, pivot, { frame, x: 65, y: 64 });
        expect(firstDifference(shown(made, [{ frame, x: 64, y: 64 }]), right)).toBeNull();

        // The frame drawn one pixel to the right of where it must be.
        const faults = compareCanvas(blended(moved), right, CLEAR, 3);
        expect(faults).toHaveLength(4);
        expect(faults[3]).toMatch(/^\d{3,} pixels differ in all$/);
        expect(compareCanvas(blended(right), right)).toEqual([]);
    });
});

// Every case rasterizes the quads of many draws: slow when other suites keep the machine busy.
describe.each(FIXTURE_IDS)(
    "what the consumer spec expects of fixture (%s)",
    { timeout: 60_000 },
    (id) => {
        const { doc, made, composites } = EXPORTS.get(id) ?? exported(FIXTURES[id].build());
        const kinds = ["anchored", "turned", "mirrored", "scaled"] as const;

        it.each(kinds)("is what NGNE's Frame shows of the runtime's quads: %s", (kind) => {
            let draws = 0;
            for (const [frame, composite] of composites) {
                for (const command of frameDraws(frame)[kind]) {
                    const expected = expectedCanvas(composite, doc.pivot, command);
                    expect(
                        firstDifference(shown(made, [command]), expected),
                        JSON.stringify(command),
                    ).toBeNull();
                    draws++;
                }
            }
            expect(draws).toBe(
                composites.size * { anchored: 8, turned: 21, mirrored: 5, scaled: 4 }[kind],
            );
        });

        it("has frames with opaque, partly transparent and transparent pixels", () => {
            const counts = [...composites.values()].map(alphaCounts);
            const sum = (key: "opaque" | "partial" | "transparent") =>
                counts.reduce((total, count) => total + count[key], 0);
            expect(sum("opaque")).toBeGreaterThan(20);
            expect(sum("partial")).toBeGreaterThan(5);
            expect(sum("transparent")).toBeGreaterThan(5);
            // What is blended over the clear colour differs from it: nothing is hidden by it.
            for (const composite of composites.values()) {
                const { opaque, partial } = alphaCounts(composite);
                if (opaque + partial === 0) continue;
                expect(compareCanvas(blended(createPixelBuffer(1, 1)), composite)).not.toEqual([]);
            }
        });

        it("draws all frames side by side in one scene", () => {
            const anchors = sceneAnchors(composites.size, doc.width, doc.height, doc.pivot);
            const commands = [...composites.keys()].map((frame, index): DrawCommand => ({
                frame,
                x: anchors[index][0],
                y: anchors[index][1],
            }));
            // `canvasOf` refuses overlapping images: the frames are apart.
            const expected = canvasOf(
                commands.map((command) =>
                    expectedSprite(
                        composites.get(command.frame) ?? createPixelBuffer(1, 1),
                        doc.pivot,
                        command,
                    ),
                ),
            );
            expect(firstDifference(shown(made, commands), expected)).toBeNull();
            // Every frame lies on the canvas in full.
            const lit = [...composites.values()].reduce(
                (total, composite) =>
                    total + alphaCounts(composite).opaque + alphaCounts(composite).partial,
                0,
            );
            expect(alphaCounts(expected).opaque + alphaCounts(expected).partial).toBe(lit);
        });
    },
);

describe("expectedSprite", () => {
    const composite = (width: number, height: number): PixelBuffer => {
        const image = createPixelBuffer(width, height);
        image.data.fill(255);
        return image;
    };

    it("puts the pivot on the anchor, on whole pixels", () => {
        // 32 × 32 about its centre: 64 − 16 = 48.
        expect(
            expectedSprite(composite(32, 32), { x: 0.5, y: 0.5 }, { frame: "f", x: 64, y: 64 }),
        ).toMatchObject({ left: 48, top: 48 });
        // 33 × 17 about its centre, (16.5, 8.5): round(−16.5) = −16 and round(−8.5) = −8.
        expect(
            expectedSprite(composite(33, 17), { x: 0.5, y: 0.5 }, { frame: "f", x: 64, y: 64 }),
        ).toMatchObject({ left: 48, top: 56 });
        // The bottom centre of 32 × 32.
        expect(
            expectedSprite(composite(32, 32), { x: 0.5, y: 1 }, { frame: "f", x: 64, y: 64 }),
        ).toMatchObject({ left: 48, top: 32 });
        // By the corner, whatever the pivot.
        const corner = { frame: "f", x: 7, y: 5, topLeft: true };
        expect(expectedSprite(composite(33, 17), { x: 0.5, y: 1 }, corner)).toMatchObject({
            left: 7,
            top: 5,
        });
    });

    it("mirrors about the anchor and scales about it", () => {
        const pivot = { x: 0.25, y: 0.5 };
        // P = (8, 16): the frame spans 56..88; mirrored about x = 64 it spans 40..72.
        const plain = expectedSprite(composite(32, 32), pivot, { frame: "f", x: 64, y: 64 });
        const mirrored = expectedSprite(composite(32, 32), pivot, {
            frame: "f",
            x: 64,
            y: 64,
            flipX: true,
        });
        expect([plain.left, mirrored.left]).toEqual([56, 40]);
        // Twice the size: 64 − 16 = 48..112.
        const doubled = expectedSprite(composite(32, 32), pivot, {
            frame: "f",
            x: 64,
            y: 64,
            scale: 2,
        });
        expect([doubled.left, doubled.top, doubled.image.width]).toEqual([48, 32, 64]);
    });

    it("turns about the anchor, and leaves a half pixel to NGNE's rounding", () => {
        // 32 × 32 with the pivot at the bottom centre, (16, 32): after a quarter turn the
        // bottom edge is the left edge of the image, on x = 64, and it spans 48..80 in y.
        const feet = expectedSprite(
            composite(32, 32),
            { x: 0.5, y: 1 },
            {
                frame: "f",
                x: 64,
                y: 64,
                quarters: 1,
            },
        );
        expect([feet.left, feet.top]).toEqual([64, 48]);
        // 33 × 17 about (16.5, 8.5): the rectangle is 34 × 18 with its middle (0.5, 0.5)
        // from the pivot. Turned, that is (−0.5, 0.5): the centre (63.5, 64.5) is rounded
        // to (64, 65), and the 18 × 34 image spans 55..73 and 48..82.
        const odd = expectedSprite(
            composite(33, 17),
            { x: 0.5, y: 0.5 },
            {
                frame: "f",
                x: 64,
                y: 64,
                quarters: 1,
            },
        );
        expect([odd.left, odd.top, odd.image.width, odd.image.height]).toEqual([55, 48, 18, 34]);
    });
});

/**
 * The draw maths of SPEC §9.2 with the sine and the cosine as `Math` gives them: the runtime
 * as it was before a quarter turn was made exact (REVIEW.md, D33).
 */
function inexactSpriteAt(
    sink: SpriteSink,
    made: Bundle,
    id: string,
    x: number,
    y: number,
    rotation: number,
): void {
    const { meta } = made;
    const frame = meta.frames[id];
    const dx = frame.offsetX + frame.w / 2 - frame.pivot[0] * frame.sourceW;
    const dy = frame.offsetY + frame.h / 2 - frame.pivot[1] * frame.sourceH;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const sprite: SheetSprite = {
        x: x + dx * cos - dy * sin,
        y: y + dx * sin + dy * cos,
        width: frame.w,
        height: frame.h,
        texture: "atlas",
        u: frame.x / meta.width,
        v: frame.y / meta.height,
        uw: frame.w / meta.width,
        vh: frame.h / meta.height,
        rotation,
    };
    sink.sprite(sprite);
}

describe("the turned draws of the consumer spec", { timeout: 60_000 }, () => {
    /** Turned draws that a runtime with an inexact turn gets wrong, by where their anchor is. */
    function wrongWithInexactTurns(): { middle: string[]; corner: string[] } {
        const wrong = { middle: [] as string[], corner: [] as string[] };
        for (const id of FIXTURE_IDS) {
            const { doc, made, composites } = EXPORTS.get(id) ?? exported(FIXTURES[id].build());
            for (const [frame, composite] of composites) {
                for (const command of frameDraws(frame).turned) {
                    const sink: Frame = ngneFrame();
                    const rotation = ((command.quarters ?? 0) * Math.PI) / 2;
                    inexactSpriteAt(sink, made, frame, command.x, command.y, rotation);
                    const image = rasterize(sink, made.atlas, CANVAS.width, CANVAS.height);
                    const expected = expectedCanvas(composite, doc.pivot, command);
                    if (firstDifference(image, expected) === null) continue;
                    const middle = command.x === ANCHOR[0] && command.y === ANCHOR[1];
                    wrong[middle ? "middle" : "corner"].push(JSON.stringify(command));
                }
            }
        }
        return wrong;
    }

    it("find an inexact quarter turn near the corner of the canvas, where the middle does not", () => {
        const wrong = wrongWithInexactTurns();
        // In the middle of the canvas the last bits of the sine are lost in the sum, and
        // every frame lands where it must. Near the corner they are kept: a centre that
        // should end in .5 falls short of it, and NGNE rounds it down, one pixel off. That
        // happens to the frames of the two fixtures of odd size, at 180° and at 270°.
        expect(wrong.middle).toEqual([]);
        expect(wrong.corner.length).toBeGreaterThan(0);
        expect(wrong.corner.every((command) => /"frame":"(odd-bird|twice)-/.test(command))).toBe(
            true,
        );
        // The anchors near the corner are whole numbers below the middle.
        for (const [x, y] of SMALL_ANCHORS) {
            expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
            expect(x < ANCHOR[0] && y <= ANCHOR[1]).toBe(true);
        }
    });
});
