import { invokeCommand } from "../commands/invoke";
import type { CommandErrorHandler } from "../commands/invoke";
import { buildMenu, menuCommands } from "../commands/menuModel";
import { MENU_BAR } from "../commands/types";
import type { Command } from "../commands/types";
import { fuzzyScore } from "./fuzzy";
import { recentCommands } from "./recentCommands";
import type { RecentCommandsState } from "./recentCommands";

/** One row of the command palette. */
export interface PaletteEntry {
    command: Command;
    /** The command's title when the list was made. */
    title: string;
    /** Where the command is in the menu bar: "Edit", "File › Open Recent"; "" outside it. */
    group: string;
}

/** The separator of a menu path as the palette shows it. */
const PATH_SEPARATOR = " › ";
/** A term found only in the menu path counts less than one found in the title. */
const GROUP_MATCH_PENALTY = 2;

/**
 * How well a query matches a command, or null when it does not. The query is split at white
 * space; every term must match the title or the menu path ("sprite prop" finds Sprite ›
 * Properties…), and the scores of the terms add up.
 */
export function paletteScore(query: string, title: string, group: string): number | null {
    let total = 0;
    for (const term of query.split(/\s+/)) {
        const inTitle = fuzzyScore(term, title);
        const inGroup = group === "" ? null : fuzzyScore(term, group);
        if (inTitle === null && inGroup === null) return null;
        total += Math.max(inTitle ?? -Infinity, (inGroup ?? -Infinity) - GROUP_MATCH_PENALTY);
    }
    return total;
}

/** The commands as the menu bar orders them, then those outside the menus by title. */
function inMenuOrder(commands: readonly Command[]): { command: Command; title: string }[] {
    const titled = (command: Command) => ({ command, title: command.title() });
    const inMenus = MENU_BAR.flatMap((menu) => menuCommands(buildMenu(commands, [menu])));
    const listed = new Set(inMenus);
    const others = commands
        .filter((command) => !listed.has(command))
        .map(titled)
        .sort(
            (a, b) =>
                a.title.localeCompare(b.title, "en") ||
                (a.command.id < b.command.id ? -1 : a.command.id > b.command.id ? 1 : 0),
        );
    return [...inMenus.map(titled), ...others];
}

/**
 * The rows of the command palette for a query (DESIGN §4): every command of the registry that
 * matches, enabled or not.
 *
 * Order: the best match first. Among equal matches, and for an empty query among all commands,
 * the commands of `recent` come first, newest first, then the others in menu order.
 */
export function paletteEntries(
    commands: readonly Command[],
    recent: readonly string[],
    query: string,
): PaletteEntry[] {
    const recency = new Map(recent.map((id, index) => [id, index]));
    const matches = [];
    for (const [order, { command, title }] of inMenuOrder(commands).entries()) {
        const group = command.menuPath?.join(PATH_SEPARATOR) ?? "";
        const score = paletteScore(query, title, group);
        if (score === null) continue;
        matches.push({
            entry: { command, title, group },
            score,
            // After every recent command when it is not one of them.
            recency: recency.get(command.id) ?? recent.length,
            order,
        });
    }
    matches.sort((a, b) => b.score - a.score || a.recency - b.recency || a.order - b.order);
    return matches.map((match) => match.entry);
}

/**
 * Runs a command chosen in the palette: the same path as a menu item or a key (`invokeCommand`),
 * so a disabled command does nothing. A hold binding gets the release that follows a key
 * press. A command that ran is recorded as recent. Returns whether it ran.
 */
export function runPaletteCommand(
    command: Command,
    onError: CommandErrorHandler,
    recent: Pick<RecentCommandsState, "record"> = recentCommands.getState(),
): boolean {
    if (!invokeCommand(command, onError)) return false;
    recent.record(command.id);
    try {
        command.release?.();
    } catch (error) {
        onError(error, command);
    }
    return true;
}
