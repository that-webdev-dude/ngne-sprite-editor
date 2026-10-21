import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { THEMES } from "./se-008-support";
import {
    answerNextChooser,
    BROKEN_PNG,
    escapeTop,
    expectAccessible,
    focusInside,
    startEditor,
    topSurface,
    visitAllSurfaces,
} from "./se-071-support";

/** Whether `surface` shows an error: a field marked invalid, or a message in an alert. */
function showsError(surface: Locator): Promise<boolean> {
    return surface.evaluate(
        (root) =>
            root.querySelector('[aria-invalid="true"]') !== null ||
            [...root.querySelectorAll('[role="alert"]')].some(
                (alert) => (alert.textContent ?? "").trim() !== "",
            ),
    );
}

/**
 * Types values a form refuses into its fields, one field and one value at a time, each
 * committed by leaving the field (Tab): no text, a text that is no colour, sizes out of range.
 * Stops at the first that shows an error; returns it, or null when none does.
 */
async function enterInvalid(page: Page, surface: Locator): Promise<string | null> {
    const fields = surface.locator(
        'input:not([type]):not([disabled]):not([readonly]), input[type="text"]:not([disabled]):not([readonly])',
    );
    const count = await fields.count();
    for (let index = 0; index < count; index++) {
        const field = fields.nth(index);
        if (!(await field.isVisible())) continue;
        const label =
            (await field.getAttribute("aria-label")) ??
            (await field.evaluate(
                (element) => (element as HTMLInputElement).labels?.[0]?.textContent ?? "",
            ));
        for (const value of ["", "zz", "0", "5000"]) {
            await field.fill(value);
            await page.keyboard.press("Tab");
            if (await showsError(surface))
                return `${label.trim() || `field ${index + 1}`} = "${value}"`;
        }
    }
    return null;
}

// SE-071: axe (WCAG 2.1 A and AA) on every dialog and every surface a command opens, in both
// themes: the dialogs of the dialog registry, the app's surfaces (command palette,
// Preferences, shortcut sheet) and the popovers commands open (layer and cel properties, the
// swatch editor). The surfaces are found from the registries at run time
// (`visitAllSurfaces`); each is judged on its own and with the page behind it, and so is the
// list of every select it holds. A form that checks its values is judged again showing its
// error (a value it refuses), and Import PNG with a file it could not read.

for (const theme of THEMES) {
    test(`axe reports no A/AA violation on any dialog or command surface in the ${theme} theme`, async ({
        page,
    }) => {
        // About 25 surfaces, two audits each; minutes on SwiftShader.
        test.setTimeout(15 * 60_000);
        const errors = collectErrors(page);
        await startEditor(page, { theme });
        const visited: string[] = [];
        const validating: string[] = [];
        const errorStates: string[] = [];
        await visitAllSurfaces(page, async ({ source, kind, name, selector, surface }) => {
            visited.push(`${source}: ${name}`);
            await expectAccessible(page, `${source}: ${name}`, selector);
            // A form that checks its values keeps a line for its message (an empty alert):
            // its error state is judged too, with a field it refuses.
            const alerts = surface.locator('[role="alert"]');
            if ((await alerts.count()) > 0 && !(await showsError(surface))) {
                validating.push(`${source}: ${name}`);
                const invalid = await enterInvalid(page, surface);
                if (invalid !== null) {
                    errorStates.push(`${source}: ${name}`);
                    await expectAccessible(page, `${source}: ${name}, ${invalid}`, selector);
                }
            }
            // Import PNG with a file that is not a PNG: the import failed.
            if (kind === "import-png") {
                answerNextChooser(page, [BROKEN_PNG]);
                await surface.getByRole("button", { name: "Choose files…" }).click();
                await expect(surface.locator("[data-import-file-errors] li")).toHaveCount(1);
                await expectAccessible(page, `${source}: ${name}, a file not read`, selector);
                errorStates.push(`${source}: ${name}, a file not read`);
            }
            // The list of each select of the surface, a layer of its own over it.
            const selects = surface.locator('button[role="combobox"]:not([disabled])');
            for (let index = 0; index < (await selects.count()); index++) {
                const select = selects.nth(index);
                const label = (await select.getAttribute("aria-label")) ?? `select ${index + 1}`;
                await select.click();
                await expect
                    .poll(async () => (await topSurface(page))?.selector !== selector)
                    .toBe(true);
                const list = (await topSurface(page))!;
                await expectAccessible(page, `${source}: ${name}, list of ${label}`, list.selector);
                await escapeTop(page);
                await expect.poll(() => focusInside(page, selector)).toBe(true);
                visited.push(`${source}: ${name}, list of ${label}`);
            }
        });
        test.info().annotations.push({ type: "surfaces", description: visited.join("; ") });
        test.info().annotations.push({
            type: "error states",
            description: errorStates.join("; "),
        });
        expect(validating.length, "forms that check their values").toBeGreaterThan(4);
        expect(
            validating.filter((form) => !errorStates.includes(form)),
            "forms whose error state was not reached",
        ).toEqual([]);
        expect(
            errorStates.some((state) => state.endsWith("a file not read")),
            "a failed import",
        ).toBe(true);
        expect(errors).toEqual([]);
    });
}
