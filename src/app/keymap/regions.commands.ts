import type { CommandSpec } from "../commands/types";
import { cycleFocusRegion } from "./regions";

// SPEC §7.8: F6 / Shift+F6 †, also while a text field has focus.
export const commands: CommandSpec[] = [
    {
        id: "focus.nextRegion",
        title: "Focus Next Region",
        shortcut: "F6",
        context: ["global", "text"],
        run: () => void cycleFocusRegion(1),
    },
    {
        id: "focus.previousRegion",
        title: "Focus Previous Region",
        shortcut: "Shift+F6",
        context: ["global", "text"],
        run: () => void cycleFocusRegion(-1),
    },
];
