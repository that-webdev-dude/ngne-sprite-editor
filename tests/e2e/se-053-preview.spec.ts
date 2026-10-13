import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { AtlasMeta } from "../../src/core/export/atlasFormat";
import { FIXTURES, FIXTURE_IDS, withRectOutsideImage } from "./se-053-documents";
import { previewProcesses, runningPreviews, startPreview } from "./se-053-preview-process";
import type { PreviewProcess } from "./se-053-preview-process";
import { exportFixture, readAtlas, writeBundle } from "./se-053-support";

// SE-053, conditions 1 and 2 of SPEC §9.7 on the bundle of every fixture, written to a
// temporary folder as an export writes it:
// 1. `<name>.atlas.json` validates and its rectangles lie inside the PNG;
// 2. the installed `ngne-preview`, started on `<name>.preview.config.mjs`, serves a page that
//    reports `Ready` without an error text for every frame selected in turn.
// A bundle corrupted on purpose fails both, and no `ngne-preview` process is left behind.
//
// The tests run one after the other in one worker: the last one looks at the process list
// for what the others started. Each test uses the one page Playwright gives it, so the
// preview is the foreground page of its window; a hidden preview pauses.

test.describe.configure({ mode: "serial" });

/** Every folder of this file has this in its name, and so has every adapter path. */
const MARKER = "se-053-preview-";

/** The folders written; removed when the file is done. */
const directories: string[] = [];

/** The process ID of every `ngne-preview` the tests have started. */
const started: number[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), MARKER));
    directories.push(directory);
    return directory;
}

test.afterAll(async () => {
    // A test that failed half way has stopped its own process; this is the net below it.
    for (const preview of runningPreviews()) await preview.stop().catch(() => undefined);
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
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

    // Beyond the ticket: every animation, with as many entries as the atlas writes out.
    for (const [id, { playback, durationMs, entries }] of animations) {
        await page.locator("#animations").selectOption(id);
        await expect
            .poll(() => page.locator("#entry").textContent(), id)
            .toBe(
                `${id}: entry 1/${entries.length} · ${entries[0].ms} ms · ` +
                    `elapsed 0.0/${durationMs} ms · ${playback} · paused`,
            );
        expect(await firstLine(page, "#details"), id).toBe(`Frame ${entries[0].frame}`);
        await expectReady(page, id);
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
        const count = fixture.build().frames.length;
        expect(Object.keys(meta.frames)).toHaveLength(count);
        for (const [frame, { x, y, w, h }] of Object.entries(meta.frames)) {
            expect(x >= 0 && y >= 0 && x + w <= image.width && y + h <= image.height, frame).toBe(
                true,
            );
            expect([w % 2, h % 2], frame).toEqual([0, 0]);
        }

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

test("no ngne-preview process is left behind", async ({ page }) => {
    // The control: the process list shows a preview that runs, by its command line.
    const directory = temporaryDirectory();
    writeBundle(directory, await exportFixture(page, "a"));
    const config = join(directory, `${FIXTURES.a.name}.preview.config.mjs`);
    const preview = await startPreview(config);
    started.push(preview.pid);
    try {
        const listed = await previewProcesses(MARKER);
        expect(listed.map((entry) => entry.pid)).toEqual([preview.pid]);
        expect(listed[0].command).toContain(config);
        expect(runningPreviews().map((entry) => entry.pid)).toEqual([preview.pid]);
    } finally {
        await closePreview(preview);
    }

    // Every preview this file started was stopped (the fixtures, the corrupted bundle, the
    // control), and the process list holds no preview on a folder of this file: none of
    // this run, and none an earlier run left.
    expect(started.length).toBeGreaterThan(0);
    expect(runningPreviews()).toEqual([]);
    expect(await previewProcesses(MARKER)).toEqual([]);
    // The folders hold the four files of a bundle and nothing a process left in them.
    for (const folder of directories) expect(readdirSync(folder), folder).toHaveLength(4);
});
