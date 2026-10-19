import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { boxOf, collectErrors, region } from "./se-006-support";
import { menuItem, openEditor, openMenu, openSession, rename } from "./se-007-support";
import {
    audit,
    dialogButton,
    discardDialog,
    documentName,
    emptyState,
    field,
    nameField,
    newSpriteButton,
    newSpriteDialog,
    openProperties,
    pivotPreset,
    propertiesDialog,
    setNumber,
    startInTheme,
    THEMES,
} from "./se-008-support";
import type { Theme } from "./se-008-support";

// SE-008: the empty state and the new dialogs meet the bar SE-006 set for the primitives — no
// WCAG AA violation (axe) in either theme, pointer targets of 24 px, focus ring on keyboard
// focus only.

const PANEL: Record<Theme, string> = { dark: "rgb(24, 24, 26)", light: "rgb(244, 244, 245)" };
const ACCENT: Record<Theme, string> = { dark: "rgb(131, 232, 225)", light: "rgb(8, 127, 120)" };
/** Several audits in one test: about 10 s alone, longer while other workers are busy. */
const AXE_TIMEOUT_MS = 90_000;

/** Opens the app in `theme` with transitions off, so colours are final when they are read. */
async function openIn(page: Page, theme: Theme): Promise<void> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startInTheme(page, theme);
    await openEditor(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
        PANEL[theme],
    );
}

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

for (const theme of THEMES) {
    test(`axe reports no AA violations on the empty state and the document name in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await openIn(page, theme);
        await expect(emptyState(page)).toBeVisible();
        await expectAccessible(page, "empty state", "[data-empty-state]");

        // With a document open the menu bar carries its name.
        await openSession(page, { name: "hero", width: 32, height: 32 });
        await expect(documentName(page)).toHaveText("hero");
        await expectAccessible(page, "document name", "[data-document-name]");
        await expectAccessible(page, "menu bar", '[data-region="menu-bar"]');
        expect(errors).toEqual([]);
    });

    test(`axe reports no AA violations on the New sprite dialog in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await openIn(page, theme);
        await newSpriteButton(page).click();
        const dialog = newSpriteDialog(page);
        await expect(dialog).toBeVisible();
        await expectAccessible(page, "New sprite", ".ui-dialog");

        // With the inline message and Create disabled.
        await setNumber(field(dialog, "Width"), 0);
        await expect(dialog.getByRole("alert")).toHaveText("Width must be from 1 to 1024 px.");
        await expect(dialogButton(dialog, "Create")).toBeDisabled();
        await expectAccessible(page, "New sprite with a message", ".ui-dialog");
        // The message itself was judged: its colour is the error colour on the panel.
        const message = await audit(page, ".sprite-form__message");
        expect(message.violations).toEqual([]);
        expect(message.contrastChecked).toBe(1);

        // Without a size preset checked.
        await setNumber(field(dialog, "Width"), 20);
        await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
        await expectAccessible(page, "New sprite without a preset", ".ui-dialog");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        expect(errors).toEqual([]);
    });

    test(`axe reports no AA violations on the discard confirmation in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await openIn(page, theme);
        const id = await openSession(page, { name: "first", width: 8, height: 8 });
        await rename(page, id, "first draft", "Pencil");
        // Since tabs (SE-047) New Sprite replaces nothing; closing the document asks.
        await openMenu(page, "File");
        await menuItem(page, "file.close").click();
        const confirm = discardDialog(page);
        await expect(confirm).toBeVisible();
        // The question is the one dialog on the page, and it is available.
        await expect(page.locator(".ui-dialog")).toHaveCount(1);
        await expect(page.locator(".ui-dialog:visible")).toHaveCount(1);
        await expect(page.locator(".ui-dialog:not([inert])")).toHaveCount(1);
        await expectAccessible(page, "discard confirmation", ".ui-dialog:not([inert])");
        await dialogButton(confirm, "Cancel").click();
        await expect(confirm).toBeHidden();
        // The document stays, and the page is available again.
        await expect(page.locator(".ui-dialog")).toHaveCount(0);
        await expect(documentName(page)).toHaveText("first draft");
        await expectAccessible(page, "menu bar after the question", '[data-region="menu-bar"]');
        expect(errors).toEqual([]);
    });

    test(`axe reports no AA violations on the Sprite properties dialog in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await openIn(page, theme);
        await openSession(page, { name: "hero", width: 32, height: 32 });
        const dialog = await openProperties(page);
        await expectAccessible(page, "Sprite properties", ".ui-dialog");

        // Another preset checked, then none, then the inline message.
        await pivotPreset(dialog, "Bottom centre").click();
        await expectAccessible(page, "Sprite properties, bottom-centre", ".ui-dialog");
        await setNumber(field(dialog.getByRole("group", { name: "Pivot" }), "X"), "0.3");
        await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
        await nameField(dialog).fill("");
        await expect(dialog.getByRole("alert")).toHaveText("Enter a name.");
        await expectAccessible(page, "Sprite properties with a message", ".ui-dialog");
        await page.keyboard.press("Escape");
        await expect(propertiesDialog(page)).toBeHidden();
        expect(errors).toEqual([]);
    });

    test(`the new controls show the focus ring on keyboard focus only (${theme} theme)`, async ({
        page,
    }) => {
        await openIn(page, theme);
        const ring = `2px solid ${ACCENT[theme]}, offset 1px`;
        const ringOf = (target: Locator) =>
            target.evaluate((element) => {
                const style = getComputedStyle(element);
                return style.outlineStyle === "none"
                    ? "none"
                    : `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}, offset ${style.outlineOffset}`;
            });
        /** Focused with the pointer: no ring. Left and reached again with Tab: the ring. */
        const expectRingOnKeyboardOnly = async (name: string, target: Locator) => {
            await target.click();
            await expect(target, name).toBeFocused();
            expect(await ringOf(target), `${name} after a pointer click`).toBe("none");
            await page.keyboard.press("Shift+Tab");
            await expect(target, name).not.toBeFocused();
            await page.keyboard.press("Tab");
            await expect(target, name).toBeFocused();
            expect(await ringOf(target), `${name} after Tab`).toBe(ring);
        };

        // The empty-state button; clicking it opens the dialog, so it is reached by F6 instead.
        await page.keyboard.press("F6");
        for (let presses = 0; presses < 7; presses++) {
            if (await newSpriteButton(page).evaluate((el) => el === document.activeElement)) break;
            await page.keyboard.press("F6");
        }
        await expect(newSpriteButton(page)).toBeFocused();
        expect(await ringOf(newSpriteButton(page)), "New sprite after F6").toBe(ring);

        // The text field of the New sprite dialog.
        await newSpriteButton(page).click();
        const created = newSpriteDialog(page);
        await expect(nameField(created)).toBeFocused();
        expect(await ringOf(nameField(created)), "dialog opened with the pointer").toBe("none");
        await expectRingOnKeyboardOnly("name field", nameField(created));
        await expectRingOnKeyboardOnly(
            "size preset",
            created.getByRole("radio", { name: "32", exact: true }),
        );
        await dialogButton(created, "Create").click();
        await expect(created).toBeHidden();

        // The pivot presets of the Sprite properties dialog.
        const dialog = await openProperties(page);
        await expectRingOnKeyboardOnly("name field", nameField(dialog));
        await expectRingOnKeyboardOnly("pivot preset", pivotPreset(dialog, "Centre"));
        // Typing in a field focused with the pointer is not keyboard navigation.
        await nameField(dialog).click();
        await page.keyboard.type("x");
        expect(await ringOf(nameField(dialog)), "name field while typing after a click").toBe(
            "none",
        );
    });
}

test("pointer targets of the empty state and the dialogs are at least 24×24 px", async ({
    page,
}) => {
    /** Controls on the page that are smaller than 24 px in either direction. */
    const tooSmall = () =>
        page.evaluate(() =>
            [
                ...document.querySelectorAll(
                    'button, [role="radio"], input[type="text"]:not(.ui-number__input), .ui-number',
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

    await openEditor(page);
    expect(await tooSmall()).toEqual([]);
    expect((await boxOf(newSpriteButton(page))).height).toBe(24);

    await newSpriteButton(page).click();
    const created = newSpriteDialog(page);
    await expect(created).toBeVisible();
    expect(await created.locator("button, input").count()).toBeGreaterThanOrEqual(10);
    expect(await tooSmall()).toEqual([]);
    await dialogButton(created, "Create").click();

    const dialog = await openProperties(page);
    expect(await dialog.getByRole("radio").count()).toBe(9);
    expect(await tooSmall()).toEqual([]);
    // The document name does not change the height of the menu bar.
    expect((await boxOf(region(page, "menu-bar"))).height).toBe(36);
});

test("a long document name is cut off in the menu bar and does not push the menus out", async ({
    page,
}) => {
    await openEditor(page);
    const long = "a very long sprite name ".repeat(20).trim();
    await openSession(page, { name: long, width: 8, height: 8 });
    await expect(documentName(page)).toHaveText(long);
    const bar = await boxOf(region(page, "menu-bar"));
    const name = await boxOf(documentName(page));
    expect(bar.height).toBe(36);
    expect(name.x + name.width).toBeLessThanOrEqual(bar.x + bar.width);
    const menus = await boxOf(region(page, "menu-bar").getByRole("menubar"));
    expect(name.x).toBeGreaterThanOrEqual(menus.x + menus.width);
    expect(menus.x).toBe(8);
    // The full name is still available.
    await expect(documentName(page)).toHaveAttribute("title", long);
});
