import type { History } from "../../core/history";
import type { CommandSpec } from "../commands/types";
import { activeDocument, sessionsStore } from "./sessions";

function activeHistory(): History | null {
    return activeDocument(sessionsStore.getState())?.history ?? null;
}

/**
 * The active history when undo and redo may use it. While a transaction is open (a stroke, a
 * floating selection) they would throw, and `canUndo` still reads true, so that is checked
 * first.
 */
function idleHistory(): History | null {
    const history = activeHistory();
    return history && !history.transaction ? history : null;
}

/** "Undo Pencil": the verb, then the label of the step it would act on. */
function titled(verb: string, label: string | null | undefined): string {
    return label ? `${verb} ${label}` : verb;
}

// SPEC §7.8: Ctrl+Z; Ctrl+Y, Ctrl+Shift+Z. Not bound in `text`: a field undoes its own typing.
export const commands: CommandSpec[] = [
    {
        id: "edit.undo",
        title: () => titled("Undo", activeHistory()?.undoLabel),
        shortcut: "Ctrl+Z",
        menuPath: ["Edit"],
        menuOrder: 100,
        enabled: () => idleHistory()?.canUndo ?? false,
        run: () => void idleHistory()?.undo(),
    },
    {
        id: "edit.redo",
        title: () => titled("Redo", activeHistory()?.redoLabel),
        shortcut: ["Ctrl+Y", "Ctrl+Shift+Z"],
        menuPath: ["Edit"],
        menuOrder: 110,
        enabled: () => idleHistory()?.canRedo ?? false,
        run: () => void idleHistory()?.redo(),
    },
];
