import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, settleTimers } from "./se-006-support";
import { openEditor, openSession } from "./se-007-support";
import { openPreferences, runFromPalette, segment, section, toggle } from "./se-064-support";

// SE-071 (from the SE-064 review): a write to `localStorage` that fails — the store is full,
// or the browser blocks it — is reported once by a toast instead of being lost silently, for
// each store kept there: the theme, the preferences, the layout (splitters) and the recent
// commands of the palette. The values still apply for the page; the toast says so. Once
// reported, later failures of any store are not reported again.

const MESSAGE =
    "Settings could not be saved: the browser's storage is full or blocked. Changes last until the page is closed.";
const KEYS = {
    theme: "ngne-sprite-editor.theme",
    preferences: "ngne-sprite-editor.preferences",
    layout: "ngne-sprite-editor.layout",
    recent: "ngne-sprite-editor.recent-commands",
};

declare global {
    interface Window {
        __se071Writes?: string[];
    }
}

const failureToasts = (page: Page) => page.locator(".ui-toast--error").filter({ hasText: MESSAGE });

/** Makes every write of the app's keys to `localStorage` fail as a full store does. */
async function fillStorage(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.__se071Writes = [];
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
            if (this === window.localStorage && key.startsWith("ngne-sprite-editor.")) {
                window.__se071Writes!.push(key);
                throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
            }
            setItem.call(this, key, value);
        };
    });
}

/** Writes to every store: theme, a preference, the dock width, a recent command. */
async function writeEveryStore(page: Page): Promise<void> {
    const dialog = await openPreferences(page);
    await segment(dialog, "Theme", "Light").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await toggle(section(dialog, "Onion skin defaults"), "Tint").click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await settleTimers(page);
    const splitter = page.getByRole("separator", { name: "Resize panels" });
    await splitter.focus();
    await page.keyboard.press("ArrowLeft");
    await runFromPalette(page, "view.grid");
}

test("a full storage is reported once by a toast, whichever store writes, and the values still apply", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await fillStorage(page);
    await openEditor(page);
    await openSession(page, { name: "hero", width: 16, height: 16 });
    await expect(failureToasts(page)).toHaveCount(0);

    // The first failed write: the theme.
    const dialog = await openPreferences(page);
    await segment(dialog, "Theme", "Light").click();
    await expect(failureToasts(page)).toHaveCount(1);
    await expect(failureToasts(page)).toHaveAttribute("role", "alert");
    // The theme applies for the page all the same.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await settleTimers(page);
    // An error toast stays until dismissed (DESIGN §4).
    await failureToasts(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(failureToasts(page)).toHaveCount(0);

    // Every store fails again; nothing more is reported.
    await writeEveryStore(page);
    const writes = await page.evaluate(() => [...new Set(window.__se071Writes)].sort());
    expect(writes).toEqual(Object.values(KEYS).sort());
    await page.waitForTimeout(500);
    await expect(failureToasts(page)).toHaveCount(0);
    expect(await page.locator(".ui-toast--error").count()).toBe(0);
    expect(errors).toEqual([]);
});

test("a storage the browser blocks is reported once by a toast at the first write", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
            configurable: true,
            get() {
                throw new DOMException("Access is denied for this document.", "SecurityError");
            },
        });
    });
    await openEditor(page);
    // Blocked storage reads as empty: the defaults (dark theme), and nothing reported yet.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await openSession(page, { name: "hero", width: 16, height: 16 });
    await expect(failureToasts(page)).toHaveCount(0);

    await writeEveryStore(page);
    await expect(failureToasts(page)).toHaveCount(1);
    await page.waitForTimeout(500);
    await expect(page.locator(".ui-toast--error")).toHaveCount(1);
    expect(errors).toEqual([]);
});

test("a store that takes the writes reports nothing", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openSession(page, { name: "hero", width: 16, height: 16 });
    await writeEveryStore(page);
    const stored = await page.evaluate(
        (keys) => keys.map((key) => window.localStorage.getItem(key) !== null),
        Object.values(KEYS),
    );
    expect(stored).toEqual([true, true, true, true]);
    await page.waitForTimeout(500);
    await expect(page.locator(".ui-toast--error")).toHaveCount(0);
    expect(errors).toEqual([]);
});
