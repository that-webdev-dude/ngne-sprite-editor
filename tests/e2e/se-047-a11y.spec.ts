import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openEditor, rename } from "./se-007-support";
import { audit, startInTheme, THEMES } from "./se-008-support";
import type { Theme } from "./se-008-support";
import { emptyState, infoToast, openHero } from "./se-041-support";
import {
    arrangePickers,
    openTab,
    overflowButton,
    settleSize,
    stubProjectFiles,
    tabList,
    tabOf,
} from "./se-047-support";

// SE-047: the tab strip, its overflow menu and the recent files of the empty state meet the
// bar of SE-006: no WCAG AA violation (axe) in either theme, every text judged by the contrast
// rule; tabs and tablist roles.

/** Several audits in one test: about 10 s alone, longer while other workers are busy. */
const AXE_TIMEOUT_MS = 90_000;

async function openIn(page: Page, theme: Theme): Promise<void> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startInTheme(page, theme);
    await openEditor(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** No violation on the page, nor in `scope`, whose text the contrast rule judged in full. */
async function expectAccessible(page: Page, name: string, scope: string): Promise<void> {
    await expect(page.locator(scope).first(), name).toBeVisible();
    const whole = await audit(page);
    expect(whole.violations, name).toEqual([]);
    const own = await audit(page, scope);
    expect(own.violations, name).toEqual([]);
    expect(own.contrastUndecided, name).toEqual([]);
    expect(own.contrastChecked, name).toBeGreaterThan(0);
}

for (const theme of THEMES) {
    test(`axe reports no AA violations on the tabs, a dirty and a hovered tab, in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await openIn(page, theme);
        const first = await openTab(page, "first");
        const second = await openTab(page, "second");
        await openTab(page, "third");
        await rename(page, first, "first draft", "Rename");
        await rename(page, second, "second draft", "Rename");
        await expect(tabList(page).getByRole("tab")).toHaveCount(3);
        await expect(tabList(page).getByRole("tab", { selected: true })).toHaveCount(1);
        await expectAccessible(page, "tabs", '[role="tablist"]');
        // A tab under the pointer, and the selected tab dirty.
        await tabOf(page, second).click();
        await tabOf(page, first).hover();
        await expectAccessible(page, "tabs, hovered", '[role="tablist"]');
        expect(errors).toEqual([]);
    });

    test(`axe reports no AA violations on the overflow menu of twelve tabs in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        await page.setViewportSize({ width: 1280, height: 720 });
        await openIn(page, theme);
        await settleSize(page);
        for (let index = 1; index <= 12; index++) await openTab(page, `sprite ${index}`);
        await overflowButton(page).click();
        const menu = page.getByRole("menu", { name: "All documents" });
        await expect(menu).toBeVisible();
        // Radix moves the focus into the menu once it has opened.
        await expect
            .poll(() => menu.evaluate((element) => element.contains(document.activeElement)))
            .toBe(true);
        await expect(menu.getByRole("menuitemradio")).toHaveCount(12);
        const own = await audit(page, '[role="menu"]');
        expect(own.violations).toEqual([]);
        expect(own.contrastUndecided).toEqual([]);
        expect(own.contrastChecked).toBeGreaterThan(0);
        // The page's violations, apart from contrast that axe cannot decide for tabs the
        // scrolling strip cuts off.
        expect((await audit(page)).violations).toEqual([]);
    });

    test(`axe reports no AA violations on the recent files of the empty state in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await startInTheme(page, theme);
        await stubProjectFiles(page);
        await openHero(page);
        await arrangePickers(page, { nextSave: ["hero.ngsprite"] });
        await page.keyboard.press("Control+KeyS");
        await expect(infoToast(page, "Saved hero.ngsprite")).toBeVisible();
        await page.keyboard.press("Alt+KeyW");
        await expect(emptyState(page)).toBeVisible();
        await expect(emptyState(page).locator("[data-recent-file]")).toHaveText(["hero.ngsprite"]);
        await expect(emptyState(page).getByRole("list", { name: "Recent files" })).toBeVisible();
        await expectAccessible(page, "empty state with recent files", "[data-empty-state]");
        expect(errors).toEqual([]);
    });
}
