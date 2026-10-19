import { restoreOrderCommand, sortPaletteCommand } from "../../core/palettes";
import type { PaletteSortKey } from "../../core/palettes";
import type { Command } from "../../core/history";
import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { applyFloating } from "../selection/floating";
import { settleableDocument } from "../selection/settled";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { ORIGINAL_ORDER, SORT_BY_HUE, SORT_BY_LIGHTNESS } from "./paletteActionIds";
import { PALETTE_MENU } from "./paletteCommandIds";
import { keepOrderBeforeSort, originalOrderOf } from "./paletteOrder";
import { currentSwatch, setCurrentSwatch } from "./paletteState";

// Sort by Hue, Sort by Lightness and Original Order (SE-066) in the palette's overflow menu, in
// the 400s DESIGN §5.4 leaves to sort and Replace Colour…. Each is a palette command of
// `core/palettes`: one undo step, none when the order would not change. Like the other palette
// commands they apply a floating selection first and are disabled only during a stroke. The
// current swatch follows its colour to its new place (of equal colours, the same occurrence);
// an undo leaves the current swatch's index as it is, as for SE-060's commands.

/** The active document when its history can take a command now. */
function idleDocument(): OpenDocument | null {
    const document = activeDocument(sessionsStore.getState());
    return document && !document.history.transaction ? document : null;
}

/** Where the colour at `index` of `before` is in `after`, a reordering of it. */
function newIndexOf(before: readonly number[], after: readonly number[], index: number): number {
    const colour = before[index];
    let occurrence = 0;
    for (let at = 0; at < index; at++) if (before[at] === colour) occurrence++;
    for (let at = 0; at < after.length; at++) {
        if (after[at] !== colour) continue;
        if (occurrence === 0) return at;
        occurrence--;
    }
    return index;
}

/** Executes a reordering of the palette; the current swatch keeps its colour. */
function reorder(document: OpenDocument, command: Command): void {
    const before = [...document.session.doc.palette.colors];
    const current = currentSwatch(before.length);
    document.history.execute(command);
    if (current >= 0) {
        setCurrentSwatch(newIndexOf(before, document.session.doc.palette.colors, current));
    }
}

function sortBy(key: PaletteSortKey): void {
    applyFloating();
    const document = idleDocument();
    if (!document) return;
    const command = sortPaletteCommand(document.session, key);
    if (!command) return;
    keepOrderBeforeSort(document.session);
    reorder(document, command);
    appCommands.refresh();
}

/** The command that puts back the original order, when it would change the palette. */
function restoreCommand(document: OpenDocument | null) {
    const order = document ? originalOrderOf(document.session) : null;
    return document && order ? restoreOrderCommand(document.session, order) : null;
}

function originalOrder(): void {
    applyFloating();
    const document = idleDocument();
    const command = restoreCommand(document);
    if (document && command) reorder(document, command);
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
