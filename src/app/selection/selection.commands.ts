import type { Command } from "../../core/history";
import type { DocSession } from "../../core/model";
import { deselectCommand, invertSelectionCommand, selectAllCommand } from "../../core/selection";
import type { CommandSpec } from "../commands/types";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { applyFloating } from "./floating";
import { settleableDocument } from "./settled";

// Select All, Deselect and Invert Selection (SPEC §7.2, §7.8; SE-030): Ctrl+A, Ctrl+D and
// Ctrl+I in the `global` context. They take the items planned for them in the Select menu
// (commands/planned.commands.ts). Each is one undoable step on the active document's
// selection; a step that would leave the same pixels selected records nothing. While a
// transaction is open for a stroke the history takes no command, so they are disabled then,
// as undo and redo are. While pixels float (SE-032) they apply them first, as Aseprite's
// Deselect drops the moving pixels in place, and then act on the selection they leave.

/** The active document when its history can take a command now. */
function idleDocument(): OpenDocument | null {
    const document = activeDocument(sessionsStore.getState());
    return document && !document.history.transaction ? document : null;
}

function runOnActive(make: (session: DocSession) => Command | null): void {
    applyFloating();
    const document = idleDocument();
    if (!document) return;
    const command = make(document.session);
    if (command) document.history.execute(command);
}

export const commands: CommandSpec[] = [
    {
        id: "select.all",
        title: "Select All",
        shortcut: "Ctrl+A",
        enabled: () => settleableDocument() !== null,
        run: () => runOnActive(selectAllCommand),
    },
    {
        id: "select.none",
        title: "Deselect",
        shortcut: "Ctrl+D",
        enabled: () => (settleableDocument()?.session.selection ?? null) !== null,
        run: () => runOnActive(deselectCommand),
    },
    {
        id: "select.invert",
        title: "Invert Selection",
        shortcut: "Ctrl+I",
        enabled: () => settleableDocument() !== null,
        run: () => runOnActive(invertSelectionCommand),
    },
];
