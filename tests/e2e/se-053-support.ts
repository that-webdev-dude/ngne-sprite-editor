import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { compositeFrame } from "../../src/core/composite";
// Not the index of `core/export`: the module writer behind it reads the sprite runtime with
// a `?raw` import, which only Vite resolves. The reader stands alone.
import type { AtlasMeta } from "../../src/core/export/atlasFormat";
import { validateAtlas } from "../../src/core/export/validateAtlas";
import type { PixelBuffer, SpriteDoc } from "../../src/core/model";
import { decodePng } from "../../src/core/png/decode";
import {
    ATLAS_FACTS,
    FIXTURES,
    animationsOf,
    fileOf,
    fromBase64,
    rectanglesOf,
} from "./se-053-documents";
import type { FileBytes, Fixture, FixtureId } from "./se-053-documents";
import { expectedAtlas, imageDifference } from "./se-053-expected";
import type {
    AnimationReadback,
    CanvasImage,
    CanvasReadback,
    DrawCommand,
} from "./se-053-expected";

// Shared helpers of the SE-053 specs: the bundle of a fixture from the export page, written
// to a folder and read back from it, and the consumer page.

/**
 * The bundle of a fixture as the editor makes it: `bundle()` run in the browser on the
 * export page. Leaves the page on that page.
 */
export async function exportFixture(page: Page, fixture: FixtureId): Promise<FileBytes[]> {
    await page.goto("/tests/e2e/harness/se-053-export.html");
    await expect(page.locator("#status")).toHaveText("ready");
    const files = await page.evaluate((id) => window.__se053Export!(id), fixture);
    return files.map(({ name, data }) => ({ name, bytes: fromBase64(data) }));
}

/** Writes the files of a bundle into a folder, as an export into a folder does. */
export function writeBundle(directory: string, files: readonly FileBytes[]): void {
    mkdirSync(directory, { recursive: true });
    for (const file of files) writeFileSync(join(directory, file.name), file.bytes);
}

/**
 * Condition 1 of SPEC §9.7 on the files of a folder: `<name>.atlas.json` is parsed, the PNG
 * it names is decoded, and `validateAtlas` checks the one against the size of the other.
 * Returns what the reader made of the atlas, and the image. Rejects with the `AtlasError`.
 */
export async function readAtlas(
    directory: string,
    name: string,
): Promise<{ meta: AtlasMeta; image: PixelBuffer }> {
    const json: unknown = JSON.parse(readFileSync(join(directory, `${name}.atlas.json`), "utf8"));
    const named = (json as { image?: unknown }).image;
    if (named !== `${name}.png`) throw new Error(`The atlas names the image ${String(named)}.`);
    const image = await decodePng(readFileSync(join(directory, `${name}.png`)));
    return { meta: validateAtlas(json, image), image };
}

/**
 * The composite of every frame of the atlas, by its ID: what `compositeFrame` gives for the
 * frame of the document the ID names (`<name>-<index>`, SPEC §9.3).
 */
export function compositesOf(
    doc: SpriteDoc,
    fixture: Fixture,
    meta: AtlasMeta,
): Map<string, PixelBuffer> {
    const ids = Object.keys(meta.frames);
    expect(ids).toEqual(doc.frames.map((_, index) => `${fixture.name}-${index}`));
    return new Map(ids.map((id, index) => [id, compositeFrame(doc, doc.frames[index].id)]));
}

/**
 * Writes the bundle into the output folder of the test, which lies in the checkout the dev
 * server serves, and opens the consumer page on its `<name>.sprites.ts`. The page imports
 * the module by that URL, and the module finds its image beside it.
 */
export async function openConsumer(
    page: Page,
    testInfo: TestInfo,
    fixture: Fixture,
    files: readonly FileBytes[],
    scheduler: "manual" | "raf" = "manual",
): Promise<void> {
    const directory = testInfo.outputPath("bundle");
    writeBundle(directory, files);
    const module = join(directory, fileOf(files, ".sprites.ts").name);
    const query = new URLSearchParams({
        module: `/${relative(testInfo.config.rootDir, module).split(sep).join("/")}`,
        camel: fixture.camel,
        pascal: fixture.pascal,
        scheduler,
    });
    await page.goto(`/tests/e2e/harness/se-053-consumer.html?${query.toString()}`);
    await expect(page.locator("#status")).toHaveText("ready");
    const adapter = await page.evaluate(() => window.__se053!.adapter);
    testInfo.annotations.push({ type: "adapter", description: adapter });
}

/**
 * The atlas and the image read from a folder are those of the fixture:
 * - the atlas states what `ATLAS_FACTS` writes out for it: the size, the rectangle of every
 *   frame (trimmed, merged and laid out as the fixture asks) and the animations;
 * - the image is, pixel for pixel, the composites of the frames in those rectangles, their
 *   edges repeated into the gutter where the fixture extrudes, and nothing else.
 * Returns the composite of every frame, by its ID.
 */
export function expectFixtureAtlas(
    fixture: Fixture,
    doc: SpriteDoc,
    meta: AtlasMeta,
    image: PixelBuffer,
): Map<string, PixelBuffer> {
    const facts = ATLAS_FACTS[fixture.id];
    expect([meta.width, meta.height]).toEqual(facts.size);
    expect(rectanglesOf(meta)).toEqual(facts.rectangles);
    expect(new Set(rectanglesOf(meta)).size).toBe(facts.distinct);
    expect(animationsOf(meta)).toEqual(facts.animations);
    const composites = compositesOf(doc, fixture, meta);
    const expected = expectedAtlas(meta, composites, doc.exportSettings.extrude);
    expect(imageDifference(image, expected)).toBeNull();
    return composites;
}

/** A fixture exported by the browser, read back from disk, and loaded by the consumer game. */
export interface Stage {
    fixture: Fixture;
    doc: SpriteDoc;
    /** `<name>.atlas.json` as it lies in the folder, read by `validateAtlas`. */
    meta: AtlasMeta;
    /** The composite of every frame, by its ID in the atlas. */
    composites: Map<string, PixelBuffer>;
}

/**
 * Exports a fixture, writes its bundle to disk and starts the consumer game on the exported
 * module. The files on disk are checked on the way:
 * - `<name>.atlas.json` and `<name>.png` are the fixture's (`expectFixtureAtlas`);
 * - the atlas the generated module carries, the one its draw functions read rectangles and
 *   entries from, is the atlas file: serialized the way the writer does, it is the text of
 *   the file. What the game then draws is drawn from the content of that file.
 */
export async function openStage(
    page: Page,
    testInfo: TestInfo,
    id: FixtureId,
    scheduler: "manual" | "raf" = "manual",
): Promise<Stage> {
    const fixture = FIXTURES[id];
    const files = await exportFixture(page, id);
    await openConsumer(page, testInfo, fixture, files, scheduler);
    const directory = testInfo.outputPath("bundle");
    const { meta, image } = await readAtlas(directory, fixture.name);
    const doc = fixture.build();
    const composites = expectFixtureAtlas(fixture, doc, meta, image);

    const carried = await page.evaluate(() => window.__se053!.atlas);
    expect(`${JSON.stringify(carried, null, 4)}\n`).toBe(
        readFileSync(join(directory, `${fixture.name}.atlas.json`), "utf8"),
    );
    expect(carried).toEqual(meta);
    return { fixture, doc, meta, composites };
}

function imageOf(readback: CanvasReadback): CanvasImage {
    return { width: readback.width, height: readback.height, data: fromBase64(readback.data) };
}

/** One frame of the game with these draws, read back in `afterFrame`. */
export async function draw(page: Page, commands: DrawCommand[]): Promise<CanvasImage> {
    return imageOf(await page.evaluate((list) => window.__se053!.draw(list), commands));
}

/**
 * With the game on `requestAnimationFrame`: puts the draws on the stage and returns a frame
 * the game rendered, in its own loop, after that.
 */
export async function shown(page: Page, commands: DrawCommand[]): Promise<CanvasImage> {
    const before = await page.evaluate((list) => window.__se053!.show(list), commands);
    // A frame is one task, so the next one already shows the new stage; two more for margin.
    await page.waitForFunction((count) => window.__se053!.frames() >= count + 3, before);
    const last = await page.evaluate(() => window.__se053!.last());
    if (!last) throw new Error("No frame was read back.");
    return imageOf(last);
}

/** What a frame of a playing animation showed. */
export interface AnimationFrame {
    ageMs: number;
    frame: string;
    done: boolean;
    canvas: CanvasImage;
}

function animationFrameOf(readback: AnimationReadback): AnimationFrame {
    const { ageMs, frame, done } = readback;
    return { ageMs, frame, done, canvas: imageOf(readback) };
}

/** Starts an animation at age 0 at a point; the frame at age 0. */
export async function play(
    page: Page,
    animation: string,
    x: number,
    y: number,
): Promise<AnimationFrame> {
    return animationFrameOf(
        await page.evaluate(([id, px, py]) => window.__se053!.play(id, px, py), [
            animation,
            x,
            y,
        ] as const),
    );
}

/** Lets `ms` milliseconds pass on the game's clock; the frame after them. */
export async function advance(page: Page, ms: number): Promise<AnimationFrame> {
    return animationFrameOf(await page.evaluate((time) => window.__se053!.advance(time), ms));
}

/** What the generated module's two animation functions return for each age, without the game. */
export function resolveAnimation(
    page: Page,
    animation: string,
    ages: number[],
): Promise<{ frame: string; done: boolean }[]> {
    return page.evaluate(([id, list]) => window.__se053!.resolve(id, list), [
        animation,
        ages,
    ] as const);
}

/**
 * The game is as it should be at the end of a test: running, with NGNE's default camera, and
 * without a report from the engine.
 */
export async function expectHealthy(page: Page): Promise<void> {
    const state = await page.evaluate(() => ({
        lifecycle: window.__se053!.lifecycle(),
        pixelSnap: window.__se053!.pixelSnap,
        diagnostics: window.__se053!.diagnostics(),
    }));
    expect(state).toEqual({ lifecycle: "Running", pixelSnap: true, diagnostics: [] });
}
