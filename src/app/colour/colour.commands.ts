import type { CommandSpec } from "../commands/types";
import { editorStore } from "../state/editor";

// The commands of the foreground and background colours (SE-016). X swaps them in the
// `canvas` context (SPEC §7.8); reset has no default key (D is the contour tool), only the
// button beside the chips of the tool rail (DESIGN §5.1), the command palette and the
// shortcut sheet.

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
