import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { region, settleTimers } from "./se-006-support";
import { menuItem, openEditor, openMenu } from "./se-007-support";
import { startInTheme } from "./se-008-support";
import type { Theme } from "./se-008-support";

// Shared helpers of the SE-064 specs: the command palette, the Preferences dialog, the
// shortcut sheet, and what the registry and the stores hold.

export const PALETTE_COMMAND = "edit.commandPalette";
export const PREFERENCES_COMMAND = "edit.preferences";
export const SHORTCUTS_COMMAND = "edit.shortcuts";
export const RECENT_KEY = "ngne-sprite-editor.recent-commands";

export const PANEL: Record<Theme, string> = {
    dark: "rgb(24, 24, 26)",
    light: "rgb(244, 244, 245)",
};
export const ACCENT: Record<Theme, string> = {
    dark: "rgb(131, 232, 225)",
    light: "rgb(8, 127, 120)",
};

// --- Command palette ----------------------------------------------------------------------

export const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
export const paletteInput = (page: Page) =>
    palette(page).getByRole("combobox", { name: "Search commands" });
export const paletteList = (page: Page) => palette(page).getByRole("listbox", { name: "Commands" });
export const paletteOptions = (page: Page) => paletteList(page).getByRole("option");
export const paletteOption = (page: Page, commandId: string) =>
    palette(page).locator(`[role="option"][data-command="${commandId}"]`);
/** The row the arrow keys are on; Enter runs it. */
export const activeOption = (page: Page) =>
    palette(page).locator('[role="option"][aria-selected="true"]');
export const paletteTrigger = (page: Page) =>
    region(page, "menu-bar").getByRole("button", { name: "Commands", exact: true });

/** Opens the palette with its key and waits until the search field has focus. */
export async function openPalette(page: Page): Promise<Locator> {
    await page.keyboard.press("Control+KeyK");
    await expect(paletteInput(page)).toBeFocused();
    return palette(page);
}

/** The command ids of the palette rows, in the order shown. */
export function paletteIds(page: Page): Promise<string[]> {
    return paletteOptions(page).evaluateAll((options) =>
        options.map((option) => option.getAttribute("data-command") ?? ""),
    );
}

/**
 * Opens the palette, picks the row of a command with the pointer, waits for it to close and for
 * the command to have run. The palette runs it where the focus returns, which Radix does one
 * timer after the palette has left the page.
 */
export async function runFromPalette(page: Page, commandId: string): Promise<void> {
    await openPalette(page);
    await paletteOption(page, commandId).click();
    await expect(palette(page)).toBeHidden();
    await settleTimers(page);
}

// --- Preferences and shortcut sheet -------------------------------------------------------

export const preferencesDialog = (page: Page) => page.getByRole("dialog", { name: "Preferences" });
export const shortcutSheet = (page: Page) =>
    page.getByRole("dialog", { name: "Keyboard shortcuts" });
/** The list of the shortcut sheet: one tab stop, scrolled with the keyboard. */
export const shortcutList = (page: Page) =>
    shortcutSheet(page).getByRole("group", { name: "Shortcuts by menu" });

/** Opens a surface from its item in the Edit menu. */
export async function openFromEditMenu(page: Page, commandId: string, surface: Locator) {
    await openMenu(page, "Edit");
    await menuItem(page, commandId).click();
    await expect(surface).toBeVisible();
    return surface;
}

export const openPreferences = (page: Page) =>
    openFromEditMenu(page, PREFERENCES_COMMAND, preferencesDialog(page));

/** Opens the shortcut sheet with its key; nothing may have focus that takes the character. */
export async function openShortcutSheet(page: Page): Promise<Locator> {
    await page.keyboard.press("Shift+Slash");
    await expect(shortcutSheet(page)).toBeVisible();
    return shortcutSheet(page);
}

/** A named group of controls in the Preferences dialog: one preference. */
export const section = (dialog: Locator, name: string) =>
    dialog.getByRole("group", { name, exact: true });
export const segment = (scope: Locator, group: string, name: string) =>
    scope.getByRole("radiogroup", { name: group, exact: true }).getByRole("radio", {
        name,
        exact: true,
    });
export const toggle = (scope: Locator, name: string) =>
    scope.getByRole("button", { name, exact: true });
export const hexField = (scope: Locator, name: string) =>
    scope.getByRole("textbox", { name, exact: true });

/**
 * Moves the choice of a group of segments with an arrow key, held until the choice has moved.
 * Radix moves focus one timer after the key goes down and checks the segment that receives it
 * only while the key is still down; a key pressed and released in one step can be up by then.
 */
export async function arrowTo(page: Page, key: string, target: Locator): Promise<void> {
    await page.keyboard.down(key);
    await expect(target).toBeFocused();
    await expect(target).toBeChecked();
    await page.keyboard.up(key);
}

/** Chooses an option of a select: opens the list, waits for it, clicks the option. */
export async function choose(page: Page, scope: Locator, name: string, option: string) {
    await scope.getByRole("combobox", { name, exact: true }).click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await list.getByRole("option", { name: option, exact: true }).click();
    await expect(list).toBeHidden();
}

// --- Registry and stores ------------------------------------------------------------------

/** What a spec reads of one command of the app's registry. */
export interface RegistryCommand {
    id: string;
    title: string;
    enabled: boolean;
    planned: boolean;
    /** Canonical chords. */
    shortcuts: string[];
    /** The menu of the menu bar the command is in, or null. */
    menu: string | null;
    menuPath: string[] | null;
    hold: boolean;
}

/** Every command of the app's registry, as the registry reports it now. */
export function registryCommands(page: Page): Promise<RegistryCommand[]> {
    return page.evaluate(() =>
        window.__ngneTest!.commands.list().map((command) => ({
            id: command.id,
            title: command.title(),
            enabled: command.enabled(),
            planned: command.planned,
            shortcuts: [...command.shortcuts],
            menu: command.menuPath?.[0] ?? null,
            menuPath: command.menuPath ? [...command.menuPath] : null,
            hold: command.release !== null,
        })),
    );
}

declare global {
    interface Window {
        /** Ids of the commands that ran, recorded by the spies and commands of these specs. */
        se064Calls?: string[];
    }
}

/** The ids recorded by `spyOnCommands` and by the commands of `registerProbes`. */
export const calls = (page: Page) => page.evaluate(() => window.se064Calls ?? []);

/**
 * Replaces what every command of the registry does by a record of its id, so that running
 * one has no other effect. The commands in `keep` stay as they are. The registry hands the
 * same command objects to menus, keys and the palette, so the record shows that the palette
 * ran the registry's command.
 */
export function spyOnCommands(page: Page, keep: readonly string[] = []): Promise<void> {
    return page.evaluate((keep) => {
        const ran = (window.se064Calls ??= []);
        for (const command of window.__ngneTest!.commands.list()) {
            if (keep.includes(command.id)) continue;
            command.run = () => void ran.push(command.id);
        }
    }, keep);
}

/** One command these specs add to the registry; `run` records its id. */
export interface Probe {
    id: string;
    title: string;
    enabled?: boolean;
    shortcut?: string | string[];
    context?: "canvas" | "global";
    menuPath?: string[];
    menuOrder?: number;
    /** A hold binding: released after it ran. */
    hold?: boolean;
}

/** Registers test commands; each records its id (and "id:release") when it runs. */
export function registerProbes(page: Page, probes: readonly Probe[]): Promise<void> {
    return page.evaluate((probes) => {
        const ran = (window.se064Calls ??= []);
        for (const probe of probes) {
            window.__ngneTest!.commands.register({
                id: probe.id,
                title: probe.title,
                shortcut: probe.shortcut,
                context: probe.context,
                menuPath: probe.menuPath,
                menuOrder: probe.menuOrder,
                enabled: () => probe.enabled ?? true,
                run: () => void ran.push(probe.id),
                release: probe.hold ? () => void ran.push(`${probe.id}:release`) : undefined,
            });
        }
    }, probes);
}

export const storedPreferences = (page: Page) =>
    page.evaluate(() => window.__ngneTest!.preferences.all());

export const recentCommands = (page: Page) =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as string[], RECENT_KEY);

/** The outline of an element as "2px solid rgb(…), offset 1px", or "none". */
export function ringOf(target: Locator): Promise<string> {
    return target.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle === "none"
            ? "none"
            : `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}, offset ${style.outlineOffset}`;
    });
}

/** Opens the app in `theme` with transitions off, so colours are final when they are read. */
export async function openIn(page: Page, theme: Theme): Promise<void> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startInTheme(page, theme);
    await openEditor(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Nothing of a closed modal surface is left on the page: the shell can be used again. */
export async function expectShellUsable(page: Page): Promise<void> {
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const leftovers = await page.evaluate(() => ({
        hidden: document.querySelectorAll("[inert], [data-aria-hidden]").length,
        pointerEvents: document.body.style.pointerEvents,
    }));
    expect(leftovers).toEqual({ hidden: 0, pointerEvents: "" });
}
