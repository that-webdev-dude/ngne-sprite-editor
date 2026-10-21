import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, settleTimers } from "./se-006-support";
import { openEditor, openSession } from "./se-007-support";
import { audit, startInTheme, THEMES } from "./se-008-support";
import {
    choose,
    dropFiles,
    flat,
    gradient,
    importFromMenu,
    pngFile,
    setField,
    settledSummary,
} from "./se-044-support";

// SE-044: the Import PNG dialog and the drop chooser meet the bar SE-006 set: no WCAG AA
// violation (axe) in either theme, every text judged by the contrast rule; with a grid, a
// crop, a message that blocks Import and files that could not be read.

/** Several audits in one test: about 10 s alone, longer while other workers are busy. */
const AXE_TIMEOUT_MS = 90_000;

async function expectAccessible(page: Page, scope: string, name: string) {
    const own = await audit(page, scope);
    expect(own.violations, name).toEqual([]);
    expect(own.contrastUndecided, name).toEqual([]);
    expect(own.contrastChecked, name).toBeGreaterThan(0);
}

for (const theme of THEMES) {
    test(`axe reports no AA violations on Import PNG and the drop chooser in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await startInTheme(page, theme);
        await openEditor(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await openSession(page, { name: "hero", width: 16, height: 16 });

        const notes = { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("text") };
        const dialog = await importFromMenu(page, [pngFile("walk.png", gradient(128, 32)), notes]);
        await settledSummary(dialog);
        await expect(dialog.locator("[data-import-file-errors] li")).toHaveCount(1);
        await expectAccessible(page, ".ui-dialog", "dialog");

        await choose(dialog, "Cells", "Grid");
        await choose(dialog, "Region", "Crop");
        await choose(dialog, "Place", "New frames");
        await setField(dialog, "Width", 20);
        await expect(dialog.locator("[data-import-message]")).toBeVisible();
        await expectAccessible(page, ".ui-dialog", "grid, crop and message");
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        // The closed dialog returns the focus one timer later; a chooser opened before that
        // loses the focus to it and closes.
        await settleTimers(page);

        expect(
            await dropFiles(page, [pngFile("photo.png", flat(8, 8, [9, 9, 9, 255]))], {
                x: 400,
                y: 300,
            }),
        ).toBe(true);
        const chooser = page.getByRole("dialog", { name: "Drop photo.png" });
        await expect(chooser).toBeVisible();
        await expectAccessible(page, "[data-import-drop]", "drop chooser");
        // Radix has moved the focus into the popover before Escape is pressed.
        await expect
            .poll(() => chooser.evaluate((element) => element.contains(document.activeElement)))
            .toBe(true);
        await page.keyboard.press("Escape");
        await expect(chooser).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}
