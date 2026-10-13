import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { formatChord } from "../../src/app/commands/chord";
import { boxOf, collectErrors, contains, settleTimers } from "./se-006-support";
import {
    addTextField,
    menuItem,
    menuTrigger,
    openEditor,
    openMenu,
    openSession,
    rename,
} from "./se-007-support";
import { dialogButton, newSpriteButton, newSpriteDialog } from "./se-008-support";
import {
    expectShellUsable,
    openFromEditMenu,
    openShortcutSheet,
    registerProbes,
    registryCommands,
    ringOf,
    SHORTCUTS_COMMAND,
    shortcutList,
    shortcutSheet,
} from "./se-064-support";
import type { Probe } from "./se-064-support";

// SE-064: the shortcut sheet (DESIGN §7) — opened with "?", generated from the command
// registry, grouped by menu. The sheet is compared with the registry of the running app, so
// the test keeps its meaning as later tickets register their shortcuts.

const MENUS = ["File", "Edit", "Sprite", "Layer", "Frame", "Select", "View"];

/** Commands with shortcuts that only these tests have: in a menu, in a submenu, outside. */
const PROBES: readonly Probe[] = [
    {
        id: "se064.viewKey",
        title: "Quokka View",
        shortcut: ["Ctrl+Alt+F9", "Ctrl+Alt+Shift+F9"],
        menuPath: ["View"],
        menuOrder: 9000,
    },
    {
        id: "se064.nested",
        title: "Quokka Nested",
        shortcut: "Ctrl+Alt+F10",
        menuPath: ["View", "SE-064 Submenu"],
        menuOrder: 9010,
    },
    { id: "se064.hold", title: "Quokka Hold", shortcut: "Alt+F9", hold: true },
    { id: "se064.arrow", title: "Quokka Arrow", shortcut: "Ctrl+Alt+ArrowLeft" },
    { id: "se064.unbound", title: "Quokka Unbound", menuPath: ["View"], menuOrder: 9020 },
];

interface SheetRow {
    group: string;
    id: string;
    title: string;
    /** Canonical chords, from `data-chord`. */
    chords: string[];
    /** The chords as shown. */
    keys: string[];
    hold: boolean;
}

/** Every row of the open sheet, in the order shown. */
function sheetRows(page: Page): Promise<SheetRow[]> {
    return shortcutSheet(page).evaluate((sheet) =>
        Array.from(sheet.querySelectorAll<HTMLElement>("[data-shortcut-group]"), (group) =>
            Array.from(group.querySelectorAll<HTMLElement>("[data-command]"), (row) => ({
                group: group.dataset.shortcutGroup ?? "",
                id: row.dataset.command ?? "",
                title: row.querySelector("dt")?.textContent ?? "",
                chords: Array.from(
                    row.querySelectorAll<HTMLElement>("kbd"),
                    (key) => key.dataset.chord ?? "",
                ),
                keys: Array.from(row.querySelectorAll("kbd"), (key) => key.textContent ?? ""),
                hold: row.querySelector(".shortcut-sheet__hold") !== null,
            })),
        ).flat(),
    );
}

/** Every binding as "command chord", sorted. */
const bindings = (rows: { id: string; chords: string[] }[]) =>
    rows.flatMap((row) => row.chords.map((chord) => `${row.id} ${chord}`)).sort();

test("the shortcut sheet lists exactly the registry's shortcuts", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    // With a document and something to undo, so that titles which follow the state are compared.
    const id = await openSession(page, { name: "start", width: 8, height: 8 });
    await rename(page, id, "first", "Pencil");
    await registerProbes(page, PROBES);
    const registry = await registryCommands(page);
    const bound = registry.filter((command) => command.shortcuts.length > 0);
    // The registry holds bindings of SE-007, SE-008, this ticket and this test at least.
    expect(
        bindings(bound.map((command) => ({ id: command.id, chords: command.shortcuts }))),
    ).toEqual(
        expect.arrayContaining([
            "edit.undo Ctrl+Z",
            "edit.redo Ctrl+Y",
            "edit.redo Ctrl+Shift+Z",
            "focus.nextRegion F6",
            "focus.previousRegion Shift+F6",
            "file.new Ctrl+Alt+N",
            "edit.commandPalette Ctrl+K",
            "edit.shortcuts ?",
            "se064.viewKey Ctrl+Alt+F9",
            "se064.viewKey Ctrl+Alt+Shift+F9",
            "se064.hold Alt+F9",
        ]),
    );

    await openShortcutSheet(page);
    const rows = await sheetRows(page);
    // The comparison: every chord of every command, and nothing else.
    expect(bindings(rows)).toEqual(
        bindings(bound.map((command) => ({ id: command.id, chords: command.shortcuts }))),
    );
    // Each command with a shortcut has one row; a command without one has none.
    expect(rows.map((row) => row.id).sort()).toEqual(bound.map((command) => command.id).sort());
    expect(rows.map((row) => row.id)).not.toContain("se064.unbound");
    for (const command of bound) {
        const row = rows.find((entry) => entry.id === command.id);
        expect(row, command.id).toMatchObject({
            title: command.title,
            // All its chords, in the registry's order, shown as the menus show them.
            chords: command.shortcuts,
            keys: command.shortcuts.map(formatChord),
            hold: command.hold,
            group: command.menu ?? "Other",
        });
    }
    // What is on the page is what was compared: nothing is hidden or cut off.
    const sheet = shortcutSheet(page);
    await expect(sheet.locator("[data-command]")).toHaveCount(bound.length);
    await expect(sheet.locator('[data-command="edit.undo"]')).toHaveText("Undo PencilCtrl+Z");
    await expect(sheet.locator('[data-command="edit.redo"]')).toHaveText("RedoCtrl+YCtrl+Shift+Z");
    await expect(sheet.locator('[data-command="se064.arrow"]')).toHaveText(
        "Quokka ArrowCtrl+Alt+←",
    );
    await expect(sheet.locator('[data-command="se064.hold"]')).toHaveText("Quokka HoldAlt+F9hold");
    await expect(sheet.locator('[data-command="edit.shortcuts"]')).toHaveText(
        "Keyboard Shortcuts…?",
    );
    expect(errors).toEqual([]);
});

test("the sheet is grouped by menu, in the order of the menu bar and of each menu", async ({
    page,
}) => {
    await openEditor(page);
    await registerProbes(page, PROBES);
    const registry = await registryCommands(page);
    await openShortcutSheet(page);
    const sheet = shortcutSheet(page);
    const rows = await sheetRows(page);

    // One heading per menu that has shortcuts, in menu-bar order; the rest under "Other".
    const groups = [...new Set(rows.map((row) => row.group))];
    const withShortcuts = (menu: string) =>
        registry.some((command) => command.menu === menu && command.shortcuts.length > 0);
    expect(groups).toEqual([...MENUS.filter(withShortcuts), "Other"]);
    expect(groups).toEqual(expect.arrayContaining(["File", "Edit", "View"]));
    await expect(sheet.getByRole("heading", { level: 3 })).toHaveText(groups);
    await expect(
        sheet.getByRole("heading", { name: "Keyboard shortcuts", level: 2 }),
    ).toBeVisible();

    // Inside a menu, the order of the menu: Undo before Redo, the palette before the sheet.
    const inGroup = (group: string) =>
        rows.filter((row) => row.group === group).map((row) => row.id);
    const known = ["edit.undo", "edit.redo", "edit.commandPalette", "edit.shortcuts"];
    expect(inGroup("File")).toContain("file.new");
    expect(inGroup("Edit").filter((id) => known.includes(id))).toEqual(known);
    // A command of a submenu belongs to its menu.
    expect(inGroup("View").slice(-2)).toEqual(["se064.viewKey", "se064.nested"]);
    // Outside the menus: by title.
    const other = rows.filter((row) => row.group === "Other");
    expect(other.map((row) => row.title)).toEqual(
        [...other.map((row) => row.title)].sort((a, b) => a.localeCompare(b, "en")),
    );
    expect(other.map((row) => row.id)).toEqual(
        expect.arrayContaining(["focus.nextRegion", "focus.previousRegion", "se064.hold"]),
    );

    // The same order as the Edit menu itself shows.
    await dialogButton(sheet, "Close").click();
    await expect(sheet).toBeHidden();
    const menu = await openMenu(page, "Edit");
    const withKey = await menu.evaluate((element) =>
        Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]'))
            .filter((item) => item.querySelector(".ui-menu__shortcut"))
            .map((item) => item.dataset.command),
    );
    expect(withKey).toEqual(inGroup("Edit"));
});

test("? opens the shortcut sheet in the canvas context; in a text field it is typed", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const sheet = shortcutSheet(page);

    // With nothing focused, and with a control focused.
    await openShortcutSheet(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await newSpriteButton(page).focus();
    await page.keyboard.press("Shift+Slash");
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(newSpriteButton(page)).toBeFocused();

    // SPEC §7.8: not marked †. A text field takes the character and no sheet opens.
    const text = await addTextField(page, "context-bar");
    await text.focus();
    await page.keyboard.press("Shift+Slash");
    await expect(text).toHaveValue("?");
    await settleTimers(page);
    await expect(sheet).toHaveCount(0);
    await text.evaluate((element) => element.remove());

    // Not while a menu or a dialog is open: those handle their own keys.
    const menu = await openMenu(page, "View");
    await page.keyboard.press("Shift+Slash");
    await settleTimers(page);
    await expect(sheet).toHaveCount(0);
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await newSpriteButton(page).click();
    await expect(newSpriteDialog(page)).toBeVisible();
    await newSpriteDialog(page).getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Shift+Slash");
    await settleTimers(page);
    await expect(sheet).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(newSpriteDialog(page)).toBeHidden();

    // The sheet is such a dialog: a second "?" does not open another one.
    await openShortcutSheet(page);
    await page.keyboard.press("Shift+Slash");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    expect(errors).toEqual([]);
});

test("the Edit menu opens the sheet and shows its key; focus returns to the menu", async ({
    page,
}) => {
    await openEditor(page);
    await openMenu(page, "Edit");
    await expect(menuItem(page, SHORTCUTS_COMMAND)).toHaveText("Keyboard Shortcuts…?");
    await page.keyboard.press("Escape");
    const sheet = await openFromEditMenu(page, SHORTCUTS_COMMAND, shortcutSheet(page));
    expect((await boxOf(sheet)).width).toBe(560);
    await dialogButton(sheet, "Close").click();
    await expect(sheet).toBeHidden();
    await expect(menuTrigger(page, "Edit")).toBeFocused();
    await expectShellUsable(page);

    // A click outside closes it as well.
    await openFromEditMenu(page, SHORTCUTS_COMMAND, shortcutSheet(page));
    await settleTimers(page);
    await page.mouse.click(8, 600);
    await expect(sheet).toBeHidden();
    await expectShellUsable(page);
});

test("a long sheet stays inside the window and scrolls with the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditor(page);
    // As many bindings as the finished editor has, and more; each chord once.
    const modifiers = ["Ctrl+Alt+Shift", "Alt+Shift", "Ctrl+Shift+Meta", "Alt+Meta"];
    await registerProbes(
        page,
        Array.from({ length: 96 }, (_, index) => ({
            id: `se064.many.${String(index).padStart(2, "0")}`,
            title: `Quokka ${String(index).padStart(2, "0")}`,
            shortcut: `${modifiers[Math.floor(index / 26)]}+${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index % 26]}`,
        })),
    );
    const sheet = await openShortcutSheet(page);
    await expect(sheet.locator("[data-command]")).toHaveCount(
        (await registryCommands(page)).filter((command) => command.shortcuts.length > 0).length,
    );

    // The dialog keeps its margin to the window; title and Close stay on screen.
    const box = await boxOf(sheet);
    expect(box.y).toBeGreaterThanOrEqual(24);
    expect(box.y + box.height).toBeLessThanOrEqual(720 - 24);
    expect(contains(box, await boxOf(dialogButton(sheet, "Close")))).toBe(true);
    expect(contains(box, await boxOf(sheet.getByRole("heading", { level: 2 })))).toBe(true);
    // Two columns side by side, neither cut off.
    const list = shortcutList(page);
    const view = await boxOf(list);
    expect(contains(box, view)).toBe(true);
    const columns = await list.evaluate((element) => [
        ...new Set(
            Array.from(element.querySelectorAll("[data-command]"), (row) =>
                Math.round(row.getBoundingClientRect().x),
            ),
        ),
    ]);
    expect(columns).toHaveLength(2);
    expect(await list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);

    // The list has focus when the sheet opens and scrolls with the keyboard.
    await expect(list).toBeFocused();
    expect(await ringOf(list)).not.toBe("none");
    const scroll = () => list.evaluate((element) => element.scrollTop);
    const overflow = await list.evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(overflow).toBeGreaterThan(100);
    expect(await scroll()).toBe(0);
    await page.keyboard.press("End");
    await expect.poll(scroll).toBe(overflow);
    // The last row is on screen now.
    const last = await boxOf(sheet.locator("[data-command]").last());
    expect(last.y + last.height).toBeLessThanOrEqual(view.y + view.height);
    await page.keyboard.press("Home");
    await expect.poll(scroll).toBe(0);
    await page.keyboard.press("PageDown");
    await expect.poll(scroll).toBeGreaterThan(0);

    // Tab goes on to Close and comes back; Escape closes the sheet.
    await page.keyboard.press("Tab");
    await expect(dialogButton(sheet, "Close")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(list).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expectShellUsable(page);
});
