import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares `window.__ngneTest` and its `viewport` probe, the development-only test hooks.
import type {} from "../../src/app/viewport/mountViewport";
import type * as PlaybackModule from "../../src/app/playback/playback";
import type * as CoreModel from "../../src/core/model";
import type { OnionSettings } from "../../src/core/model";
import { collectErrors, settleTimers } from "./se-006-support";
import { openEditor } from "./se-007-support";
import { checkerAt, DARK_CHECKER, paint, settle, solid } from "./se-011-support";
import type { Rgba } from "./se-011-support";
import { timeline, viewport } from "./se-022-support";

// SE-025: onion skins in the app (SPEC §6.4, §7.5). Documents are made in the page with one
// colour per frame; the viewport is read back in the page after it has settled (SPEC §6.7),
// and its probe says which ghosts the last frame drew.

declare global {
    interface Window {
        __se025?: { playback: typeof PlaybackModule; now: number };
    }
}

const SIZE = 8;
const VIEW = { scale: 8, originX: 32, originY: 24 };

/** The device pixel at the centre of texel `x`, `y`. */
function device(x: number, y: number) {
    return { x: VIEW.originX + x * VIEW.scale + 4, y: VIEW.originY + y * VIEW.scale + 4 };
}

interface AnimationOptions {
    /** One entry per frame: the colour of all its pixels, or null for an empty frame. */
    frames: readonly (Rgba | null)[];
    /** The 1-based frame made active. */
    active: number;
    onion: Partial<OnionSettings>;
    /** 1-based frame ranges of tags. */
    tags?: readonly [number, number][];
    /** 1-based frames whose cel shares the image of the frame before (linked cels). */
    linked?: readonly number[];
}

/** Opens a document of 8×8 frames with the grids off; returns its id. */
function openAnimation(page: Page, options: AnimationOptions): Promise<string> {
    return page.evaluate(
        async ({ options, size, view }) => {
            const path = "/src/core/model/index.ts";
            const core = (await import(/* @vite-ignore */ path)) as typeof CoreModel;
            const session = core.createDocument({ name: "onion", width: size, height: size });
            const { doc } = session;
            const first = doc.frames[0]!;
            doc.frames = options.frames.map((_, index) => ({
                id: index === 0 ? first.id : `frame-${index + 1}`,
                durationMs: 100,
            }));
            doc.frames.forEach((frame, index) => {
                const linked = options.linked?.includes(index + 1) ?? false;
                const imageId = `image-${linked ? index : index + 1}`;
                const colour = options.frames[index];
                if (!linked) {
                    if (!colour) return;
                    const data = new Uint8ClampedArray(size * size * 4);
                    for (let at = 0; at < data.length; at += 4) data.set(colour, at);
                    doc.images.set(imageId, { width: size, height: size, data });
                }
                doc.cels.set(core.celKey(session.activeLayerId, frame.id), {
                    imageId,
                    opacity: 255,
                });
            });
            doc.tags = (options.tags ?? []).map(([from, to], index) => ({
                id: `tag-${index}`,
                name: `tag ${index}`,
                color: 0xff8000ff,
                fromFrameId: doc.frames[from - 1]!.id,
                toFrameId: doc.frames[to - 1]!.id,
                direction: "forward",
                repeat: 0,
            }));
            session.activeFrameId = doc.frames[options.active - 1]!.id;
            doc.settings.pixelGrid = false;
            doc.settings.grid.visible = false;
            doc.settings.onion = { ...doc.settings.onion, ...options.onion };
            return window.__ngneTest!.sessions.getState().open(session, { view }).id;
        },
        { options, size: SIZE, view: VIEW },
    );
}

/** The colour the viewport shows at a device pixel, read back in the page. */
function shownAt(page: Page, at: { x: number; y: number }): Promise<Rgba> {
    return page.evaluate((at) => {
        const image = window.__ngneTest!.viewport!.readCanvas();
        if (!image) throw new Error("se-025: the viewport has no ready renderer");
        const index = (at.y * image.width + at.x) * 4;
        return Array.from(image.data.subarray(index, index + 4)) as unknown as Rgba;
    }, at);
}

/** The ghosts the last frame drew: their frame number (1-based), variant and layer. */
function drawnGhosts(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const ids = document.session.doc.frames.map((frame) => frame.id);
        return window.__ngneTest!.viewport!.onion.map((ghost) => {
            const at = ghost.key.lastIndexOf(":");
            const frame = ids.indexOf(ghost.key.slice(0, at)) + 1;
            return `${frame}:${ghost.key.slice(at + 1)}@${ghost.layer}`;
        });
    });
}

function setOnion(page: Page, patch: Partial<OnionSettings>): Promise<void> {
    return page.evaluate((patch) => {
        const state = window.__ngneTest!.sessions.getState();
        state.updateDocSettings(state.activeId!, (settings) => {
            settings.onion = { ...settings.onion, ...patch };
        });
    }, patch);
}

/** Makes frame `number` (1-based) the active one, as the timeline does. */
function showFrame(page: Page, number: number): Promise<void> {
    return page.evaluate((number) => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        document.session.activeFrameId = document.session.doc.frames[number - 1]!.id;
        state.touch(document.id);
    }, number);
}

/** `colour` at `alpha` (0..1) over `under`, per channel, as NGNE blends a quad. */
function blend(colour: Rgba, alpha: number, under: readonly number[]): number[] {
    return [0, 1, 2].map((channel) => colour[channel]! * alpha + under[channel]! * (1 - alpha));
}

function expectNear(actual: Rgba, expected: readonly number[], tolerance: number): void {
    for (const channel of [0, 1, 2]) {
        expect(
            Math.abs(actual[channel]! - expected[channel]!),
            `channel ${channel}: ${actual.join(",")} against ${expected.map((v) => v.toFixed(1)).join(",")}`,
        ).toBeLessThanOrEqual(tolerance);
    }
    expect(actual[3]).toBe(255);
}

const PINK: Rgba = [200, 40, 120, 255];
const BLACK: Rgba = [0, 0, 0, 255];

test("one frame before at 50% with tint off blends over the checkerboard within ±1", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openAnimation(page, {
        frames: [PINK, null],
        active: 2,
        onion: { enabled: true, before: 1, after: 0, opacity: 128, tint: false },
    });
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(["1:plain@3"]);
    const alpha = 128 / 255;
    for (const [x, y] of [
        [1, 1],
        [6, 2],
    ] as const) {
        const under = checkerAt(DARK_CHECKER, x, y);
        expectNear(await shownAt(page, device(x, y)), blend(PINK, alpha, under), 1);
    }

    // Off: the checkerboard alone, and no ghost drawn.
    await setOnion(page, { enabled: false });
    await settle(page);
    expect(await drawnGhosts(page)).toEqual([]);
    expectNear(await shownAt(page, device(1, 1)), checkerAt(DARK_CHECKER, 1, 1), 0);
    expect(errors).toEqual([]);
});

test("with tint on a black pixel of the previous frame appears reddish, of the next one bluish", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openAnimation(page, {
        frames: [BLACK, null, BLACK],
        active: 2,
        onion: { enabled: true, before: 1, after: 0, opacity: 255, tint: true },
    });
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(["1:before@3"]);
    const red = await shownAt(page, device(2, 2));
    // Not a multiply, which would leave black black.
    expect(red[0]).toBeGreaterThan(red[1]);
    expect(red[0]).toBeGreaterThan(red[2]);
    expectNear(red, [128, 0, 0], 1);

    await setOnion(page, { before: 0, after: 1 });
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(["3:after@3"]);
    const blue = await shownAt(page, device(2, 2));
    expect(blue[2]).toBeGreaterThan(blue[0]);
    expect(blue[2]).toBeGreaterThan(blue[1]);
    expect(errors).toEqual([]);
});

test("placed in front, a ghost is drawn over the current frame", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openAnimation(page, {
        frames: [PINK, BLACK],
        active: 2,
        onion: { enabled: true, before: 1, after: 0, opacity: 128, placement: "behind" },
    });
    await settle(page);
    // Behind an opaque frame: hidden.
    expectNear(await shownAt(page, device(3, 3)), [0, 0, 0], 0);
    await setOnion(page, { placement: "front" });
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(["1:plain@5"]);
    expectNear(await shownAt(page, device(3, 3)), blend(PINK, 128 / 255, [0, 0, 0]), 1);
    expect(errors).toEqual([]);
});

test("frames outside the document or the tag are not drawn; quick toggles and scrubbing report nothing", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const colours: Rgba[] = [0, 1, 2, 3, 4, 5].map((index) => [
        40 * index,
        90,
        200 - 30 * index,
        255,
    ]);
    await openAnimation(page, {
        frames: colours,
        active: 1,
        onion: { enabled: true, before: 3, after: 3, opacity: 200, falloff: 0.5 },
        tags: [[2, 4]],
    });
    await settle(page);
    // At the first frame nothing lies before it; the farthest after is drawn first.
    expect(await drawnGhosts(page)).toEqual(["4:plain@3", "3:plain@3", "2:plain@3"]);
    await showFrame(page, 6);
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(["3:plain@3", "4:plain@3", "5:plain@3"]);
    // Within the tag of frames 2 to 4.
    await setOnion(page, { withinTag: true });
    await showFrame(page, 3);
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(["2:plain@3", "4:plain@3"]);
    // Frame 6 is in no tag: the document's range.
    await showFrame(page, 6);
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(["3:plain@3", "4:plain@3", "5:plain@3"]);

    // F3 on the canvas and ← → (frames) as fast as the keyboard goes, tint on: every ghost
    // is drawn only once its upload has resolved, so NGNE reports no texture that is not ready.
    await setOnion(page, { withinTag: false, tint: true });
    await viewport(page).focus();
    for (let round = 0; round < 6; round++) {
        await page.keyboard.press("F3");
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("F3");
        await page.keyboard.press("ArrowRight");
    }
    await settle(page);
    // NGNE reports a frame naming a texture that is not ready when it is submitted; a few more
    // frames give a late report time to arrive.
    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
    // Each round toggles twice and steps back one frame, stopping at the first: frame 2, on.
    const enabled = await page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        return state.documents.find((entry) => entry.id === state.activeId)!.session.doc.settings
            .onion.enabled;
    });
    expect(enabled).toBe(true);
    expect(await drawnGhosts(page)).toEqual(["1:before@3", "5:after@3", "4:after@3", "3:after@3"]);
});

test("editing frame N updates its ghost while frame N+1 is shown, tinted or not", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const id = await openAnimation(page, {
        frames: [PINK, null],
        active: 2,
        onion: { enabled: true, before: 1, after: 0, opacity: 255, tint: false },
    });
    await settle(page);
    expectNear(await shownAt(page, device(4, 4)), PINK, 0);
    const first = await page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        return state.documents.find((entry) => entry.id === state.activeId)!.session.doc.frames[0]!
            .id;
    });
    const green: Rgba = [30, 220, 60, 255];
    await paint(page, id, solid(SIZE, SIZE, green), first);
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(["1:plain@3"]);
    expectNear(await shownAt(page, device(4, 4)), green, 0);

    await setOnion(page, { tint: true });
    await settle(page);
    expectNear(await shownAt(page, device(4, 4)), [143, 110, 30], 1);
    await paint(page, id, solid(SIZE, SIZE, BLACK), first);
    await settle(page);
    expectNear(await shownAt(page, device(4, 4)), [128, 0, 0], 1);
    expect(errors).toEqual([]);
});

test("a stroke on a linked cel updates the linked ghost while the stroke goes on", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    // Frames 1 and 2 share one transparent image; the ghost of frame 1 is in front, tinted.
    await openAnimation(page, {
        frames: [[0, 0, 0, 0], null],
        linked: [2],
        active: 2,
        onion: { enabled: true, before: 1, after: 0, opacity: 255, tint: true, placement: "front" },
    });
    await page.evaluate(() => {
        const editor = window.__ngneTest!.editor.getState();
        editor.setTool("pencil");
        editor.setForeground(0x000000ff);
    });
    await settle(page);
    const host = await page.locator("[data-viewport-canvas]").boundingBox();
    const at = device(2, 2);
    await page.mouse.move(host!.x + at.x, host!.y + at.y);
    await page.mouse.down();
    // While the button is held, the ghost of frame 1 shows the pixel the stroke wrote into the
    // shared image: tinted red over it.
    await expect
        .poll(async () => {
            const shown = await shownAt(page, at);
            return shown[0] > shown[1] + 40 && shown[0] > shown[2] + 40;
        })
        .toBe(true);
    await page.mouse.up();
    expect(errors).toEqual([]);
});

test("onion skins are hidden while playing and come back after", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openAnimation(page, {
        frames: [PINK, null, PINK, null],
        active: 2,
        onion: { enabled: true, before: 1, after: 1, opacity: 255 },
    });
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(["1:plain@3", "3:plain@3"]);
    await page.evaluate(async () => {
        const path = "/src/app/playback/playback.ts";
        const playback = (await import(/* @vite-ignore */ path)) as typeof PlaybackModule;
        window.__se025 = { playback, now: 0 };
        playback.playbackTime.now = () => window.__se025!.now;
    });
    await viewport(page).focus();
    await page.keyboard.press("Enter");
    await expect
        .poll(() => page.evaluate(() => window.__se025!.playback.editorPlayback.playing))
        .toBe(true);
    // The clock stays in frame 2's interval, which is transparent: while playing the viewport
    // shows the checkerboard there, with no ghost (the read draws the scene as it is now).
    expectNear(await shownAt(page, device(1, 1)), checkerAt(DARK_CHECKER, 1, 1), 0);
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.onion)).toEqual([]);
    // F3 leaves playback running.
    await page.keyboard.press("F3");
    expect(await page.evaluate(() => window.__se025!.playback.editorPlayback.playing)).toBe(true);
    await page.keyboard.press("F3");
    await page.keyboard.press("Enter");
    await expect
        .poll(() => page.evaluate(() => window.__se025!.playback.editorPlayback.playing))
        .toBe(false);
    await settle(page);
    // Paused on frame 2, its ghosts as before playing.
    expect(await drawnGhosts(page)).toEqual(["1:plain@3", "3:plain@3"]);
    expect(errors).toEqual([]);
});

test("a burst of frame changes with three tinted ghosts each side leaves all six on screen", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const colours: Rgba[] = Array.from({ length: 10 }, (_, index) => [20 * index, 80, 100, 255]);
    await openAnimation(page, {
        frames: colours,
        active: 5,
        onion: { enabled: true, before: 3, after: 3, opacity: 200, tint: true },
    });
    await settle(page);
    const ghostsOf5 = [
        "2:before@3",
        "3:before@3",
        "4:before@3",
        "8:after@3",
        "7:after@3",
        "6:after@3",
    ];
    expect(await drawnGhosts(page)).toEqual(ghostsOf5);
    // ← ← → → from the keyboard, three times: back on frame 5.
    await viewport(page).focus();
    for (let round = 0; round < 3; round++) {
        for (const key of ["ArrowLeft", "ArrowLeft", "ArrowRight", "ArrowRight"]) {
            await page.keyboard.press(key);
        }
    }
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(ghostsOf5);
    // Faster than keys arrive: Previous and Next Frame run in the page one animation frame
    // apart, so the uploads of a change are in flight when the next one comes (the review's
    // sequences, each back on frame 5).
    const [next, previous] = ["frame.next", "frame.previous"];
    for (const sequence of [
        [next, previous],
        [next, next, previous, previous],
        [previous, previous, next, next],
        [next, next, next, previous, previous, previous],
        [previous, previous, previous, next, next, next],
    ]) {
        await page.evaluate(async (sequence) => {
            const commands = window.__ngneTest!.commands;
            for (const id of sequence) {
                await commands.get(id)!.run();
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
        }, sequence);
        await settle(page);
        expect(await drawnGhosts(page), sequence.join(" ")).toEqual(ghostsOf5);
    }
    // The frame is frame 5's colour where no ghost is drawn over it.
    expectNear(await shownAt(page, device(4, 4)), colours[4]!, 0);
    expect(errors).toEqual([]);
});

test("the transport's toggle and its settings popover change the document's settings, not its history", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openAnimation(page, {
        frames: [PINK, null, null],
        active: 2,
        onion: { enabled: false },
    });
    await settle(page);
    const transport = timeline(page).getByRole("group", { name: "Transport" });
    const toggle = transport.getByRole("button", { name: "Onion skin", exact: true });
    const settings = transport.getByRole("button", { name: "Onion skin settings" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    // Seven buttons in the 200 px column, none outside it.
    const column = (await transport.boundingBox())!;
    expect(column.width).toBe(200);
    for (const button of await transport.getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width);
        expect(box.width).toBeGreaterThanOrEqual(24);
    }

    const onion = () =>
        page.evaluate(() => {
            const state = window.__ngneTest!.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId)!;
            return {
                ...document.session.doc.settings.onion,
                canUndo: document.history.canUndo,
            };
        });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await onion()).toMatchObject({ enabled: true, canUndo: false });
    await settle(page);
    // A new document's defaults: one frame on each side, behind, untinted.
    expect(await drawnGhosts(page)).toEqual(["1:plain@3", "3:plain@3"]);

    // F3 on the canvas toggles it back; the button follows.
    await viewport(page).focus();
    await page.keyboard.press("F3");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("F3");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // The popover runs Apply Onion Skin Settings for each change (SPEC §5: the interface
    // changes a document only through registered commands): its runs are counted.
    await page.evaluate(() => {
        const command = window.__ngneTest!.commands.get("view.applyOnionSettings")!;
        const run = command.run;
        const spy = window as unknown as { __se025Runs: number };
        spy.__se025Runs = 0;
        (command as { run: () => void | Promise<void> }).run = () => {
            spy.__se025Runs++;
            return run();
        };
    });
    const runs = () =>
        page.evaluate(() => (window as unknown as { __se025Runs: number }).__se025Runs);

    // The popover: After 0, placement in front, tint.
    await settings.click();
    const popover = page.getByRole("dialog", { name: "Onion skin settings" });
    await expect(popover).toBeVisible();
    await expect(popover.getByRole("spinbutton", { name: "Before" })).toBeVisible();
    const after = popover.getByRole("spinbutton", { name: "After" });
    await after.fill("0");
    await after.press("Enter");
    await expect.poll(async () => (await onion()).after).toBe(0);
    await popover.getByRole("radio", { name: "In front" }).click();
    await popover.getByRole("button", { name: "Tint" }).click();
    expect(await onion()).toMatchObject({
        after: 0,
        placement: "front",
        tint: true,
        canUndo: false,
    });
    await settle(page);
    expect(await drawnGhosts(page)).toEqual(["1:before@5"]);
    expect(await runs()).toBe(3);
    // With the command disabled, a change in the popover changes nothing.
    await page.evaluate(() => {
        const command = window.__ngneTest!.commands.get("view.applyOnionSettings")!;
        (command as { enabled: () => boolean }).enabled = () => false;
    });
    await popover.getByRole("button", { name: "Within tag" }).click();
    await expect(popover.getByRole("button", { name: "Within tag" })).toHaveAttribute(
        "aria-pressed",
        "false",
    );
    expect((await onion()).withinTag).toBe(false);
    expect(await runs()).toBe(3);
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await settleTimers(page);
    // No unsaved marker: the settings are not part of the history.
    await expect(page.getByRole("tab", { selected: true })).not.toContainText("*");
    expect(errors).toEqual([]);
});
