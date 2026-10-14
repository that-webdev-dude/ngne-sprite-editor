import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import {
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    setView,
    settle,
} from "./se-011-support";
import { clientAt, geometry, twoFrames } from "./se-012-support";
import { overlaySettled, redraws, setGrids } from "./se-013-support";

// SE-013: the overlay redraws only when the view or the cursor changes or a draw layer asks
// for it, and an idle overlay redraws nothing. The redraws are counted by the overlay's test
// hook, so the test runs alone (@alone, SPEC §6.7): beside other workers its frames come late.
// Each step waits for the redraw it causes, and for two more frames, before the next one: on a
// slow runner two requests could otherwise share one frame.

/** Waits until the overlay has redrawn `count` times in all, then two more frames. */
async function redrawnTo(page: Page, count: number): Promise<void> {
    await expect.poll(() => redraws(page)).toBe(count);
    await twoFrames(page);
    expect(await redraws(page)).toBe(count);
}

test("with no view or cursor change for 2 s the overlay performs no redraw; each change redraws it once @alone", async ({
    page,
}) => {
    const errors = collectErrors(page);
    // The pointer rests outside the viewport.
    await page.mouse.move(1, 1);
    await openViewportEditor(page);
    const view = { scale: 8, originX: 40, originY: 24 };
    const document = await openDocument(page, { width: 32, height: 24 }, view);
    await paint(page, document.id, pattern(32, 24, 5));
    await overlaySettled(page);
    const layout = await geometry(page);

    // Idle for 2 s: no redraw. The NGNE viewport reads its renderer's status meanwhile (once a
    // second); that is no change the overlay follows.
    let count = await redraws(page);
    await page.waitForTimeout(2000);
    expect(await redraws(page)).toBe(count);

    // Pixels only: a history step, drawn by NGNE, leaves the overlay alone.
    await paint(page, document.id, pattern(32, 24, 6));
    await settle(page);
    await twoFrames(page);
    expect(await redraws(page)).toBe(count);

    // The view: one redraw.
    await setView(page, document.id, { ...view, originX: 41 });
    await redrawnTo(page, ++count);
    await setView(page, document.id, { ...view, scale: 12 });
    await redrawnTo(page, ++count);

    // The cursor: one redraw when it enters the viewport and one for each move to another
    // device pixel; one when it leaves.
    const inside = clientAt(layout, { x: 120, y: 90 });
    await page.mouse.move(inside.x, inside.y);
    await redrawnTo(page, ++count);
    await page.mouse.move(inside.x + 3, inside.y + 1);
    await redrawnTo(page, ++count);
    await page.mouse.move(1, 1);
    await redrawnTo(page, ++count);

    // A setting a draw layer follows (the pixel grid): the layer asks for one redraw.
    await setGrids(page, document.id, { pixelGrid: false });
    await redrawnTo(page, ++count);
    await setGrids(page, document.id, { grid: { visible: true } });
    await redrawnTo(page, ++count);
    // A setting no layer draws from: none.
    await page.evaluate((id) => {
        window.__ngneTest!.sessions.getState().updateDocSettings(id, (settings) => {
            settings.onion.enabled = true;
        });
    }, document.id);
    await twoFrames(page);
    expect(await redraws(page)).toBe(count);

    // Idle again, with the pointer resting over the viewport: no redraw for 2 s.
    await page.mouse.move(inside.x, inside.y);
    await redrawnTo(page, ++count);
    await page.waitForTimeout(2000);
    expect(await redraws(page)).toBe(count);
    expect(errors).toEqual([]);
});
