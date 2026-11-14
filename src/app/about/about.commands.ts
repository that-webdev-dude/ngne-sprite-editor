import type { CommandSpec } from "../commands/types";
import { openAbout } from "./openAbout";

// About NGNE Sprite Editor… (openAbout.ts): the item of the Help menu, which it takes over from
// commands/planned.commands.ts, and a command of the palette. Always available.
export const ABOUT_COMMAND = "help.about";

export const commands: CommandSpec[] = [
    {
        id: ABOUT_COMMAND,
        title: "About NGNE Sprite Editor…",
        run: async () => {
            await openAbout();
        },
    },
];
