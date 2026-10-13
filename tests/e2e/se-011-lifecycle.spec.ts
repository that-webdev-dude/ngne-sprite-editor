import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as ThemeModule from "../../src/ui/theme/theme";
import { decodePng } from "../../src/core/png";
import { boxOf, collectErrors } from "./se-006-support";
import {
    captures,
    compare,
    DARK,
    documentRect,
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
    shows,
    viewportHost,
} from "./se-011-support";
import type { Checker } from "./se-011-support";

// SE-011: the life of the renderer — sizing by replacement, drawing on demand, device loss,
// a failed renderer — and the preferences and theme the viewport reads.

const VIEW = { scale: 8, originX: 40, originY: 24 };
const SIZE = { width: 5, height: 3 };
const IMAGE = pattern(SIZE.width, SIZE.height, 2);

/** Opens the editor with the painted 5×3 test document on show. */
async function openPainted(page: Page) {
    await openViewportEditor(page);
    const document = await openDocument(page, SIZE, VIEW);
    await paint(page, document.id, IMAGE);
    await settle(page);
    await expectImage(page, document, VIEW, IMAGE);
    return document;
}

/** Counters of the viewport and of the page's WebGPU devices. */
function counters(page: Page) {
    return page.evaluate(() => {
        const probe = window.__ngneTest!.viewport!;
        return {
            submittedFrames: probe.submittedFrames,
            textureCalls: probe.textureCalls,
            liveRenderers: probe.liveRenderers,
            status: probe.status,
            liveDevices: window.__se011.liveDevices(),
            devicesCreated: window.__se011.devicesCreated(),
        };
    });
}

/** Backing sizes of the canvases inside the viewport element. */
function canvases(page: Page) {
    return viewportHost(page)
        .locator("canvas")
        .evaluateAll((all) =>
            (all as HTMLCanvasElement[]).map((canvas) => ({
                width: canvas.width,
                height: canvas.height,
            })),
        );
}

test("resizing the window 20 times leaves exactly one live renderer and a correct image", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await openPainted(page);
    const start = await counters(page);
    expect(start).toMatchObject({ liveRenderers: 1, liveDevices: 1, status: "ready" });

    for (let step = 0; step < 20; step++) {
        await page.setViewportSize({
            width: 1280 + ((step * 74) % 420),
            height: 720 + ((step * 46) % 200),
        });
        // Some resizes are left to settle; the others are overtaken by the next one, while
        // the replacement for them is waiting or under way.
        if (step % 3 === 0) {
            await settle(page);
            await expectImage(page, document, VIEW, IMAGE);
            expect(await counters(page)).toMatchObject({ liveRenderers: 1, liveDevices: 1 });
        } else if (step % 3 === 1) {
            await page.waitForTimeout(140);
        }
    }
    await settle(page);

    const end = await counters(page);
    expect(end).toMatchObject({ liveRenderers: 1, liveDevices: 1, status: "ready" });
    // The renderer was replaced, not kept: each settled size made a new device.
    expect(end.devicesCreated - start.devicesCreated).toBeGreaterThanOrEqual(7);
    const host = await boxOf(viewportHost(page));
    expect(await canvases(page)).toEqual([{ width: host.width, height: host.height }]);
    await expectImage(page, document, VIEW, IMAGE);
    expect(errors).toEqual([]);
});

/** What the window shows over the document rectangle, from a screenshot (SPEC §6.7). */
async function onScreen(page: Page, rect: { x: number; y: number; width: number; height: number }) {
    const host = await boxOf(viewportHost(page));
    const clip = { ...rect, x: host.x + rect.x, y: host.y + rect.y };
    const shot = await decodePng(await page.screenshot({ clip }));
    expect({ width: shot.width, height: shot.height }).toEqual({
        width: rect.width,
        height: rect.height,
    });
    return { ...rect, data: [...shot.data] };
}

const twoFrames = (page: Page) =>
    page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );

test("the window shows the image the new renderer drew before the swap, and still after the shell was hidden", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await openPainted(page);
    const rect = documentRect(document, VIEW);
    expect(compare(await onScreen(page, rect), IMAGE, SIZE.width, VIEW.scale)).toEqual([]);

    // A new size: the new canvas draws once, off the page, and is swapped in. Nothing is
    // drawn afterwards, so the screen shows that one frame.
    await page.setViewportSize({ width: 1400, height: 800 });
    await settle(page);
    const swapped = await counters(page);
    await twoFrames(page);
    expect(await counters(page)).toEqual(swapped);
    expect(compare(await onScreen(page, rect), IMAGE, SIZE.width, VIEW.scale)).toEqual([]);

    // Below the minimum window size the shell is hidden and the viewport element has no
    // size: the renderer is kept, and its image is on screen again afterwards.
    await page.setViewportSize({ width: 1000, height: 600 });
    await expect(viewportHost(page)).toBeHidden();
    await page.waitForTimeout(300);
    expect(await counters(page)).toMatchObject({ liveRenderers: 1, liveDevices: 1 });
    await page.setViewportSize({ width: 1400, height: 800 });
    await expect(viewportHost(page)).toBeVisible();
    await settle(page);
    await twoFrames(page);
    expect(await counters(page)).toMatchObject({
        liveRenderers: 1,
        liveDevices: 1,
        devicesCreated: swapped.devicesCreated,
    });
    expect(compare(await onScreen(page, rect), IMAGE, SIZE.width, VIEW.scale)).toEqual([]);
    expect(errors).toEqual([]);
});

test("with no state change for 2 s, zero frames are submitted", async ({ page }) => {
    const errors = collectErrors(page);
    await openPainted(page);
    const before = await counters(page);
    // Two status checks fall into the wait; reading the status submits nothing.
    await page.waitForTimeout(2200);
    expect(await counters(page)).toEqual(before);
    expect(errors).toEqual([]);
});

test("a device lost while the window is focused and idle is followed by a correct image within 3 s, without input", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await openPainted(page);
    const rect = documentRect(document, VIEW);
    await page.bringToFront();
    const before = await counters(page);

    // The method of SE-002 question 8: `destroy()` on the device NGNE got from the wrapped
    // `requestDevice`. From here on the test only waits.
    const lostAt = await page.evaluate((rect) => {
        window.__se011.record(rect);
        window.__se011.loseDevice();
        return performance.now();
    }, rect);
    await page.waitForTimeout(3000);

    const frames = await captures(page);
    const redrawn = frames.find(
        (frame) => shows(frame.crop, [IMAGE], SIZE.width, VIEW.scale) === 0,
    );
    expect(redrawn).toBeDefined();
    expect((redrawn?.at ?? Infinity) - lostAt).toBeLessThanOrEqual(3000);
    // NGNE recovered on a new device: the same renderer, and its slots show their content.
    const after = await counters(page);
    expect(after).toMatchObject({ liveRenderers: 1, liveDevices: 1, status: "ready" });
    expect(after.devicesCreated).toBe(before.devicesCreated + 1);
    expect(after.textureCalls).toBe(before.textureCalls);
    expect(after.submittedFrames).toBeGreaterThan(before.submittedFrames);
    await expectImage(page, document, VIEW, IMAGE);
    expect(errors).toEqual([]);
});

test("a renderer that fails is replaced by a fresh one, and its error is shown once", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await openPainted(page);
    const failure = /WebGPU recovery failed/;
    const toasts = page.getByRole("alert").filter({ hasText: failure });

    for (let round = 0; round < 2; round++) {
        const before = await counters(page);
        await viewportHost(page)
            .locator("canvas")
            .evaluate((canvas) => canvas.setAttribute("data-before-failure", ""));
        // The device is lost and NGNE cannot get another: the renderer ends as `failed`.
        await page.evaluate(() => {
            window.__se011.refuseDevices(1);
            window.__se011.loseDevice();
        });

        // A new renderer on a new canvas takes over, with the same image.
        await expect(viewportHost(page).locator("canvas[data-before-failure]")).toHaveCount(0);
        await settle(page);
        const after = await counters(page);
        expect(after).toMatchObject({ liveRenderers: 1, liveDevices: 1, status: "ready" });
        expect(after.devicesCreated).toBe(before.devicesCreated + 1);
        expect(await canvases(page)).toHaveLength(1);
        await expectImage(page, document, VIEW, IMAGE);

        // The diagnostic is a toast and a console error, once: the second failure has the
        // same message and adds neither.
        await expect(toasts).toHaveCount(1);
        await expect(toasts).toHaveText(
            "Viewport: WebGPU recovery failed. Reload to create a new renderer",
        );
        expect(errors.filter((line) => failure.test(line))).toHaveLength(1);
        expect(errors).toHaveLength(1);
    }
});

test("the checkerboard follows the preference and the theme", async ({ page }) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    // Half transparent everywhere: the checkerboard shows through every texel.
    const size = 8;
    const view = { scale: 4, originX: 16, originY: 16 };
    const pixels = Array.from({ length: size * size }, () => [240, 20, 60, 128]).flat();
    const document = await openDocument(page, { width: size, height: size }, view);
    await paint(page, document.id, pixels);
    await settle(page);
    const dark: Checker = { a: DARK.checkerA, b: DARK.checkerB, size: 8 };
    await expectImage(page, document, view, pixels, dark);

    // Size and colours from the preference store.
    const custom: Checker = { a: [0x10, 0x90, 0x30], b: [0xf0, 0xe0, 0x20], size: 3 };
    await page.evaluate(() =>
        window.__ngneTest!.preferences.set("checkerboard", {
            size: 3,
            colors: { a: 0x109030, b: 0xf0e020 },
        }),
    );
    await settle(page);
    await expectImage(page, document, view, pixels, custom);

    // Back to the theme's colours, then to the light theme: checkerboard and workspace
    // (DESIGN §3.1) follow.
    await page.evaluate(() =>
        window.__ngneTest!.preferences.set("checkerboard", { size: 2, colors: "theme" }),
    );
    await settle(page);
    await expectImage(page, document, view, pixels, { ...dark, size: 2 });
    await page.evaluate(async () => {
        const path = "/src/ui/theme/theme.ts";
        const theme = (await import(/* @vite-ignore */ path)) as typeof ThemeModule;
        theme.setTheme("light");
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const light: Checker = { a: [0xc8, 0xc8, 0xc8], b: [0xff, 0xff, 0xff], size: 2 };
    // The interface hands the theme's colours over in an effect, after the attribute.
    await expect(async () => {
        await settle(page);
        await expectImage(page, document, view, pixels, light, [0xd9, 0xd9, 0xdb]);
    }).toPass();
    expect(errors).toEqual([]);
});
