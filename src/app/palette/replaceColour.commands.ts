import type { CommandSpec } from "../commands/types";
import { settleableDocument } from "../selection/settled";
import { REPLACE_COLOUR } from "./paletteActionIds";
import { PALETTE_MENU } from "./paletteCommandIds";
import { replaceColour } from "./replaceColour";

// Replace Colour… (SE-066): the Edit menu item planned for it (`planned.commands.ts`), and the
// last item of the palette's overflow menu, in the 400s with sort (DESIGN §5.4). Enabled while
// the active document's history is idle or holds a floating selection, which it applies first.

export const commands: CommandSpec[] = [
    {
        id: REPLACE_COLOUR,
        title: "Replace Colour…",
        enabled: () => settleableDocument() !== null,
        run: async () => void (await replaceColour.run()),
        contextMenus: [{ menu: PALETTE_MENU, order: 490 }],
    },
];
