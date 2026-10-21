import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { boxOf, collectErrors, region, tabTo } from "./se-006-support";
import { openSession, rename } from "./se-007-support";
import { audit, dialogButton, field, THEMES } from "./se-008-support";
import {
    ACCENT,
    hexField,
    openIn,
    openPalette,
    openPreferences,
    openShortcutSheet,
    palette,
    paletteInput,
    paletteOptions,
    paletteTrigger,
    preferencesDialog,
    registerProbes,
    ringOf,
    section,
    segment,
    shortcutList,
    shortcutSheet,
    toggle,
} from "./se-064-support";

// SE-064: the command palette, the Preferences dialog, the shortcut sheet and the palette
// trigger meet the bar SE-006 set for the primitives — no WCAG AA violation (axe) in either
// theme, pointer targets of 24 px, focus ring on keyboard focus only.

/**
 * No violation on the page as a whole, nor in the surface itself, whose text the contrast rule
 * must have judged: nodes it could not decide on would hide a failure.
 */
async function expectAccessible(page: Page, name: string, scope: string): Promise<void> {
    await expect(page.locator(scope), name).toBeVisible();
    const whole = await audit(page);
    expect(whole.violations, name).toEqual([]);
    const own = await audit(page, scope);
    expect(own.violations, name).toEqual([]);
    expect(own.contrastUndecided, name).toEqual([]);
    expect(own.contrastChecked, name).toBeGreaterThan(0);
}

/**
 * `expectAccessible` for the open command palette, whose list scrolls: the row cut off at the
 * list's visible edge is one the contrast rule cannot decide on, and which row that is depends
 * on how many commands there are (SE-033 review). So a node left undecided must lie in an
 * option partly outside the list's visible rectangle; each such option is then scrolled fully
 * into view and judged on its own: no violation, nothing undecided, and every text of it —
 * title, menu, shortcut, those it has — checked. An undecided node anywhere else fails.
 */
async function expectPaletteAccessible(page: Page, list: Locator): Promise<void> {
    const name = "command palette";
    const scope = ".command-palette";
    await expect(page.locator(scope), name).toBeVisible();
    const whole = await audit(page);
    expect(whole.violations, name).toEqual([]);
    const own = await audit(page, scope);
    expect(own.violations, name).toEqual([]);
    expect(own.contrastChecked, name).toBeGreaterThan(0);

    const cut = new Set<string>();
    for (const selector of own.contrastUndecided) {
        const place = await page.locator(selector).evaluate((element) => {
            const option = element.closest('[role="option"]');
            const listbox = option?.closest('[role="listbox"]');
            if (!(option instanceof HTMLElement) || !listbox) return null;
            const row = option.getBoundingClientRect();
            const view = listbox.getBoundingClientRect();
            const visible = Math.min(row.bottom, view.bottom) - Math.max(row.top, view.top);
            return {
                command: option.dataset.command ?? "",
                partlyOutside: visible > 0 && visible < row.height,
            };
        });
        expect(place, `${name}: undecided ${selector} outside the list's options`).not.toBeNull();
        expect(place!.partlyOutside, `${name}: undecided ${selector} in a whole row`).toBe(true);
        cut.add(place!.command);
    }
    for (const command of cut) {
        const option = list.locator(`[role="option"][data-command="${command}"]`);
        await option.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
        // The scroll has settled: the same position in two animation frames in a row.
        await expect
            .poll(() =>
                list.evaluate(
                    (element) =>
                        new Promise<boolean>((resolve) => {
                            const before = element.scrollTop;
                            requestAnimationFrame(() =>
                                requestAnimationFrame(() => resolve(element.scrollTop === before)),
                            );
                        }),
                ),
            )
            .toBe(true);
        const inside = await option.evaluate((element) => {
            const row = element.getBoundingClientRect();
            const view = element.closest('[role="listbox"]')!.getBoundingClientRect();
            return row.top >= view.top && row.bottom <= view.bottom;
        });
        expect(inside, `${command} in view`).toBe(true);
        const texts = await option
            .locator(".command-palette__title, .command-palette__group, .command-palette__shortcut")
            .count();
        const row = await audit(page, `.command-palette [data-command="${command}"]`);
        expect(row.violations, command).toEqual([]);
        expect(row.contrastUndecided, command).toEqual([]);
        expect(row.contrastChecked, command).toBe(texts);
        expect(texts, command).toBeGreaterThanOrEqual(1);
    }
}

/** Enough commands with shortcuts to make the palette list and the shortcut sheet scroll. */
function manyProbes() {
    const modifiers = ["Ctrl+Alt+Shift", "Alt+Shift", "Ctrl+Shift+Meta", "Alt+Meta"];
    return Array.from({ length: 96 }, (_, index) => ({
        id: `se064.many.${String(index).padStart(2, "0")}`,
        title: `Quokka ${String(index).padStart(2, "0")}`,
        shortcut: `${modifiers[Math.floor(index / 26)]}+${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index % 26]}`,
    }));
}

for (const theme of THEMES) {
    test(`axe reports no AA violations on the command palette and its trigger in the ${theme} theme`, async ({
        page,
    }) => {
        // Several audits in one test: about 10 s alone, longer while other workers are busy.
        test.slow();
        const errors = collectErrors(page);
        await openIn(page, theme);
        // With a document: the menu bar holds its name next to the trigger, Undo is enabled.
        const id = await openSession(page, { name: "hero", width: 32, height: 32 });
        await rename(page, id, "hero walk", "Pencil");
        await expectAccessible(page, "menu bar", '[data-region="menu-bar"]');
        // The trigger itself was judged: its label and its key.
        const trigger = await audit(page, ".command-palette-trigger");
        expect(trigger.violations).toEqual([]);
        expect(trigger.contrastUndecided).toEqual([]);
        expect(trigger.contrastChecked).toBe(2);

        // The whole list: enabled and disabled rows, menus, shortcuts; it scrolls.
        await openPalette(page);
        const list = palette(page).getByRole("listbox");
        expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
        expect(await palette(page).locator('[aria-disabled="true"]').count()).toBeGreaterThan(5);
        await expectPaletteAccessible(page, list);
        // The enabled rows were judged by the contrast rule, title, menu and shortcut.
        const row = await audit(page, '.command-palette [data-command="edit.undo"]');
        expect(row.violations).toEqual([]);
        expect(row.contrastChecked).toBe(3);

        // With a query that has no match: no list, the message instead.
        await paletteInput(page).fill("no such command anywhere");
        await expect(paletteOptions(page)).toHaveCount(0);
        await expectAccessible(page, "command palette without a match", ".command-palette");
        const message = await audit(page, ".command-palette__empty");
        expect(message.violations).toEqual([]);
        expect(message.contrastChecked).toBe(1);
        await page.keyboard.press("Escape");
        await expect(palette(page)).toBeHidden();
        expect(errors).toEqual([]);
    });

    test(`axe reports no AA violations on the Preferences dialog in the ${theme} theme`, async ({
        page,
    }) => {
        // Several audits in one test: about 10 s alone, longer while other workers are busy.
        test.slow();
        const errors = collectErrors(page);
        await openIn(page, theme);
        const dialog = await openPreferences(page);
        await expectAccessible(page, "Preferences", ".ui-dialog");

        // With custom colours (two more fields), toggles pressed and other choices checked.
        await segment(section(dialog, "Checkerboard"), "Colours", "Custom").click();
        await expect(hexField(dialog, "Colour A")).toBeVisible();
        await toggle(section(dialog, "Onion skin defaults"), "Onion skin").click();
        await toggle(dialog, "Tint").click();
        await toggle(section(dialog, "Autosave"), "Autosave").click();
        await expectAccessible(page, "Preferences with custom colours", ".ui-dialog");

        // With a select open: its list is a layer of its own over the dialog.
        await dialog.getByRole("combobox", { name: "Dither" }).click();
        await expect(page.getByRole("listbox")).toBeVisible();
        await expect(page.getByRole("option", { name: "None" })).toBeFocused();
        const list = await audit(page, ".ui-menu--select");
        expect(list.violations).toEqual([]);
        expect(list.contrastUndecided).toEqual([]);
        expect(list.contrastChecked).toBeGreaterThanOrEqual(3);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("listbox")).toBeHidden();

        // In the other theme, switched in the dialog itself.
        await segment(dialog, "Theme", theme === "dark" ? "Light" : "Dark").click();
        await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme);
        await expectAccessible(page, "Preferences after a change of theme", ".ui-dialog");
        await dialogButton(dialog, "Restore defaults").click();
        await page.keyboard.press("Escape");
        await expect(preferencesDialog(page)).toBeHidden();
        expect(errors).toEqual([]);
    });

    test(`axe reports no AA violations on the shortcut sheet in the ${theme} theme`, async ({
        page,
    }) => {
        // Several audits in one test: about 10 s alone, longer while other workers are busy.
        test.slow();
        const errors = collectErrors(page);
        await openIn(page, theme);
        await registerProbes(page, [
            { id: "se064.hold", title: "Quokka Hold", shortcut: "Alt+F9", hold: true },
        ]);
        await openShortcutSheet(page);
        await expectAccessible(page, "shortcut sheet", ".ui-dialog");
        // Title, key and the hold mark of one row, scrolled into view: the commands of later
        // tools (SE-065) put it below the fold of the list, where contrast is not judged.
        await page.locator('.ui-dialog [data-command="se064.hold"]').scrollIntoViewIfNeeded();
        const row = await audit(page, '.ui-dialog [data-command="se064.hold"]');
        expect(row.violations).toEqual([]);
        expect(row.contrastChecked).toBe(3);
        await page.keyboard.press("Escape");
        await expect(shortcutSheet(page)).toBeHidden();

        // A sheet longer than the window: a scrolling list that the keyboard can reach.
        await registerProbes(page, manyProbes());
        await openShortcutSheet(page);
        expect(await shortcutList(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
            true,
        );
        await expectAccessible(page, "long shortcut sheet", ".ui-dialog");
        await page.keyboard.press("Escape");
        await expect(shortcutSheet(page)).toBeHidden();
        expect(errors).toEqual([]);
    });

    test(`the new controls show the focus ring on keyboard focus only (${theme} theme)`, async ({
        page,
    }) => {
        await openIn(page, theme);
        const ring = `2px solid ${ACCENT[theme]}, offset 1px`;
        /** Focused with the pointer: no ring. Left and reached again with Tab: the ring. */
        const expectRingOnKeyboardOnly = async (name: string, target: Locator, box = target) => {
            await target.click();
            await expect(target, name).toBeFocused();
            expect(await ringOf(box), `${name} after a pointer click`).toBe("none");
            await page.keyboard.press("Shift+Tab");
            await expect(target, name).not.toBeFocused();
            await page.keyboard.press("Tab");
            await expect(target, name).toBeFocused();
            expect(await ringOf(box), `${name} after Tab`).toBe(ring);
        };

        // The palette trigger: a click opens the palette, so the pointer case is read on return.
        const trigger = paletteTrigger(page);
        const search = palette(page).locator(".command-palette__search");
        await trigger.click();
        await expect(paletteInput(page)).toBeFocused();
        // The search field is one box: the ring is the box's, never the bare input's.
        expect(await ringOf(search), "search field opened with the pointer").toBe("none");
        expect(await ringOf(paletteInput(page))).toBe("none");
        // Typing and arrow keys in a field focused with the pointer are not keyboard navigation.
        await page.keyboard.type("un");
        await page.keyboard.press("ArrowDown");
        expect(await ringOf(search), "search field while typing after a click").toBe("none");
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        expect(await ringOf(trigger), "trigger after a pointer click").toBe("none");
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(trigger).toBeFocused();
        expect(await ringOf(trigger), "trigger after Tab").toBe(ring);
        // Opened from the keyboard: the search field has the ring.
        await page.keyboard.press("Enter");
        await expect(paletteInput(page)).toBeFocused();
        expect(await ringOf(search), "search field opened from the keyboard").toBe(ring);
        expect(await ringOf(paletteInput(page))).toBe("none");
        await page.keyboard.press("Escape");
        await expect(palette(page)).toBeHidden();

        // Preferences: the hex field, a toggle, a segment, a number field's box.
        const dialog = await openPreferences(page);
        await segment(section(dialog, "Checkerboard"), "Colours", "Custom").click();
        await expectRingOnKeyboardOnly("hex field", hexField(dialog, "Colour A"));
        await expectRingOnKeyboardOnly("toggle", toggle(dialog, "Within tag"));
        await expectRingOnKeyboardOnly(
            "segment",
            segment(section(dialog, "Onion skin defaults"), "Placement", "Behind"),
        );
        const width = field(section(dialog, "Default grid"), "Width");
        await expectRingOnKeyboardOnly(
            "number field",
            width,
            section(dialog, "Default grid").locator(".ui-number").first(),
        );
        // Typing in a field focused with the pointer is not keyboard navigation.
        await hexField(dialog, "Colour A").click();
        await page.keyboard.type("1");
        expect(await ringOf(hexField(dialog, "Colour A")), "hex field while typing").toBe("none");
        // The actions, reached with Tab (a click on one would act: both are plain buttons).
        await tabTo(page, dialogButton(dialog, "Restore defaults"));
        expect(await ringOf(dialogButton(dialog, "Restore defaults")), "Restore defaults").toBe(
            ring,
        );
        await page.keyboard.press("Tab");
        await expect(dialogButton(dialog, "Close")).toBeFocused();
        expect(await ringOf(dialogButton(dialog, "Close")), "Close").toBe(ring);
        await dialogButton(dialog, "Close").click();
        await expect(dialog).toBeHidden();

        // The shortcut sheet: its list is the first tab stop.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await openShortcutSheet(page);
        await expect(shortcutList(page)).toBeFocused();
        expect(await ringOf(shortcutList(page)), "sheet opened from the keyboard").toBe(ring);
        await expectRingOnKeyboardOnly("shortcut list", shortcutList(page));
        await page.keyboard.press("Tab");
        await expect(dialogButton(shortcutSheet(page), "Close")).toBeFocused();
        expect(await ringOf(dialogButton(shortcutSheet(page), "Close")), "Close after Tab").toBe(
            ring,
        );
    });
}

test("pointer targets of the trigger, the palette, Preferences and the shortcut sheet are at least 24×24 px", async ({
    page,
}) => {
    /** Controls on the page that are smaller than 24 px in either direction. */
    const tooSmall = () =>
        page.evaluate(() =>
            [
                ...document.querySelectorAll(
                    'button, [role="radio"], [role="option"], [role="combobox"], input[type="text"]:not(.ui-number__input), .ui-number, .command-palette__search',
                ),
            ]
                .map((element) => {
                    const rect = element.getBoundingClientRect();
                    const name = element.getAttribute("aria-label") ?? element.textContent;
                    return { name, width: rect.width, height: rect.height };
                })
                .filter((target) => target.width < 24 || target.height < 24)
                .map((target) => `${target.name}: ${target.width}×${target.height}`),
        );

    await openIn(page, "dark");
    await openSession(page, { name: "hero", width: 32, height: 32 });
    expect((await boxOf(paletteTrigger(page))).height).toBe(24);
    expect(await tooSmall()).toEqual([]);
    // The trigger does not change the height of the menu bar.
    expect((await boxOf(region(page, "menu-bar"))).height).toBe(36);

    await openPalette(page);
    expect(await paletteOptions(page).count()).toBeGreaterThan(30);
    expect(await tooSmall()).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();

    const dialog = await openPreferences(page);
    await segment(section(dialog, "Checkerboard"), "Colours", "Custom").click();
    await expect(hexField(dialog, "Colour B")).toBeVisible();
    // 11 number fields and 2 hex fields; 6 segments, 2 selects, 4 toggles and 2 actions.
    expect(await dialog.locator("input").count()).toBe(13);
    expect(await dialog.locator("button").count()).toBe(14);
    expect(await tooSmall()).toEqual([]);
    await dialog.getByRole("combobox", { name: "Resample" }).click();
    await expect(page.getByRole("option")).toHaveCount(3);
    expect(await tooSmall()).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await dialogButton(dialog, "Restore defaults").click();
    await dialogButton(dialog, "Close").click();
    await expect(dialog).toBeHidden();

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await openShortcutSheet(page);
    expect(await tooSmall()).toEqual([]);
    // The rows of the sheet are not controls; they keep the 24 px line of the controls.
    for (const row of await shortcutSheet(page).locator("[data-command]").all()) {
        expect((await boxOf(row)).height).toBeGreaterThanOrEqual(24);
    }
});
