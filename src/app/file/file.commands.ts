import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { activeDocument, sessionsStore } from "../state/sessions";
import { fileWorkflows } from "./workflows";

// The file commands of SPEC §10 (SE-041). They take the File menu items planned for their ids
// (commands/planned.commands.ts). SPEC §7.8: Ctrl+O, Ctrl+S, Ctrl+Shift+S and Alt+W are
// marked †, so they also act while a text field has focus. Each waits while another file
// operation runs, and none acts on a document during a stroke; each does act while a selection
// floats, which it applies first (SPEC §5.2), Open once the file has been read.

/** The active document's history, when one is open. */
function activeHistory() {
    return activeDocument(sessionsStore.getState())?.history ?? null;
}

/**
 * No file operation runs and the active document, if any, is not in a stroke: its history is
 * idle or holds a floating selection, which the operation applies first.
 */
function idle(): boolean {
    return fileWorkflows.canAct();
}

/** A document is open, and `idle` holds. */
function idleDocument(): boolean {
    return activeHistory() !== null && idle();
}

const TEXT_TOO: CommandSpec["context"] = ["global", "text"];

export const commands: CommandSpec[] = [
    {
        id: "file.open",
        title: "Open…",
        shortcut: "Ctrl+O",
        context: TEXT_TOO,
        enabled: idle,
        run: async () => void (await fileWorkflows.open()),
    },
    {
        id: "file.save",
        title: "Save",
        shortcut: "Ctrl+S",
        context: TEXT_TOO,
        enabled: () => fileWorkflows.canSave(),
        run: async () => void (await fileWorkflows.save()),
    },
    {
        id: "file.saveAs",
        title: "Save As…",
        shortcut: "Ctrl+Shift+S",
        context: TEXT_TOO,
        enabled: () => fileWorkflows.canSave(),
        run: async () => void (await fileWorkflows.saveAs()),
    },
    {
        id: "file.revert",
        title: "Revert",
        // Only a document with a file has something to go back to.
        enabled: () => {
            const document = activeDocument(sessionsStore.getState());
            return document !== null && idle() && fileWorkflows.fileOf(document.id) !== null;
        },
        run: async () => void (await fileWorkflows.revert()),
    },
    {
        id: "file.close",
        title: "Close",
        shortcut: "Alt+W",
        context: TEXT_TOO,
        enabled: idleDocument,
        run: async () => void (await fileWorkflows.close()),
    },
];

// `enabled` reads the workflows' state: an open menu follows it.
fileWorkflows.subscribe(() => appCommands.refresh());
