import type { Command } from "../../src/core/history";
import type { KeyValueStorage } from "../../src/ui/platform/storage";

// Shared by the SE-007 unit tests.

/** An undoable test command: sets the document name and restores the previous one. */
export function renameCommand(name: string, label = "Rename"): Command {
    let previous = "";
    return {
        label,
        bytes: 0,
        touched: { frameIds: [], layerIds: [], structure: false },
        do(session) {
            previous = session.doc.name;
            session.doc.name = name;
        },
        undo(session) {
            session.doc.name = previous;
        },
    };
}

/** An in-memory `localStorage`. */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
    data: Map<string, string>;
} {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => void data.set(key, value),
        removeItem: (key) => void data.delete(key),
    };
}
