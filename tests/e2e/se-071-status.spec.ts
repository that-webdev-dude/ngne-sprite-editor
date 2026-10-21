import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { boxOf, collectErrors, region } from "./se-006-support";
import { openEditor, openSession } from "./se-007-support";
import { settle } from "./se-011-support";
import { cursorField, viewportArea } from "./se-012-support";

// SE-071 (from the SE-011 and SE-012 reviews): the cursor field of the status bar keeps its
// place. It is not rendered while the pointer is off the document, and its text changes width
// with the position; neither moves the fields after it (DESIGN §5.7).

/** The left edge of every field after the cursor, by name. */
function fieldEdges(page: Page): Promise<Record<string, number>> {
    return region(page, "status-bar").evaluate((bar) =>
        Object.fromEntries(
            Array.from(bar.querySelectorAll<HTMLElement>("[data-status], [data-status-action]"))
                .filter((field) => field.dataset.status !== "cursor")
                .map((field) => [
                    field.dataset.status ?? field.dataset.statusAction ?? "",
                    field.getBoundingClientRect().left,
                ]),
        ),
    );
}

function setCursor(page: Page, cursor: { x: number; y: number } | null): Promise<void> {
    return page.evaluate(
        (cursor) => window.__ngneTest!.status.getState().setCursor(cursor),
        cursor,
    );
}

test("the fields after the cursor stay in place while the pointer crosses the document's edge", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openSession(page, { name: "hero", width: 32, height: 32 });
    await settle(page);
    const view = await boxOf(viewportArea(page));

    // Off the document, in the workspace: no cursor field.
    await page.mouse.move(view.x + 4, view.y + 4);
    await expect(cursorField(page)).toHaveCount(0);
    const blank = await fieldEdges(page);
    expect(Object.keys(blank)).toEqual(
        expect.arrayContaining(["size", "zoom", "frame", "duration"]),
    );

    // Over the document: the cursor field, and the others where they were.
    await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
    await expect(cursorField(page)).toHaveText(/^\d+, \d+$/);
    expect(await fieldEdges(page)).toEqual(blank);

    await page.mouse.move(view.x + 4, view.y + 4);
    await expect(cursorField(page)).toHaveCount(0);
    expect(await fieldEdges(page)).toEqual(blank);
    expect(errors).toEqual([]);
});

test("the widest position of the largest document fits the cursor's place", async ({ page }) => {
    await openEditor(page);
    // SPEC §5.1: a side is at most 1024 px.
    await openSession(page, { name: "large", width: 1024, height: 1024 });
    await setCursor(page, null);
    await expect(cursorField(page)).toHaveCount(0);
    const blank = await fieldEdges(page);
    for (const cursor of [
        { x: 0, y: 0 },
        { x: 1023, y: 1023 },
        { x: 511, y: 7 },
        { x: 1000, y: 888 },
    ]) {
        await setCursor(page, cursor);
        await expect(cursorField(page)).toHaveText(`${cursor.x}, ${cursor.y}`);
        expect(await fieldEdges(page), `${cursor.x}, ${cursor.y}`).toEqual(blank);
    }
    // The text is not cut: the field holds all of it.
    await setCursor(page, { x: 1023, y: 1023 });
    expect(
        await cursorField(page).evaluate((field) => field.scrollWidth <= field.clientWidth),
    ).toBe(true);
});
