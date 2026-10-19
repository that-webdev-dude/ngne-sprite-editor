import { expect, test } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openEditor } from "./se-007-support";
import { audit, startInTheme, THEMES } from "./se-008-support";
import { gifDialog, openGifDialog, openGifFixture } from "./se-063-support";

// SE-063: the Export GIF dialog meets the bar SE-006 set — no WCAG AA violation (axe) in
// either theme, every text judged by the contrast rule.

/** Two audits in one test: several seconds alone, longer while other workers are busy. */
const AXE_TIMEOUT_MS = 90_000;

for (const theme of THEMES) {
    test(`axe reports no AA violations in the Export GIF dialog in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await startInTheme(page, theme);
        await openEditor(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await openGifFixture(page, "fourFrames");

        const dialog = await openGifDialog(page);
        await expect(dialog.locator("[data-gif-result]")).toBeVisible();
        const whole = await audit(page);
        expect(whole.violations).toEqual([]);
        const own = await audit(page, ".ui-dialog");
        expect(own.violations).toEqual([]);
        expect(own.contrastUndecided).toEqual([]);
        expect(own.contrastChecked).toBeGreaterThan(0);
        await page.keyboard.press("Escape");
        await expect(gifDialog(page)).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}
