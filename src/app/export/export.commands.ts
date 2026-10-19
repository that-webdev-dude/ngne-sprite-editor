import type { CommandSpec } from "../commands/types";
import { fileWorkflows } from "../file/workflows";
import { exportWorkflows } from "./exportWorkflows";

// The export commands of SPEC §9.6 (SE-052). Export… and Export Again take the File menu
// items planned for them (commands/planned.commands.ts); the other exports follow them in
// that group. SPEC §7.8: Ctrl+E and Ctrl+Shift+E are marked †, so they also act while a text
// field has focus. Each is a file operation: it waits while another one runs and never acts
// during a stroke; each does act while a selection floats, which it applies first (SPEC §5.2).
// The file workflows' `subscribe` already refreshes the registry when `busy` changes
// (file.commands.ts).

const TEXT_TOO: CommandSpec["context"] = ["global", "text"];

const enabled = () => exportWorkflows.canExport();

export const commands: CommandSpec[] = [
    {
        id: "file.export",
        title: "Export…",
        shortcut: "Ctrl+E",
        context: TEXT_TOO,
        enabled,
        run: async () => void (await exportWorkflows.exportWithDialog()),
    },
    {
        id: "file.exportAgain",
        title: "Export Again",
        shortcut: "Ctrl+Shift+E",
        context: TEXT_TOO,
        enabled,
        run: async () => void (await exportWorkflows.exportAgain()),
    },
    {
        id: "file.exportFramePng",
        title: "Export Frame PNG…",
        menuPath: ["File"],
        menuOrder: 420,
        enabled,
        run: async () => void (await exportWorkflows.exportFramePng()),
    },
    {
        id: "file.exportSpriteSheet",
        title: "Export Sprite Sheet PNG…",
        menuPath: ["File"],
        menuOrder: 430,
        enabled,
        run: async () => void (await exportWorkflows.exportSpriteSheet()),
    },
    {
        id: "file.exportPngSequence",
        title: "Export PNG Sequence…",
        menuPath: ["File"],
        menuOrder: 440,
        enabled,
        run: async () => void (await exportWorkflows.exportPngSequence()),
    },
];

// `exportOnSave` (SPEC §9.6): a successful save writes the bundle again.
fileWorkflows.onSaved((document) => exportWorkflows.exportOnSave(document));
