import { readdirSync } from "node:fs";
import { posix } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appCommands, commandModulePaths } from "../../src/app/testing/pageModules";
import { normalizeChord } from "@ngne/editor-ui/commands";
import { buildMenu, menuCommands } from "@ngne/editor-ui/commands";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { MenuNode } from "@ngne/editor-ui/commands";
import { createCommandRegistry, findChordConflicts } from "@ngne/editor-ui/commands";
import { KEY_CONTEXTS, MENU_BAR } from "../../src/app/testing/pageModules";
import type { CommandSpec } from "@ngne/editor-ui/commands";
import { setKeyContext } from "../../src/app/keymap/contextState";
import { sessionsStore } from "../../src/app/state/sessions";
import { createDocument } from "../../src/core/model";
import { renameCommand } from "./se-007-support";

// SE-007: the app's command registry and modules, and the menus generated from it.

const run = () => {};
const spec = (id: string, rest: Partial<CommandSpec> = {}): CommandSpec => ({
    id,
    title: id,
    run,
    ...rest,
});

/** A menu as text: ids, "---" for a separator, "Title > [...]" for a submenu. */
function outline(nodes: readonly MenuNode[]): (string | object)[] {
    return nodes.map((node) =>
        node.kind === "command"
            ? node.command.id
            : node.kind === "separator"
              ? "---"
              : { [node.title]: outline(node.children) },
    );
}

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    setKeyContext("gesture", false);
    setKeyContext("floating", false);
});

describe("command modules", () => {
    it("discovers every *.commands.ts module under src", () => {
        const modules = readdirSync(new URL("../../src/", import.meta.url), {
            recursive: true,
            encoding: "utf8",
        })
            .map((path) => path.replaceAll("\\", "/"))
            .filter((path) => /\.commands\.tsx?$/.test(path));
        expect(modules).toEqual(
            expect.arrayContaining([
                "app/commands/planned.commands.ts",
                "app/state/history.commands.ts",
            ]),
        );
        // The registry names each command's module by its path from editorUi.ts.
        const fromRegistry = (path: string) => {
            const relative = posix.relative("app", path);
            return relative.startsWith(".") ? relative : `./${relative}`;
        };
        expect([...commandModulePaths]).toEqual(modules.map(fromRegistry).sort());
        // Every command of the registry but the package's own comes from one of them.
        const own = appCommands
            .list()
            .filter((command) => !command.source.startsWith("@ngne/editor-ui/"));
        for (const command of own) {
            expect(commandModulePaths, command.id).toContain(command.source);
        }
    });
});

describe("the app's registry", () => {
    it("holds the commands of this ticket", () => {
        expect(appCommands.get("edit.undo")).toMatchObject({
            planned: false,
            shortcuts: ["Ctrl+Z"],
            contexts: ["global"],
            menuPath: ["Edit"],
        });
        expect(appCommands.get("edit.redo")).toMatchObject({
            planned: false,
            shortcuts: ["Ctrl+Y", "Ctrl+Shift+Z"],
            contexts: ["global"],
            menuPath: ["Edit"],
        });
        expect(appCommands.get("focus.nextRegion")).toMatchObject({
            shortcuts: ["F6"],
            contexts: ["global", "text"],
        });
        expect(appCommands.get("focus.previousRegion")).toMatchObject({
            shortcuts: ["Shift+F6"],
            contexts: ["global", "text"],
        });
    });

    it("plans a menu item for the commands of later tickets", () => {
        const ids = plannedCommands.map((plan) => plan.id);
        expect(ids.length).toBeGreaterThan(40);
        expect(new Set(ids).size).toBe(ids.length);
        // Every menu of the bar has planned items, and those the tickets name are among them.
        for (const menu of MENU_BAR) {
            expect(
                plannedCommands.some((plan) => plan.menuPath[0] === menu),
                menu,
            ).toBe(true);
        }
        expect(ids).toEqual(
            expect.arrayContaining([
                "file.new",
                "file.open",
                "file.save",
                "file.importPng",
                "file.export",
                "sprite.properties",
                "sprite.canvasSize",
                "layer.new",
                "layer.newReference",
                "frame.new",
                "frame.newTag",
                "frame.celProperties",
                "select.all",
                "view.zoomIn",
                "view.grid",
                "view.onionSkin",
            ]),
        );
    });

    it("shows a planned command disabled and without a binding until its ticket implements it", () => {
        for (const plan of plannedCommands) {
            const command = appCommands.get(plan.id);
            // Implemented or replaced by its ticket: no longer this ticket's to check.
            if (!command?.planned) continue;
            expect(command.enabled(), plan.id).toBe(false);
            // Bindings of commands that do not exist yet are registered by their own tickets.
            expect(command.shortcuts, plan.id).toEqual([]);
            expect(command.title(), plan.id).toBe(plan.title);
            expect(command.menuPath, plan.id).toEqual(plan.menuPath);
        }
    });

    it("has only canonical chords and known contexts", () => {
        for (const command of appCommands.list()) {
            for (const chord of command.shortcuts) {
                expect(normalizeChord(chord), command.id).toBe(chord);
            }
            for (const context of command.contexts) expect(KEY_CONTEXTS).toContain(context);
        }
    });

    const SIZE = { name: "sprite", width: 8, height: 8 };
    /** Editor states in which the set of enabled commands differs. */
    const states: [name: string, enter: () => void][] = [
        ["no document", () => {}],
        ["a new document", () => void sessionsStore.getState().open(createDocument(SIZE))],
        [
            "after a command",
            () => {
                const { history } = sessionsStore.getState().open(createDocument(SIZE));
                history.execute(renameCommand("renamed"));
            },
        ],
        [
            "after undo",
            () => {
                const { history } = sessionsStore.getState().open(createDocument(SIZE));
                history.execute(renameCommand("renamed"));
                history.undo();
            },
        ],
        [
            "with a gesture and a floating selection",
            () => {
                sessionsStore.getState().open(createDocument(SIZE));
                setKeyContext("gesture", true);
                setKeyContext("floating", true);
            },
        ],
    ];

    for (const [name, enter] of states) {
        it(`no two enabled commands share a chord in the same context: ${name}`, () => {
            enter();
            // The state must really enable something, or the check is empty.
            const bound = appCommands
                .list()
                .filter((command) => command.enabled() && command.shortcuts.length > 0);
            expect(bound.length).toBeGreaterThanOrEqual(2);
            expect(findChordConflicts(appCommands)).toEqual([]);
        });
    }
});

describe("menus generated from the registry", () => {
    it("the menu bar has the eight menus of DESIGN §2, none of them empty", () => {
        expect(MENU_BAR).toEqual([
            "File",
            "Edit",
            "Sprite",
            "Layer",
            "Frame",
            "Select",
            "View",
            "Help",
        ]);
        for (const menu of MENU_BAR) {
            expect(buildMenu(appCommands.list(), [menu]).length, menu).toBeGreaterThan(0);
        }
    });

    it("every menu item corresponds to a registry entry, and none is an orphan", () => {
        const inMenus = MENU_BAR.flatMap((menu) =>
            menuCommands(buildMenu(appCommands.list(), [menu])),
        );
        // Each item is the registry's own entry for its id.
        for (const command of inMenus) {
            expect(appCommands.get(command.id), command.id).toBe(command);
        }
        // Each entry with a menu path appears in the menus exactly once.
        const withPath = appCommands.list().filter((command) => command.menuPath !== null);
        expect(inMenus.map((command) => command.id).sort()).toEqual(
            withPath.map((command) => command.id).sort(),
        );
        expect(new Set(inMenus).size).toBe(inMenus.length);
        // A path outside the menu bar cannot be registered, so no entry is left without a menu.
        for (const command of withPath) expect(MENU_BAR).toContain(command.menuPath?.[0]);
    });

    it("puts Undo and Redo first in Edit, in a group of their own", () => {
        const edit = outline(buildMenu(appCommands.list(), ["Edit"]));
        expect(edit.slice(0, 3)).toEqual(["edit.undo", "edit.redo", "---"]);
    });

    it("lays the planned items out in separated groups, in the order planned", () => {
        // The plan alone, so the result does not depend on what later tickets register.
        const registry = createCommandRegistry<string, string>({ menus: MENU_BAR });
        for (const plan of plannedCommands) registry.plan(plan);
        expect(outline(buildMenu(registry.list(), ["File"]))).toEqual([
            "file.new",
            "file.open",
            "---",
            "file.save",
            "file.saveAs",
            "file.revert",
            "---",
            "file.importPng",
            "---",
            "file.export",
            "file.exportAgain",
            "---",
            "file.close",
        ]);
        expect(outline(buildMenu(registry.list(), ["Select"]))).toEqual([
            "select.all",
            "select.none",
            "select.invert",
        ]);
        // Edit keeps its first group free for Undo and Redo.
        expect(outline(buildMenu(registry.list(), ["Edit"]))[0]).toBe("edit.cut");
        registry.register(spec("edit.undo", { menuPath: ["Edit"], menuOrder: 100 }));
        expect(outline(buildMenu(registry.list(), ["Edit"])).slice(0, 3)).toEqual([
            "edit.undo",
            "---",
            "edit.cut",
        ]);
    });
});
