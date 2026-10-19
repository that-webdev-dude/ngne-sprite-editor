import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, settleTimers } from "./se-006-support";
import { openEditor } from "./se-007-support";
import { audit, startInTheme, THEMES } from "./se-008-support";
import {
    arrangeFolders,
    exportDialog,
    openExportDialog,
    openFixture,
    overwriteDialog,
    putFiles,
    stubExportFolders,
} from "./se-052-support";

// SE-052: the Export dialog and the overwrite question meet the bar SE-006 set — no WCAG AA
// violation (axe) in either theme, every text judged by the contrast rule — with a warning,
// with an error in place of the result, and with the files a folder holds.

/** Several audits in one test: about 10 s alone, longer while other workers are busy. */
const AXE_TIMEOUT_MS = 90_000;

async function expectAccessible(page: Page, name: string): Promise<void> {
    const whole = await audit(page);
    expect(whole.violations, name).toEqual([]);
    const own = await audit(page, ".ui-dialog");
    expect(own.violations, name).toEqual([]);
    expect(own.contrastUndecided, name).toEqual([]);
    expect(own.contrastChecked, name).toBeGreaterThan(0);
}

for (const theme of THEMES) {
    test(`axe reports no AA violations in the Export dialog and the overwrite question in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await startInTheme(page, theme);
        await stubExportFolders(page);
        await openEditor(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await openFixture(page, "a");
        // A second tag named "Walk": its animation is renamed "walk-2", a warning.
        await page.evaluate(() => {
            const state = window.__ngneTest!.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId)!;
            document.session.doc.tags[1]!.name = "Walk";
            state.touch(document.id);
        });

        let dialog = await openExportDialog(page);
        const warnings = dialog.locator("[data-export-warnings] li");
        await expect(warnings).toHaveText([
            "Tag “Walk” is exported as “walk-2”: an earlier tag has the ID “walk”.",
        ]);
        await expectAccessible(page, "Export with a warning");
        const warning = await audit(page, "[data-export-warnings]");
        expect(warning.violations).toEqual([]);
        expect(warning.contrastChecked).toBe(1);

        // The error of an export past the entry limit, in place of the result: 258 tags of
        // 255 passes, and the 13 entries of the fixture's own tags.
        await page.evaluate(() => {
            const state = window.__ngneTest!.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId)!;
            const { doc } = document.session;
            for (let index = 0; index < 258; index++) {
                doc.tags.push({
                    id: `se052-${index}`,
                    name: `t${index}`,
                    color: 0x3cb371ff,
                    fromFrameId: doc.frames[0]!.id,
                    toFrameId: doc.frames[0]!.id,
                    direction: "forward",
                    repeat: 255,
                });
            }
            state.touch(document.id);
        });
        await expect(dialog.getByRole("alert")).toContainText("65803 entries");
        await expectAccessible(page, "Export with an error");
        await page.keyboard.press("Escape");
        await expect(exportDialog(page)).toHaveCount(0);
        await settleTimers(page);

        // The overwrite question, for a folder that holds a file of the bundle.
        await page.evaluate(() => {
            const state = window.__ngneTest!.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId)!;
            document.session.doc.tags.splice(3);
            state.touch(document.id);
        });
        await putFiles(page, "shared", { "walker.png": [1] });
        await arrangeFolders(page, { nextFolder: ["shared"] });
        dialog = await openExportDialog(page);
        await dialog.getByRole("button", { name: "Export", exact: true }).click();
        await expect(overwriteDialog(page)).toBeVisible();
        await expectAccessible(page, "Replace files?");
        await overwriteDialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}
