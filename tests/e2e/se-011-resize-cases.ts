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
    viewportHost,
} from "./se-011-support";
import { clientAt, geometry } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { celPixel, historyOf, selectDot, withTexels } from "./se-014-support";
import { collapsePreview } from "./se-054-support";

// SE-011 on NGNE 0.3.0: a change of the viewport element's size resizes the renderer on screen
// (`renderer.resize`) and draws it in the same task; no renderer is made for it. After every
// size of a run of growing and shrinking windows, the canvas backing is the element's device
// size, NGNE draws the document where the view puts it (projection), the overlay has the same
// size (alignment), and a click paints the texel under the pointer. Declared once per device
// pixel ratio (se-011-resize-dpr*.spec.ts), each in a Chrome of its own.

const WIDTH = 32;
const HEIGHT = 24;
const VIEW: View = { scale: 8, originX: 40, originY: 32 };
const BLACK = [0, 0, 0, 255];
/** Window sizes, CSS pixels: each one grows or shrinks the element against the one before. */
const WINDOWS = [
    { width: 1600, height: 900 },
    { width: 1300, height: 740 },
    { width: 1700, height: 960 },
    { width: 1280, height: 720 },
    { width: 1500, height: 850 },
    { width: 1360, height: 780 },
    { width: 1650, height: 930 },
    { width: 1400, height: 800 },
];

/**
 * The element's device size once the shell has laid out after a resize: the size two reads,
 * two animation frames apart, agree on (the rail picks its columns a frame later, SE-014).
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

/** Devices the page made, and the renderers the viewport holds. */
function counters(page: Page) {
    return page.evaluate(() => ({
        devicesCreated: window.__se011.devicesCreated(),
        liveDevices: window.__se011.liveDevices(),
        liveRenderers: window.__ngneTest!.viewport!.liveRenderers,
        status: window.__ngneTest!.viewport!.status,
    }));
}

export function resizeTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        test("growing and shrinking the window resizes the renderer in place: projection, overlay and the texel under the pointer follow every size", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await page.setViewportSize({ width: 1280, height: 720 });
            await openViewportEditor(page);
            // SE-054: the preview panel's game has a device of its own; these counts are the
            // viewport's.
            await collapsePreview(page);
            const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
            let pixels = pattern(WIDTH, HEIGHT, 5);
            await paint(page, document.id, pixels);
            await selectDot(page);
            await settle(page);
            const before = await counters(page);
            expect(before).toMatchObject({ liveRenderers: 1, liveDevices: 1, status: "ready" });

            for (const [step, size] of WINDOWS.entries()) {
                await page.setViewportSize(size);
                const box = await laidOutDeviceSize(page);
                await settle(page);
                const message = `window ${size.width}×${size.height}`;
                // The renderer's logical size and the canvas backing are the element's device
                // size: one canvas, the one NGNE draws on, no stretch.
                expect(
                    await page.evaluate(() => window.__ngneTest!.viewport!.canvasSize),
                    message,
                ).toEqual(box);
                expect(
                    await viewportHost(page)
                        .locator("canvas")
                        .evaluateAll((all) =>
                            (all as HTMLCanvasElement[]).map((canvas) => ({
                                width: canvas.width,
                                height: canvas.height,
                            })),
                        ),
                    message,
                ).toEqual([box]);
                // The overlay has the same backing size over the same box.
                expect(
                    await page.evaluate(() => window.__ngneTest!.overlay!.canvasSize),
                    message,
                ).toEqual(box);
                // Projection: the document is where the view puts it, texel for texel.
                await expectImage(page, document, VIEW, pixels);

                // A click on a device pixel of a texel paints that texel. The texel moves on
                // with each size, along the document's diagonal.
                const target: Point = { x: 3 + step * 3, y: 2 + step * 2 };
                const layout = await geometry(page);
                expect(layout.device, message).toEqual(box);
                const device = {
                    x: VIEW.originX + target.x * VIEW.scale + 3,
                    y: VIEW.originY + target.y * VIEW.scale + 5,
                };
                const client = clientAt(layout, device);
                await page.mouse.move(client.x, client.y);
                await page.mouse.down();
                await page.mouse.up();
                expect(await celPixel(page, document.id, target), message).toEqual(BLACK);
                pixels = withTexels(pixels, WIDTH, [target], BLACK);
                await settle(page);
                await expectImage(page, document, VIEW, pixels);
            }

            expect(await historyOf(page, document.id)).toEqual({
                undo: 1 + WINDOWS.length,
                open: false,
            });
            // No renderer and no device was made for any size.
            expect(await counters(page)).toEqual(before);
            expect(errors).toEqual([]);
        });
    });
}
