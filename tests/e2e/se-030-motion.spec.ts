import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openDocument, openViewportEditor, settle } from "./se-011-support";
import { twoFrames, viewportArea } from "./se-012-support";
import { overlaySettled, redraws, setGrids } from "./se-013-support";
import { antsState } from "./se-030-support";

// SE-030: the ants march 8 steps per second (DESIGN §6) on a timer that exists only while
// the active document has a selection and motion is allowed, so an idle editor redraws
// nothing (SE-013). The overlay's redraws are counted, so the test runs alone (@alone, SPEC
// §6.7): beside other workers its frames come late. Each change waits for the state it
// causes before the next.

/** Steps marched and redraws made over `ms` milliseconds of the page's clock. */
async function over(page: Page, ms: number): Promise<{ steps: number; redraws: number }> {
    const start = { steps: (await antsState(page)).steps, redraws: await redraws(page) };
    await page.waitForTimeout(ms);
    return {
        steps: (await antsState(page)).steps - start.steps,
        redraws: (await redraws(page)) - start.redraws,
    };
}

/** Asserts that for `ms` milliseconds nothing marches and nothing is redrawn. */
async function still(page: Page, ms: number): Promise<void> {
    await overlaySettled(page);
    expect(await over(page, ms)).toEqual({ steps: 0, redraws: 0 });
}

test("the ants march 8 steps per second only while there is a selection and motion is allowed @alone", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // The pointer rests outside the viewport.
    await page.mouse.move(1, 1);
    await openViewportEditor(page);
    const document = await openDocument(
        page,
        { width: 16, height: 12 },
        {
            scale: 8,
            originX: 40,
            originY: 24,
        },
    );
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    await settle(page);

    // No selection: no timer, no redraw.
    expect((await antsState(page)).animating).toBe(false);
    await still(page, 1000);

    // Select All: the timer runs, about 8 steps a second, each asking for a redraw.
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Control+KeyA");
    await expect.poll(async () => (await antsState(page)).animating).toBe(true);
    const marching = await over(page, 2000);
    expect(marching.steps).toBeGreaterThanOrEqual(12);
    expect(marching.steps).toBeLessThanOrEqual(18);
    // A redraw per step, two steps in one animation frame at most now and then.
    expect(marching.redraws).toBeGreaterThanOrEqual(marching.steps / 2);
    expect(marching.redraws).toBeLessThanOrEqual(marching.steps + 1);

    // Reduced motion: the dashes stand still; no timer, no redraw.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(async () => (await antsState(page)).animating).toBe(false);
    await twoFrames(page);
    await still(page, 2000);

    // Motion allowed again: they march again.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(async () => (await antsState(page)).animating).toBe(true);
    expect((await over(page, 500)).steps).toBeGreaterThan(0);

    // Deselect: the timer is gone, and the editor is idle again.
    await page.keyboard.press("Control+KeyD");
    await expect.poll(async () => (await antsState(page)).animating).toBe(false);
    await twoFrames(page);
    await still(page, 2000);
    expect(errors).toEqual([]);
});
