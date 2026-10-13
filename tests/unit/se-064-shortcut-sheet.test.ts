import { describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { createCommandRegistry } from "../../src/app/commands/registry";
import type { CommandRegistry } from "../../src/app/commands/registry";
import { MENU_BAR } from "../../src/app/commands/types";
import type { CommandSpec } from "../../src/app/commands/types";
import { OTHER_SHORTCUTS, shortcutGroups } from "../../src/app/shortcuts/shortcutSheet";
import type { ShortcutGroup } from "../../src/app/shortcuts/shortcutSheet";

// SE-064: the shortcut sheet as generated from the registry — exactly the registry's
// shortcuts, grouped by menu.

function spec(id: string, overrides: Partial<CommandSpec> = {}): CommandSpec {
    return { id, title: id, run() {}, ...overrides };
}

function registryOf(...specs: CommandSpec[]): CommandRegistry {
    const registry = createCommandRegistry();
    for (const each of specs) registry.register(each);
    return registry;
}

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

/** The sheet as `{ group: ["command: chord, chord"] }`. */
function outline(groups: readonly ShortcutGroup[]): Record<string, string[]> {
    return Object.fromEntries(
        groups.map((group) => [
            group.title,
            group.rows.map((row) => `${row.command.id}: ${row.chords.join(", ")}`),
        ]),
    );
}

const registry = registryOf(
    spec("view.zoomIn", { shortcut: "Ctrl+Plus", menuPath: ["View"], menuOrder: 110 }),
    spec("view.fit", { shortcut: "0", context: "canvas", menuPath: ["View"], menuOrder: 100 }),
    spec("edit.redo", {
        title: "Redo",
        shortcut: ["Ctrl+Y", "Ctrl+Shift+Z"],
        menuPath: ["Edit"],
        menuOrder: 110,
    }),
    spec("edit.undo", {
        title: () => "Undo Pencil",
        shortcut: "Ctrl+Z",
        menuPath: ["Edit"],
        menuOrder: 100,
        enabled: () => false,
    }),
    spec("edit.fill", { menuPath: ["Edit"], menuOrder: 120 }),
    spec("file.recent.clear", { shortcut: "Alt+F8", menuPath: ["File", "Open Recent"] }),
    spec("tool.pencil", { title: "Pencil", shortcut: "B", context: "canvas" }),
    spec("tool.hand", {
        title: "Hand",
        shortcut: "Space",
        context: "canvas",
        release() {},
    }),
    spec("frame.next", {
        title: "Next Frame",
        shortcut: "ArrowRight",
        context: ["canvas", "timeline"],
    }),
    spec("no.shortcut"),
);

describe("the shortcut sheet", () => {
    it("lists exactly the registry's shortcuts", () => {
        const groups = shortcutGroups(registry.list());
        expect(sheetBindings(groups)).toEqual(registryBindings(registry));
        // Every command with a shortcut once, with all its chords in the order it lists them.
        const rows = groups.flatMap((group) => group.rows);
        expect(new Set(rows.map((row) => row.command.id)).size).toBe(rows.length);
        for (const row of rows) {
            expect(row.command).toBe(registry.get(row.command.id));
            expect(row.chords).toEqual(row.command.shortcuts);
            expect(row.chords.length).toBeGreaterThan(0);
        }
        expect(rows.map((row) => row.command.id)).not.toContain("no.shortcut");
        expect(rows.map((row) => row.command.id)).not.toContain("edit.fill");
    });

    it("lists exactly the shortcuts of the app's registry", () => {
        const groups = shortcutGroups(appCommands.list());
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

    it("follows the registry: a command registered later is on the sheet, a removed one is not", () => {
        const own = registryOf(spec("edit.undo", { shortcut: "Ctrl+Z", menuPath: ["Edit"] }));
        expect(sheetBindings(shortcutGroups(own.list()))).toEqual(["edit.undo Ctrl+Z"]);
        const remove = own.register(spec("layer.new", { shortcut: "Shift+N" }));
        expect(sheetBindings(shortcutGroups(own.list()))).toEqual([
            "edit.undo Ctrl+Z",
            "layer.new Shift+N",
        ]);
        remove();
        expect(sheetBindings(shortcutGroups(own.list()))).toEqual(["edit.undo Ctrl+Z"]);
    });

    it("groups the commands by menu, in the order of the menu bar and of each menu", () => {
        expect(outline(shortcutGroups(registry.list()))).toEqual({
            File: ["file.recent.clear: Alt+F8"],
            Edit: ["edit.undo: Ctrl+Z", "edit.redo: Ctrl+Y, Ctrl+Shift+Z"],
            View: ["view.fit: 0", "view.zoomIn: Ctrl++"],
            [OTHER_SHORTCUTS]: ["tool.hand: Space", "frame.next: ArrowRight", "tool.pencil: B"],
        });
        const titles = shortcutGroups(registry.list()).map((group) => group.title);
        const bar: readonly string[] = MENU_BAR;
        expect(titles).toEqual([...bar.filter((menu) => titles.includes(menu)), OTHER_SHORTCUTS]);
    });

    it("puts the commands outside the menus in a last group, ordered by title", () => {
        const groups = shortcutGroups(registry.list());
        expect(groups.at(-1)?.title).toBe("Other");
        expect(groups.at(-1)?.rows.map((row) => row.title)).toEqual([
            "Hand",
            "Next Frame",
            "Pencil",
        ]);
    });

    it("leaves out a menu without shortcuts, and the last group when it is empty", () => {
        const own = registryOf(
            spec("edit.undo", { shortcut: "Ctrl+Z", menuPath: ["Edit"] }),
            spec("layer.flatten", { menuPath: ["Layer"] }),
        );
        expect(Object.keys(outline(shortcutGroups(own.list())))).toEqual(["Edit"]);
        expect(shortcutGroups(createCommandRegistry().list())).toEqual([]);
    });

    it("lists a disabled command too, with the title it has now", () => {
        const edit = shortcutGroups(registry.list()).find((group) => group.title === "Edit");
        expect(edit?.rows[0]).toMatchObject({ title: "Undo Pencil", chords: ["Ctrl+Z"] });
        expect(edit?.rows[0]?.command.enabled()).toBe(false);
    });

    it("marks the bindings that act while the key is held", () => {
        const rows = shortcutGroups(registry.list()).flatMap((group) => group.rows);
        expect(rows.filter((row) => row.hold).map((row) => row.command.id)).toEqual(["tool.hand"]);
    });
});
