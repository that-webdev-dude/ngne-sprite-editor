import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, region, settleTimers } from "./se-006-support";
import { audit, startInTheme, THEMES } from "./se-008-support";
import { viewportArea } from "./se-012-support";
import { setColours } from "./se-015-support";
import { focusInside, history, menuItem, openPalettePanel } from "./se-060-support";
import {
    celColours,
    chooseInPaletteMenu,
    paintCel,
    replaceDialog,
    scopeRadio,
    selectRect,
} from "./se-066-support";

// SE-066: Replace colour (DESIGN §7) — from the palette's overflow menu and the Edit menu: the
// colour, its replacement, the tolerance and the scope; across the sprite one undo step that
// changes only the matching pixels; with a selection and the scope "Selection", the pixels
// outside it untouched; no AA violation in either theme.

const RED = 0xff0000ff;
const NEAR_RED = 0xfa0403ff;
const GREEN = 0x00ff00ff;
const BLUE = 0x0000ffff;

/** A 16 × 16 cel: a pattern of red, near red and green on the first rows, the rest clear. */
const CEL = Array.from({ length: 16 * 16 }, (_, index) =>
    index >= 32 ? 0 : [RED, GREEN, NEAR_RED, RED][index % 4]!,
);

async function openReplaceFromEdit(page: Page): Promise<void> {
    await region(page, "menu-bar").getByRole("menuitem", { name: "Edit", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Edit" });
    await expect(menu).toBeVisible();
    await focusInside(menu);
    await menuItem(menu, "Replace Colour…").click();
    await expect(replaceDialog(page)).toBeVisible();
    await focusInside(replaceDialog(page));
}

test("across the sprite, Replace is one undo step that changes only the matching pixels", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    await paintCel(page, CEL);
    // The dialog opens with the foreground and the background.
    await setColours(page, RED, BLUE);
    await chooseInPaletteMenu(page, "Replace Colour…");
    const dialog = replaceDialog(page);
    await expect(dialog).toBeVisible();
    await focusInside(dialog);
    await expect(dialog.getByLabel("From", { exact: true })).toHaveValue("#FF0000");
    await expect(dialog.getByLabel("To", { exact: true })).toHaveValue("#0000FF");
    // No selection: the scope "Selection" is not offered, the cel is.
    await expect(scopeRadio(page, "Selection")).toBeDisabled();
    await expect(scopeRadio(page, "Cel")).toBeChecked();
    await scopeRadio(page, "Sprite").click();
    await expect(scopeRadio(page, "Sprite")).toBeChecked();
    await dialog.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(dialog).toBeHidden();

    const after = await celColours(page);
    expect(after).toEqual(CEL.map((colour) => (colour === RED ? BLUE : colour)));
    expect(await history(page)).toEqual({ undo: 1, label: "Replace Colour" });
    await expect(
        page.locator(".ui-toast").filter({ hasText: "Replaced 16 pixels in the sprite" }),
    ).toBeVisible();

    await settleTimers(page);
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Control+z");
    expect(await celColours(page)).toEqual(CEL);
    expect(errors).toEqual([]);
});

test("the tolerance takes the near colour too; with a selection, pixels outside it are untouched", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    await paintCel(page, CEL);
    // Four pixels of the first row and the next four of the second: the selection's bounds
    // hold pixels it leaves out, (0, 1) and (4, 0) among them.
    await selectRect(page, { x: 0, y: 0, width: 4, height: 1 });
    await selectRect(page, { x: 4, y: 1, width: 4, height: 1 }, "add");
    await openReplaceFromEdit(page);
    const dialog = replaceDialog(page);
    await expect(scopeRadio(page, "Selection")).toBeChecked();
    await dialog.getByLabel("From", { exact: true }).fill("#f00");
    await dialog.getByLabel("To", { exact: true }).fill("#00FF0080");
    const tolerance = dialog.getByRole("spinbutton", { name: "Tolerance" });
    await tolerance.fill("5");
    await tolerance.press("Tab");
    await expect(tolerance).toHaveValue("5");
    await dialog.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(dialog).toBeHidden();

    const after = await celColours(page);
    const selected = (index: number) => index < 4 || (index >= 20 && index < 24);
    const expected = CEL.map((colour, index) =>
        selected(index) && (colour === RED || colour === NEAR_RED) ? 0x00ff0080 : colour,
    );
    expect(after).toEqual(expected);
    // Red outside the selection is still red, within its bounds as well.
    expect(after[4]).toBe(RED);
    expect(after[16]).toBe(RED);
    expect(await history(page)).toEqual({ undo: 3, label: "Replace Colour" });
    expect(errors).toEqual([]);
});

test("a colour that is not one is named, and Replace waits until it is fixed", async ({ page }) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    await paintCel(page, CEL);
    await chooseInPaletteMenu(page, "Replace Colour…");
    const dialog = replaceDialog(page);
    await focusInside(dialog);
    const from = dialog.getByLabel("From", { exact: true });
    await from.fill("#12");
    await expect(from).toHaveAttribute("aria-invalid", "true");
    const message = dialog.getByRole("alert");
    await expect(message).toHaveText("From is not a colour: use 3, 4, 6 or 8 hex digits.");
    const replace = dialog.getByRole("button", { name: "Replace", exact: true });
    await expect(replace).toBeDisabled();

    const to = dialog.getByLabel("To", { exact: true });
    await to.fill("blue");
    await expect(to).toHaveAttribute("aria-invalid", "true");
    await expect(message).toHaveText("From and To are not colours: use 3, 4, 6 or 8 hex digits.");
    await from.fill("#00FF00");
    await expect(from).not.toHaveAttribute("aria-invalid", "true");
    await expect(message).toHaveText("To is not a colour: use 3, 4, 6 or 8 hex digits.");
    await expect(replace).toBeDisabled();
    await to.fill("#00f");
    await expect(message).toHaveText("");
    await expect(replace).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await celColours(page)).toEqual(CEL);
    expect(await history(page)).toEqual({ undo: 0, label: null });
    expect(errors).toEqual([]);
});

/** Several audits in one test: longer while other workers are busy. */
const AXE_TIMEOUT_MS = 90_000;

for (const theme of THEMES) {
    test(`axe reports no AA violations in the Replace colour dialog in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await startInTheme(page, theme);
        await openPalettePanel(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await paintCel(page, CEL);
        for (const selected of [false, true]) {
            if (selected) await selectRect(page, { x: 0, y: 0, width: 4, height: 4 });
            await chooseInPaletteMenu(page, "Replace Colour…");
            const dialog = replaceDialog(page);
            await focusInside(dialog);
            if (selected) await dialog.getByLabel("From", { exact: true }).fill("#xyz");
            const whole = await audit(page);
            expect(whole.violations, `selected: ${selected}`).toEqual([]);
            const own = await audit(page, ".ui-dialog");
            expect(own.violations, `selected: ${selected}`).toEqual([]);
            expect(own.contrastUndecided, `selected: ${selected}`).toEqual([]);
            expect(own.contrastChecked).toBeGreaterThan(0);
            await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
            await expect(dialog).toBeHidden();
            await settleTimers(page);
        }
        expect(errors).toEqual([]);
    });
}
