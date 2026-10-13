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
import { fileOf, fromBase64 } from "./se-053-documents";
import type { FileBytes, Fixture, FixtureId } from "./se-053-documents";
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
