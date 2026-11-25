import { describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/testing/pageModules";
import type { CommandRegistry } from "@ngne/editor-ui/commands";
import { shortcutGroups } from "@ngne/editor-ui/commands";
import type { ShortcutGroup } from "@ngne/editor-ui/commands";

// SE-064: the shortcut sheet as generated from the app's registry: exactly the registry's
// shortcuts.

/** Every binding as "command chord", sorted: what the sheet and the registry are compared by. */
function sheetBindings(groups: readonly ShortcutGroup[]): string[] {
    return groups
        .flatMap((group) =>
            group.rows.flatMap((row) => row.chords.map((chord) => `${row.command.id} ${chord}`)),
        )
        .sort();
}

function registryBindings(registry: CommandRegistry): string[] {
    return registry
        .list()
        .flatMap((command) => command.shortcuts.map((chord) => `${command.id} ${chord}`))
        .sort();
}

describe("the shortcut sheet", () => {
    it("lists exactly the shortcuts of the app's registry", () => {
        const groups = shortcutGroups(appCommands.list(), appCommands.menus);
        const expected = registryBindings(appCommands);
        // The bindings of SE-007, SE-008 and this ticket are there at least.
        expect(expected).toEqual(
            expect.arrayContaining([
                "edit.undo Ctrl+Z",
                "edit.redo Ctrl+Y",
                "edit.redo Ctrl+Shift+Z",
                "focus.nextRegion F6",
                "file.new Ctrl+Alt+N",
                "edit.commandPalette Ctrl+K",
                "edit.shortcuts ?",
            ]),
        );
        expect(sheetBindings(groups)).toEqual(expected);
    });
});
