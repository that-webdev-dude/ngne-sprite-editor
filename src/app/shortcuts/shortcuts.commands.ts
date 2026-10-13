import type { CommandSpec } from "../commands/types";
import { surfaces } from "../surfaces/surfaces";

// SPEC §7.8: ? in the `canvas` context, so it is typed as a character while a text field has
// focus. The command takes the menu item planned for its id (commands/planned.commands.ts).
export const commands: CommandSpec[] = [
    {
        id: "edit.shortcuts",
        title: "Keyboard Shortcuts…",
        shortcut: "?",
        context: "canvas",
        run: () => surfaces.open("shortcut-sheet"),
    },
];
