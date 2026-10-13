import type { CommandSpec } from "../commands/types";
import { surfaces } from "../surfaces/surfaces";

// SPEC §7.8: Ctrl+K †, also while a text field has focus. The command takes the menu item
// planned for its id (commands/planned.commands.ts).
export const commands: CommandSpec[] = [
    {
        id: "edit.commandPalette",
        title: "Command Palette…",
        shortcut: "Ctrl+K",
        context: ["global", "text"],
        run: () => surfaces.open("command-palette"),
    },
];
