import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, region, settleTimers } from "./se-006-support";
import { menuItem, menuTrigger, openEditor, openMenu } from "./se-007-support";
import { newSpriteButton } from "./se-008-support";
import {
    SHORTCUTS_COMMAND,
    openShortcutSheet,
    runFromPalette,
    shortcutSheet,
} from "./se-064-support";
import { buildApp, serve } from "./se-072-support";

// Help → About NGNE Sprite Editor… (src/app/about, src/ui/about): the app's and the engine's
// versions as package.json gives them, the licence, the links, and Copy version info.

/**
 * The command's id. Not imported from src/app/about: that module reads the app's build-time
 * constants, which only Vite puts in.
 */
const ABOUT_COMMAND = "help.about";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
    license: string;
    dependencies: Record<string, string>;
};
const APP = `NGNE Sprite Editor ${pkg.version}`;
const ENGINE = `@ngne/core ${pkg.dependencies["@ngne/core"]}`;
const REPOSITORY = "https://github.com/that-webdev-dude/ngne-sprite-editor";

const aboutDialog = (page: Page) => page.getByRole("dialog", { name: "About NGNE Sprite Editor" });

/** Opens the dialog from its item in the Help menu. */
async function openFromHelpMenu(page: Page) {
    await openMenu(page, "Help");
    await menuItem(page, ABOUT_COMMAND).click();
    await expect(aboutDialog(page)).toBeVisible();
    // Radix moves the focus into the dialog one timer after it opens.
    await settleTimers(page);
    return aboutDialog(page);
}

/** Makes the page's clipboard refuse every write, as a browser that denies the permission. */
function refuseClipboard(page: Page): Promise<void> {
    return page.evaluate(() => {
        Object.defineProperty(navigator.clipboard, "writeText", {
            configurable: true,
            value: () => Promise.reject(new DOMException("Write denied", "NotAllowedError")),
        });
    });
}

test("Help → About shows the versions of package.json, the licence and the links", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openMenu(page, "Help");
    await expect(page.getByRole("menu", { name: "Help" }).getByRole("menuitem")).toHaveText([
        "About NGNE Sprite Editor…",
    ]);
    await page.keyboard.press("Escape");

    const dialog = await openFromHelpMenu(page);
    await expect(dialog.getByText(APP, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("definition")).toHaveText([ENGINE, pkg.license]);
    await expect(dialog.getByRole("term")).toHaveText(["Engine", "Licence"]);
    expect(pkg.license).toBe("MIT");

    const links = dialog.getByRole("link");
    await expect(links).toHaveText(["Source code on GitHub", "Changelog"]);
    await expect(links.nth(0)).toHaveAttribute("href", REPOSITORY);
    await expect(links.nth(1)).toHaveAttribute("href", `${REPOSITORY}/blob/main/CHANGELOG.md`);
    for (const link of await links.all()) {
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(errors).toEqual([]);
});

test("Copy version info copies the one-line summary and says so", async ({ page, context }) => {
    const errors = collectErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openEditor(page);
    const dialog = await openFromHelpMenu(page);
    const status = dialog.getByRole("status");
    await expect(status).toHaveText("");

    await dialog.getByRole("button", { name: "Copy version info" }).click();
    await expect(status).toHaveText("Version info copied.");
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`ngne-sprite-editor ${pkg.version} · ${ENGINE} · ${userAgent}`);
    expect(copied).not.toContain("\n");
    // The dialog stays open with the focus where it was.
    await expect(dialog.getByRole("button", { name: "Copy version info" })).toBeFocused();
    expect(errors).toEqual([]);
});

test("Copy version info says so when the clipboard refuses, and throws nothing", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await openEditor(page);
    await refuseClipboard(page);
    const dialog = await openFromHelpMenu(page);

    await dialog.getByRole("button", { name: "Copy version info" }).click();
    await expect(dialog.getByRole("status")).toHaveText(
        "Could not copy the version info: the clipboard is not available.",
    );
    await expect(dialog).toBeVisible();

    // A page without the API (not a secure context) gets the same answer.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.evaluate(() => {
        Object.defineProperty(Navigator.prototype, "clipboard", {
            configurable: true,
            get: () => undefined,
        });
    });
    await openFromHelpMenu(page);
    await dialog.getByRole("button", { name: "Copy version info" }).click();
    await expect(dialog.getByRole("status")).toHaveText(
        "Could not copy the version info: the clipboard is not available.",
    );
    expect(pageErrors).toEqual([]);
    expect(errors).toEqual([]);
});

test("Escape and Close close the dialog, and the focus returns to where it was", async ({
    page,
}) => {
    await openEditor(page);
    // From the menu: back to the menu's trigger, as every dialog a menu opens.
    const dialog = await openFromHelpMenu(page);
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "Help")).toBeFocused();

    await openFromHelpMenu(page);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "Help")).toBeFocused();

    // From the command palette: back to the control that had the focus before it.
    await newSpriteButton(page).focus();
    await runFromPalette(page, ABOUT_COMMAND);
    await expect(dialog).toBeVisible();
    await settleTimers(page);
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(newSpriteButton(page)).toBeFocused();
});

test("the command palette lists About and opens the same dialog", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await runFromPalette(page, ABOUT_COMMAND);
    const dialog = aboutDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(APP, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("definition").first()).toHaveText(ENGINE);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    expect(errors).toEqual([]);
});

test("Keyboard Shortcuts… stays in the Edit menu and ? still opens the sheet", async ({ page }) => {
    await openEditor(page);
    await openMenu(page, "Edit");
    await expect(menuItem(page, SHORTCUTS_COMMAND)).toHaveText("Keyboard Shortcuts…?");
    await page.keyboard.press("Escape");
    await openShortcutSheet(page);
    await expect(shortcutSheet(page)).toBeVisible();
});

test("a production build shows the versions of package.json", async ({ page }) => {
    test.setTimeout(240_000);
    const served = await serve(await buildApp());
    try {
        await page.goto(served.url);
        await expect(region(page, "viewport")).toBeVisible();
        await menuTrigger(page, "Help").click();
        await page.locator(`[role="menuitem"][data-command="${ABOUT_COMMAND}"]`).click();
        const dialog = aboutDialog(page);
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(APP, { exact: true })).toBeVisible();
        await expect(dialog.getByRole("definition")).toHaveText([ENGINE, pkg.license]);
    } finally {
        await served.close();
    }
});
