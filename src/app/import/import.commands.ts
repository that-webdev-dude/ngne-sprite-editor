import type { CommandSpec } from "../commands/types";
import { fileWorkflows } from "../file/workflows";
import { sessionsStore } from "../state/sessions";
import { importPasted, importPng } from "./importWorkflow";

// Import PNG (SPEC §8; SE-044). File → Import PNG… takes the menu item planned for its id
// (commands/planned.commands.ts), without a key. A paste while no document is open imports the
// clipboard's image: Ctrl+V, which Edit → Paste (SE-032) binds too; the two exclude each other,
// Paste being enabled only with a document open. Both wait while a file operation runs, and
// Import PNG also while the active document is in a stroke (it may place the frames there).

export const commands: CommandSpec[] = [
    {
        id: "file.importPng",
        title: "Import PNG…",
        enabled: () => fileWorkflows.canAct(),
        run: async () => void (await importPng()),
    },
    {
        id: "file.pasteImage",
        title: "Paste Image as New Sprite",
        shortcut: "Ctrl+V",
        enabled: () => sessionsStore.getState().documents.length === 0 && !fileWorkflows.busy,
        run: async () => void (await importPasted()),
    },
];
