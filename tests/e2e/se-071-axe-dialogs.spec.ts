import { expect, test } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { THEMES } from "./se-008-support";
import {
    escapeTop,
    expectAccessible,
    focusInside,
    startEditor,
    topSurface,
    visitAllSurfaces,
} from "./se-071-support";

// SE-071: axe (WCAG 2.1 A and AA) on every dialog and every surface a command opens, in both
// themes: the dialogs of the dialog registry, the app's surfaces (command palette,
// Preferences, shortcut sheet) and the popovers commands open (layer and cel properties, the
// swatch editor). The surfaces are found from the registries at run time
// (`visitAllSurfaces`); each is judged on its own and with the page behind it, and so is the
// list of every select it holds.

for (const theme of THEMES) {
    test(`axe reports no A/AA violation on any dialog or command surface in the ${theme} theme`, async ({
        page,
    }) => {
        // About 25 surfaces, two audits each; minutes on SwiftShader.
        test.setTimeout(15 * 60_000);
        const errors = collectErrors(page);
        await startEditor(page, { theme });
        const visited: string[] = [];
        await visitAllSurfaces(page, async ({ source, name, selector, surface }) => {
            visited.push(`${source}: ${name}`);
            await expectAccessible(page, `${source}: ${name}`, selector);
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
        expect(errors).toEqual([]);
    });
}
