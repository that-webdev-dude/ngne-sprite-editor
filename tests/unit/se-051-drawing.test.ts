import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { bundle, spriteAt, spriteAtTopLeft } from "../../src/core/export";
import type { Bundle, DrawOptions } from "../../src/core/export";
import type { ExportSettings, PixelBuffer, SpriteDoc } from "../../src/core/model";
import { flipPixels, resizeNearest, rotatePixels } from "../../src/core/pixels";
import {
    cornersOf,
    exportSettings,
    firstDifference,
    grid,
    heroWalk,
    ngneFrame,
    noise,
    placed,
    quadsOf,
    rasterize,
    sprite,
} from "./se-051-support";

// What an exported bundle shows when it is drawn: the frames of the atlas, drawn by the
// sprite runtime into NGNE's own `Frame`, against the composites they were packed from.
// The renderer is stood in for by `rasterize` of se-051-support.ts, which samples the quads
// a `Frame` holds the way NGNE's shader does. This is condition 3 of SPEC §9.7 without a
// GPU; SE-053 repeats it on one.
//
// Where a frame must appear is worked out from the definition, not from the runtime's
// formula: the pivot P = pivot · size of the source frame lies on the anchor A; with a
// whole-number scale s and no rotation the frame is moved to whole pixels, so its top-left
// corner is at A + round(−s·P) (halves upwards); a mirrored frame is the mirror image of
// that about the line through A.

/** Size of the target every test draws into, and the anchor: whole numbers. */
const WIDTH = 160;
const HEIGHT = 160;
const ANCHOR: [number, number] = [80, 80];

/** A frame of noise with `inset` transparent pixels around it and a hole in it. */
function drawing(
    width: number,
    height: number,
    seed: number,
    inset: [number, number, number, number],
): PixelBuffer {
    const frame = noise(width, height, seed);
    const [left, top, right, bottom] = inset;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const outside = x < left || y < top || x >= width - right || y >= height - bottom;
            const hole = (x + y * 3 + seed) % 11 === 0;
            if (outside || hole) frame.data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
        }
    }
    return frame;
}

/** The fixtures of SE-053: (a) to (d). */
const FIXTURES: Record<string, () => SpriteDoc> = {
    "(a) 32 × 32, four frames, no trim": () =>
        sprite({
            name: "Even",
            frames: [0, 1, 2, 3].map((seed) => drawing(32, 32, seed, [seed, 0, 0, seed])),
        }),
    "(b) 33 × 17 with trim and extrude 1": () =>
        sprite({
            name: "Odd",
            frames: [
                drawing(33, 17, 10, [0, 0, 0, 0]),
                // Content 30 × 13 from (3, 2): even width, odd height, inside the frame.
                drawing(33, 17, 11, [3, 2, 0, 2]),
                // Content 27 × 16 from (6, 1): odd width against the right edge.
                drawing(33, 17, 12, [6, 1, 0, 0]),
                // Content 5 × 3 from (1, 1): odd both ways, inside the frame.
                drawing(33, 17, 13, [1, 1, 27, 13]),
                null,
            ],
            settings: { trim: true, extrude: 1 },
        }),
    "(c) merged duplicate frames": () =>
        sprite({
            name: "Twice",
            frames: [
                drawing(9, 7, 20, [1, 0, 0, 0]),
                drawing(9, 7, 21, [0, 0, 2, 1]),
                drawing(9, 7, 20, [1, 0, 0, 0]),
                drawing(9, 7, 21, [0, 0, 2, 1]),
                drawing(9, 7, 20, [1, 0, 0, 0]),
            ],
            settings: { trim: true },
        }),
    "(d) pivot at the bottom centre": () =>
        sprite({
            name: "Feet",
            frames: [drawing(32, 32, 30, [4, 6, 4, 0]), drawing(32, 32, 31, [0, 0, 0, 0])],
            pivot: [0.5, 1],
            settings: { trim: true },
        }),
    "the fixture of the golden files": heroWalk,
};

interface Drawn {
    doc: SpriteDoc;
    made: Bundle;
    /** The composite of each frame, by its ID in the atlas. */
    composites: Map<string, PixelBuffer>;
}

function exported(doc: SpriteDoc, settings: ExportSettings = doc.exportSettings): Drawn {
    const made = bundle(doc, settings);
    const ids = Object.keys(made.meta.frames);
    const composites = new Map(
        ids.map((id) => {
            const index = Number(id.slice(id.lastIndexOf("-") + 1));
            return [id, compositeFrame(doc, doc.frames[index].id)];
        }),
    );
    return { doc, made, composites };
}

/** What NGNE shows after `draw`, with its centre snapping on or off. */
function shown(
    made: Bundle,
    pixelSnap: boolean,
    draw: (frame: ReturnType<typeof ngneFrame>) => void,
): PixelBuffer {
    const frame = ngneFrame(pixelSnap);
    draw(frame);
    return rasterize(frame, made.atlas, WIDTH, HEIGHT);
}

/**
 * Where a composite must appear for a draw at the anchor with the pivot of the document:
 * scaled, moved to A + round(−s·P), and mirrored about the anchor.
 */
function expectedAtPivot(
    doc: SpriteDoc,
    composite: PixelBuffer,
    options: DrawOptions = {},
): PixelBuffer {
    const scale = options.scale ?? 1;
    let image = resizeNearest(composite, composite.width * scale, composite.height * scale);
    let left = ANCHOR[0] + Math.round(-scale * (doc.pivot.x * composite.width));
    let top = ANCHOR[1] + Math.round(-scale * (doc.pivot.y * composite.height));
    if (options.flipX) {
        image = flipPixels(image, "horizontal");
        left = 2 * ANCHOR[0] - (left + image.width);
    }
    if (options.flipY) {
        image = flipPixels(image, "vertical");
        top = 2 * ANCHOR[1] - (top + image.height);
    }
    return placed(image, left, top, WIDTH, HEIGHT);
}

// Every case rasterizes several quads: slow when other suites keep the machine busy.
describe.each(Object.entries(FIXTURES))("drawing %s", { timeout: 60_000 }, (_name, fixture) => {
    const { doc, made, composites } = exported(fixture());

    it("top-left placement shows every frame as its composite, corner on the point", () => {
        for (const pixelSnap of [true, false]) {
            for (const [id, composite] of composites) {
                const image = shown(made, pixelSnap, (frame) =>
                    spriteAtTopLeft(frame, made.meta, "atlas", id, 7, 5),
                );
                const expected = placed(composite, 7, 5, WIDTH, HEIGHT);

                expect(firstDifference(image, expected), `${id}, snap ${pixelSnap}`).toBeNull();
            }
        }
    });

    it("at an integer anchor shows every frame as its composite, on whole pixels", () => {
        for (const pixelSnap of [true, false]) {
            for (const [id, composite] of composites) {
                const image = shown(made, pixelSnap, (frame) =>
                    spriteAt(frame, made.meta, "atlas", id, ...ANCHOR),
                );

                expect(
                    firstDifference(image, expectedAtPivot(doc, composite)),
                    `${id}, snap ${pixelSnap}`,
                ).toBeNull();
            }
        }
    });

    it("flipX shows the mirror image about the anchor; flipY likewise", () => {
        for (const options of [{ flipX: true }, { flipY: true }, { flipX: true, flipY: true }]) {
            for (const pixelSnap of [true, false]) {
                for (const [id, composite] of composites) {
                    const image = shown(made, pixelSnap, (frame) =>
                        spriteAt(frame, made.meta, "atlas", id, ...ANCHOR, options),
                    );

                    expect(
                        firstDifference(image, expectedAtPivot(doc, composite, options)),
                        `${id}, snap ${pixelSnap}, ${JSON.stringify(options)}`,
                    ).toBeNull();
                }
            }
        }
    });

    it("scale 2 shows every pixel as 2 × 2, about the anchor", () => {
        for (const options of [{ scale: 2 }, { scale: 2, flipX: true }]) {
            for (const pixelSnap of [true, false]) {
                for (const [id, composite] of composites) {
                    const image = shown(made, pixelSnap, (frame) =>
                        spriteAt(frame, made.meta, "atlas", id, ...ANCHOR, options),
                    );

                    expect(
                        firstDifference(image, expectedAtPivot(doc, composite, options)),
                        `${id}, snap ${pixelSnap}, ${JSON.stringify(options)}`,
                    ).toBeNull();
                }
            }
        }
    });

    it("draws nothing outside the composite: padding, extrusion and neighbours stay out", () => {
        // All frames at once, side by side from their corners: nothing bleeds between them.
        const ids = [...composites.keys()].slice(0, 2);
        const image = shown(made, true, (frame) => {
            ids.forEach((id, index) =>
                spriteAtTopLeft(frame, made.meta, "atlas", id, 3 + index * 40, 9),
            );
        });
        const expected = placed(composites.get(ids[0]) ?? noise(1, 1, 0), 3, 9, WIDTH, HEIGHT);
        if (ids.length > 1) {
            const second = placed(composites.get(ids[1]) ?? noise(1, 1, 0), 43, 9, WIDTH, HEIGHT);
            second.data.forEach((value, index) => {
                if (value !== 0) expected.data[index] = value;
            });
        }
        expect(firstDifference(image, expected)).toBeNull();
    });
});

describe("drawing fixture (d): the pivot", () => {
    it("the bottom centre of a 32 × 32 frame lands on the anchor", () => {
        const { made, composites } = exported(FIXTURES["(d) pivot at the bottom centre"]());

        // P = (0.5·32, 1·32) = (16, 32): the frame spans 80 − 16 = 64..96 and
        // 80 − 32 = 48..80. Its bottom edge is the line y = 80 and its centre line x = 80:
        // the anchor.
        for (const [id, composite] of composites) {
            const image = shown(made, true, (frame) =>
                spriteAt(frame, made.meta, "atlas", id, ...ANCHOR),
            );
            expect(firstDifference(image, placed(composite, 64, 48, WIDTH, HEIGHT)), id).toBeNull();
        }
    });

    it("of an odd frame lands half a pixel beside it, on whole pixels", () => {
        const doc = FIXTURES["(b) 33 × 17 with trim and extrude 1"]();
        doc.pivot = { x: 0.5, y: 1 };
        const { made, composites } = exported(doc);

        // P = (16.5, 17): round(−16.5) = −16, so the frame spans 64..97 and 63..80. Its
        // centre line is x = 80.5.
        for (const [id, composite] of composites) {
            const image = shown(made, false, (frame) =>
                spriteAt(frame, made.meta, "atlas", id, ...ANCHOR),
            );
            expect(firstDifference(image, placed(composite, 64, 63, WIDTH, HEIGHT)), id).toBeNull();
        }
    });
});

describe("drawing with rotation 90°", () => {
    const quarter = { rotation: Math.PI / 2 };

    it("shows a 32 × 32 frame turned clockwise about its centre", () => {
        const { made, composites } = exported(FIXTURES["(a) 32 × 32, four frames, no trim"]());

        // The pivot (16, 16) stays on the anchor: the turned frame spans 64..96 both ways.
        for (const pixelSnap of [true, false]) {
            for (const [id, composite] of composites) {
                const image = shown(made, pixelSnap, (frame) =>
                    spriteAt(frame, made.meta, "atlas", id, ...ANCHOR, quarter),
                );
                const expected = placed(rotatePixels(composite, 90), 64, 64, WIDTH, HEIGHT);

                expect(firstDifference(image, expected), `${id}, snap ${pixelSnap}`).toBeNull();
            }
        }
    });

    it("turns a trimmed frame about its pivot at the bottom centre", () => {
        const { made, composites } = exported(FIXTURES["(d) pivot at the bottom centre"]());

        // P = (16, 32). A point (x, y) of the frame goes to A + (−(y − 32), x − 16): the
        // frame's bottom edge becomes the left edge of the image, on x = 80, and the image
        // spans 80..112 and 80 − 16 = 64..96.
        for (const pixelSnap of [true, false]) {
            for (const [id, composite] of composites) {
                const image = shown(made, pixelSnap, (frame) =>
                    spriteAt(frame, made.meta, "atlas", id, ...ANCHOR, quarter),
                );
                const expected = placed(rotatePixels(composite, 90), 80, 64, WIDTH, HEIGHT);

                expect(firstDifference(image, expected), `${id}, snap ${pixelSnap}`).toBeNull();
            }
        }
    });

    it("leaves an odd frame to NGNE's snapping: whole pixels with it, half pixels without", () => {
        // 33 × 17, untrimmed, pivot at the centre: P = (16.5, 8.5) cannot lie on a pixel
        // corner. Turned, the frame is 17 × 33 and ideally spans 71.5..88.5 and 63.5..96.5.
        // The runtime does not round a rotated frame (SPEC §9.2).
        const doc = sprite({ name: "Odd", frames: [drawing(33, 17, 40, [0, 0, 0, 0])] });
        const { made, composites } = exported(doc);
        const [[id, composite]] = [...composites];

        // The quad is the even 34 × 18 rectangle, turned: 18 × 34 about (79.5, 80.5). NGNE's
        // default camera rounds that centre to (80, 81): the quad spans 71..89 and 64..98,
        // and the frame in it 72..89 and 64..97, half a pixel right of and below the ideal.
        const snapped = shown(made, true, (frame) =>
            spriteAt(frame, made.meta, "atlas", id, ...ANCHOR, quarter),
        );
        expect(
            firstDifference(snapped, placed(rotatePixels(composite, 90), 72, 64, WIDTH, HEIGHT)),
        ).toBeNull();

        // With snapping off the quad keeps its centre: its edges lie on pixel centres.
        const loose = ngneFrame(false);
        spriteAt(loose, made.meta, "atlas", id, ...ANCHOR, quarter);
        const { xs, ys } = cornersOf(quadsOf(loose)[0]);
        expect(xs[0]).toBeCloseTo(70.5, 4);
        expect(xs[3]).toBeCloseTo(88.5, 4);
        expect(ys[0]).toBeCloseTo(63.5, 4);
        expect(ys[3]).toBeCloseTo(97.5, 4);
    });
});

// 150 documents, each drawn frame by frame.
describe("drawing any document", { timeout: 60_000 }, () => {
    const pixel = fc.constantFrom(".", ".", "A", "B", "C", "D");
    const cases = fc
        .record({
            width: fc.integer({ min: 1, max: 9 }),
            height: fc.integer({ min: 1, max: 9 }),
            count: fc.integer({ min: 1, max: 5 }),
            pivot: fc.tuple(
                fc.constantFrom(0, 0.25, 0.5, 0.75, 1, 1 / 3, 0.3, 0.7),
                fc.constantFrom(0, 0.25, 0.5, 0.75, 1, 1 / 3, 0.3, 0.7),
            ),
            settings: fc.record({
                layout: fc.constantFrom("grid" as const, "row" as const, "column" as const),
                padding: fc.integer({ min: 0, max: 8 }),
                extrude: fc.integer({ min: 0, max: 2 }),
                trim: fc.boolean(),
                mergeDuplicates: fc.boolean(),
            }),
            scale: fc.integer({ min: 1, max: 3 }),
            flipX: fc.boolean(),
            flipY: fc.boolean(),
            pixelSnap: fc.boolean(),
        })
        .chain((shape) =>
            fc
                .array(
                    fc.array(
                        fc.string({ unit: pixel, minLength: shape.width, maxLength: shape.width }),
                        {
                            minLength: shape.height,
                            maxLength: shape.height,
                        },
                    ),
                    { minLength: shape.count, maxLength: shape.count },
                )
                .map((rows) => ({ ...shape, rows })),
        );

    it("shows every frame as its composite, at its corner and at its pivot, scaled and mirrored", () => {
        fc.assert(
            fc.property(cases, ({ rows, pivot, settings, scale, flipX, flipY, pixelSnap }) => {
                const doc = sprite({
                    name: "Any",
                    frames: rows.map((frame) => grid(...frame)),
                    pivot,
                });
                const { made, composites } = exported(doc, exportSettings(settings));
                const options = { scale, flipX, flipY };

                expect(composites.size).toBe(rows.length);
                for (const [id, composite] of composites) {
                    const corner = shown(made, pixelSnap, (frame) =>
                        spriteAtTopLeft(frame, made.meta, "atlas", id, 11, 13),
                    );
                    expect(
                        firstDifference(corner, placed(composite, 11, 13, WIDTH, HEIGHT)),
                    ).toBeNull();

                    const anchored = shown(made, pixelSnap, (frame) =>
                        spriteAt(frame, made.meta, "atlas", id, ...ANCHOR, options),
                    );
                    expect(
                        firstDifference(anchored, expectedAtPivot(doc, composite, options)),
                    ).toBeNull();
                }
            }),
            { numRuns: 150 },
        );
    });
});
