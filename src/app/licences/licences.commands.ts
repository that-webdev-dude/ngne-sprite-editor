import type { CommandSpec } from "../commands/types";
import { openLicences } from "./openLicences";

// The open-source licences of the app (openLicences.ts): the last item of the View menu, in a
// group of its own, and in the command palette. The menu bar has no Help menu (DESIGN §2).
export const LICENCES_COMMAND = "app.licences";

export const commands: CommandSpec[] = [
    {
        id: LICENCES_COMMAND,
        title: "Open Source Licences",
        menuPath: ["View"],
        menuOrder: 700,
        run: async () => {
            await openLicences();
        },
    },
];
