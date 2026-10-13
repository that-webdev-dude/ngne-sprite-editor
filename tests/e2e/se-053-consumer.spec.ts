import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import type { AtlasMeta } from "../../src/core/export/atlasFormat";
import type { PixelBuffer, SpriteDoc } from "../../src/core/model";
import { blitPixels, createPixelBuffer } from "../../src/core/pixels";
import { FIXTURES, FIXTURE_IDS } from "./se-053-documents";
import type { Fixture, FixtureId } from "./se-053-documents";
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
import {
    compositesOf,
    draw,
    expectHealthy,
    exportFixture,
    openConsumer,
    readAtlas,
    shown,
} from "./se-053-support";

// SE-053, condition 3 of SPEC §9.7: an NGNE game that imports the exported
// `<name>.sprites.ts` draws every frame, and its canvas, read back in the page, is the CPU
// composite of that frame (opaque pixels exact, others within 1 after blending over the
// clear colour). The bundle is made by `bundle()` in the browser and written to disk; the
// game is tests/fixtures/ngne-consumer, with NGNE's default camera.

interface Stage {
    fixture: Fixture;
    doc: SpriteDoc;
    meta: AtlasMeta;
    /** The composite of every frame, by its ID in the atlas. */
    composites: Map<string, PixelBuffer>;
    /** Pixels of each kind the test has compared so far. */
    compared: { opaque: number; partial: number; transparent: number };
}

/** Exports a fixture, starts the consumer game on the exported module, and composites its frames. */
async function stageOf(
    page: Page,
    testInfo: TestInfo,
    id: FixtureId,
    scheduler: "manual" | "raf" = "manual",
): Promise<Stage> {
    const fixture = FIXTURES[id];
    const files = await exportFixture(page, id);
    await openConsumer(page, testInfo, fixture, files, scheduler);
    const { meta } = await readAtlas(testInfo.outputPath("bundle"), fixture.name);
    const doc = fixture.build();
    return {
        fixture,
        doc,
        meta,
        composites: compositesOf(doc, fixture, meta),
        compared: { opaque: 0, partial: 0, transparent: 0 },
    };
}

/** Draws one frame of the sheet and compares the canvas with where its composite must be. */
async function check(page: Page, stage: Stage, command: DrawCommand): Promise<void> {
    const composite = stage.composites.get(command.frame);
    if (!composite) throw new Error(`No frame ${command.frame}`);
    const expected = expectedCanvas(composite, stage.doc.pivot, command);
    const counts = alphaCounts(expected);
    stage.compared.opaque += counts.opaque;
    stage.compared.partial += counts.partial;
    stage.compared.transparent += counts.transparent;
    const canvas = await draw(page, [command]);
    expect(compareCanvas(canvas, expected), JSON.stringify(command)).toEqual([]);
}

/** The test compared pixels of every kind: its fixtures were not empty where it looked. */
function expectCompared(stage: Stage): void {
    expect(stage.compared.opaque).toBeGreaterThan(0);
    expect(stage.compared.partial).toBeGreaterThan(0);
    expect(stage.compared.transparent).toBeGreaterThan(0);
}

for (const id of FIXTURE_IDS) {
    const { title } = FIXTURES[id];

    /** Makes the draws of one kind of every frame of the fixture, each compared. */
    const drawsOf = async (
        page: Page,
        testInfo: TestInfo,
        kind: keyof ReturnType<typeof frameDraws>,
    ) => {
        const stage = await stageOf(page, testInfo, id);
        for (const frame of stage.composites.keys()) {
            for (const command of frameDraws(frame)[kind]) await check(page, stage, command);
        }
        expectCompared(stage);
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
            const stage = await stageOf(page, testInfo, id);
            const { doc, composites } = stage;
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

test.describe("an NGNE game drawing the pivot fixture", () => {
    test("puts the bottom centre of every frame on the anchor", async ({ page }, testInfo) => {
        const stage = await stageOf(page, testInfo, "d");
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
            const expected = createPixelBuffer(CANVAS.width, CANVAS.height);
            blitPixels(expected, composite, 48, 32);
            const canvas = await draw(page, [{ frame, x: 64, y: 64 }]);
            expect(compareCanvas(canvas, expected), frame).toEqual([]);
        }
        // At (40, 32): 24..56 and 0..32, against the top edge of the canvas.
        for (const [frame, composite] of stage.composites) {
            const expected = createPixelBuffer(CANVAS.width, CANVAS.height);
            blitPixels(expected, composite, 24, 0);
            const canvas = await draw(page, [{ frame, x: 40, y: 32 }]);
            expect(compareCanvas(canvas, expected), frame).toEqual([]);
        }
        await expectHealthy(page);
    });
});

test.describe("an NGNE game on requestAnimationFrame", () => {
    test("draws the exported frames in its own loop", async ({ page }, testInfo) => {
        // The other tests run the game's frames themselves. Here the game runs as a game
        // does, with NGNE's scheduler and tick length, and every frame is read back in
        // `afterFrame`.
        const stage = await stageOf(page, testInfo, "b", "raf");
        for (const [frame, composite] of stage.composites) {
            const command: DrawCommand = { frame, x: ANCHOR[0], y: ANCHOR[1], quarters: 1 };
            const expected = expectedCanvas(composite, stage.doc.pivot, command);
            expect(compareCanvas(await shown(page, [command]), expected), frame).toEqual([]);
        }
        expect(await page.evaluate(() => window.__se053!.ticks())).toBeGreaterThan(0);
        await expectHealthy(page);
    });
});
