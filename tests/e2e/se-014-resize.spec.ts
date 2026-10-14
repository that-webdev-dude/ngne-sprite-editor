import { expect, test } from "@playwright/test";
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

// SE-014 decides which texel a stroke paints during NGNE's resize quiet: after the viewport
// element changes size NGNE keeps its old canvas on screen, stretched over the new box, until
// the replacement has drawn (SPEC §6.4), and the overlay is stretched alike (SPEC §6.3). A
// stroke then paints the texel shown under the pointer — the overlay's `cursor.pixel` — not
// the one the element's box would put there. Here the replacement is held back (no WebGPU
// device until released), so the stretch lasts as long as the test needs it.

const WIDTH = 32;
const HEIGHT = 24;
const VIEW: View = { scale: 8, originX: 40, originY: 32 };
const BLACK = [0, 0, 0, 255];

test("while NGNE stretches its old canvas after a resize, a stroke paints the texel shown under the pointer", async ({
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

    // A larger window: the element grows, NGNE's replacement waits for its device.
    await page.evaluate(() => window.__se011.holdDevices());
    await page.setViewportSize({ width: 1600, height: 900 });
    const box = await hostDeviceSize(page);
    await expect
        .poll(() => page.evaluate(() => window.__ngneTest!.overlay!.canvasSize))
        .not.toEqual(box);
    const backing = await page.evaluate(() => window.__ngneTest!.overlay!.canvasSize);
    expect(backing.width).toBeLessThan(box.width);
    expect(backing.height).toBeLessThan(box.height);
    const layout = await geometry(page);

    // The centre of a device pixel of the element over the document, and the canvas pixel
    // shown there.
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
    expect(await celPixel(page, document.id, texelShown)).toEqual(BLACK);
    expect(await celPixel(page, document.id, texelByBox)).not.toEqual(BLACK);
    // Still stretched: the stroke was made in the quiet.
    expect(await page.evaluate(() => window.__ngneTest!.overlay!.canvasSize)).toEqual(backing);

    await page.evaluate(() => window.__se011.releaseDevices());
    await settle(page);
    await expectImage(page, document, VIEW, withTexels(pixels, WIDTH, [texelShown], BLACK));
    expect(errors).toEqual([]);
});
