import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { audit, startInTheme, THEMES } from "./se-008-support";
import { openDocument } from "./se-011-support";
import { openPreviewEditor, previewSection, previewSettled, setPreview } from "./se-054-support";

// SE-054: the preview panel meets the bar SE-006 set — no WCAG AA violation (axe) in either
// theme, every text judged by the contrast rule — playing, with a diagnostic listed, and with
// its message in place of the canvas.

/** Several audits in one test: about 10 s alone, longer while other workers are busy. */
const AXE_TIMEOUT_MS = 90_000;
const PANEL = '[data-dock-panel="preview"]';

async function expectAccessible(page: Page, name: string) {
    const own = await audit(page, PANEL);
    expect(own.violations, name).toEqual([]);
    expect(own.contrastUndecided, name).toEqual([]);
    expect(own.contrastChecked, name).toBeGreaterThan(0);
}

for (const theme of THEMES) {
    test(`axe reports no AA violations in the preview panel in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(AXE_TIMEOUT_MS);
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await startInTheme(page, theme);
        await openPreviewEditor(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        // No document: the controls are disabled.
        await expectAccessible(page, "no document");

        const document = await openDocument(page, { name: "a11y", width: 16, height: 16 });
        await previewSettled(page);
        await expectAccessible(page, "playing");
        for (const background of ["light", "mid"] as const) {
            await setPreview(page, { background });
            await expectAccessible(page, `background ${background}`);
        }

        // A diagnostic listed under the controls.
        await page.evaluate(() =>
            window.__ngneTest!.previewState!.setState({
                diagnostics: ["Texture replacement failed: pv:atlas"],
            }),
        );
        await expect(previewSection(page).getByRole("listitem")).toHaveCount(1);
        await expectAccessible(page, "diagnostic");

        // An export error in place of the canvas, over each background.
        await page.evaluate((id) => {
            const state = window.__ngneTest!.sessions.getState();
            const { doc } = state.documents.find((entry) => entry.id === id)!.session;
            for (let index = 0; index < 258; index++) {
                doc.tags.push({
                    id: `se054-${index}`,
                    name: `t${index}`,
                    color: 0x3cb371ff,
                    fromFrameId: doc.frames[0]!.id,
                    toFrameId: doc.frames[0]!.id,
                    direction: "forward",
                    repeat: 255,
                });
            }
            state.touch(id);
        }, document.id);
        await expect(previewSection(page).getByRole("status")).toContainText("Cannot preview");
        for (const background of ["dark", "light", "mid"] as const) {
            await setPreview(page, { background });
            await expectAccessible(page, `error over ${background}`);
        }
        expect(errors).toEqual([]);
    });
}
