import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { boxOf, collectErrors, region } from "./se-006-support";
import { openEditor, rename } from "./se-007-support";
import { dialogButton } from "./se-008-support";
import { settle } from "./se-011-support";
import {
    discardDialog,
    documentName,
    drawStroke,
    emptyState,
    unsavedMarker,
} from "./se-041-support";
import {
    activeId,
    cacheBytes,
    compositesOf,
    documentIds,
    liesWithin,
    openTab,
    overflowButton,
    settleSize,
    tabList,
    tabOf,
    tabs,
} from "./se-047-support";

// SE-047: document tabs in the menu bar as the user works with them (DESIGN §2): each tab its
// own document and history, the close question once per dirty tab, the empty state after the
// last tab, only the active document's composites kept, middle-click close, reorder with the
// pointer and the keyboard, and twelve tabs at the minimum window width.

const STROKE_A = [
    { x: 1, y: 1 },
    { x: 9, y: 6 },
];
const STROKE_B = [
    { x: 2, y: 10 },
    { x: 14, y: 3 },
];

const viewportFocus = (page: Page) => page.locator("[data-viewport-focus]");

/** Whether any byte of any frame differs between two composites. */
const differs = (a: number[][], b: number[][]) => JSON.stringify(a) !== JSON.stringify(b);

test("two documents: drawing in one leaves the other's composite unchanged, and undo acts on the active tab only", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const hero = await openTab(page, "hero");
    const villain = await openTab(page, "villain");
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabOf(page, villain)).toHaveAttribute("aria-selected", "true");
    await expect(tabOf(page, hero)).toHaveAttribute("aria-selected", "false");
    await expect(documentName(page)).toHaveText("villain");

    const heroBlank = await compositesOf(page, hero);
    const villainBlank = await compositesOf(page, villain);
    await drawStroke(page, STROKE_A);
    const villainDrawn = await compositesOf(page, villain);
    expect(differs(villainDrawn, villainBlank)).toBe(true);
    expect(await compositesOf(page, hero)).toEqual(heroBlank);

    // A press on the other tab selects it; the focus goes back to the viewport.
    await tabOf(page, hero).click();
    await expect(tabOf(page, hero)).toHaveAttribute("aria-selected", "true");
    expect(await activeId(page)).toBe(hero);
    await expect(documentName(page)).toHaveText("hero");
    await expect(viewportFocus(page)).toBeFocused();
    await settle(page);
    await drawStroke(page, STROKE_B);
    const heroDrawn = await compositesOf(page, hero);
    expect(differs(heroDrawn, heroBlank)).toBe(true);
    expect(await compositesOf(page, villain)).toEqual(villainDrawn);

    // Undo from the keyboard: the active tab's stroke goes, the other tab keeps its own.
    await page.keyboard.press("Control+KeyZ");
    await expect.poll(() => compositesOf(page, hero)).toEqual(heroBlank);
    expect(await compositesOf(page, villain)).toEqual(villainDrawn);
    const undoCounts = await page.evaluate(() =>
        window.__ngneTest!.sessions.getState().documents.map((entry) => entry.history.undoCount),
    );
    expect(undoCounts).toEqual([0, 1]);
    expect(errors).toEqual([]);
});

test("closing a dirty tab asks once; a middle click closes a tab; closing the last tab shows the empty state", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const first = await openTab(page, "first");
    const second = await openTab(page, "second");
    const third = await openTab(page, "third");
    await rename(page, first, "first draft", "Rename");
    await rename(page, third, "third draft", "Rename");
    // The unsaved marker of each tab; the active one's is the menu bar's marker.
    await expect(tabOf(page, first)).toContainText("Unsaved changes");
    await expect(unsavedMarker(page)).toHaveCount(1);
    await expect(tabOf(page, second)).not.toContainText("Unsaved changes");

    // The page asks before it is left while any document is dirty, also a tab not shown.
    const guarded = () =>
        page.evaluate(() => {
            const event = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        });
    expect(await guarded()).toBe(true);

    // A middle click on a dirty tab that is not the active one: asked once, Cancel keeps it.
    await tabOf(page, first).click({ button: "middle" });
    const dialog = discardDialog(page);
    await expect(dialog).toContainText("“first draft” has unsaved changes. Closing it loses them.");
    await expect(dialogButton(dialog, "Cancel")).toBeFocused();
    await dialogButton(dialog, "Cancel").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await documentIds(page)).toEqual([first, second, third]);
    expect(await activeId(page)).toBe(third);

    // Again, Discard: closed, the active tab is the same.
    await tabOf(page, first).click({ button: "middle" });
    await expect(dialog).toBeVisible();
    await dialogButton(dialog, "Discard").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await documentIds(page)).toEqual([second, third]);
    expect(await activeId(page)).toBe(third);
    expect(await guarded()).toBe(true);

    // A clean tab closes without a question, with its close control.
    await tabOf(page, second).hover();
    await tabOf(page, second).locator("[data-tab-close]").click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The last tab, dirty: asked once, then the empty state.
    await tabOf(page, third).locator("[data-tab-close]").click();
    await expect(dialog).toContainText("“third draft” has unsaved changes.");
    await dialogButton(dialog, "Discard").click();
    await expect(emptyState(page)).toBeVisible();
    await expect(tabList(page)).toHaveCount(0);
    await expect(documentName(page)).toHaveCount(0);
    expect(await documentIds(page)).toEqual([]);
    expect(await guarded()).toBe(false);
    expect(errors).toEqual([]);
});

test("with three open documents only the active one holds composites: each other document's cache reports 0 bytes", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const ids = [];
    for (const name of ["one", "two", "three"]) {
        ids.push(await openTab(page, name));
        await drawStroke(page, STROKE_A);
        await settle(page);
    }
    const [one, two, three] = ids as [string, string, string];
    const frame = 16 * 12 * 4;

    // The active document shows its frame, so it holds its composite; the others hold none.
    await expect.poll(() => cacheBytes(page)).toEqual({ [one]: 0, [two]: 0, [three]: frame });

    for (const id of [one, two]) {
        await tabOf(page, id).click();
        await expect(tabOf(page, id)).toHaveAttribute("aria-selected", "true");
        await settle(page);
        const expected = Object.fromEntries(ids.map((each) => [each, each === id ? frame : 0]));
        await expect.poll(() => cacheBytes(page)).toEqual(expected);
    }
    expect(errors).toEqual([]);
});

test("tabs reorder by dragging and from the keyboard; the keyboard moves between tabs, selects and closes them", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const a = await openTab(page, "alpha");
    const b = await openTab(page, "beta");
    const c = await openTab(page, "gamma");
    expect(await documentIds(page)).toEqual([a, b, c]);

    // Drag gamma (active) over to the left of alpha.
    const from = await boxOf(tabOf(page, c));
    const to = await boxOf(tabOf(page, a));
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 - 10, from.y + from.height / 2);
    await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => documentIds(page)).toEqual([c, a, b]);
    await expect(tabs(page)).toHaveText([/^gamma/, /^alpha/, /^beta/]);
    expect(await activeId(page)).toBe(c);

    // From the keyboard: the strip is one tab stop, on the active tab.
    await tabOf(page, c).focus();
    await expect(tabOf(page, c)).toBeFocused();
    await expect(tabOf(page, c)).toHaveAttribute("tabindex", "0");
    await expect(tabOf(page, a)).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("ArrowRight");
    await expect(tabOf(page, a)).toBeFocused();
    // Moving the focus does not select.
    expect(await activeId(page)).toBe(c);
    await page.keyboard.press("Enter");
    await expect(tabOf(page, a)).toHaveAttribute("aria-selected", "true");
    expect(await activeId(page)).toBe(a);
    await expect(tabOf(page, a)).toBeFocused();

    // Ctrl+Shift+→ moves the focused tab one place, and it keeps the focus.
    await page.keyboard.press("Control+Shift+ArrowRight");
    await expect.poll(() => documentIds(page)).toEqual([c, b, a]);
    await expect(tabOf(page, a)).toBeFocused();
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect.poll(() => documentIds(page)).toEqual([c, a, b]);
    await expect(tabOf(page, a)).toBeFocused();

    // End, Home; Delete closes the focused tab (clean: no question).
    await page.keyboard.press("End");
    await expect(tabOf(page, b)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tabOf(page, c)).toBeFocused();
    await page.keyboard.press("Delete");
    await expect.poll(() => documentIds(page)).toEqual([a, b]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await activeId(page)).toBe(a);
    expect(errors).toEqual([]);
});

test("with 12 open tabs at 1280 px width every tab is reachable: the strip scrolls and the overflow menu lists them all", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditor(page);
    await settleSize(page);
    const ids: string[] = [];
    for (let index = 1; index <= 12; index++) ids.push(await openTab(page, `sprite ${index}`));
    await expect(tabs(page)).toHaveCount(12);

    // Tabs shrink to 96 px, then the strip scrolls and the overflow menu appears.
    for (const id of ids) expect((await boxOf(tabOf(page, id))).width).toBeGreaterThanOrEqual(96);
    await expect(overflowButton(page)).toBeVisible();
    const list = await tabList(page).evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
    }));
    expect(list.scroll).toBeGreaterThan(list.client);
    // The strip stays between the menus and the command palette trigger, on one 36 px bar.
    const bar = region(page, "menu-bar");
    expect((await boxOf(bar)).height).toBe(36);
    const menus = await boxOf(bar.getByRole("menubar"));
    const strip = await boxOf(bar.locator("[data-document-tabs]"));
    const trigger = await boxOf(bar.locator(".command-palette-trigger"));
    expect(strip.x).toBeGreaterThanOrEqual(menus.x + menus.width);
    expect(strip.x + strip.width).toBeLessThanOrEqual(trigger.x);
    // The active tab, the last one opened, is in view.
    expect(await liesWithin(tabOf(page, ids[11]!), tabList(page))).toBe(true);

    // Every document from the overflow menu: selected, and its tab scrolled into view.
    for (const [index, id] of ids.entries()) {
        await overflowButton(page).click();
        const menu = page.getByRole("menu", { name: "All documents" });
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("menuitemradio")).toHaveCount(12);
        await menu.getByRole("menuitemradio", { name: `sprite ${index + 1}`, exact: true }).click();
        await expect(menu).toHaveCount(0);
        await expect(tabOf(page, id)).toHaveAttribute("aria-selected", "true");
        expect(await liesWithin(tabOf(page, id), tabList(page))).toBe(true);
    }

    // From the keyboard too: End reaches the last tab and brings it into view.
    await tabOf(page, ids[0]!).focus();
    await page.keyboard.press("End");
    await expect(tabOf(page, ids[11]!)).toBeFocused();
    expect(await liesWithin(tabOf(page, ids[11]!), tabList(page))).toBe(true);
    await page.keyboard.press("Enter");
    await expect(tabOf(page, ids[11]!)).toHaveAttribute("aria-selected", "true");
    expect(errors).toEqual([]);
});
