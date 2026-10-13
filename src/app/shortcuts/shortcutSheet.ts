import { buildMenu, menuCommands } from "../commands/menuModel";
import { MENU_BAR } from "../commands/types";
import type { Command } from "../commands/types";

/** One command of the shortcut sheet with every chord that runs it. */
export interface ShortcutRow {
    command: Command;
    /** The command's title when the sheet was made. */
    title: string;
    /** Canonical chords (commands/chord.ts), in the order the command lists them. */
    chords: readonly string[];
    /** The chords act while the key is held ("Space (hold)" in SPEC §7.8). */
    hold: boolean;
}

export interface ShortcutGroup {
    /** A menu of the menu bar, or `OTHER_SHORTCUTS`. */
    title: string;
    rows: ShortcutRow[];
}

/** The group of the commands that have a shortcut and no menu item (tools, focus regions). */
export const OTHER_SHORTCUTS = "Other";

function row(command: Command): ShortcutRow {
    return {
        command,
        title: command.title(),
        chords: command.shortcuts,
        hold: command.release !== null,
    };
}

/**
 * The shortcut sheet (DESIGN §7), generated from the commands: every command that has a
 * shortcut, once, with all its chords. Grouped by menu in the order of the menu bar, each
 * group in menu order; the commands outside the menus form a last group, ordered by title.
 * A group without shortcuts is left out.
 */
export function shortcutGroups(commands: readonly Command[]): ShortcutGroup[] {
    const bound = (command: Command) => command.shortcuts.length > 0;
    const groups: ShortcutGroup[] = MENU_BAR.map((menu) => ({
        title: menu,
        rows: menuCommands(buildMenu(commands, [menu]))
            .filter(bound)
            .map(row),
    }));
    const others = commands
        .filter((command) => bound(command) && command.menuPath === null)
        .map(row)
        .sort(
            (a, b) =>
                a.title.localeCompare(b.title, "en") ||
                (a.command.id < b.command.id ? -1 : a.command.id > b.command.id ? 1 : 0),
        );
    groups.push({ title: OTHER_SHORTCUTS, rows: others });
    return groups.filter((group) => group.rows.length > 0);
}
