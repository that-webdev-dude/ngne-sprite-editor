import type { CommandSpec } from "../commands/types";
import { exportWorkflows } from "./exportWorkflows";
import { exportGif } from "./gifExport";

// Export GIF… (SPEC §9.6; SE-063): a File menu item after the other exports of SE-052, without
// a key. A file operation of the export workflows: enabled when they can export.

export const commands: CommandSpec[] = [
    {
        id: "file.exportGif",
        title: "Export GIF…",
        menuPath: ["File"],
        menuOrder: 450,
        enabled: () => exportWorkflows.canExport(),
        run: async () => void (await exportGif()),
    },
];
