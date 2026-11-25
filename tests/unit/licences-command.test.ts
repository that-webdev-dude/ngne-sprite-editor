import { describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/testing/pageModules";
import { buildMenu } from "@ngne/editor-ui/commands";
import type { MenuNode } from "@ngne/editor-ui/commands";
import { LICENCES_COMMAND } from "@ngne/editor-ui/licences";

// The Open Source Licences command, the package's (@ngne/editor-ui/licences): where it is in
// the app's menus.

/** The ids of a menu's commands, with "---" for a separator. */
function outline(nodes: readonly MenuNode[]): string[] {
    return nodes.map((node) => (node.kind === "command" ? node.command.id : "---"));
}

describe("the Open Source Licences command", () => {
    it("is the last item of the View menu, in a group of its own, from a module of its own", () => {
        const command = appCommands.get(LICENCES_COMMAND);
        expect(command).toMatchObject({
            planned: false,
            menuPath: ["View"],
            shortcuts: [],
            source: "@ngne/editor-ui/licences/licences.commands.ts",
        });
        expect(command?.title()).toBe("Open Source Licences…");
        // Always available: it needs no document.
        expect(command?.enabled()).toBe(true);
        expect(outline(buildMenu(appCommands.list(), ["View"])).slice(-2)).toEqual([
            "---",
            LICENCES_COMMAND,
        ]);
    });
});
