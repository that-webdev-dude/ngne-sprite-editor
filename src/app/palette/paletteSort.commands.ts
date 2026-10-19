import { restoreOrderCommand, sortPaletteCommand } from "../../core/palettes";
import type { PaletteSortKey } from "../../core/palettes";
import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { applyFloating } from "../selection/floating";
import { settleableDocument } from "../selection/settled";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { ORIGINAL_ORDER, SORT_BY_HUE, SORT_BY_LIGHTNESS } from "./paletteActionIds";
import { PALETTE_MENU } from "./paletteCommandIds";
import { keepOrderBeforeSort, originalOrderOf } from "./paletteOrder";

// Sort by Hue, Sort by Lightness and Original Order (SE-066) in the palette's overflow menu, in
// the 400s DESIGN §5.4 leaves to sort and Replace Colour…. Each is a palette command of
// `core/palettes`: one undo step, none when the order would not change. Like the other palette
// commands they apply a floating selection first and are disabled only during a stroke.

/** The active document when its history can take a command now. */
function idleDocument(): OpenDocument | null {
    const document = activeDocument(sessionsStore.getState());
    return document && !document.history.transaction ? document : null;
}

function sortBy(key: PaletteSortKey): void {
    applyFloating();
    const document = idleDocument();
    if (!document) return;
    const command = sortPaletteCommand(document.session, key);
    if (!command) return;
    keepOrderBeforeSort(document);
    document.history.execute(command);
    appCommands.refresh();
}

/** The command that puts back the original order, when it would change the palette. */
function restoreCommand(document: OpenDocument | null) {
    const order = document ? originalOrderOf(document) : null;
    return document && order ? restoreOrderCommand(document.session, order) : null;
}

function originalOrder(): void {
    applyFloating();
    const document = idleDocument();
    const command = restoreCommand(document);
    if (document && command) document.history.execute(command);
}

/** A palette of two colours or more can be sorted. */
const canSort = () => (settleableDocument()?.session.doc.palette.colors.length ?? 0) > 1;

export const commands: CommandSpec[] = [
    {
        id: SORT_BY_HUE,
        title: "Sort by Hue",
        enabled: canSort,
        run: () => sortBy("hue"),
        contextMenus: [{ menu: PALETTE_MENU, order: 400 }],
    },
    {
        id: SORT_BY_LIGHTNESS,
        title: "Sort by Lightness",
        enabled: canSort,
        run: () => sortBy("lightness"),
        contextMenus: [{ menu: PALETTE_MENU, order: 410 }],
    },
    {
        id: ORIGINAL_ORDER,
        title: "Original Order",
        enabled: () => restoreCommand(settleableDocument()) !== null,
        run: originalOrder,
        contextMenus: [{ menu: PALETTE_MENU, order: 420 }],
    },
];
