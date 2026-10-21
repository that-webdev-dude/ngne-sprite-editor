import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as CommandTypes from "../../src/app/commands/types";
import type * as ToolRegistryModule from "../../src/app/tools/toolRegistry";
import type * as DockRegistryModule from "../../src/ui/dock/registry";
import { collectErrors, region, REGIONS, settleTimers } from "./se-006-support";
import { menuTrigger } from "./se-007-support";
import { THEMES } from "./se-008-support";
import { infoToast } from "./se-041-support";
import { arrangePickers, openTab, overflowButton } from "./se-047-support";
import {
    closeAll,
    dismissEveryToast,
    escapeTop,
    expectAccessible,
    focusInside,
    motionProblems,
    NOTIFICATIONS,
    openRichDocument,
    runCommand,
    showEveryToast,
    startEditor,
    topSurface,
} from "./se-071-support";

// SE-071: axe (WCAG 2.1 A and AA) on the shell and on every panel, menu and popover that no
// command opens, in both themes. What is visited comes from the registries at run time: the
// dock panels of the dock registry, the context bar of every tool of the tool registry, the
// menus of `MENU_BAR` and the submenus of the registry's menu paths, the context menus the
// registry's commands name; then the controls that open a popover or a list in the shell
// (found on the page: every button with `aria-haspopup`, every select), tooltips, toasts and
// the two full-window notices.

/** Waits for the surface on top to take the focus (Radix does it one timer after opening). */
async function surfaceOnTop(page: Page, what: string): Promise<{ selector: string; name: string }> {
    await expect.poll(async () => (await topSurface(page)) !== null, `${what} opens`).toBe(true);
    const top = (await topSurface(page))!;
    await expect.poll(() => focusInside(page, top.selector), `${what} has the focus`).toBe(true);
    return top;
}

/** With reduced motion (`startEditor`) nothing moves: an open surface, or once it closed. */
async function expectStill(page: Page, what: string): Promise<void> {
    expect(await motionProblems(page), `${what}: reduced motion`).toEqual([]);
}

for (const theme of THEMES) {
    test(`axe reports no A/AA violation on the shell, every dock panel and every tool's context bar in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(10 * 60_000);
        const errors = collectErrors(page);
        await startEditor(page, { theme });
        await expectAccessible(page, "empty state", "[data-empty-state]");
        await openRichDocument(page);
        await runCommand(page, "select.all");
        for (const id of REGIONS) {
            await expectAccessible(page, `region ${id}`, `[data-region="${id}"]`);
        }

        // Every dock panel, expanded.
        const panels = await page.evaluate(async () => {
            const path = "/src/ui/dock/registry.ts";
            const { dockPanels } = (await import(
                /* @vite-ignore */ path
            )) as typeof DockRegistryModule;
            return dockPanels.map((panel) => panel.id);
        });
        expect(panels.length).toBeGreaterThan(0);
        for (const id of panels) {
            const section = page.locator(`[data-dock-panel="${id}"]`);
            const toggle = section.locator(".dock-section__toggle");
            if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
            await expect(toggle).toHaveAttribute("aria-expanded", "true");
            await expectAccessible(page, `dock panel ${id}`, `[data-dock-panel="${id}"]`);
        }

        // The context bar of every tool.
        const tools = await page.evaluate(async () => {
            const path = "/src/app/tools/toolRegistry.ts";
            const { toolRegistry } = (await import(
                /* @vite-ignore */ path
            )) as typeof ToolRegistryModule;
            return toolRegistry.list().map((tool) => tool.id);
        });
        expect(tools.length).toBeGreaterThan(10);
        for (const tool of tools) {
            await runCommand(page, `tool.${tool}`);
            await expect
                .poll(() => page.evaluate(() => window.__ngneTest!.editor.getState().tool))
                .toBe(tool);
            await expectAccessible(page, `context bar of ${tool}`, '[data-region="context-bar"]');
        }
        expect(errors).toEqual([]);
    });

    test(`axe reports no A/AA violation on every menu, submenu and context menu in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(10 * 60_000);
        const errors = collectErrors(page);
        // Project files on OPFS (SE-047), so that a save puts a file in Open Recent.
        await startEditor(page, { theme, projectFiles: true });
        await openRichDocument(page);
        await arrangePickers(page, { nextSave: ["hero.ngsprite"] });
        await page.keyboard.press("Control+KeyS");
        await expect(infoToast(page, "Saved hero.ngsprite")).toBeVisible();

        const { menus, submenus, contextMenus } = await page.evaluate(async () => {
            const path = "/src/app/commands/types.ts";
            const { MENU_BAR } = (await import(/* @vite-ignore */ path)) as typeof CommandTypes;
            const commands = window.__ngneTest!.commands.list();
            const paths = new Set<string>();
            for (const command of commands) {
                const menuPath = command.menuPath ?? [];
                for (let depth = 2; depth <= menuPath.length; depth++) {
                    paths.add(JSON.stringify(menuPath.slice(0, depth)));
                }
            }
            return {
                menus: [...MENU_BAR],
                submenus: [...paths].map((path) => JSON.parse(path) as string[]),
                contextMenus: [
                    ...new Set(
                        commands.flatMap((command) => command.contextMenus.map((m) => m.menu)),
                    ),
                ].sort(),
            };
        });

        for (const menu of menus) {
            await menuTrigger(page, menu).click();
            const top = await surfaceOnTop(page, `menu ${menu}`);
            expect(top.name).toBe(menu);
            await expectAccessible(page, `menu ${menu}`, top.selector);
            await expectStill(page, `menu ${menu}`);
            await escapeTop(page);
            await expectStill(page, `menu ${menu} closed`);
        }
        expect(submenus.length).toBeGreaterThan(0);
        for (const path of submenus) {
            await menuTrigger(page, path[0]!).click();
            await surfaceOnTop(page, `menu ${path[0]}`);
            for (const name of path.slice(1)) {
                const item = page
                    .getByRole("menu")
                    .last()
                    .getByRole("menuitem", { name, exact: true });
                await item.focus();
                await page.keyboard.press("ArrowRight");
                await expect(page.getByRole("menu", { name })).toBeVisible();
            }
            const top = await surfaceOnTop(page, `submenu ${path.join(" › ")}`);
            await expectAccessible(page, `submenu ${path.join(" › ")}`, top.selector);
            await expectStill(page, `submenu ${path.join(" › ")}`);
            // Escape once the submenu holds the focus (Radix), and again while a menu is open.
            await closeAll(page);
            await expect(page.getByRole("menu")).toHaveCount(0);
            await settleTimers(page);
        }

        // Each context menu the registry's commands name, opened where the interface opens it.
        const openers: Record<string, () => Promise<void>> = {
            "timeline.layer": () =>
                page
                    .locator('[role="row"][data-layer] [data-layer-header]')
                    .first()
                    .click({ button: "right" }),
            "timeline.frame": () =>
                page.locator(".timeline__frame").first().click({ button: "right" }),
            "timeline.cel": () =>
                page.locator("[data-timeline-cell]").first().click({ button: "right" }),
            "timeline.tag": () => page.locator("[data-tag]").first().click({ button: "right" }),
            palette: () => page.getByRole("button", { name: "Swatch actions" }).click(),
            "palette-presets": () =>
                page
                    .locator('[data-dock-panel="palette"]')
                    .getByRole("button", { name: /^Presets/ })
                    .click(),
        };
        const palette = page.locator('[data-dock-panel="palette"] .dock-section__toggle');
        if ((await palette.getAttribute("aria-expanded")) === "false") await palette.click();
        expect(
            contextMenus.filter((menu) => !openers[menu]),
            "context menus without an opener",
        ).toEqual([]);
        for (const menu of contextMenus) {
            await openers[menu]!();
            const top = await surfaceOnTop(page, `context menu ${menu}`);
            await expectAccessible(page, `context menu ${menu}`, top.selector);
            await expectStill(page, `context menu ${menu}`);
            await escapeTop(page);
            await expectStill(page, `context menu ${menu} closed`);
        }
        expect(errors).toEqual([]);
    });

    test(`axe reports no A/AA violation on the shell's popovers, lists, tooltips, toasts and notices in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(10 * 60_000);
        const errors = collectErrors(page);
        await startEditor(page, { theme });
        await openRichDocument(page);
        const palette = page.locator('[data-dock-panel="palette"] .dock-section__toggle');
        if ((await palette.getAttribute("aria-expanded")) === "false") await palette.click();

        // Every control of the shell that opens a popover or a menu, and the tool slots with
        // variants (Shift+F10 opens their menu). Menu bar triggers were judged with the menus.
        const openers = page.locator(
            '[data-region]:not([data-region="menu-bar"]) button[aria-haspopup]:not([disabled]), .tool-rail__variants',
        );
        const count = await openers.count();
        expect(count).toBeGreaterThan(5);
        for (let index = 0; index < count; index++) {
            const opener = openers.nth(index);
            const label =
                (await opener.getAttribute("aria-label")) ?? (await opener.textContent()) ?? "";
            if (
                await opener.evaluate((element) =>
                    element.classList.contains("tool-rail__variants"),
                )
            ) {
                await opener.focus();
                await page.keyboard.press("Shift+F10");
            } else {
                await opener.click();
            }
            const top = await surfaceOnTop(page, label);
            await expectAccessible(page, `popover of ${label}`, top.selector);
            await expectStill(page, `popover of ${label}`);
            await escapeTop(page);
            await expectStill(page, `popover of ${label} closed`);
        }

        // The list of every select of the shell.
        const selects = page.locator('[data-region] button[role="combobox"]:not([disabled])');
        const selectCount = await selects.count();
        expect(selectCount).toBeGreaterThan(0);
        for (let index = 0; index < selectCount; index++) {
            const select = selects.nth(index);
            const label =
                (await select.getAttribute("aria-label")) ?? (await select.textContent()) ?? "";
            await select.click();
            const top = await surfaceOnTop(page, `select ${label}`);
            await expectAccessible(page, `list of ${label}`, top.selector);
            await expectStill(page, `list of ${label}`);
            await escapeTop(page);
            await expectStill(page, `list of ${label} closed`);
        }

        // The overflow menu of the document tabs.
        for (let index = 1; index <= 12; index++) await openTab(page, `sprite ${index}`);
        await overflowButton(page).click();
        const tabs = await surfaceOnTop(page, "All documents");
        await expectAccessible(page, "All documents", tabs.selector);
        await expectStill(page, "All documents");
        await escapeTop(page);
        await expectStill(page, "All documents closed");

        // A tooltip, on keyboard focus.
        const tool = region(page, "tool-rail").locator("[data-tool]").first();
        await tool.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(page.getByRole("tooltip")).toBeVisible();
        await expectAccessible(page, "tooltip", '[role="tooltip"]');

        // A toast of every kind: information, error, SE-072's update toast with Reload, a
        // failed storage write.
        await showEveryToast(page);
        await expectAccessible(page, "toasts", NOTIFICATIONS);
        await dismissEveryToast(page);

        // The two full-window notices: the window too small, then no WebGPU.
        await page.setViewportSize({ width: 1200, height: 700 });
        await expect(page.locator('[data-notice="window-too-small"]')).toBeVisible();
        await expectAccessible(page, "window too small", '[data-notice="window-too-small"]');
        await page.addInitScript(() => {
            delete (Navigator.prototype as { gpu?: unknown }).gpu;
        });
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.reload();
        await expect(page.locator('[data-notice="webgpu-required"]')).toBeVisible();
        await expectAccessible(page, "WebGPU required", '[data-notice="webgpu-required"]');
        expect(errors).toEqual([]);
    });
}
