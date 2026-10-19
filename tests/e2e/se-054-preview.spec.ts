import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import {
    addFrame,
    captures,
    openDocument,
    paint,
    pattern,
    settle,
    showFrame,
    shows,
    solid,
} from "./se-011-support";
import type { Rgba } from "./se-011-support";
import { geometry } from "./se-012-support";
import { texelClient } from "./se-014-support";
import { celBytes, setColours, setToolOptions } from "./se-015-support";
import { composite } from "./se-054-readback-cases";
import {
    ALL_FRAMES,
    BACKGROUNDS,
    createTag,
    frameIdOf,
    installManualScheduler,
    openPreviewEditor,
    previewCanvas,
    previewMismatches,
    previewSection,
    previewSettled,
    previewStage,
    previewToggle,
    readPreview,
    recordedPreview,
    recordPreview,
    runPreviewFrames,
    setPreview,
    setTagDirection,
} from "./se-054-support";
import type { PreviewRead, Rgb } from "./se-054-support";

// SE-054: the preview panel (SPEC §6.5, DESIGN §5.5) as the user works with it: it follows
// edits, repacks without pairing new metadata with an old texture, follows tag changes, keeps
// one game for the page, leaves wheel and focus to the dock, shows why it cannot preview, and
// leaves the viewport drawing correctly.

const DARK = BACKGROUNDS.dark;

/** Solid opaque images, one colour per frame. */
const COLOURS: readonly Rgba[] = [
    [230, 40, 40, 255],
    [40, 200, 60, 255],
    [50, 70, 230, 255],
    [240, 220, 30, 255],
];

/** Opens a `width` × `height` document whose frames are painted the colours of `COLOURS`. */
async function solidFrames(
    page: Page,
    name: string,
    width: number,
    height: number,
    count: number,
    image: (index: number) => number[] = (index) => solid(width, height, COLOURS[index]!),
): Promise<{ id: string; frameIds: string[]; images: number[][] }> {
    const document = await openDocument(page, { name, width, height });
    const frameIds = [document.frameId];
    const images: number[][] = [];
    for (let index = 0; index < count; index++) {
        if (index > 0) frameIds.push(await addFrame(page, document.id));
        const pixels = image(index);
        await paint(page, document.id, pixels, frameIds[index]);
        images.push(pixels);
    }
    return { id: document.id, frameIds, images };
}

/** Which of `images` a read shows in full over `under`; -1 when none. */
function showsImage(read: PreviewRead, images: readonly number[][], under: Rgb = DARK): number {
    return images.findIndex((pixels) => previewMismatches(read, pixels, under).length === 0);
}

/** Every diagnostic any preview of the page reported. */
function diagnostics(page: Page): Promise<string[]> {
    return page.evaluate(() => [
        ...((window as unknown as { __se054Probe?: { diagnostics: string[] } }).__se054Probe
            ?.diagnostics ??
            window.__ngneTest!.preview?.diagnostics ??
            []),
    ]);
}

/** Keeps the probe of the panel mounted now, whose page-wide counters outlive it. */
function keepProbe(page: Page): Promise<void> {
    return page.evaluate(() => {
        (window as unknown as { __se054Probe: unknown }).__se054Probe = window.__ngneTest!.preview;
    });
}

/** Reads a counter of the kept probe. */
function probeValue(page: Page, name: "liveGames" | "frames"): Promise<number> {
    return page.evaluate(
        (name) =>
            (window as unknown as { __se054Probe: Record<string, number> }).__se054Probe[name]!,
        name,
    );
}

test("drawing a pencil stroke updates the preview within 500 ms", async ({ page }) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    const view = { scale: 8, originX: 48, originY: 32 };
    const document = await openDocument(page, { name: "stroke", width: 16, height: 16 }, view);
    await setColours(page, 0x000000ff, 0xffffffff);
    await setToolOptions(page, "pencil", { size: 2, shape: "square" });
    await setPreview(page, { chosen: ALL_FRAMES, playing: false });
    await settle(page);
    await previewSettled(page);
    await page.evaluate(() => {
        window.addEventListener(
            "pointerup",
            () => {
                (window as unknown as { __se054Up: number }).__se054Up = performance.now();
            },
            { capture: true },
        );
    });
    await recordPreview(page);

    const layout = await geometry(page);
    const at = (x: number, y: number) => texelClient(layout, view, { x, y });
    await page.mouse.move(at(2, 2).x, at(2, 2).y);
    await page.mouse.down();
    await page.mouse.move(at(9, 6).x, at(9, 6).y);
    await page.mouse.move(at(13, 12).x, at(13, 12).y);
    await page.mouse.up();
    const after = await celBytes(page, document.id);
    if (!after) throw new Error("no cel");
    await previewSettled(page);
    // A few more frames after the update.
    await readPreview(page);
    const frames = await recordedPreview(page);
    const up = await page.evaluate(() => (window as unknown as { __se054Up: number }).__se054Up);
    const first = frames.find((frame) => showsImage(frame, [composite(after)]) === 0);
    expect(first, "no frame of the preview showed the stroke").toBeDefined();
    expect(first!.at - up).toBeLessThanOrEqual(500);
    // Until then it showed the document before the stroke: the empty frame.
    const empty = solid(16, 16, [0, 0, 0, 0]);
    for (const frame of frames.filter((entry) => entry.at < first!.at)) {
        expect(showsImage(frame, [empty])).toBe(0);
    }
    expect(errors).toEqual([]);
});

test("during a repack that changes the atlas layout, every frame shows the old or the new frame image in full", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    // Opaque patterns, every texel unlike its neighbours: a rectangle sampled from the wrong
    // place of an atlas shows another image.
    const { id, frameIds, images } = await solidFrames(page, "repack", 8, 8, 4, (index) =>
        pattern(8, 8, index + 1),
    );
    // Paused at 250 ms: frame 2 now; after a frame is inserted after frame 0, the old frame 1.
    await setPreview(page, { chosen: ALL_FRAMES, playing: false });
    await previewSettled(page);
    await page.evaluate(() => window.__ngneTest!.preview!.seek(250));
    expect(showsImage(await readPreview(page, frameIdOf("repack", 2)), images)).toBe(2);
    const before = await page.evaluate(() => window.__ngneTest!.preview!.publishedSize);

    // The upload of the new atlas waits until the gate opens.
    await page.evaluate(() => {
        const scope = window as unknown as { __se054Open: () => void };
        const opened = new Promise<void>((resolve) => {
            scope.__se054Open = resolve;
        });
        window.__ngneTest!.preview!.uploadGate = () => opened;
    });
    // Every animation frame, not only on demand: the frames while the upload waits as well.
    await recordPreview(page, true);
    await showFrame(page, id, frameIds[0]!);
    await addFrame(page, id);
    // The new atlas is packed and its upload waits: frames keep coming meanwhile.
    await page.waitForFunction(() => {
        const probe = window.__ngneTest!.preview!;
        return probe.serial > (probe.published ?? 0);
    });
    const gatedFrom = await page.evaluate(() => window.__ngneTest!.preview!.frames);
    await page.waitForFunction(
        (from) => window.__ngneTest!.preview!.frames >= from + 10,
        gatedFrom,
    );
    await page.evaluate(() => {
        window.__ngneTest!.preview!.uploadGate = null;
        (window as unknown as { __se054Open: () => void }).__se054Open();
    });
    await previewSettled(page);
    await readPreview(page);
    const frames = await recordedPreview(page);

    const shown = frames.map((frame) => showsImage(frame, images));
    expect(frames.every((frame) => frame.drawn !== null)).toBe(true);
    expect(shown.filter((index) => index !== 1 && index !== 2)).toEqual([]);
    // The old image while the upload waited, the new one once it was published.
    expect(shown.filter((index) => index === 2).length).toBeGreaterThanOrEqual(10);
    expect(shown[shown.length - 1]).toBe(1);
    const after = await page.evaluate(() => window.__ngneTest!.preview!.publishedSize);
    expect(after).not.toEqual(before);
    expect(errors).toEqual([]);
});

test("changing a tag's direction to ping-pong changes the preview sequence without reload", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    await installManualScheduler(page);
    const { id, images } = await solidFrames(page, "bounce", 4, 4, 3);
    const tagId = await createTag(page, id, { name: "walk", from: 0, to: 2 });
    await setPreview(page, { chosen: "walk", playing: true, speed: 1 });
    await previewSettled(page);
    const tick = 1000 / 60;

    /** Each frame shows the image of the frame the entry at its age names. */
    const check = (frames: PreviewRead[], order: readonly number[]) => {
        const period = order.length * 100;
        const seen: number[] = [];
        for (const frame of frames) {
            const age = frame.drawn!.ageMs;
            const expected = order[Math.floor((age % period) / 100)]!;
            expect(frame.drawn!.frame).toBe(frameIdOf("bounce", expected));
            expect(showsImage(frame, images)).toBe(expected);
            if (seen[seen.length - 1] !== expected) seen.push(expected);
        }
        return seen;
    };

    const forward = await runPreviewFrames(page, 40, tick);
    expect(check(forward, [0, 1, 2]).join(",")).toContain("0,1,2,0");

    await setTagDirection(page, id, tagId, "pingpong");
    await previewSettled(page);
    // The game was not made again: the same one plays on.
    expect(await page.evaluate(() => window.__ngneTest!.preview!.liveGames)).toBe(1);
    const bouncing = await runPreviewFrames(page, 60, tick);
    expect(check(bouncing, [0, 1, 2, 1]).join(",")).toContain("2,1,0");
    expect(errors).toEqual([]);
});

test("an entry boundary is crossed at the tick that reaches it, at the default 1/60 s tick", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    await installManualScheduler(page);
    const { id, frameIds, images } = await solidFrames(page, "tick", 6, 4, 2);
    // 50 ms is three ticks of 16.67 ms, so the boundary falls on a tick, give or take the
    // rounding of the ages (fractions of a millisecond).
    await page.evaluate(
        ({ id, frameIds }) => {
            const { documents } = window.__ngneTest!.sessions.getState();
            const { session } = documents.find((entry) => entry.id === id)!;
            for (const frame of session.doc.frames) {
                if (frameIds.includes(frame.id)) frame.durationMs = 50;
            }
            window.__ngneTest!.sessions.getState().touch(id);
        },
        { id, frameIds },
    );
    await setPreview(page, { chosen: ALL_FRAMES, playing: true, speed: 1 });
    await previewSettled(page);
    await page.evaluate(() => window.__ngneTest!.preview!.seek(0));
    const frames = await runPreviewFrames(page, 12, 1000 / 60);
    const ages = frames.map((frame) => frame.drawn!.ageMs);
    // The ages are whole ticks: fractions of a millisecond.
    expect(ages.some((age) => !Number.isInteger(age))).toBe(true);
    for (const frame of frames) {
        const age = frame.drawn!.ageMs;
        // Start-inclusive, end-exclusive entries of 50 ms, looping over 100 ms.
        const expected = age % 100 < 50 ? 0 : 1;
        expect(frame.drawn!.frame, `age ${age}`).toBe(frameIdOf("tick", expected));
        expect(showsImage(frame, images), `age ${age}`).toBe(expected);
    }
    // Both entries were shown, and the change came with the first age at or past 50 ms.
    const firstSecond = frames.findIndex((frame) => frame.drawn!.frame === frameIdOf("tick", 1));
    expect(firstSecond).toBeGreaterThan(0);
    expect(ages[firstSecond]).toBeGreaterThanOrEqual(50);
    expect(ages[firstSecond - 1]).toBeLessThan(50);
    expect(errors).toEqual([]);
});

test("no 'Texture is not ready' on first open, on document switch or on 20 collapses and expands in 2 s", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    const first = await solidFrames(page, "first", 16, 16, 1);
    await setPreview(page, { chosen: ALL_FRAMES, playing: true });
    await previewSettled(page);
    await keepProbe(page);
    expect(showsImage(await readPreview(page), first.images)).toBe(0);

    // Another document of another size, then back: a game for each size.
    const second = await solidFrames(page, "second", 24, 12, 2);
    await previewSettled(page);
    expect(showsImage(await readPreview(page, frameIdOf("second", 0)), [second.images[0]!])).toBe(
        0,
    );
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().activate(id), first.id);
    await previewSettled(page);
    expect(showsImage(await readPreview(page), first.images)).toBe(0);

    // 20 toggles of the section, 100 ms apart: the panel is mounted and unmounted each time.
    await page.evaluate(async () => {
        const toggle = document.querySelector<HTMLButtonElement>(
            '[data-dock-panel="preview"] .dock-section__toggle',
        )!;
        for (let index = 0; index < 20; index++) {
            toggle.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    });
    await expect(previewToggle(page)).toHaveAttribute("aria-expanded", "true");
    await previewSettled(page);
    expect(showsImage(await readPreview(page), first.images)).toBe(0);
    await page.waitForFunction(() => window.__ngneTest!.preview!.liveGames === 1);
    expect(await diagnostics(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test("opening, switching and closing documents 20 times leaves at most one live BrowserGame", async ({
    page,
}) => {
    // 60 activations, 30 of them with a new game: about 15 s alone, more under SwiftShader.
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    const base = await solidFrames(page, "base", 16, 16, 1);
    await previewSettled(page);
    await keepProbe(page);
    let most = 0;
    for (let index = 0; index < 20; index++) {
        const size = index % 2 === 0 ? { width: 20, height: 10 } : { width: 16, height: 16 };
        const other = await openDocument(page, { name: `doc-${index}`, ...size });
        most = Math.max(most, await probeValue(page, "liveGames"));
        await page.evaluate((id) => window.__ngneTest!.sessions.getState().activate(id), base.id);
        most = Math.max(most, await probeValue(page, "liveGames"));
        await page.evaluate((id) => window.__ngneTest!.sessions.getState().activate(id), other.id);
        most = Math.max(most, await probeValue(page, "liveGames"));
        await page.evaluate((id) => window.__ngneTest!.sessions.getState().close(id), other.id);
        most = Math.max(most, await probeValue(page, "liveGames"));
    }
    await previewSettled(page);
    expect(most).toBeLessThanOrEqual(1);
    expect(await probeValue(page, "liveGames")).toBe(1);
    // The page's devices: the viewport's renderers and the one game.
    const devices = await page.evaluate(() => ({
        live: window.__se011.liveDevices(),
        viewport: window.__se011.liveRenderers(),
    }));
    expect(devices.live).toBe(devices.viewport + 1);
    expect(showsImage(await readPreview(page), base.images)).toBe(0);
    expect(await diagnostics(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test("with no document open the panel has no game; it stops while the tab is hidden", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    await expect(previewCanvas(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__ngneTest!.preview!.liveGames)).toBe(0);
    const opened = await solidFrames(page, "hidden", 8, 8, 1);
    await previewSettled(page);

    const setHidden = (hidden: boolean) =>
        page.evaluate((hidden) => {
            Object.defineProperty(document, "visibilityState", {
                configurable: true,
                get: () => (hidden ? "hidden" : "visible"),
            });
            document.dispatchEvent(new Event("visibilitychange"));
        }, hidden);
    await setHidden(true);
    await page.waitForFunction(() => window.__ngneTest!.preview!.lifecycle === "Stopped");
    await setHidden(false);
    await previewSettled(page);
    expect(await page.evaluate(() => window.__ngneTest!.preview!.lifecycle)).toBe("Running");

    // Closing the last document disposes the game.
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().close(id), opened.id);
    await page.waitForFunction(() => window.__ngneTest!.preview!.liveGames === 0);
    await expect(previewCanvas(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("wheel over the preview scrolls the dock; clicking it does not move keyboard focus to it", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    await solidFrames(page, "wheel", 16, 16, 1);
    await previewSettled(page);
    // The palette is collapsed under 800 px; expanded, the dock is taller than its region.
    const paletteToggle = page
        .locator('[data-dock-panel="palette"]')
        .getByRole("button", { name: "Palette" });
    if ((await paletteToggle.getAttribute("aria-expanded")) === "false")
        await paletteToggle.click();
    const scroller = page.locator(".shell-dock__scroll");
    const overflow = await scroller.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
    );
    expect(overflow).toBeGreaterThan(40);
    await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await previewCanvas(page).scrollIntoViewIfNeeded();
    const top = await scroller.evaluate((element) => element.scrollTop);
    expect(top).toBeGreaterThan(0);

    const box = (await previewCanvas(page).boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(top);

    // A click: neither the canvas nor anything of the stage takes the focus.
    const field = page.getByRole("button", { name: "Preview · NGNE" });
    await field.focus();
    await page.mouse.click(centre.x, centre.y);
    const focus = await page.evaluate(() => {
        const active = document.activeElement;
        const stage = document.querySelector('[data-dock-panel="preview"] .preview-panel__stage');
        return { inStage: !!active && !!stage?.contains(active), tag: active?.tagName ?? null };
    });
    expect(focus.inStage).toBe(false);
    expect(focus.tag).not.toBe("CANVAS");
    expect(errors).toEqual([]);
});

test("a document too large to pack shows “Too large to preview” and no error; one tag of it previews", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    // 9 frames 1024 px high in one column: 9 × 1025 + 1 px, past the 8192 px side.
    const document = await openDocument(page, { name: "tall", width: 2, height: 1024 });
    await page.evaluate((id) => {
        window.__ngneTest!.sessions.getState().updateExportSettings(id, (settings) => {
            settings.layout = "column";
        });
    }, document.id);
    // Frames that differ, so no two share a rectangle (merge duplicates is on).
    const tall = (index: number) => solid(2, 1024, [index * 20, 100, 200 - index * 20, 255]);
    await paint(page, document.id, tall(0));
    for (let index = 1; index < 9; index++) {
        await paint(page, document.id, tall(index), await addFrame(page, document.id));
    }
    await setPreview(page, { chosen: ALL_FRAMES });
    const message = previewStage(page).getByRole("status");
    await expect(message).toContainText("Too large to preview");
    await expect(message).toContainText("8192");
    await expect(previewSection(page).locator("[data-preview-canvas]")).toBeHidden();
    await expect(page.locator(".ui-toast")).toHaveCount(0);

    // The selected animation alone is packed: a tag of three frames fits.
    await createTag(page, document.id, { name: "short", from: 0, to: 2 });
    await setPreview(page, { chosen: "short" });
    await previewSettled(page);
    await expect(message).toHaveCount(0);
    const size = await page.evaluate(() => window.__ngneTest!.preview!.publishedSize);
    expect(size!.height).toBe(3 * 1025 + 1);
    expect(await diagnostics(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test("an export error of the document is shown in place of the preview", async ({ page }) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    const document = await openDocument(page, { name: "entries", width: 4, height: 4 });
    await previewSettled(page);
    // 258 tags of 255 passes over one frame: more animation entries than an atlas holds.
    await page.evaluate((id) => {
        const state = window.__ngneTest!.sessions.getState();
        const { doc } = state.documents.find((entry) => entry.id === id)!.session;
        for (let index = 0; index < 258; index++) {
            doc.tags.push({
                id: `se054-${index}`,
                name: `t${index}`,
                color: 0x3cb371ff,
                fromFrameId: doc.frames[0]!.id,
                toFrameId: doc.frames[0]!.id,
                direction: "forward",
                repeat: 255,
            });
        }
        state.touch(id);
    }, document.id);
    const message = previewStage(page).getByRole("status");
    await expect(message).toContainText("Cannot preview");
    await expect(message).toContainText("65536");
    await expect(previewSection(page).locator("[data-preview-canvas]")).toBeHidden();
    expect(errors).toEqual([]);
});

test("the viewport keeps rendering correctly while the preview plays", async ({ page }) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    const view = { scale: 4, originX: 16, originY: 16 };
    const width = 16;
    const document = await openDocument(page, { name: "both", width, height: width }, view);
    await addFrame(page, document.id);
    await showFrame(page, document.id, document.frameId);
    await setPreview(page, { chosen: ALL_FRAMES, playing: true, speed: 4 });
    await settle(page);
    await previewSettled(page);
    const rect = {
        x: view.originX,
        y: view.originY,
        width: width * view.scale,
        height: width * view.scale,
    };
    await page.evaluate((rect) => window.__se011.record(rect), rect);

    const painted: number[][] = [];
    for (let index = 0; index < 6; index++) {
        const pixels = solid(width, width, COLOURS[index % COLOURS.length]!).map((value, at) =>
            at % 4 === 0 ? (value + index * 7) & 255 : value,
        );
        const before = await probeFrames(page);
        await paint(page, document.id, pixels, document.frameId);
        painted.push(pixels);
        await settle(page);
        // The preview ran meanwhile.
        await page.waitForFunction((from) => window.__ngneTest!.preview!.frames > from + 2, before);
        const recorded = await captures(page);
        const last = recorded[recorded.length - 1]!;
        expect(shows(last.crop, [pixels], width, view.scale)).toBe(0);
    }
    // Every frame the viewport submitted showed one of the painted images in full.
    for (const capture of await captures(page)) {
        expect(shows(capture.crop, painted, width, view.scale)).toBeGreaterThanOrEqual(0);
    }
    expect(errors).toEqual([]);
});

function probeFrames(page: Page): Promise<number> {
    return page.evaluate(() => window.__ngneTest!.preview!.frames);
}

test("an NGNE failure is shown in the panel, and the game is made again", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openPreviewEditor(page);
    // Collapsed while the document opens: the viewport's uploads are done first.
    await previewToggle(page).click();
    await expect(previewToggle(page)).toHaveAttribute("aria-expanded", "false");
    const { images } = await solidFrames(page, "failing", 8, 8, 1);
    await settle(page);
    await page.evaluate(() => window.__se011.failCopies(1));
    await previewToggle(page).click();
    // NGNE reports the failed copy; the panel lists what it reported.
    const list = previewSection(page).getByRole("list", { name: "Preview diagnostics" });
    await expect(list.getByRole("listitem")).not.toHaveCount(0);
    const reported = await diagnostics(page);
    expect(reported.length).toBeGreaterThan(0);
    await expect(list.getByRole("listitem")).toHaveText(reported);
    await previewSettled(page);
    expect(showsImage(await readPreview(page), images)).toBe(0);
    expect(errors).toEqual([]);
});

test("the controls: play and pause, the animation, the speed and the background chip", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    const { id, images } = await solidFrames(page, "controls", 4, 4, 2);
    await createTag(page, id, { name: "Run", from: 1, to: 1 });
    await previewSettled(page);
    const section = previewSection(page);

    // The first animation plays by default; the select lists them and "All frames".
    const animation = section.getByRole("combobox", { name: "Preview animation" });
    await expect(animation).toHaveText("run");
    await animation.click();
    const options = page.getByRole("option");
    await expect(options).toHaveText(["run", "All frames"]);
    await expect(page.getByRole("option", { name: "run" })).toBeFocused();
    await page.getByRole("option", { name: "All frames" }).click();
    await expect(animation).toHaveText("All frames");
    await expect(page.getByRole("listbox")).toHaveCount(0);

    // Pause stops the age; play goes on.
    await section.getByRole("button", { name: "Pause preview" }).click();
    const paused = await page.evaluate(() => window.__ngneTest!.preview!.ageMs);
    await readPreview(page);
    await readPreview(page);
    expect(await page.evaluate(() => window.__ngneTest!.preview!.ageMs)).toBe(paused);
    await section.getByRole("button", { name: "Play preview" }).click();
    await expect
        .poll(() => page.evaluate(() => window.__ngneTest!.preview!.ageMs))
        .toBeGreaterThan(paused);

    // Speed.
    const speed = section.getByRole("combobox", { name: "Preview speed" });
    await speed.click();
    await expect(page.getByRole("option", { name: "1×", exact: true })).toBeFocused();
    await page.getByRole("option", { name: "2×", exact: true }).click();
    await expect(speed).toHaveText("2×");
    expect(await page.evaluate(() => window.__ngneTest!.previewState!.getState().speed)).toBe(2);

    // The background chip cycles dark, light, mid grey; the game draws it under the frame.
    await section.getByRole("button", { name: "Pause preview" }).click();
    await setPreview(page, { chosen: "run" });
    const chip = section.getByRole("button", { name: /^Preview background/ });
    await expect(chip).toHaveAccessibleName("Preview background: Dark");
    await chip.click();
    await expect(chip).toHaveAccessibleName("Preview background: Light");
    expect(showsImage(await readPreview(page), images, BACKGROUNDS.light)).toBe(1);
    await chip.click();
    await expect(chip).toHaveAccessibleName("Preview background: Mid grey");
    await chip.click();
    await expect(chip).toHaveAccessibleName("Preview background: Dark");
    expect(errors).toEqual([]);
});

test("frames run on demand: at each entry while playing, none while paused; paused time is not played @alone", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    const { images } = await solidFrames(page, "demand", 8, 8, 4);
    await setPreview(page, { chosen: ALL_FRAMES, playing: true, speed: 1 });
    await previewSettled(page);
    await keepProbe(page);

    // Playing 100 ms entries for 1 s: about ten entries, each drawn once or twice, every frame
    // the image of its entry; far fewer than the display's rate (60 Hz or more).
    await recordPreview(page);
    await page.waitForTimeout(1000);
    const playing = await recordedPreview(page);
    expect(playing.length).toBeGreaterThanOrEqual(8);
    expect(playing.length).toBeLessThanOrEqual(25);
    for (const frame of playing) {
        const index = Math.floor((frame.drawn!.ageMs % 400) / 100);
        expect(showsImage(frame, images)).toBe(index);
    }
    const shown = new Set(playing.map((frame) => frame.drawn!.frame));
    expect(shown.size).toBe(4);

    // Paused: nothing changes, so nothing is drawn.
    await setPreview(page, { playing: false });
    await readPreview(page);
    const from = await probeValue(page, "frames");
    const pausedAge = await page.evaluate(() => window.__ngneTest!.preview!.ageMs);
    await page.waitForTimeout(1500);
    expect((await probeValue(page, "frames")) - from).toBe(0);
    // Played again: the age goes on from where it stood, not 1.5 s later.
    await setPreview(page, { playing: true });
    const resumed = await readPreview(page);
    expect(resumed.drawn!.ageMs - pausedAge).toBeGreaterThanOrEqual(0);
    expect(resumed.drawn!.ageMs - pausedAge).toBeLessThan(200);
    await setPreview(page, { playing: false });
    await readPreview(page);
    // A change is drawn at once.
    await recordPreview(page);
    const changed = await page.evaluate(() => {
        window.__ngneTest!.previewState!.setState({ background: "light" });
        return performance.now();
    });
    await page.waitForFunction(
        () => (window as unknown as { __se054Frames: unknown[] }).__se054Frames.length > 0,
        undefined,
        { timeout: 2000 },
    );
    const [first] = await recordedPreview(page);
    expect(first!.at - changed).toBeLessThan(500);
    expect(showsImage(first!, images, BACKGROUNDS.light)).toBeGreaterThanOrEqual(0);
    expect(errors).toEqual([]);
});

test("collapsing the panel stops the game loop: no frame for 1 s @alone", async ({ page }) => {
    const errors = collectErrors(page);
    await openPreviewEditor(page);
    await solidFrames(page, "collapse", 8, 8, 2);
    await previewSettled(page);
    await keepProbe(page);
    // It runs: frames come.
    const running = await probeValue(page, "frames");
    await page.waitForFunction(
        (from) =>
            (window as unknown as { __se054Probe: { frames: number } }).__se054Probe.frames >
            from + 5,
        running,
    );

    await previewToggle(page).click();
    await expect(previewToggle(page)).toHaveAttribute("aria-expanded", "false");
    await page.waitForFunction(
        () =>
            (window as unknown as { __se054Probe: { liveGames: number } }).__se054Probe
                .liveGames === 0,
    );
    const stopped = await probeValue(page, "frames");
    await page.waitForTimeout(1000);
    expect(await probeValue(page, "frames")).toBe(stopped);
    expect(errors).toEqual([]);
});
