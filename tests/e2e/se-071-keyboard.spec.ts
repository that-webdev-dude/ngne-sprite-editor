import { expect, test } from "@playwright/test";
import type { JSHandle, Page } from "@playwright/test";
import type * as CommandTypes from "../../src/app/commands/types";
import { collectErrors, REGIONS, settleTimers } from "./se-006-support";
import { menuTrigger } from "./se-007-support";
import { activeOption, openPalette, paletteInput, paletteOption } from "./se-064-support";
import {
    armCommand,
    askingCommands,
    closeAll,
    openRichDocument,
    runCommand,
    startEditor,
    surfaceOpened,
    topSurface,
} from "./se-071-support";

// SE-071: the keyboard walk-through of DESIGN §8. Every command of the registry is reachable
// from the keyboard — each one through the command palette, and each enabled menu command
// through the menus; F6 and Shift+F6 cycle the regions; every surface a command opens closes
// on Escape, changes nothing by it, and gives the focus back to where it came from: the
// element focused when the palette was opened, the menu bar's trigger for a menu item, the
// cell or swatch a context menu was opened on. The commands come from the registry at run
// time.

/** The region of the focused element, or null. */
function focusedRegion(page: Page): Promise<string | null> {
    return page.evaluate(
        () => document.activeElement?.closest("[data-region]")?.getAttribute("data-region") ?? null,
    );
}

/** What the active document's history holds: Escape must leave it as it was. */
function historyState(page: Page): Promise<string> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) return "no document";
        const { history } = document;
        return `${state.documents.length} documents; ${history.undoCount} undo, ${history.redoCount} redo, ${history.undoLabel}`;
    });
}

/** Moves the focus with F6 into `region`. */
async function focusRegion(page: Page, region: string): Promise<void> {
    for (let presses = 0; presses < REGIONS.length + 1; presses++) {
        if ((await focusedRegion(page)) === region) return;
        await page.keyboard.press("F6");
    }
    expect(await focusedRegion(page)).toBe(region);
}

/** Whether the focus is on the element `origin` holds. */
function focusIsOn(page: Page, origin: JSHandle): Promise<boolean> {
    return page.evaluate((element) => document.activeElement === element, origin);
}

/**
 * The surface open now, closed with Escape: the history unchanged and the focus where it
 * belongs.
 *
 * - A dialog or app surface gives it back to `origin`: the element focused when the palette
 *   was opened, the menu bar's trigger (`focusMenuOpener`), the cell or swatch a context menu
 *   was opened on.
 * - A popover anchored in the timeline (layer and cel properties) gives it back to the element
 *   that had it when it opened, and to the active cell when that was a menu item, now gone
 *   (SE-022, SE-061).
 * - The swatch editor gives it to its swatch, or to the "Swatch actions" button when no swatch
 *   is on the page (SE-060).
 */
async function escapeBackTo(
    page: Page,
    what: string,
    origin: JSHandle,
    openedByMenuItem: boolean,
): Promise<void> {
    const top = (await topSurface(page))!;
    const kind = await page
        .locator(top.selector)
        .evaluate((element) =>
            element.matches("[data-swatch-editor]")
                ? "swatch editor"
                : element.matches(".timeline-properties")
                  ? "timeline popover"
                  : "dialog",
        );
    const before = await historyState(page);
    await closeAll(page);
    expect(await historyState(page), `${what}: Escape changes nothing`).toBe(before);
    const swatch = page.locator('[data-dock-panel="palette"] [role="gridcell"][tabindex="0"]');
    const target =
        kind === "swatch editor"
            ? (await swatch.count()) > 0
                ? swatch
                : page.getByRole("button", { name: "Swatch actions" })
            : kind === "timeline popover" && openedByMenuItem
              ? page.locator('[data-timeline-cell][tabindex="0"]')
              : null;
    const expected = target ? await target.elementHandle() : origin;
    await expect
        .poll(
            async () =>
                (await focusIsOn(page, expected!)) ? "where it belongs" : await describeFocus(page),
            `${what} (${kind}): the focus is back`,
        )
        .toBe("where it belongs");
}

/** The focused element, for a failure message. */
function describeFocus(page: Page): Promise<string> {
    return page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return "body";
        const name = element.getAttribute("aria-label") ?? (element.textContent ?? "").slice(0, 30);
        return `${element.tagName.toLowerCase()}[role=${element.getAttribute("role")}] "${name}"`;
    });
}

test("every command of the registry is found in the command palette and reached with the arrow keys", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    const commands = await page.evaluate(() =>
        window.__ngneTest!.commands.list().map((command) => ({
            id: command.id,
            title: command.title(),
            enabled: command.enabled(),
        })),
    );
    expect(commands.length).toBeGreaterThan(100);
    await openPalette(page);
    for (const { id, title, enabled } of commands) {
        await paletteInput(page).fill(title);
        const option = paletteOption(page, id);
        await expect(option, id).toHaveCount(1);
        for (let presses = 0; presses < 60; presses++) {
            if ((await option.getAttribute("aria-selected")) === "true") break;
            await page.keyboard.press("ArrowDown");
        }
        await expect(activeOption(page), id).toHaveAttribute("data-command", id);
        // A disabled command is listed and inert (DESIGN §4).
        if (enabled) await expect(option, id).not.toHaveAttribute("aria-disabled", "true");
        else await expect(option, id).toHaveAttribute("aria-disabled", "true");
    }
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
});

test("every enabled command of the menu bar is reached with the arrow keys", async ({ page }) => {
    test.setTimeout(5 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    await runCommand(page, "select.all");
    const { menus, expected } = await page.evaluate(async () => {
        const path = "/src/app/commands/types.ts";
        const { MENU_BAR } = (await import(/* @vite-ignore */ path)) as typeof CommandTypes;
        return {
            menus: [...MENU_BAR],
            expected: window
                .__ngneTest!.commands.list()
                .filter((command) => !command.planned && command.enabled() && command.menuPath)
                .map((command) => command.id)
                .sort(),
        };
    });
    expect(expected.length).toBeGreaterThan(40);

    const focusedItem = () =>
        page.evaluate(() => {
            const element = document.activeElement;
            return {
                command: element?.getAttribute("data-command") ?? null,
                submenu: element?.getAttribute("aria-haspopup") === "menu",
                text: element?.textContent ?? "",
                key: element ? `${element.id}|${element.textContent}` : "",
            };
        });
    /** Walks the open menu from its first item down; returns the commands it focused. */
    const walk = async (depth: number): Promise<string[]> => {
        const seen: string[] = [];
        let previous = "";
        for (let step = 0; step < 80; step++) {
            await settleTimers(page);
            const item = await focusedItem();
            if (item.key === previous) break;
            previous = item.key;
            if (item.command) seen.push(item.command);
            if (item.submenu && depth < 3) {
                await page.keyboard.press("ArrowRight");
                await expect(page.getByRole("menu")).toHaveCount(depth + 2);
                await settleTimers(page);
                seen.push(...(await walk(depth + 1)));
                await page.keyboard.press("ArrowLeft");
                await expect(page.getByRole("menu")).toHaveCount(depth + 1);
                await settleTimers(page);
            }
            await page.keyboard.press("ArrowDown");
        }
        return seen;
    };

    const reached = new Set<string>();
    await focusRegion(page, "menu-bar");
    await expect(menuTrigger(page, menus[0]!)).toBeFocused();
    for (const [index, menu] of menus.entries()) {
        if (index === 0) await page.keyboard.press("ArrowDown");
        else await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("menu", { name: menu })).toBeVisible();
        await expect.poll(async () => (await focusedItem()).key !== "").toBe(true);
        // Arrow keys from the top: ArrowRight lands on the first item, as ArrowDown does.
        for (const id of await walk(0)) reached.add(id);
        // Back to the top item, so that ArrowRight opens the next menu (not a submenu).
        await page.keyboard.press("Home");
        await settleTimers(page);
        const top = await focusedItem();
        if (top.submenu) await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Escape");
    expect(
        expected.filter((id) => !reached.has(id)),
        "menu commands not reached",
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("F6 and Shift+F6 cycle through every region of the shell with a document open", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const forward: (string | null)[] = [];
    for (let presses = 0; presses <= REGIONS.length; presses++) {
        await page.keyboard.press("F6");
        forward.push(await focusedRegion(page));
    }
    expect(forward).toEqual([...REGIONS, REGIONS[0]]);
    const backward: (string | null)[] = [];
    for (let presses = 0; presses <= REGIONS.length; presses++) {
        await page.keyboard.press("Shift+F6");
        backward.push(await focusedRegion(page));
    }
    expect(backward).toEqual([...[...REGIONS].reverse(), REGIONS.at(-1)]);
    expect(errors).toEqual([]);
});

test("every surface a command opens from the palette closes on Escape, changes nothing and returns the focus to the viewport", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    const visited: string[] = [];
    for (const id of await askingCommands(page)) {
        await focusRegion(page, "viewport");
        const origin = await page.evaluateHandle(() => document.activeElement);
        const title = await page.evaluate((id) => window.__ngneTest!.commands.get(id)!.title(), id);
        await openPalette(page);
        await paletteInput(page).fill(title);
        for (let presses = 0; presses < 60; presses++) {
            if ((await paletteOption(page, id).getAttribute("aria-selected")) === "true") break;
            await page.keyboard.press("ArrowDown");
        }
        await armCommand(page, id);
        await page.keyboard.press("Enter");
        // The palette closes; the command runs where the focus went back to (Command
        // Palette… opens it again).
        await expect
            .poll(
                async () =>
                    (await page.evaluate(() => window.__se071?.settled ?? true)) ||
                    (await paletteInput(page).count()) === 0,
                `${id}: the palette closes`,
            )
            .toBe(true);
        if (await surfaceOpened(page)) {
            const top = await topSurface(page);
            visited.push(`${id}: ${top?.name}`);
            await escapeBackTo(page, id, origin, false);
        } else {
            // A picker that was cancelled: the focus is where it was too.
            await expect.poll(() => focusIsOn(page, origin), id).toBe(true);
        }
    }
    expect(visited.length).toBeGreaterThan(10);
    test.info().annotations.push({ type: "surfaces", description: visited.join("; ") });

    // The discard question, asked by Close (Alt+W) from the viewport.
    await focusRegion(page, "viewport");
    const origin = await page.evaluateHandle(() => document.activeElement);
    await armCommand(page, "file.close");
    await page.keyboard.press("Alt+KeyW");
    expect(await surfaceOpened(page)).toBe(true);
    expect((await topSurface(page))?.name).toBe("Discard unsaved changes?");
    await escapeBackTo(page, "file.close", origin, false);
    expect(errors).toEqual([]);
});

test("every surface a menu item opens closes on Escape, changes nothing and returns the focus to the menu bar", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    const asking = await askingCommands(page);
    const items = await page.evaluate(
        (ids) =>
            ids.flatMap((id) => {
                const path = window.__ngneTest!.commands.get(id)!.menuPath;
                return path ? [{ id, path: [...path] }] : [];
            }),
        asking,
    );
    expect(items.length).toBeGreaterThan(10);
    let surfaces = 0;
    for (const { id, path } of items) {
        const trigger = menuTrigger(page, path[0]!);
        await trigger.focus();
        const origin = await trigger.elementHandle();
        await page.keyboard.press("ArrowDown");
        await expect(page.getByRole("menu", { name: path[0] })).toBeVisible();
        for (const name of path.slice(1)) {
            for (let presses = 0; presses < 40; presses++) {
                await settleTimers(page);
                const text = await page.evaluate(() => document.activeElement?.textContent ?? "");
                if (text.startsWith(name)) break;
                await page.keyboard.press("ArrowDown");
            }
            await page.keyboard.press("ArrowRight");
            await expect(page.getByRole("menu", { name })).toBeVisible();
        }
        const item = page.locator(`[role="menuitem"][data-command="${id}"]`);
        for (let presses = 0; presses < 40; presses++) {
            await settleTimers(page);
            if (await item.evaluate((element) => element === document.activeElement)) break;
            await page.keyboard.press("ArrowDown");
        }
        await expect(item, id).toBeFocused();
        await armCommand(page, id);
        await page.keyboard.press("Enter");
        await expect(page.getByRole("menu")).toHaveCount(0);
        if (await surfaceOpened(page)) {
            surfaces++;
            await escapeBackTo(page, id, origin!, true);
        } else {
            await expect.poll(() => focusIsOn(page, origin!), id).toBe(true);
        }
    }
    expect(surfaces).toBeGreaterThan(10);
    expect(errors).toEqual([]);
});

test("a surface opened from a context menu by the keyboard returns the focus to the cell or swatch", async ({
    page,
}) => {
    test.setTimeout(5 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    const palette = page.locator('[data-dock-panel="palette"] .dock-section__toggle');
    if ((await palette.getAttribute("aria-expanded")) === "false") await palette.click();

    // The context menus the keyboard opens: the focused cell's (SE-026) and the current
    // swatch's (SE-060), with Shift+F10.
    const origins = {
        "timeline.cel": page.locator('[data-timeline-cell][tabindex="0"]'),
        palette: page.locator('[data-dock-panel="palette"] [role="gridcell"][tabindex="0"]'),
    };
    const asking = await askingCommands(page);
    let opened = 0;
    for (const [menu, originLocator] of Object.entries(origins)) {
        const ids = await page.evaluate(
            ({ ids, menu }) =>
                ids.filter((id) =>
                    window
                        .__ngneTest!.commands.get(id)!
                        .contextMenus.some((placement) => placement.menu === menu),
                ),
            { ids: asking, menu },
        );
        expect(ids.length, menu).toBeGreaterThan(0);
        for (const id of ids) {
            await originLocator.focus();
            await expect(originLocator).toBeFocused();
            const origin = (await originLocator.elementHandle())!;
            await page.keyboard.press("Shift+F10");
            await expect(page.getByRole("menu"), `${menu} menu`).toBeVisible();
            const item = page.locator(`[role="menuitem"][data-command="${id}"]`);
            for (let presses = 0; presses < 40; presses++) {
                await settleTimers(page);
                if (await item.evaluate((element) => element === document.activeElement)) break;
                await page.keyboard.press("ArrowDown");
            }
            await expect(item, id).toBeFocused();
            await armCommand(page, id);
            await page.keyboard.press("Enter");
            await expect(page.getByRole("menu")).toHaveCount(0);
            if (await surfaceOpened(page)) {
                opened++;
                await escapeBackTo(page, `${menu}: ${id}`, origin, true);
            } else {
                await expect.poll(() => focusIsOn(page, origin), id).toBe(true);
            }
        }
    }
    expect(opened).toBeGreaterThan(1);
    expect(errors).toEqual([]);
});

test("menus and select lists take typeahead (Radix, DESIGN §8)", async ({ page }) => {
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    await focusRegion(page, "menu-bar");
    await page.keyboard.press("ArrowDown");
    const file = page.getByRole("menu", { name: "File" });
    await expect(file).toBeVisible();
    await settleTimers(page);
    // The first enabled item of the File menu whose title starts with E.
    const target = await file.evaluate((menu) =>
        Array.from(menu.querySelectorAll('[role="menuitem"]:not([data-disabled])'))
            .map((item) => item.textContent ?? "")
            .find((text) => text.startsWith("E")),
    );
    expect(target).toBeTruthy();
    await page.keyboard.press("e");
    await expect
        .poll(() => page.evaluate(() => document.activeElement?.textContent ?? ""))
        .toBe(target);
    await page.keyboard.press("Escape");
    await expect(file).toBeHidden();

    // The Ink select of the pencil's context bar.
    const ink = page.locator('[data-region="context-bar"] button[role="combobox"]').first();
    await ink.focus();
    await page.keyboard.press("Enter");
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await settleTimers(page);
    const options = await list.getByRole("option").allTextContents();
    const other = options.find((text) => text !== (options[0] ?? ""))!;
    await page.keyboard.press(other[0]!.toLowerCase());
    await expect
        .poll(() => page.evaluate(() => document.activeElement?.textContent ?? ""))
        .toBe(other);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    expect(errors).toEqual([]);
});

test("a tab's close control is for the pointer only: hidden from assistive technology and no tab stop", async ({
    page,
}) => {
    await startEditor(page);
    await openRichDocument(page);
    const close = page.locator("[data-tab-close]").first();
    await expect(close).toHaveAttribute("aria-hidden", "true");
    expect(await close.evaluate((element) => (element as HTMLElement).tabIndex)).toBeLessThan(0);
    // Inside the tab, which the keyboard closes with Delete (SE-047).
    expect(await close.evaluate((element) => element.closest('[role="tab"]') !== null)).toBe(true);
});
