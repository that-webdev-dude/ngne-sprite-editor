import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares `window.__ngneTest` and its `viewport` probe, the development-only test hooks.
import type {} from "../../src/app/viewport/mountViewport";
import type * as PlaybackModule from "../../src/app/playback/playback";
import type * as CoreModel from "../../src/core/model";
import { collectErrors } from "./se-006-support";
import { openEditor } from "./se-007-support";
import { settle } from "./se-011-support";
import { activeCell, timeline, viewport } from "./se-022-support";

// SE-024: editor playback in the app with a controlled clock (SPEC §7.5): playback reads the
// time from `playbackTime.now`, which the test sets, so each frame is checked at the edges of
// its interval with no wall-clock timing. The viewport is read back in the page after each
// step has been drawn (SPEC §6.7).

declare global {
    interface Window {
        __se024?: { playback: typeof PlaybackModule; now: number };
    }
}

interface View {
    scale: number;
    originX: number;
    originY: number;
}

type Rgba = [number, number, number, number];

/** An opaque colour per frame, none of them grey like the checkerboard. */
function colourOf(index: number): Rgba {
    return [20 + 12 * index, 200 - 9 * index, 90 + (index % 5) * 30, 255];
}

/**
 * Opens a document of `count` frames of `width` × `height`, 100 ms each, every frame one
 * colour of its own (`colourOf`), frame 1 active, with the grids off; returns its id.
 */
function openAnimation(
    page: Page,
    options: { count: number; width: number; height: number; view: View },
): Promise<string> {
    const colours = Array.from({ length: options.count }, (_, index) => colourOf(index));
    return page.evaluate(
        async ({ count, width, height, view, colours }) => {
            const path = "/src/core/model/index.ts";
            const core = (await import(/* @vite-ignore */ path)) as typeof CoreModel;
            const session = core.createDocument({ name: "playback", width, height });
            const { doc } = session;
            const first = doc.frames[0]!;
            doc.frames = Array.from({ length: count }, (_, index) => ({
                id: index === 0 ? first.id : `frame-${index + 1}`,
                durationMs: 100,
            }));
            doc.frames.forEach((frame, index) => {
                const data = new Uint8ClampedArray(width * height * 4);
                const colour = colours[index]!;
                for (let at = 0; at < data.length; at += 4) data.set(colour, at);
                const imageId = `image-${index + 1}`;
                doc.images.set(imageId, { width, height, data });
                doc.cels.set(core.celKey(session.activeLayerId, frame.id), {
                    imageId,
                    opacity: 255,
                });
            });
            session.activeFrameId = first.id;
            doc.settings.pixelGrid = false;
            doc.settings.grid.visible = false;
            const state = window.__ngneTest!.sessions.getState();
            return state.open(session, { view }).id;
        },
        { ...options, colours },
    );
}

/** Makes playback read its time from `window.__se024.now`, starting at `at`. */
async function controlClock(page: Page, at: number): Promise<void> {
    await page.evaluate(async (at) => {
        const path = "/src/app/playback/playback.ts";
        const playback = (await import(/* @vite-ignore */ path)) as typeof PlaybackModule;
        window.__se024 = { playback, now: at };
        playback.playbackTime.now = () => window.__se024!.now;
    }, at);
}

function playing(page: Page): Promise<boolean> {
    return page.evaluate(() => window.__se024!.playback.editorPlayback.playing);
}

/** The 1-based number of the active frame. */
function activeFrame(page: Page): Promise<number> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const { doc, activeFrameId } = document.session;
        return doc.frames.findIndex((frame) => frame.id === activeFrameId) + 1;
    });
}

/**
 * Sets the clock to `at` and waits for playback's next step, which reads it, then for the
 * viewport to have drawn what the step made active.
 */
async function stepTo(page: Page, at: number): Promise<void> {
    const ticks = await page.evaluate((at) => {
        window.__se024!.now = at;
        return window.__se024!.playback.editorPlayback.ticks;
    }, at);
    await page.waitForFunction(
        ({ at, ticks }) => {
            const { editorPlayback } = window.__se024!.playback;
            return (
                !editorPlayback.playing ||
                (editorPlayback.ticks > ticks && editorPlayback.lastTick === at)
            );
        },
        { at, ticks },
        { polling: "raf" },
    );
    await settle(page);
}

/** The colour the viewport shows at device pixel `x`, `y`, read back in the page. */
function shownAt(page: Page, x: number, y: number): Promise<Rgba> {
    return page.evaluate(
        ({ x, y }) => {
            const image = window.__ngneTest!.viewport!.readCanvas();
            if (!image) throw new Error("se-024: the viewport has no ready renderer");
            const at = (y * image.width + x) * 4;
            return Array.from(image.data.subarray(at, at + 4)) as Rgba;
        },
        { x, y },
    );
}

const SMALL = { count: 8, width: 16, height: 16, view: { scale: 8, originX: 32, originY: 24 } };
/** The device pixel at the document's centre. */
const CENTRE = { x: 32 + 8 * 8, y: 24 + 8 * 8 };

test("an 8-frame, 100 ms animation shows each frame for its interval and loops at 800 ms", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openAnimation(page, SMALL);
    await settle(page);
    await controlClock(page, 0);

    // Enter on the canvas plays.
    await viewport(page).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => playing(page)).toBe(true);
    // The range fits: it is drawn from the ed:play grid, whatever its state at the first step.
    await page.waitForFunction(() => window.__ngneTest!.viewport!.playGrid?.cells === 8);
    await settle(page);
    const uploads = await page.evaluate(() => window.__ngneTest!.viewport!.textureCalls);

    const times = [0, 99, 100, 199, 200, 299, 300, 399, 400, 499, 500, 599, 600, 699, 700, 799];
    for (const time of [...times, ...times.map((time) => time + 800), 1600]) {
        await stepTo(page, time);
        const frame = Math.floor(time / 100) % 8;
        expect(await activeFrame(page), `${time} ms`).toBe(frame + 1);
        expect(await shownAt(page, CENTRE.x, CENTRE.y), `${time} ms`).toEqual(colourOf(frame));
    }
    // Every step came from the grid: not one upload.
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.textureCalls)).toBe(uploads);

    // Enter again pauses, on the frame on screen.
    await page.keyboard.press("Enter");
    await expect.poll(() => playing(page)).toBe(false);
    expect(await activeFrame(page)).toBe(1);
    expect(errors).toEqual([]);
});

test("starting a stroke during playback stops it on the displayed frame and paints there", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openAnimation(page, SMALL);
    await page.evaluate(() => {
        const editor = window.__ngneTest!.editor.getState();
        editor.setTool("pencil");
    });
    await settle(page);
    await controlClock(page, 0);
    await viewport(page).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => playing(page)).toBe(true);
    await stepTo(page, 350);
    expect(await activeFrame(page)).toBe(4);
    expect(await shownAt(page, CENTRE.x, CENTRE.y)).toEqual(colourOf(3));

    // A press on texel 2, 3: the stroke stops playback on frame 4 and paints it.
    const box = (await page.locator("[data-viewport-canvas]").boundingBox())!;
    const texel = { x: 32 + 2 * 8 + 4, y: 24 + 3 * 8 + 4 };
    await page.mouse.move(box.x + texel.x, box.y + texel.y);
    await page.mouse.down();
    await expect.poll(() => playing(page)).toBe(false);
    await page.mouse.up();
    // The clock goes on; nothing steps any more.
    await page.evaluate(() => (window.__se024!.now = 5000));
    await settle(page);
    expect(await activeFrame(page)).toBe(4);
    const painted = await page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const { doc, activeLayerId } = document.session;
        const pixel = (frame: number, x: number, y: number) => {
            const cel = doc.cels.get(`${activeLayerId}:${doc.frames[frame - 1]!.id}`)!;
            const image = doc.images.get(cel.imageId)!;
            const at = (y * image.width + x) * 4;
            return Array.from(image.data.subarray(at, at + 4));
        };
        return {
            label: document.history.undoLabel,
            foreground: window.__ngneTest!.editor.getState().foreground,
            frame4: pixel(4, 2, 3),
            frame4Other: pixel(4, 9, 9),
            frame5: pixel(5, 2, 3),
        };
    });
    expect(painted.label).toBe("Pencil");
    expect(painted.frame4).not.toEqual(colourOf(3));
    expect(painted.frame4Other).toEqual(colourOf(3));
    expect(painted.frame5).toEqual(colourOf(4));
    // On screen: frame 4 with the new texel.
    expect(await shownAt(page, CENTRE.x, CENTRE.y)).toEqual(colourOf(3));
    expect(await shownAt(page, texel.x, texel.y)).toEqual(painted.frame4);
    expect(errors).toEqual([]);
});

test("a range too large for ed:play still plays: frames may be skipped, none out of order", async ({
    page,
}) => {
    test.slow();
    const errors = collectErrors(page);
    await openEditor(page);
    // 17 frames of 1024 × 1024 are 68 MB: more than the 64 MB of ed:play (SPEC §6.4).
    const view = { scale: 0.25, originX: 16, originY: 16 };
    await openAnimation(page, { count: 17, width: 1024, height: 1024, view });
    await settle(page);
    await controlClock(page, 0);
    // Every frame the viewport submits from now on: the colour at the document's centre.
    await page.evaluate(
        ({ x, y }) => {
            const shown: number[][] = [];
            (window as unknown as { __se024shown: number[][] }).__se024shown = shown;
            window.__ngneTest!.viewport!.onFrame = (read) => {
                const image = read();
                const at = (y * image.width + x) * 4;
                shown.push(Array.from(image.data.subarray(at, at + 4)));
            };
        },
        { x: 16 + 128, y: 16 + 128 },
    );
    await viewport(page).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => playing(page)).toBe(true);

    // One pass, 1700 ms, in steps of 50 ms that do not wait for the uploads: frames are
    // skipped while the frame cache catches up.
    for (let time = 0; time < 1700; time += 50) {
        const ticks = await page.evaluate((time) => {
            window.__se024!.now = time;
            return window.__se024!.playback.editorPlayback.ticks;
        }, time);
        await page.waitForFunction(
            (ticks) => window.__se024!.playback.editorPlayback.ticks > ticks,
            ticks,
            { polling: "raf" },
        );
    }
    await settle(page);
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.playGrid)).toBeNull();
    expect(await activeFrame(page)).toBe(17);
    const shown = await page.evaluate(
        () => (window as unknown as { __se024shown: number[][] }).__se024shown,
    );
    await page.evaluate(() => (window.__ngneTest!.viewport!.onFrame = null));
    const colours = Array.from({ length: 17 }, (_, index) => colourOf(index).join(","));
    const frames = shown.map((colour) => colours.indexOf(colour.join(",")));
    // Every frame drawn showed a frame of the animation (never the checkerboard alone), in
    // playing order, and the last one drawn is the last frame.
    expect(frames, JSON.stringify(shown.slice(0, 5))).not.toContain(-1);
    for (let at = 1; at < frames.length; at++) {
        expect(frames[at]!, frames.join(" ")).toBeGreaterThanOrEqual(frames[at - 1]!);
    }
    expect(frames.at(-1)).toBe(16);
    expect(new Set(frames).size).toBeGreaterThan(2);
    await page.keyboard.press("Enter");
    await expect.poll(() => playing(page)).toBe(false);
    expect(errors).toEqual([]);
});

test("Play / Pause from Enter in the timeline and from the transport's button", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openAnimation(page, SMALL);
    await settle(page);
    await controlClock(page, 0);
    const play = timeline(page)
        .getByRole("group", { name: "Transport" })
        .locator('[data-command="frame.playPause"]');
    await expect(play).toBeEnabled();
    await expect(play).toHaveAccessibleName(/^Play/);

    // A focused cell leaves Enter to play / pause (SPEC §7.8).
    await activeCell(page).focus();
    await expect(activeCell(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => playing(page)).toBe(true);
    await expect(play).toHaveAccessibleName(/^Pause/);
    await stepTo(page, 250);
    expect(await activeFrame(page)).toBe(3);
    // The focus follows the active cell and stays in the timeline.
    await expect(activeCell(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => playing(page)).toBe(false);
    expect(await activeFrame(page)).toBe(3);

    // The transport's button: playback goes on from frame 3, at 250 ms on the clock.
    await play.click();
    await expect.poll(() => playing(page)).toBe(true);
    await stepTo(page, 450);
    expect(await activeFrame(page)).toBe(5);
    await play.click();
    await expect.poll(() => playing(page)).toBe(false);
    await expect(play).toHaveAccessibleName(/^Play/);
    expect(await activeFrame(page)).toBe(5);
    expect(errors).toEqual([]);
});
