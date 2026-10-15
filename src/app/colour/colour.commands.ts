import type { CommandSpec } from "../commands/types";
import { editorStore } from "../state/editor";

// The commands of the foreground and background colours (SE-016). X swaps them in the
// `canvas` context (SPEC §7.8). Reset has no default key (D is the contour tool), so it is
// reached from the button beside the chips of the tool rail (DESIGN §5.1) and from the
// command palette; the shortcut sheet lists only commands with a key.

export const SWAP_COLOURS = "colour.swap";
export const RESET_COLOURS = "colour.reset";

export const commands: CommandSpec[] = [
    {
        id: SWAP_COLOURS,
        title: "Swap Colours",
        shortcut: "X",
        context: "canvas",
        run: () => editorStore.getState().swapColours(),
    },
    {
        id: RESET_COLOURS,
        title: "Reset Colours",
        run: () => editorStore.getState().resetColours(),
    },
];
