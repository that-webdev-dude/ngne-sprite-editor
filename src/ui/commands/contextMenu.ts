import { appCommands } from "../../app/commands/appCommands";
import { formatChord } from "../../app/commands/chord";
import { invokeCommand } from "../../app/commands/invoke";
import { buildContextMenu } from "../../app/commands/menuModel";
import type { Command } from "../../app/commands/types";
import type { ContextMenuEntry } from "../primitives/ContextMenu";
import { reportCommandError } from "./runCommand";

/**
 * The entries of the context menu named `menu` for the `ContextMenu` primitive, generated from
 * the commands that list that menu in `contextMenus`. Call it while rendering, with the
 * commands of `useCommands()`, so titles and disabled states are current.
 */
export function contextMenuEntries(
    menu: string,
    commands: readonly Command[] = appCommands.list(),
): ContextMenuEntry[] {
    return buildContextMenu(commands, menu).flatMap((node, index): ContextMenuEntry[] => {
        if (node.kind === "separator") return [{ type: "separator", id: `separator-${index}` }];
        if (node.kind !== "command") return [];
        const { command } = node;
        const shortcut = command.shortcuts[0];
        return [
            {
                id: command.id,
                label: command.title(),
                shortcut: shortcut ? formatChord(shortcut) : undefined,
                disabled: !command.enabled(),
                onSelect: () => void invokeCommand(command, reportCommandError),
            },
        ];
    });
}
