import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import {
    activeCell,
    afterFrames,
    documentState,
    expectFocusOn,
    grid,
    scroller,
} from "./se-022-support";
import { openCels } from "./se-026-support";

// SE-026: virtualized rendering of the timeline grid — with 200 frames × 30 layers, at most the
// cells in view plus one screen of overscan are in the DOM, every cell in view is there, and the
// keyboard and the scroll bars still reach every cell. (The scroll frame rate is measured by
// tests/perf/se-026-timeline-scroll.perf.ts.)

const LAYERS = 30;
const FRAMES = 200;

/**
 * The cels' cells in the DOM, and those in view: the frame columns and the layer rows that
 * show between the layer column, the parts that stick to the top and the scroller's edges
 * (cut ones count), as the headers lie — every row and frame header is rendered.
 */
function census(page: Page) {
    return scroller(page).evaluate((panel) => {
        const box = panel.getBoundingClientRect();
        const left = panel
            .querySelector('[role="row"][data-layer] [role="rowheader"]')!
            .getBoundingClientRect().right;
        const top = Math.max(
            ...[...panel.querySelectorAll(".timeline__bar, .timeline__row--header")].map(
                (sticky) => sticky.getBoundingClientRect().bottom,
            ),
        );
        const right = box.left + panel.clientLeft + panel.clientWidth;
        const bottom = box.top + panel.clientTop + panel.clientHeight;
        const columns = [...panel.querySelectorAll(".timeline__frame")]
            .map((header, index) => ({ index, box: header.getBoundingClientRect() }))
            .filter(({ box }) => box.right > left && box.left < right)
            .map(({ index }) => index);
        const rows = [...panel.querySelectorAll('[role="row"][data-layer]')]
            .map((row) => ({ row: row as HTMLElement, box: row.getBoundingClientRect() }))
            .filter(({ box }) => box.bottom > top && box.top < bottom);
        // Every cell in view is rendered.
        const missing: string[] = [];
        for (const { row } of rows) {
            for (const column of columns) {
                const found = row.querySelector(`[role="gridcell"][aria-colindex="${column + 2}"]`);
                if (!found) missing.push(`${row.dataset.layer}/${column + 1}`);
            }
        }
        return {
            rendered: panel.querySelectorAll('[role="gridcell"]').length,
            inView: columns.length * rows.length,
            columns: columns.length,
            rows: rows.length,
            missing,
        };
    });
}

/** Scrolls the panel and waits until two equal size reads and the frames that draw it pass. */
async function scrollTo(page: Page, left: number, top: number): Promise<void> {
    await scroller(page).evaluate(
        (element, { left, top }) => {
            element.scrollLeft = left * (element.scrollWidth - element.clientWidth);
            element.scrollTop = top * (element.scrollHeight - element.clientHeight);
        },
        { left, top },
    );
    await afterFrames(page, 2);
}

test("with 200 frames × 30 layers, at most the cells in view plus one screen of overscan are in the DOM, and every cell in view is", async ({
    page,
}) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await openCels(page, LAYERS, FRAMES);
    // The panel is shorter than 30 rows and narrower than 200 columns.
    const size = await scroller(page).evaluate((element) => ({
        across: element.scrollWidth > element.clientWidth,
        down: element.scrollHeight > element.clientHeight,
    }));
    expect(size).toEqual({ across: true, down: true });

    for (const [left, top] of [
        [0, 0],
        [0.5, 0.5],
        [1, 1],
        [0.25, 1],
        [1, 0],
        [0.73, 0.31],
    ] as const) {
        await scrollTo(page, left, top);
        await expect.poll(async () => (await census(page)).missing, `${left}, ${top}`).toEqual([]);
        const counted = await census(page);
        // One screen of overscan: the cells in view twice over, plus the active cell, which is
        // rendered wherever it is.
        expect(counted.rendered, JSON.stringify(counted)).toBeLessThanOrEqual(
            2 * counted.inView + 1,
        );
        expect(counted.rendered).toBeGreaterThanOrEqual(counted.inView);
        expect(counted.rendered).toBeLessThan(LAYERS * FRAMES);
    }
    // Every row header and frame number stays rendered.
    await expect(grid(page).getByRole("rowheader")).toHaveCount(LAYERS);
    await expect(grid(page).locator(".timeline__frame")).toHaveCount(FRAMES);
    expect(errors).toEqual([]);
});

test("the keyboard reaches every cell of a large grid: End, Home and the arrows keep the active cell rendered, focused and in view", async ({
    page,
}) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await openCels(page, LAYERS, FRAMES);
    const state = await documentState(page);
    expect(state.activeFrame).toBe(1);

    await activeCell(page).focus();
    await page.keyboard.press("End");
    await expectFocusOn(page, state.activeLayer, FRAMES);
    await expect.poll(async () => (await census(page)).missing).toEqual([]);
    await page.keyboard.press("ArrowDown");
    await expect
        .poll(async () => (await documentState(page)).activeLayer)
        .not.toBe(state.activeLayer);
    const below = (await documentState(page)).activeLayer;
    await expectFocusOn(page, below, FRAMES);
    await page.keyboard.press("Home");
    await expectFocusOn(page, below, 1);
    await expect.poll(async () => (await census(page)).missing).toEqual([]);

    // Scrolled away from it, the active cell stays rendered; the next key brings it back.
    await scrollTo(page, 1, 1);
    await expect(activeCell(page)).toHaveCount(1);
    await expect(activeCell(page)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expectFocusOn(page, below, 2);
    const inView = await activeCell(page).evaluate((cell) => {
        const panel = cell.closest("[data-timeline]")!.getBoundingClientRect();
        const box = cell.getBoundingClientRect();
        return box.left >= panel.left && box.right <= panel.right;
    });
    expect(inView).toBe(true);
    expect(errors).toEqual([]);
});
