import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import type { PixelBuffer } from "../../src/core/model";
import { blitPixels, createPixelBuffer, flipPixels, rotatePixels } from "../../src/core/pixels";
import { FIXTURES, FIXTURE_IDS } from "./se-053-documents";
import {
    ANCHOR,
    CANVAS,
    alphaCounts,
    canvasOf,
    compareCanvas,
    expectedCanvas,
    expectedSprite,
    frameDraws,
    sceneAnchors,
} from "./se-053-expected";
import type { DrawCommand } from "./se-053-expected";
import { draw, expectHealthy, openStage, shown } from "./se-053-support";
import type { Stage } from "./se-053-support";

// SE-053, condition 3 of SPEC §9.7: an NGNE game that imports the exported
// `<name>.sprites.ts` draws every frame, and its canvas, read back in the page, is the CPU
// composite of that frame (opaque pixels exact, others within 1 after blending over the
// clear colour). The bundle is made by `bundle()` in the browser and written to disk; the
// game is tests/fixtures/ngne-consumer, with NGNE's default camera.
//
// `openStage` ties the files on disk to what is drawn: the atlas the module draws from is
// the text of `<name>.atlas.json`, and `<name>.png` is the composites in its rectangles.

/** Pixels of each kind a test has compared so far. */
interface Compared {
    opaque: number;
    partial: number;
    transparent: number;
}

/** Draws one frame of the sheet and compares the canvas with where its composite must be. */
async function check(
    page: Page,
    stage: Stage,
    command: DrawCommand,
    compared: Compared,
): Promise<void> {
    const composite = stage.composites.get(command.frame);
    if (!composite) throw new Error(`No frame ${command.frame}`);
    const expected = expectedCanvas(composite, stage.doc.pivot, command);
    const counts = alphaCounts(expected);
    compared.opaque += counts.opaque;
    compared.partial += counts.partial;
    compared.transparent += counts.transparent;
    const canvas = await draw(page, [command]);
    expect(compareCanvas(canvas, expected), JSON.stringify(command)).toEqual([]);
}

for (const id of FIXTURE_IDS) {
    const { title } = FIXTURES[id];

    /** Makes the draws of one kind of every frame of the fixture, each compared. */
    const drawsOf = async (
        page: Page,
        testInfo: TestInfo,
        kind: keyof ReturnType<typeof frameDraws>,
    ) => {
        const stage = await openStage(page, testInfo, id);
        const compared: Compared = { opaque: 0, partial: 0, transparent: 0 };
        for (const frame of stage.composites.keys()) {
            for (const command of frameDraws(frame)[kind]) {
                await check(page, stage, command, compared);
            }
        }
        // The test compared pixels of every kind: the fixture was not empty where it looked.
        expect(compared.opaque).toBeGreaterThan(0);
        expect(compared.partial).toBeGreaterThan(0);
        expect(compared.transparent).toBeGreaterThan(0);
        await expectHealthy(page);
    };

    test.describe(`an NGNE game drawing ${title}`, () => {
        // In the middle of the canvas and near its corner, where part of the frame lies
        // outside; and by the corner of its source frame, whatever the pivot and the trim.
        test("shows every frame as its composite at an integer anchor", async ({
            page,
        }, testInfo) => {
            await drawsOf(page, testInfo, "anchored");
        });

        test("shows every frame turned by 90°, 180° and 270°, in the middle and near the corner", async ({
            page,
        }, testInfo) => {
            await drawsOf(page, testInfo, "turned");
        });

        test("shows every frame mirrored with flipX, and with flipY", async ({
            page,
        }, testInfo) => {
            await drawsOf(page, testInfo, "mirrored");
        });

        test("shows every pixel of every frame as 2 × 2 with scale 2", async ({
            page,
        }, testInfo) => {
            await drawsOf(page, testInfo, "scaled");
        });

        test("shows all frames side by side in one scene, and nothing between them", async ({
            page,
        }, testInfo) => {
            const { doc, composites } = await openStage(page, testInfo, id);
            // Padding, extruded edges and the neighbours of a rectangle in the atlas stay
            // out: between the frames the canvas has the clear colour.
            const anchors = sceneAnchors(composites.size, doc.width, doc.height, doc.pivot);
            const commands = [...composites.keys()].map((frame, index): DrawCommand => ({
                frame,
                x: anchors[index][0],
                y: anchors[index][1],
            }));
            const expected = canvasOf(
                commands.map((command) =>
                    expectedSprite(
                        composites.get(command.frame) ?? createPixelBuffer(1, 1),
                        doc.pivot,
                        command,
                    ),
                ),
            );
            expect(alphaCounts(expected).opaque).toBeGreaterThan(0);

            expect(compareCanvas(await draw(page, commands), expected)).toEqual([]);
            await expectHealthy(page);
        });
    });
}

/** A transparent canvas with one image on it, cut to the canvas. */
function placedAt(image: PixelBuffer, left: number, top: number): PixelBuffer {
    const canvas = createPixelBuffer(CANVAS.width, CANVAS.height);
    blitPixels(canvas, image, left, top);
    return canvas;
}

test.describe("an NGNE game drawing the pivot fixture", () => {
    test("puts the bottom centre of every frame on the anchor", async ({ page }, testInfo) => {
        const stage = await openStage(page, testInfo, "d");
        expect(stage.doc.pivot).toEqual({ x: 0.5, y: 1 });
        expect(Object.values(stage.meta.frames).map((frame) => frame.pivot)).toEqual([
            [0.5, 1],
            [0.5, 1],
            [0.5, 1],
        ]);

        // The frames are 32 × 32: with the bottom centre on (64, 64) a frame spans
        // 64 − 16 = 48..80 and 64 − 32 = 32..64, however it was trimmed. Its bottom row is
        // row 63, the one above the anchor, and the anchor is the middle of its width.
        for (const [frame, composite] of stage.composites) {
            const canvas = await draw(page, [{ frame, x: 64, y: 64 }]);
            expect(compareCanvas(canvas, placedAt(composite, 48, 32)), frame).toEqual([]);
        }
        // At (40, 32): 24..56 and 0..32, against the top edge of the canvas.
        for (const [frame, composite] of stage.composites) {
            const canvas = await draw(page, [{ frame, x: 40, y: 32 }]);
            expect(compareCanvas(canvas, placedAt(composite, 24, 0)), frame).toEqual([]);
        }
        await expectHealthy(page);
    });
});

test.describe("an NGNE game drawing the fixture with the pivot off centre in x and y", () => {
    test("puts the pivot point of every frame on the anchor, also turned and mirrored", async ({
        page,
    }, testInfo) => {
        const stage = await openStage(page, testInfo, "e");
        expect(stage.doc.pivot).toEqual({ x: 0.25, y: 0.75 });
        expect([stage.doc.width, stage.doc.height]).toEqual([24, 16]);
        expect(Object.values(stage.meta.frames).map((frame) => frame.pivot)).toEqual([
            [0.25, 0.75],
            [0.25, 0.75],
            [0.25, 0.75],
        ]);

        // The pivot point is P = (0.25 · 24, 0.75 · 16) = (6, 12), and the anchor A is
        // (64, 64). Every placement below is written out from that, not taken from
        // `expectedSprite`: where the point (x, y) of the frame goes, and with it the corner
        // and the size of the image on the canvas.
        const cases: {
            label: string;
            command: Omit<DrawCommand, "frame" | "x" | "y">;
            image: (composite: PixelBuffer) => PixelBuffer;
            at: [number, number];
        }[] = [
            // (x, y) → A + (x − 6, y − 12): 58..82 by 52..68.
            { label: "as it is", command: {}, image: (c) => c, at: [58, 52] },
            // (x, y) → A + (−(x − 6), y − 12): 6 left of the anchor becomes 6 right of it,
            // 18 right becomes 18 left: 46..70 by 52..68.
            {
                label: "flipX",
                command: { flipX: true },
                image: (c) => flipPixels(c, "horizontal"),
                at: [46, 52],
            },
            // (x, y) → A + (x − 6, −(y − 12)): 12 above becomes 12 below: 58..82 by 60..76.
            {
                label: "flipY",
                command: { flipY: true },
                image: (c) => flipPixels(c, "vertical"),
                at: [58, 60],
            },
            // A quarter turn clockwise takes (x, y) to A + (−(y − 12), x − 6): the 16 rows
            // become columns 60..76, the 24 columns rows 58..82.
            {
                label: "90°",
                command: { quarters: 1 },
                image: (c) => rotatePixels(c, 90),
                at: [60, 58],
            },
            // Half a turn: A − (x − 6, y − 12): 46..70 by 60..76.
            {
                label: "180°",
                command: { quarters: 2 },
                image: (c) => rotatePixels(c, 180),
                at: [46, 60],
            },
            // Three quarters: A + (y − 12, −(x − 6)): columns 52..68, rows 46..70.
            {
                label: "270°",
                command: { quarters: 3 },
                image: (c) => rotatePixels(c, 270),
                at: [52, 46],
            },
            // Mirrored, then turned: A + (−(y − 12), −(x − 6)): columns 60..76, rows 46..70.
            {
                label: "flipX and 90°",
                command: { flipX: true, quarters: 1 },
                image: (c) => rotatePixels(flipPixels(c, "horizontal"), 90),
                at: [60, 46],
            },
        ];
        for (const [frame, composite] of stage.composites) {
            for (const { label, command, image, at } of cases) {
                const canvas = await draw(page, [{ frame, x: 64, y: 64, ...command }]);
                const expected = placedAt(image(composite), ...at);
                expect(compareCanvas(canvas, expected), `${frame}, ${label}`).toEqual([]);
            }
        }
        // Somewhere else, and twice the size: (x, y) → (40, 90) + 2 · (x − 6, y − 12), so the
        // corner is at (28, 66) and the frame 48 × 32.
        for (const [frame, composite] of stage.composites) {
            const canvas = await draw(page, [{ frame, x: 40, y: 90, scale: 2 }]);
            const doubled = createPixelBuffer(48, 32);
            for (let y = 0; y < 32; y++) {
                for (let x = 0; x < 48; x++) {
                    const from = ((y >> 1) * 24 + (x >> 1)) * 4;
                    doubled.data.set(composite.data.subarray(from, from + 4), (y * 48 + x) * 4);
                }
            }
            expect(compareCanvas(canvas, placedAt(doubled, 28, 66)), frame).toEqual([]);
        }
        await expectHealthy(page);
    });
});

test.describe("an NGNE game on requestAnimationFrame", () => {
    test("draws the exported frames in its own loop", async ({ page }, testInfo) => {
        // The other tests run the game's frames themselves. Here the game runs as a game
        // does, with NGNE's scheduler and tick length, and every frame is read back in
        // `afterFrame`.
        const stage = await openStage(page, testInfo, "b", "raf");
        for (const [frame, composite] of stage.composites) {
            const command: DrawCommand = { frame, x: ANCHOR[0], y: ANCHOR[1], quarters: 1 };
            const expected = expectedCanvas(composite, stage.doc.pivot, command);
            expect(compareCanvas(await shown(page, [command]), expected), frame).toEqual([]);
        }
        expect(await page.evaluate(() => window.__se053!.ticks())).toBeGreaterThan(0);
        await expectHealthy(page);
    });
});
