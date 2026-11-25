import type { CommandSpec } from "@ngne/editor-ui/commands";
import { editorUi } from "../editorUi";

// SPEC §7.8 lists no key for the Preferences dialog (Aseprite's Ctrl+K is the command palette
// here). The command takes the menu item planned for its id (commands/planned.commands.ts). It
// opens the editor UI instance's surface `preferences`; the instance's module loads this one
// first, so the command reads the instance only when it runs.
export const commands: CommandSpec[] = [
    {
        id: "edit.preferences",
        title: "Preferences…",
        run: () => editorUi.surfaces.open("preferences"),
    },
];
