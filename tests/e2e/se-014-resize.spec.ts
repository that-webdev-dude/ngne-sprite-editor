import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import {
    expectImage,
    hostDeviceSize,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
} from "./se-011-support";
import { clientAt, geometry } from "./se-012-support";
import type { View } from "./se-012-support";
import { celPixel, historyOf, selectDot, withTexels } from "./se-014-support";

// SE-014 decides which texel a stroke paints right after the viewport element changes size.
// With NGNE 0.3.0 the renderer is resized in the task the size is observed (SPEC §6.4): the
// canvas and the overlay take the element's device size at once, nothing is stretched, and a
// stroke paints the texel the element's box puts under the pointer — not the one a canvas
// still at its old size would have shown there. WebGPU devices are held from before the
// resize: the resize needs none, so nothing waits on them.

const WIDTH = 32;
const HEIGHT = 24;
const VIEW: View = { scale: 8, originX: 40, originY: 32 };
const BLACK = [0, 0, 0, 255];

/**
 * The element's device size once the shell has laid out after a resize. The shell lays out
 * again a frame later (the rail chooses its column count from its new height, which moves and
 * widens the viewport), so the size is the one two reads two animation frames apart agree on.
 */
async function laidOutDeviceSize(page: Page): Promise<{ width: number; height: number }> {
    let size = await hostDeviceSize(page);
    for (let read = 0; read < 20; read += 1) {
        await page.evaluate(
            () =>
                new Promise<void>((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                ),
        );
        const next = await hostDeviceSize(page);
        if (next.width === size.width && next.height === size.height) return size;
        size = next;
    }
    throw new Error("the viewport element kept changing size after the resize");
}

test("right after a resize the canvases have the new size, and a stroke paints the texel under the pointer", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    const pixels = pattern(WIDTH, HEIGHT, 7);
    await paint(page, document.id, pixels);
    await selectDot(page);
    await settle(page);

    // A larger window: the element grows. No device is to be had meanwhile.
    const backing = await page.evaluate(() => window.__ngneTest!.overlay!.canvasSize);
    const created = await page.evaluate(() => window.__se011.devicesCreated());
    await page.evaluate(() => window.__se011.holdDevices());
    await page.setViewportSize({ width: 1600, height: 900 });
    const box = await laidOutDeviceSize(page);
    // At once: the overlay and NGNE's canvas have the element's device size.
    expect(await page.evaluate(() => window.__ngneTest!.overlay!.canvasSize)).toEqual(box);
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.canvasSize)).toEqual(box);
    expect(backing.width).toBeLessThan(box.width);
    expect(backing.height).toBeLessThan(box.height);
    const layout = await geometry(page);
    expect(layout.device).toEqual(box);

    // The centre of a device pixel of the element over the document, and the pixel a canvas
    // still at the old size, stretched over the box, would have shown there.
    const device = { x: 250.5, y: 180.5 };
    const shown = {
        x: Math.floor((device.x * backing.width) / box.width),
        y: Math.floor((device.y * backing.height) / box.height),
    };
    const texelShown = {
        x: Math.floor((shown.x - VIEW.originX) / VIEW.scale),
        y: Math.floor((shown.y - VIEW.originY) / VIEW.scale),
    };
    const texelByBox = {
        x: Math.floor((device.x - VIEW.originX) / VIEW.scale),
        y: Math.floor((device.y - VIEW.originY) / VIEW.scale),
    };
    expect(texelShown).not.toEqual(texelByBox);
    const client = clientAt(layout, device);
    await page.mouse.move(client.x, client.y);
    await page.mouse.down();
    await page.mouse.up();

    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    expect(await celPixel(page, document.id, texelByBox)).toEqual(BLACK);
    expect(await celPixel(page, document.id, texelShown)).not.toEqual(BLACK);
    // No device was asked for: the renderer was resized, not replaced.
    expect(await page.evaluate(() => window.__se011.devicesCreated())).toBe(created);
    expect(await page.evaluate(() => window.__se011.creatingDevices())).toBe(0);

    await settle(page);
    await expectImage(page, document, VIEW, withTexels(pixels, WIDTH, [texelByBox], BLACK));
    await page.evaluate(() => window.__se011.releaseDevices());
    expect(errors).toEqual([]);
});
