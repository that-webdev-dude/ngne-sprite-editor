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
// cells and frame numbers in view plus one screen of overscan are in the DOM, every cell and
// number in view is there, each cell under its number, and the keyboard and the scroll bars still
// reach every cell. The row headers all stay rendered. (The scroll frame rate is measured by
// tests/perf/se-026-timeline-scroll.perf.ts.)

const LAYERS = 30;
const FRAMES = 200;

/**
 * The cels' cells and frame numbers in the DOM, and those in view: the frame columns and the
 * layer rows that show between the layer column, the parts that stick to the top and the
 * scroller's edges (cut ones count). Columns are found by geometry: column i starts i × 24 px
 * right of the header row's left plus the layer column; rows by their headers, which are all
 * rendered. `missing` lists cells and numbers in view that are not rendered, and cells that do
 * not lie under their frame number.
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
        const headerRow = panel.querySelector(".timeline__row--header")!;
        const corner = headerRow.querySelector<HTMLElement>(".timeline__corner")!;
        const columnZero = headerRow.getBoundingClientRect().left + corner.offsetWidth;
        const frames =
            Number(panel.querySelector('[role="grid"]')!.getAttribute("aria-colcount")) - 1;
        const columns: number[] = [];
        for (let index = 0; index < frames; index++) {
            const start = columnZero + index * 24;
            if (start + 24 > left && start < right) columns.push(index);
        }
        const headerOf = (column: number) =>
            headerRow.querySelector(`.timeline__frame[aria-colindex="${column + 2}"]`);
        const rows = [...panel.querySelectorAll('[role="row"][data-layer]')]
            .map((row) => ({ row: row as HTMLElement, box: row.getBoundingClientRect() }))
            .filter(({ box }) => box.bottom > top && box.top < bottom);
        // Every cell and frame number in view is rendered, each cell under its number.
        const missing: string[] = [];
        for (const column of columns) {
            if (!headerOf(column)) missing.push(`number ${column + 1}`);
        }
        for (const { row } of rows) {
            for (const column of columns) {
                const found = row.querySelector(`[role="gridcell"][aria-colindex="${column + 2}"]`);
                const header = headerOf(column);
                if (!found) missing.push(`${row.dataset.layer}/${column + 1}`);
                else if (
                    header &&
                    Math.abs(
                        found.getBoundingClientRect().left - header.getBoundingClientRect().left,
                    ) > 0.5
                ) {
                    missing.push(`${row.dataset.layer}/${column + 1} not under its number`);
                }
            }
        }
        return {
            rendered: panel.querySelectorAll('[role="gridcell"]').length,
            inView: columns.length * rows.length,
            headers: panel.querySelectorAll(".timeline__frame").length,
            columns: columns.length,
            rows: rows.length,
            missing,
        };
    });
}

/** Scrolls the panel and waits for the two animation frames that draw it. */
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
        // The frame numbers likewise: those in view twice over, plus the active cel's.
        expect(counted.headers, JSON.stringify(counted)).toBeLessThanOrEqual(
            2 * counted.columns + 1,
        );
        expect(counted.headers).toBeGreaterThanOrEqual(counted.columns);
    }
    // Every row header stays rendered.
    await expect(grid(page).getByRole("rowheader")).toHaveCount(LAYERS);
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
