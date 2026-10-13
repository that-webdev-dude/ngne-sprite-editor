import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    animationDone,
    animationFrame,
    bundle,
    spriteAt,
    spriteAtTopLeft,
} from "../../src/core/export";
import type { AtlasFrame, DrawOptions, SpriteAtlas } from "../../src/core/export";
import {
    Recorder,
    cornersOf,
    demoDrawSprite,
    heroWalk,
    ngneFrame,
    quadsOf,
} from "./se-051-support";
import type { DemoRect } from "./se-051-support";

// The draw maths of SPEC §9.2, as the sprite runtime does them:
//
//     d      = (offsetX + w/2 − pivot[0]·sourceW, offsetY + h/2 − pivot[1]·sourceH)
//     centre = A + R(θ) · (fx·s·d.x, fy·s·d.y)        R(θ)·(x, y) = (x cos θ − y sin θ,
//     size   = (fx·s·w, fy·s·h)                                      x sin θ + y cos θ)
//     uv     = (x/width, y/height, w/width, h/height)
//
// with `s·d` rounded to integers when θ = 0 and s is an integer. Every expected number is
// worked out by hand from these lines. What the runtime hands over is looked at twice: as
// the sprite it gives a recording sink, and as the quad NGNE's own `Frame` packs from it.

/** The frame `player` of the atlas of NGNE's demo (demo/assets/starfall.json). */
const PLAYER = { x: 34, y: 72, w: 32, h: 36 };

/** A sheet written out by hand, 256 × 128 as the demo's atlas. */
const SHEET: SpriteAtlas = {
    width: 256,
    height: 128,
    frames: {
        // An untrimmed frame of even size with the pivot at its centre, as the demo has them.
        ship: { ...PLAYER, sourceW: 32, sourceH: 36, offsetX: 0, offsetY: 0, pivot: [0.5, 0.5] },
        // The same frame with its pivot a quarter in and three quarters down.
        nose: { ...PLAYER, sourceW: 32, sourceH: 36, offsetX: 0, offsetY: 0, pivot: [0.25, 0.75] },
        // 12 × 6 pixels trimmed out of a 33 × 17 frame; pivot at the bottom centre.
        boot: {
            x: 100,
            y: 10,
            w: 12,
            h: 6,
            sourceW: 33,
            sourceH: 17,
            offsetX: 7,
            offsetY: 4,
            pivot: [0.5, 1],
        },
        // A whole 33 × 17 frame in its even 34 × 18 rectangle; pivot at the centre.
        odd: {
            x: 1,
            y: 1,
            w: 34,
            h: 18,
            sourceW: 33,
            sourceH: 17,
            offsetX: 0,
            offsetY: 0,
            pivot: [0.5, 0.5],
        },
    },
    animations: {},
};

/** The demo's atlas data for the first two frames above. */
const DEMO_ART: { width: number; height: number; frames: Record<string, DemoRect> } = {
    width: 256,
    height: 128,
    frames: {
        ship: { ...PLAYER, pivot: [0.5, 0.5] },
        nose: { ...PLAYER, pivot: [0.25, 0.75] },
    },
};

/** The sprite the runtime hands a sink for one draw. */
function drawn(id: string, x: number, y: number, options?: DrawOptions) {
    const sink = new Recorder();
    spriteAt(sink, SHEET, "sheet", id, x, y, options);
    expect(sink.sprites).toHaveLength(1);
    return sink.sprites[0];
}

/** The quad NGNE's `Frame` packs for one draw. */
function quad(id: string, x: number, y: number, options?: DrawOptions, pixelSnap = true) {
    const frame = ngneFrame(pixelSnap);
    spriteAt(frame, SHEET, "sheet", id, x, y, options);
    return quadsOf(frame)[0];
}

const ANCHORS: [number, number][] = [
    [0, 0],
    [120, 80],
    [-7, 3],
    [10.25, 99.5],
];
const ROTATIONS = [0, 0.3, Math.PI / 2, -2.1, Math.PI, 7];

describe("an untrimmed frame of even size, against NGNE's demo/sprites.ts", () => {
    it("centre pivot: the runtime hands over the sprite the demo hands over", () => {
        for (const [x, y] of ANCHORS) {
            for (const rotation of ROTATIONS) {
                const demo = new Recorder();
                demoDrawSprite(demo, DEMO_ART, "ships", "ship", x, y, rotation);
                const ours = new Recorder();
                // Layer 3 and alpha 1 are the defaults of the demo's function.
                spriteAt(ours, SHEET, "ships", "ship", x, y, { rotation, layer: 3, alpha: 1 });

                expect(ours.sprites, `${x}, ${y} at ${rotation}`).toEqual(demo.sprites);
            }
        }
        // With the pivot at the centre d = (0 + 16 − 0.5·32, 0 + 18 − 0.5·36) = (0, 0): the
        // quad is centred on the anchor at any rotation.
        expect(drawn("ship", 120, 80, { rotation: 0.3 })).toEqual({
            x: 120,
            y: 80,
            width: 32,
            height: 36,
            texture: "sheet",
            u: 34 / 256,
            v: 72 / 128,
            uw: 32 / 256,
            vh: 36 / 128,
            rotation: 0.3,
        });
    });

    it("centre pivot: NGNE's Frame holds the same quad for both", () => {
        for (const pixelSnap of [true, false]) {
            const demo = ngneFrame(pixelSnap);
            const ours = ngneFrame(pixelSnap);
            for (const [x, y] of ANCHORS) {
                for (const rotation of ROTATIONS) {
                    demoDrawSprite(demo, DEMO_ART, "ships", "ship", x, y, rotation);
                    spriteAt(ours, SHEET, "ships", "ship", x, y, { rotation, layer: 3, alpha: 1 });
                }
            }
            demo.sort();
            ours.sort();

            expect(ours.count).toBe(ANCHORS.length * ROTATIONS.length);
            expect(Array.from(ours.data.subarray(0, ours.count * 14))).toEqual(
                Array.from(demo.data.subarray(0, demo.count * 14)),
            );
            expect(ours.textures).toEqual(demo.textures);
            expect(ours.order).toEqual(demo.order);
        }
    });

    it("off-centre pivot: the same sprite as the demo, the whole pixels at rotation 0 aside", () => {
        // d = (16 − 0.25·32, 18 − 0.75·36) = (8, −9); the demo has
        // ((0.5 − 0.25)·32, (0.5 − 0.75)·36) = (8, −9). Whole numbers: rounding changes nothing.
        for (const [x, y] of ANCHORS) {
            for (const rotation of ROTATIONS) {
                const demo = new Recorder();
                demoDrawSprite(demo, DEMO_ART, "ships", "nose", x, y, rotation);
                const ours = new Recorder();
                spriteAt(ours, SHEET, "ships", "nose", x, y, { rotation, layer: 3, alpha: 1 });

                expect(ours.sprites, `${x}, ${y} at ${rotation}`).toEqual(demo.sprites);
            }
        }
        expect(drawn("nose", 120, 80)).toMatchObject({ x: 128, y: 71 });

        // A pivot of 0.3, 0.7: d = (16 − 9.6, 18 − 25.2) = (6.4, −7.2). Rotated, the runtime
        // and the demo agree. At rotation 0 the runtime rounds d to (6, −7), the demo does
        // not: at most half a pixel apart on each axis.
        const sheet: SpriteAtlas = {
            ...SHEET,
            frames: { tail: { ...SHEET.frames.ship, pivot: [0.3, 0.7] } },
        };
        const art = { ...DEMO_ART, frames: { tail: { ...PLAYER, pivot: [0.3, 0.7] as const } } };
        for (const rotation of ROTATIONS) {
            const demo = new Recorder();
            demoDrawSprite(demo, art, "ships", "tail", 120, 80, rotation);
            const ours = new Recorder();
            spriteAt(ours, sheet, "ships", "tail", 120, 80, { rotation });
            if (rotation === 0) {
                expect([ours.sprites[0].x, ours.sprites[0].y]).toEqual([126, 73]);
                expect(demo.sprites[0].x).toBeCloseTo(126.4, 9);
                expect(demo.sprites[0].y).toBeCloseTo(72.8, 9);
            } else {
                expect(ours.sprites[0].x).toBeCloseTo(demo.sprites[0].x, 9);
                expect(ours.sprites[0].y).toBeCloseTo(demo.sprites[0].y, 9);
            }
        }
    });
});

describe("a trimmed frame with an off-centre pivot", () => {
    // `boot`: d = (7 + 12/2 − 0.5·33, 4 + 6/2 − 1·17) = (13 − 16.5, 7 − 17) = (−3.5, −10).

    it("lies where its source frame puts it, on whole pixels", () => {
        // Rounded: (−3, −10); Math.round takes a half upwards. Centre = (40 − 3, 30 − 10).
        expect(drawn("boot", 40, 30)).toEqual({
            x: 37,
            y: 20,
            width: 12,
            height: 6,
            texture: "sheet",
            u: 100 / 256,
            v: 10 / 128,
            uw: 12 / 256,
            vh: 6 / 128,
            rotation: 0,
        });
        // The quad spans 37 ∓ 6 = 31..43 and 20 ∓ 3 = 17..23. Its rectangle starts 7, 4 into
        // the source frame, so that frame starts at 31 − 7 = 24 and 17 − 4 = 13 and ends at
        // 13 + 17 = 30: its bottom edge is on the anchor, its centre line (24 + 16.5 = 40.5)
        // half a pixel beside it.
        for (const pixelSnap of [true, false]) {
            const packed = quad("boot", 40, 30, undefined, pixelSnap);
            expect(packed.origin).toEqual([31, 17]);
            expect(packed.i).toEqual([12, 0]);
            expect(packed.j).toEqual([0, 6]);
            expect(packed.uv).toEqual([100 / 256, 10 / 128, 12 / 256, 6 / 128].map(Math.fround));
            expect(packed.texture).toBe("sheet");
        }
    });

    it("rotation 90°: the offset turns with the frame and is not rounded", () => {
        // R(π/2)·(−3.5, −10) = (10, −3.5): centre = (40 + 10, 30 − 3.5) = (50, 26.5).
        const sprite = drawn("boot", 40, 30, { rotation: Math.PI / 2 });
        expect(sprite.x).toBeCloseTo(50, 12);
        expect(sprite.y).toBeCloseTo(26.5, 12);
        expect([sprite.width, sprite.height, sprite.rotation]).toEqual([12, 6, Math.PI / 2]);

        // The quad stands on its side: 6 wide and 12 high around the centre. NGNE's snap
        // moves the centre to (50, 27).
        const loose = cornersOf(quad("boot", 40, 30, { rotation: Math.PI / 2 }, false));
        [47, 47, 53, 53].forEach((x, index) => expect(loose.xs[index]).toBeCloseTo(x, 4));
        [20.5, 20.5, 32.5, 32.5].forEach((y, index) => expect(loose.ys[index]).toBeCloseTo(y, 4));
        const snapped = cornersOf(quad("boot", 40, 30, { rotation: Math.PI / 2 }, true));
        [47, 47, 53, 53].forEach((x, index) => expect(snapped.xs[index]).toBeCloseTo(x, 4));
        [21, 21, 33, 33].forEach((y, index) => expect(snapped.ys[index]).toBeCloseTo(y, 4));
    });

    it("rotation 90° turns clockwise on screen, about the anchor", () => {
        // `ship` has d = (0, 0): it stays centred on (120, 80), now 36 wide and 32 high.
        const packed = quad("ship", 120, 80, { rotation: Math.PI / 2 });
        const { xs, ys } = cornersOf(packed);
        [102, 102, 138, 138].forEach((x, index) => expect(xs[index]).toBeCloseTo(x, 4));
        [64, 64, 96, 96].forEach((y, index) => expect(ys[index]).toBeCloseTo(y, 4));
        // The corner that shows the top-left texel is now the top-right one, and the top
        // edge of the frame runs down the right side.
        expect(packed.origin[0]).toBeCloseTo(138, 4);
        expect(packed.origin[1]).toBeCloseTo(64, 4);
        expect(packed.i[0]).toBeCloseTo(0, 4);
        expect(packed.i[1]).toBeCloseTo(32, 4);
        expect(packed.j[0]).toBeCloseTo(-36, 4);
        expect(packed.j[1]).toBeCloseTo(0, 4);
    });

    it("flipX mirrors the frame about the vertical line through the anchor", () => {
        // The rounded d.x = −3 changes its sign: centre x = 40 + 3 = 43; the width is −12.
        expect(drawn("boot", 40, 30, { flipX: true })).toMatchObject({
            x: 43,
            y: 20,
            width: -12,
            height: 6,
        });
        // NGNE starts a quad of negative width at its right edge: 43 + 6 = 49, running left.
        // 37..49 is the mirror image of 31..43 about x = 40, and the texture runs with it.
        const packed = quad("boot", 40, 30, { flipX: true });
        expect(packed.origin).toEqual([49, 17]);
        expect(packed.i).toEqual([-12, 0]);
        expect(packed.j).toEqual([0, 6]);
        expect(packed.uv).toEqual(quad("boot", 40, 30).uv);
    });

    it("flipY mirrors it about the horizontal line through the anchor", () => {
        // d.y = −10 becomes 10: centre y = 40; 37..43 is the mirror image of 17..23 about 30.
        expect(drawn("boot", 40, 30, { flipY: true })).toMatchObject({
            x: 37,
            y: 40,
            width: 12,
            height: -6,
        });
        const packed = quad("boot", 40, 30, { flipY: true });
        expect(packed.origin).toEqual([31, 43]);
        expect(packed.j).toEqual([0, -6]);

        expect(drawn("boot", 40, 30, { flipX: true, flipY: true })).toMatchObject({
            x: 43,
            y: 40,
            width: -12,
            height: -6,
        });
    });

    it("scale 2 doubles the offset and the size", () => {
        // 2·d = (−7, −20), whole numbers: centre = (33, 10); size 24 × 12; edges 21..45, 4..16.
        expect(drawn("boot", 40, 30, { scale: 2 })).toMatchObject({
            x: 33,
            y: 10,
            width: 24,
            height: 12,
        });
        const { xs, ys } = cornersOf(quad("boot", 40, 30, { scale: 2 }));
        expect([xs, ys]).toEqual([
            [21, 21, 45, 45],
            [4, 4, 16, 16],
        ]);
        // The source frame, 66 × 34 at this scale, starts at 21 − 2·7 = 7 = 40 − 33: its
        // centre line is on the anchor, which at scale 1 it cannot be.

        // Mirrored at scale 2: centre x = 40 + 7 = 47.
        expect(drawn("boot", 40, 30, { scale: 2, flipX: true })).toMatchObject({
            x: 47,
            width: -24,
        });
    });

    it("a scale that is not a whole number is not rounded", () => {
        // 1.5·d = (−5.25, −15): centre = (34.75, 15); size 18 × 9.
        expect(drawn("boot", 40, 30, { scale: 1.5 })).toMatchObject({
            x: 34.75,
            y: 15,
            width: 18,
            height: 9,
        });
    });
});

describe("a frame of odd size in its even rectangle", () => {
    // `odd`: 33 × 17 in 34 × 18. d = (0 + 17 − 16.5, 0 + 9 − 8.5) = (0.5, 0.5).

    it("is drawn on whole pixels, half a pixel off its ideal place", () => {
        // Rounded: (1, 1). Centre (41, 31); edges 41 ∓ 17 = 24..58 and 31 ∓ 9 = 22..40.
        expect(drawn("odd", 40, 30)).toMatchObject({ x: 41, y: 31, width: 34, height: 18 });
        for (const pixelSnap of [true, false]) {
            const { xs, ys } = cornersOf(quad("odd", 40, 30, undefined, pixelSnap));
            expect([xs, ys]).toEqual([
                [24, 24, 58, 58],
                [22, 22, 40, 40],
            ]);
        }
        // Unrounded, the centre would be (40.5, 30.5): NGNE's snap would round it, and with
        // snapping off the quad would lie across pixel centres.
    });

    it("mirrored, it is the mirror image of that", () => {
        // Centre x = 40 − 1 = 39: edges 22..56, the image of 24..58 about x = 40.
        const { xs } = cornersOf(quad("odd", 40, 30, { flipX: true }));
        expect(xs).toEqual([22, 22, 56, 56]);
    });

    it("at scale 2 it is centred exactly; at scale 3 on whole pixels again", () => {
        // 2·d = (1, 1): centre (41, 31), size 68 × 36: edges 7..75 and 13..49. The frame is
        // 66 × 34 there: 7..73, centred on 40.
        expect(drawn("odd", 40, 30, { scale: 2 })).toMatchObject({
            x: 41,
            y: 31,
            width: 68,
            height: 36,
        });
        // 3·d = (1.5, 1.5), rounded (2, 2): centre (42, 32), size 102 × 54: edges −9..93.
        expect(drawn("odd", 40, 30, { scale: 3 })).toMatchObject({
            x: 42,
            y: 32,
            width: 102,
            height: 54,
        });
    });
});

describe("top-left placement", () => {
    it("puts the centre at (X + offsetX + w/2, Y + offsetY + h/2), whatever the pivot", () => {
        const expected: Record<string, [number, number]> = {
            // 10 + 0 + 16, 20 + 0 + 18.
            ship: [26, 38],
            nose: [26, 38],
            // 10 + 7 + 6, 20 + 4 + 3.
            boot: [23, 27],
            // 10 + 0 + 17, 20 + 0 + 9.
            odd: [27, 29],
        };
        for (const [id, centre] of Object.entries(expected)) {
            const sink = new Recorder();
            spriteAtTopLeft(sink, SHEET, "sheet", id, 10, 20);
            const frame = SHEET.frames[id];

            expect([sink.sprites[0].x, sink.sprites[0].y], id).toEqual(centre);
            expect(sink.sprites[0]).toMatchObject({ width: frame.w, height: frame.h, rotation: 0 });
            // The source frame's corner is on (10, 20): the quad starts `offset` into it.
            const target = ngneFrame();
            spriteAtTopLeft(target, SHEET, "sheet", id, 10, 20);
            expect(quadsOf(target)[0].origin, id).toEqual([10 + frame.offsetX, 20 + frame.offsetY]);
        }
    });

    it("works about the corner: scale, mirror and rotation leave it on (X, Y)", () => {
        const at = (options: DrawOptions) => {
            const sink = new Recorder();
            spriteAtTopLeft(sink, SHEET, "sheet", "boot", 10, 20, options);
            return sink.sprites[0];
        };
        // d = (7 + 6, 4 + 3) = (13, 7). Scale 2: centre (10 + 26, 20 + 14).
        expect(at({ scale: 2 })).toMatchObject({ x: 36, y: 34, width: 24, height: 12 });
        // Mirrored: the frame lies to the left of X. Centre x = 10 − 13.
        expect(at({ flipX: true })).toMatchObject({ x: -3, y: 27, width: -12 });
        // Turned a quarter: R(π/2)·(13, 7) = (−7, 13).
        expect(at({ rotation: Math.PI / 2 }).x).toBeCloseTo(3, 12);
        expect(at({ rotation: Math.PI / 2 }).y).toBeCloseTo(33, 12);
    });
});

describe("whole pixels: an integer anchor at rotation 0", { timeout: 60_000 }, () => {
    const side = fc.integer({ min: 1, max: 32 }).map((half) => half * 2);
    const frames: fc.Arbitrary<AtlasFrame> = fc
        .record({
            x: fc.integer({ min: 0, max: 100 }),
            y: fc.integer({ min: 0, max: 100 }),
            w: side,
            h: side,
            offsetX: fc.integer({ min: 0, max: 40 }),
            offsetY: fc.integer({ min: 0, max: 40 }),
            // How far the source frame reaches past the rectangle: −1 is the padded pixel.
            pastX: fc.integer({ min: -1, max: 20 }),
            pastY: fc.integer({ min: -1, max: 20 }),
            pivot: fc.tuple(
                fc.double({ min: 0, max: 1, noNaN: true }),
                fc.double({ min: 0, max: 1, noNaN: true }),
            ),
        })
        .map(({ pastX, pastY, ...frame }) => ({
            ...frame,
            sourceW: frame.offsetX + frame.w + pastX,
            sourceH: frame.offsetY + frame.h + pastY,
        }));
    const draws = fc.record({
        frame: frames,
        x: fc.integer({ min: -5000, max: 5000 }),
        y: fc.integer({ min: -5000, max: 5000 }),
        scale: fc.integer({ min: 1, max: 8 }),
        flipX: fc.boolean(),
        flipY: fc.boolean(),
        topLeft: fc.boolean(),
    });

    it("gives a quad with integer edges, the same with NGNE's centre snapping on and off", () => {
        fc.assert(
            fc.property(draws, ({ frame, x, y, scale, flipX, flipY, topLeft }) => {
                const atlas: SpriteAtlas = {
                    width: 256,
                    height: 256,
                    frames: { f: frame },
                    animations: {},
                };
                const draw = topLeft ? spriteAtTopLeft : spriteAt;
                const options = { scale, flipX, flipY };

                const sink = new Recorder();
                draw(sink, atlas, "t", "f", x, y, options);
                const [sprite] = sink.sprites;
                expect(Number.isInteger(sprite.x - sprite.width / 2)).toBe(true);
                expect(Number.isInteger(sprite.x + sprite.width / 2)).toBe(true);
                expect(Number.isInteger(sprite.y - sprite.height / 2)).toBe(true);
                expect(Number.isInteger(sprite.y + sprite.height / 2)).toBe(true);
                expect([Math.abs(sprite.width), Math.abs(sprite.height)]).toEqual([
                    scale * frame.w,
                    scale * frame.h,
                ]);

                const snapped = ngneFrame(true);
                const loose = ngneFrame(false);
                draw(snapped, atlas, "t", "f", x, y, options);
                draw(loose, atlas, "t", "f", x, y, options);
                expect(quadsOf(snapped)).toEqual(quadsOf(loose));
                const { xs, ys } = cornersOf(quadsOf(snapped)[0]);
                expect([...xs, ...ys].every(Number.isInteger)).toBe(true);
                expect([xs[3] - xs[0], ys[3] - ys[0]]).toEqual([scale * frame.w, scale * frame.h]);
            }),
            { numRuns: 500 },
        );
    });

    it("is never more than half a pixel from where the pivot would put the frame", () => {
        fc.assert(
            fc.property(draws, ({ frame, x, y, scale, flipX, flipY }) => {
                const atlas: SpriteAtlas = {
                    width: 256,
                    height: 256,
                    frames: { f: frame },
                    animations: {},
                };
                const sink = new Recorder();
                spriteAt(sink, atlas, "t", "f", x, y, { scale, flipX, flipY });
                const [sprite] = sink.sprites;
                // The centre by the formula of SPEC §9.2, not rounded.
                const dx = frame.offsetX + frame.w / 2 - frame.pivot[0] * frame.sourceW;
                const dy = frame.offsetY + frame.h / 2 - frame.pivot[1] * frame.sourceH;

                expect(
                    Math.abs(sprite.x - (x + (flipX ? -1 : 1) * scale * dx)),
                ).toBeLessThanOrEqual(0.5);
                expect(
                    Math.abs(sprite.y - (y + (flipY ? -1 : 1) * scale * dy)),
                ).toBeLessThanOrEqual(0.5);
            }),
            { numRuns: 500 },
        );
    });

    it("puts the source frame of every frame of a sheet at one place", () => {
        // The fixture: 5 × 3 with trim and the pivot (0.5, 1), so P = (2.5, 3). Every frame's
        // d.x ends in .5 and is rounded upwards alike: the source frame starts at
        // 40 + round(−2.5) = 38 and 30 + round(−3) = 27, whatever the rectangle.
        const { meta } = bundle(heroWalk());
        const corners = Object.entries(meta.frames).map(([id, frame]) => {
            const sink = new Recorder();
            spriteAt(sink, meta, "t", id, 40, 30);
            const [sprite] = sink.sprites;
            return [
                sprite.x - sprite.width / 2 - frame.offsetX,
                sprite.y - sprite.height / 2 - frame.offsetY,
            ];
        });

        expect(corners).toHaveLength(6);
        expect(corners).toEqual(new Array(6).fill([38, 27]));

        // Mirrored, the source frame ends at 40 + 2 = 42: the image of 38 about x = 40.
        const mirrored = Object.entries(meta.frames).map(([id, frame]) => {
            const sink = new Recorder();
            spriteAt(sink, meta, "t", id, 40, 30, { flipX: true });
            // A quad of negative width starts at its right edge.
            return sink.sprites[0].x - sink.sprites[0].width / 2 + frame.offsetX;
        });
        expect(mirrored).toEqual(new Array(6).fill(42));
    });
});

describe("what the runtime passes to the engine", () => {
    it("sets the geometry, the texture and the rotation, and no option that was not given", () => {
        expect(Object.keys(drawn("ship", 1, 2))).toEqual([
            "x",
            "y",
            "width",
            "height",
            "texture",
            "u",
            "v",
            "uw",
            "vh",
            "rotation",
        ]);
        // `scale` and the flips are the runtime's own: they are in the geometry.
        expect(
            Object.keys(drawn("ship", 1, 2, { scale: 2, flipX: true, flipY: false })),
        ).toHaveLength(10);
    });

    it("passes layer, depth, alpha, color and screen on as they are", () => {
        const options = { layer: 4, depth: -2, alpha: 0.25, color: 0xff8000, screen: true };
        expect(drawn("ship", 1, 2, options)).toMatchObject(options);
        expect(
            drawn("ship", 1, 2, { layer: 0, alpha: 0, color: 0, depth: 0, screen: false }),
        ).toMatchObject({
            layer: 0,
            alpha: 0,
            color: 0,
            depth: 0,
            screen: false,
        });
        // An option given as `undefined` is an option left out.
        const none = { layer: undefined, alpha: undefined } as unknown as DrawOptions;
        expect(Object.keys(drawn("ship", 1, 2, none))).toHaveLength(10);
    });

    it("leaves NGNE its defaults: white, opaque, layer 0", () => {
        const frame = ngneFrame();
        spriteAt(frame, SHEET, "sheet", "ship", 1, 2);
        spriteAt(frame, SHEET, "sheet", "ship", 1, 2, { color: 0xff0000, alpha: 0.5, layer: 2 });
        frame.sort();

        expect(quadsOf(frame)[0].tint).toEqual([1, 1, 1, 1]);
        expect(quadsOf(frame)[1].tint).toEqual([1, 0, 0, 0.5]);
        expect(frame.order).toEqual([0, 1]);
    });

    it("does not change the atlas or the options", () => {
        const options = Object.freeze({ rotation: 1, scale: 2, flipX: true });
        const atlas = structuredClone(SHEET);
        Object.freeze(atlas.frames.boot);
        spriteAt(new Recorder(), atlas, "sheet", "boot", 5, 5, options);
        spriteAtTopLeft(new Recorder(), atlas, "sheet", "boot", 5, 5, options);

        expect(atlas).toEqual(SHEET);
    });

    it("refuses a frame the atlas does not have, also one named like a member of Object", () => {
        for (const id of ["none", "", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
            const sink = new Recorder();
            expect(() => spriteAt(sink, SHEET, "sheet", id, 0, 0), id).toThrow(RangeError);
            expect(() => spriteAtTopLeft(sink, SHEET, "sheet", id, 0, 0), id).toThrow(RangeError);
            expect(sink.sprites).toEqual([]);
        }
        expect(() => spriteAt(new Recorder(), SHEET, "sheet", "none", 0, 0)).toThrow(
            'The atlas has no frame "none".',
        );
        // A frame that is called `constructor` is drawn.
        const named: SpriteAtlas = { ...SHEET, frames: { constructor: SHEET.frames.ship } };
        const sink = new Recorder();
        spriteAt(sink, named, "sheet", "constructor", 3, 4);
        expect(sink.sprites[0]).toMatchObject({ x: 3, y: 4 });
    });
});

const TILE: AtlasFrame = {
    x: 0,
    y: 0,
    w: 2,
    h: 2,
    sourceW: 2,
    sourceH: 2,
    offsetX: 0,
    offsetY: 0,
    pivot: [0.5, 0.5],
};

/** 100, 200 and 300 ms: 600 in all. */
const ENTRIES = [
    { frame: "a", ms: 100 },
    { frame: "b", ms: 200 },
    { frame: "c", ms: 300 },
];

/** Three entries, as a loop and to be played once. */
const CLIPS: SpriteAtlas = {
    width: 8,
    height: 8,
    frames: { a: TILE, b: TILE, c: TILE },
    animations: {
        loop: { playback: "loop", durationMs: 600, entries: ENTRIES },
        once: { playback: "once", durationMs: 600, entries: ENTRIES },
    },
};

describe("animationFrame", () => {
    // Entries: a from 0 to 100, b from 100 to 300, c from 300 to 600; the end is not part.
    it.each([
        [0, "a"],
        [50, "a"],
        [99.999, "a"],
        [100, "b"],
        [100.001, "b"],
        [299, "b"],
        [300, "c"],
        [599.999, "c"],
    ])("at %d ms shows %s, looping or not", (age, frame) => {
        expect(animationFrame(CLIPS, "loop", age)).toBe(frame);
        expect(animationFrame(CLIPS, "once", age)).toBe(frame);
    });

    it("a loop starts over at durationMs", () => {
        expect(animationFrame(CLIPS, "loop", 600)).toBe("a");
        // 650 mod 600 = 50; 700 mod 600 = 100; 1199 mod 600 = 599.
        expect(animationFrame(CLIPS, "loop", 650)).toBe("a");
        expect(animationFrame(CLIPS, "loop", 700)).toBe("b");
        expect(animationFrame(CLIPS, "loop", 1199)).toBe("c");
        // 1 000 250 = 1667 × 600 + 50.
        expect(animationFrame(CLIPS, "loop", 1_000_250)).toBe("a");
    });

    it("a once animation stays on its last entry from durationMs on", () => {
        for (const age of [600, 600.001, 650, 1199, 1_000_250, Infinity]) {
            expect(animationFrame(CLIPS, "once", age), String(age)).toBe("c");
        }
    });

    it("an age below 0, or none, counts as 0", () => {
        for (const age of [-1, -0.001, -1e9, -Infinity, NaN]) {
            expect(animationFrame(CLIPS, "loop", age), String(age)).toBe("a");
            expect(animationFrame(CLIPS, "once", age), String(age)).toBe("a");
        }
    });

    it("refuses an animation the atlas does not have", () => {
        for (const id of ["walk", "", "constructor", "toString", "__proto__"]) {
            expect(() => animationFrame(CLIPS, id, 0), id).toThrow(RangeError);
            expect(() => animationDone(CLIPS, id, 0), id).toThrow(RangeError);
        }
        expect(() => animationFrame(CLIPS, "walk", 0)).toThrow(
            'The atlas has no animation "walk".',
        );
    });

    it("does not change the atlas", () => {
        const atlas = structuredClone(CLIPS);
        animationFrame(atlas, "loop", 1234);
        animationDone(atlas, "once", 1234);
        expect(atlas).toEqual(CLIPS);
    });
});

describe("animationDone", () => {
    it("flips at durationMs for a once animation", () => {
        for (const age of [-1, 0, 300, 599, 599.999]) {
            expect(animationDone(CLIPS, "once", age), String(age)).toBe(false);
        }
        for (const age of [600, 600.001, 601, 1e9, Infinity]) {
            expect(animationDone(CLIPS, "once", age), String(age)).toBe(true);
        }
        expect(animationDone(CLIPS, "once", NaN)).toBe(false);
    });

    it("is never true for a loop", () => {
        for (const age of [-1, 0, 599, 600, 601, 1e9, Infinity, NaN]) {
            expect(animationDone(CLIPS, "loop", age), String(age)).toBe(false);
        }
    });
});

describe("animations against NGNE's own playback", () => {
    interface NgnePlayback {
        index: number;
        playing: boolean;
        play(now: number): void;
        advance(now: number): void;
    }
    type PlaybackModule = {
        Playback: new (animation: {
            id: string;
            playback: string;
            entries: readonly object[];
        }) => NgnePlayback;
    };

    /** The `Playback` class `ngne-preview` plays an adapter's animations with. */
    async function ngnePlayback(): Promise<PlaybackModule["Playback"]> {
        const file = new URL(
            "../../node_modules/@ngne/core/dist/preview/playback.js",
            import.meta.url,
        );
        return ((await import(file.href)) as PlaybackModule).Playback;
    }

    it("show the frame the preview shows at every age, and end when it stops", async () => {
        const Playback = await ngnePlayback();
        const { meta } = bundle(heroWalk());
        const atlases: SpriteAtlas[] = [CLIPS, meta];
        let compared = 0;

        for (const atlas of atlases) {
            for (const [id, animation] of Object.entries(atlas.animations)) {
                const total = animation.durationMs;
                const ages = new Set([
                    0,
                    0.5,
                    1,
                    total - 1,
                    total - 0.5,
                    total,
                    total + 1,
                    2 * total,
                    2.5 * total,
                ]);
                let end = 0;
                for (const entry of animation.entries) {
                    end += entry.ms;
                    for (const age of [end - 1, end - 0.25, end, end + 0.25]) ages.add(age);
                }
                for (const age of ages) {
                    // Started at 0 and asked at `age`, on the preview's millisecond clock.
                    const preview = new Playback({ id, ...animation });
                    preview.play(0);
                    preview.advance(age);
                    const label = `${id} at ${age}`;

                    expect(animationFrame(atlas, id, age), label).toBe(
                        animation.entries[preview.index].frame,
                    );
                    // The preview stops a once animation at its end and never a loop.
                    expect(animationDone(atlas, id, age), label).toBe(!preview.playing);
                    compared++;
                }
            }
        }
        expect(compared).toBeGreaterThan(60);
    });
});
