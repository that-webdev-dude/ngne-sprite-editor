import type { CommandSpec } from "../commands/types";
import { surfaces } from "../surfaces/surfaces";

// SPEC §7.8 lists no key for the Preferences dialog (Aseprite's Ctrl+K is the command palette
// here). The command takes the menu item planned for its id (commands/planned.commands.ts).
export const commands: CommandSpec[] = [
    {
        id: "edit.preferences",
        title: "Preferences…",
        run: () => surfaces.open("preferences"),
    },
];
