import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { region } from "./se-006-support";
import { menuTrigger, openEditor } from "./se-007-support";
import {
    activeOption,
    expectShellUsable,
    openPalette,
    openShortcutSheet,
    palette,
    paletteOption,
    paletteTrigger,
    preferencesDialog,
    shortcutSheet,
} from "./se-064-support";

// SE-064: where the three surfaces are mounted — at the root of the app, outside every region
// and inside an error boundary of their own (REVIEW.md, Checkpoint B decisions, B11).

declare global {
    interface Window {
        /** While true, the title of the command of `registerFragile` throws. */
        se064Break?: boolean;
    }
}

/**
 * Registers a command whose title throws while `window.se064Break` is set: whatever renders
 * the title then crashes. With `menu` the command is an item of the View menu.
 */
function registerFragile(page: Page, menu: boolean): Promise<void> {
    return page.evaluate((menu) => {
        window.__ngneTest!.commands.register({
            id: "se064.fragile",
            title() {
                if (window.se064Break)
                    throw new Error("SE-064: the command title was asked to fail.");
                return "Quokka Fragile";
            },
            menuPath: menu ? ["View"] : undefined,
            menuOrder: 9000,
            run() {},
        });
    }, menu);
}

const setBreak = (page: Page, on: boolean) =>
    page.evaluate((on) => void (window.se064Break = on), on);

test("with the menu bar region failed, the palette, Preferences and the shortcut sheet still open", async ({
    page,
}) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await openEditor(page);
    await registerFragile(page, true);

    // The View menu crashes when it renders its items; the region shows its boundary message.
    await setBreak(page, true);
    await menuTrigger(page, "View").click();
    const bar = region(page, "menu-bar");
    await expect(bar.getByRole("alert")).toHaveText("Menu bar failed to render.Reload");
    await expect(bar.getByRole("menubar")).toHaveCount(0);
    await expect(paletteTrigger(page)).toHaveCount(0);
    await setBreak(page, false);

    // The surfaces are not part of that region: their keys open them as before.
    await openPalette(page);
    await expect(paletteOption(page, "se064.fragile")).toHaveText("Quokka FragileView");
    await page.keyboard.type("preferences");
    await expect(activeOption(page)).toHaveAttribute("data-command", "edit.preferences");
    await page.keyboard.press("Enter");
    await expect(preferencesDialog(page)).toBeVisible();
    // Escape closes the dialog once it holds the focus.
    await expect(preferencesDialog(page).locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(preferencesDialog(page)).toBeHidden();
    await openShortcutSheet(page);
    await page.keyboard.press("Escape");
    await expect(shortcutSheet(page)).toBeHidden();
    await expectShellUsable(page);
    // The boundary caught the error: nothing was left uncaught.
    expect(uncaught).toEqual([]);

    // Reload mounts the menu bar again, with the trigger.
    await bar.getByRole("button", { name: "Reload" }).click();
    await expect(bar.getByRole("menubar")).toBeVisible();
    await expect(paletteTrigger(page)).toBeVisible();
});

test("a surface that fails to render is closed and reported by an error toast; the app goes on working", async ({
    page,
}) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await openEditor(page);
    await registerFragile(page, false);

    // The palette renders every title: it crashes while it opens.
    await setBreak(page, true);
    await page.keyboard.press("Control+KeyK");
    await expect(page.getByRole("alert")).toHaveText("Command palette failed to open.");
    await expect(palette(page)).toHaveCount(0);
    // Nothing of it is left: the shell is usable, the menus open.
    await expectShellUsable(page);
    for (const id of ["menu-bar", "tool-rail", "viewport", "dock"] as const) {
        await expect(region(page, id)).toBeVisible();
        await expect(region(page, id).locator(".region-error")).toHaveCount(0);
    }
    await menuTrigger(page, "File").click();
    await expect(page.getByRole("menu", { name: "File" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The other surfaces are not affected (the command has no shortcut, so the sheet does not
    // render its title), and the palette opens again once its content renders.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await openShortcutSheet(page);
    await page.keyboard.press("Escape");
    await expect(shortcutSheet(page)).toBeHidden();
    await setBreak(page, false);
    await openPalette(page);
    await expect(paletteOption(page, "se064.fragile")).toHaveText("Quokka Fragile");
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    expect(uncaught).toEqual([]);
});
