import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { AtlasMeta } from "../../src/core/export/atlasFormat";
import { FIXTURES, FIXTURE_IDS, withRectOutsideImage } from "./se-053-documents";
import { guttersOf } from "./se-053-expected";
import {
    endProcesses,
    previewProcesses,
    runFolder,
    runningPreviews,
    startPreview,
} from "./se-053-preview-process";
import type { PreviewProcess } from "./se-053-preview-process";
import { expectFixtureAtlas, exportFixture, readAtlas, writeBundle } from "./se-053-support";

// SE-053, conditions 1 and 2 of SPEC §9.7 on the bundle of every fixture, written to a
// temporary folder as an export writes it:
// 1. `<name>.atlas.json` validates and its rectangles lie inside the PNG;
// 2. the installed `ngne-preview`, started on `<name>.preview.config.mjs`, serves a page that
//    reports `Ready` without an error text for every frame selected in turn.
// A bundle corrupted on purpose fails both, and no `ngne-preview` process is left behind.
//
// The tests of the file run in order in one worker, and each uses the one page Playwright
// gives it, so the preview is the foreground page of its window; a hidden preview pauses.
// A failed test does not stop the ones after it: they go on in a new worker, the last test
// among them, which looks at the process list for what the whole run has started.

test.describe.configure({ mode: "default" });

/**
 * The folder of this run of the file: every bundle lies in a folder of its own inside it.
 * Its path is in the command line of every preview the run starts, and tells them from the
 * previews of every other run. A worker that takes over after a failed test finds the same
 * folder through a file in the output folder of the run, which Playwright empties when a
 * run starts; the file is named after the runner, the parent of every worker, so that a
 * second run going on in the same checkout has another.
 */
let run = "";

test.beforeAll(() => {
    const pointer = join(test.info().project.outputDir, `se-053-preview-run-${process.ppid}.txt`);
    run = runFolder("se-053-preview-", pointer);
});

/** A new folder for one bundle, inside the folder of the run. */
function temporaryDirectory(): string {
    return mkdtempSync(join(run, "bundle-"));
}

// After the tests of a worker, whatever their outcome: what the worker knows of is stopped,
// and then nothing of this run may be left in the process list. What is found there all the
// same is ended, so that it is not left on the machine, and reported.
test.afterAll(async () => {
    for (const preview of runningPreviews()) await preview.stop().catch(() => undefined);
    // Without the folder of the run no test has run, and nothing tells its previews apart.
    if (run === "") return;
    const left = await previewProcesses(run);
    endProcesses(left);
    rmSync(run, { recursive: true, force: true, maxRetries: 5 });
    expect(left, "ngne-preview processes left by this run").toEqual([]);
});

/** The first line of an element's text. */
async function firstLine(page: Page, selector: string): Promise<string> {
    return ((await page.locator(selector).textContent()) ?? "").split("\n")[0];
}

/** What the preview page says of itself. */
async function report(page: Page): Promise<{ status: string; error: string }> {
    return {
        status: (await page.locator("#status").textContent()) ?? "",
        error: (await page.locator("#error").textContent()) ?? "",
    };
}

/** The page reports a status that begins with `Ready`, and no error text. */
async function expectReady(page: Page, label: string): Promise<void> {
    const { status, error } = await report(page);
    expect({ ready: status.startsWith("Ready"), error }, `${label}: ${status}`).toEqual({
        ready: true,
        error: "",
    });
}

/** The process ID of every `ngne-preview` the tests of this worker have started. */
const started: number[] = [];

/** Starts `ngne-preview` on the adapter of a folder and opens its page in the foreground. */
async function openPreview(page: Page, directory: string, name: string): Promise<PreviewProcess> {
    const preview = await startPreview(join(directory, `${name}.preview.config.mjs`));
    started.push(preview.pid);
    await page.goto(preview.url);
    await page.bringToFront();
    return preview;
}

/** Ends the process; its server no longer answers afterwards. */
async function closePreview(preview: PreviewProcess): Promise<void> {
    await preview.stop();
    await expect(fetch(new URL("config", preview.url))).rejects.toThrow();
}

/** Every frame and every animation of the atlas selected in turn on the preview page. */
async function selectEverything(page: Page, name: string, meta: AtlasMeta): Promise<void> {
    const frames = Object.entries(meta.frames);
    const animations = Object.entries(meta.animations);
    const options = (select: string) =>
        page
            .locator(`${select} option`)
            .evaluateAll((list) => list.map((option) => (option as HTMLOptionElement).value));
    expect(await options("#frames")).toEqual(frames.map(([id]) => id));
    expect(await options("#animations")).toEqual(["", ...animations.map(([id]) => id)]);

    for (const [id, { x, y, w, h }] of frames) {
        await page.locator("#frames").selectOption(id);
        // The page names the selected frame once it has drawn it.
        await expect.poll(() => firstLine(page, "#details"), id).toBe(`Frame ${id}`);
        await expectReady(page, id);
        // It shows the rectangle of the atlas, from an image of the atlas's size.
        const details = ((await page.locator("#details").textContent()) ?? "").split("\n");
        expect(details.slice(1, 3), id).toEqual([
            `Source: ${name} (${meta.width} × ${meta.height}), crop ${x}, ${y}, ${w} × ${h} px`,
            `Destination: ${w} × ${h} logical units`,
        ]);
    }

    // Beyond the ticket: every animation, entry by entry. Selected, an animation is paused
    // on its first entry, and the page's Next button steps to the one after. For each entry
    // the page states its number, its duration, the time before it, the length and the
    // playback of the animation, and the frame it shows: all as the atlas has them.
    for (const [id, { playback, durationMs, entries }] of animations) {
        await page.locator("#animations").selectOption(id);
        let elapsed = 0;
        for (const [index, { frame, ms }] of entries.entries()) {
            const label = `${id}, entry ${index + 1}`;
            if (index > 0) await page.locator("#next").click();
            await expect
                .poll(() => page.locator("#entry").textContent(), label)
                .toBe(
                    `${id}: entry ${index + 1}/${entries.length} · ${ms} ms · ` +
                        `elapsed ${elapsed.toFixed(1)}/${durationMs} ms · ${playback} · paused`,
                );
            await expect.poll(() => firstLine(page, "#details"), label).toBe(`Frame ${frame}`);
            await expectReady(page, label);
            elapsed += ms;
        }
        expect(elapsed, id).toBe(durationMs);
    }
}

for (const id of FIXTURE_IDS) {
    const fixture = FIXTURES[id];

    test(`${fixture.title}: the atlas validates and ngne-preview is Ready for every frame`, async ({
        page,
    }) => {
        const files = await exportFixture(page, id);
        expect(files.map((file) => file.name)).toEqual([
            `${fixture.name}.png`,
            `${fixture.name}.atlas.json`,
            `${fixture.name}.sprites.ts`,
            `${fixture.name}.preview.config.mjs`,
        ]);
        const directory = temporaryDirectory();
        writeBundle(directory, files);

        // Condition 1, on the files as they lie in the folder.
        const { meta, image } = await readAtlas(directory, fixture.name);
        expect([meta.width, meta.height]).toEqual([image.width, image.height]);
        const doc = fixture.build();
        expect(Object.keys(meta.frames)).toHaveLength(doc.frames.length);
        for (const [frame, { x, y, w, h }] of Object.entries(meta.frames)) {
            expect(x >= 0 && y >= 0 && x + w <= image.width && y + h <= image.height, frame).toBe(
                true,
            );
            expect([w % 2, h % 2], frame).toEqual([0, 0]);
        }
        // And they are the fixture's: the rectangles it must have, trimmed and merged, and
        // in them the composites of its frames, with the gutters where it extrudes.
        expectFixtureAtlas(fixture, doc, meta, image);

        // Condition 2.
        const preview = await openPreview(page, directory, fixture.name);
        try {
            await expect(page.locator("#status")).toHaveText(/^(Ready|Preview failed|Hidden)/);
            await expectReady(page, "on load");
            await selectEverything(page, fixture.name, meta);
            // Still without an error after all of them.
            await expectReady(page, "at the end");
        } finally {
            await closePreview(preview);
        }
    });
}

test("the atlas image on disk repeats the edges of every rectangle into its gutter, and leaves a padded side clear", async ({
    page,
}) => {
    // Fixture (b) is exported with extrude 1. No draw reads a gutter: a game samples the
    // nearest texel, inside the rectangle. So the gutters are read from the PNG itself.
    const fixture = FIXTURES.b;
    expect(fixture.build().exportSettings.extrude).toBe(1);
    const directory = temporaryDirectory();
    writeBundle(directory, await exportFixture(page, "b"));
    const { meta, image } = await readAtlas(directory, fixture.name);

    // Every rectangle: each side of the gutter repeats the edge beside it, and each corner
    // the corner pixel.
    for (const [frame, rect] of Object.entries(meta.frames)) {
        const gutters = guttersOf(image, rect);
        for (const side of ["left", "right", "top", "bottom", "corners"] as const) {
            expect(gutters[side].outside, `${frame}, ${side}`).toEqual(gutters[side].edge);
        }
    }

    const clear = (count: number) => new Array<string>(count).fill("0,0,0,0");
    // The frame of 33 × 17 in its rectangle of 34 × 18: the left and the top edge show, and
    // are repeated. The right column and the bottom row are the padding of the odd sides:
    // those sides are not extruded (SPEC §9.2), their gutters are clear.
    const whole = guttersOf(image, meta.frames["odd-bird-0"]);
    expect([whole.left.edge.length, whole.top.edge.length]).toEqual([18, 34]);
    expect(whole.left.lit).toBeGreaterThan(12);
    expect(whole.top.lit).toBeGreaterThan(24);
    expect(whole.right).toEqual({ outside: clear(18), edge: clear(18), lit: 0 });
    expect(whole.bottom).toEqual({ outside: clear(34), edge: clear(34), lit: 0 });
    // Its corners: the top-left one repeats a pixel that shows; the other three lie on a
    // padded side.
    expect(whole.corners.outside[0]).toBe(whole.corners.edge[0]);
    expect(whole.corners.outside[0]).not.toBe("0,0,0,0");
    expect(whole.corners.outside.slice(1)).toEqual(clear(3));

    // The frame trimmed to 30 × 13 in its rectangle of 30 × 14: three sides show and are
    // repeated; the fourteenth row pads the odd height, and below it the gutter is clear.
    const trimmed = guttersOf(image, meta.frames["odd-bird-1"]);
    expect(trimmed.left.lit).toBeGreaterThan(8);
    expect(trimmed.right.lit).toBeGreaterThan(8);
    expect(trimmed.top.lit).toBeGreaterThan(20);
    expect(trimmed.bottom).toEqual({ outside: clear(30), edge: clear(30), lit: 0 });

    // A gutter is one pixel: the pixel beyond it is padding, and clear. Left of the first
    // column of rectangles that is column 0 of the image.
    const { x, y, h } = meta.frames["odd-bird-0"];
    expect(x).toBe(2);
    for (let row = y - 2; row < y + h + 2; row++) {
        expect([...image.data.subarray(row * image.width * 4, row * image.width * 4 + 4)]).toEqual([
            0, 0, 0, 0,
        ]);
    }
});

test("a bundle with a rectangle outside the image is refused by validateAtlas and by the ngne-preview page", async ({
    page,
}) => {
    const fixture = FIXTURES.a;
    const whole = await exportFixture(page, "a");
    const { files, frame, x } = withRectOutsideImage(whole, fixture.name);
    const directory = temporaryDirectory();
    writeBundle(directory, files);

    // The control: the bundle it was made from is accepted from a folder of its own. The
    // image is the same; only the rectangle of one frame has moved.
    const intact = temporaryDirectory();
    writeBundle(intact, whole);
    const { meta, image } = await readAtlas(intact, fixture.name);
    expect(x + meta.frames[frame].w).toBeGreaterThan(image.width);

    await expect(readAtlas(directory, fixture.name)).rejects.toMatchObject({
        name: "AtlasError",
        code: "bounds",
        path: `frames["${frame}"]`,
    });

    const preview = await openPreview(page, directory, fixture.name);
    try {
        // The page loads the adapter and the image, finds the rectangle, and stops.
        await expect(page.locator("#status")).toHaveText(/^(Ready|Preview failed|Hidden)/);
        const { status, error } = await report(page);
        expect(status).toBe("Preview failed");
        expect(error).toContain(
            `frame ${frame}: source rectangle outside image ${fixture.name} ` +
                `(${image.width}x${image.height})`,
        );
        // It stays that way: the page draws nothing and its controls are off.
        await expect(page.locator("#controls")).toHaveJSProperty("disabled", true);
        expect(await page.locator("#frames option").count()).toBe(0);
    } finally {
        await closePreview(preview);
    }
});

// The last test of the file. It runs whether the tests before it passed or not, and in a
// new worker when one of them failed: what it looks for is found by the folder of the run,
// not by what this worker remembers.
test("no ngne-preview process is left behind", async ({ page }) => {
    // Nothing of the tests before this one is left: none of this worker, and none of a
    // worker a failed test has ended.
    expect(runningPreviews()).toEqual([]);
    expect(await previewProcesses(run)).toEqual([]);

    // The control: the process list does show a preview of this run while it runs, by the
    // folder of the run in its command line.
    const directory = temporaryDirectory();
    writeBundle(directory, await exportFixture(page, "a"));
    const config = join(directory, `${FIXTURES.a.name}.preview.config.mjs`);
    const preview = await startPreview(config);
    started.push(preview.pid);
    try {
        const listed = await previewProcesses(run);
        expect(listed.map((entry) => entry.pid)).toEqual([preview.pid]);
        expect(listed[0].command).toContain(config);
        expect(runningPreviews().map((entry) => entry.pid)).toEqual([preview.pid]);
    } finally {
        await closePreview(preview);
    }

    // Every preview this worker started was stopped (the fixtures and the corrupted bundle
    // when no test failed, the control in any case), and the process list holds none of
    // this run.
    expect(started.length).toBeGreaterThan(0);
    expect(runningPreviews()).toEqual([]);
    expect(await previewProcesses(run)).toEqual([]);
    // The folders of the run hold the four files of a bundle each, and nothing a process
    // left in them.
    const folders = readdirSync(run);
    expect(folders.length).toBeGreaterThan(0);
    for (const folder of folders) expect(readdirSync(join(run, folder)), folder).toHaveLength(4);
});
