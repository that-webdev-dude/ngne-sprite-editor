import { readdirSync } from "node:fs";
import { posix } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appCommands, commandModulePaths } from "../../src/app/commands/appCommands";
import { normalizeChord } from "../../src/app/commands/chord";
import { invokeCommand } from "../../src/app/commands/invoke";
import { buildContextMenu, buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { MenuNode } from "../../src/app/commands/menuModel";
import {
    CommandRegistryError,
    createCommandRegistry,
    findChordConflicts,
    registerCommandModules,
} from "../../src/app/commands/registry";
import { KEY_CONTEXTS, MENU_BAR } from "../../src/app/commands/types";
import type { CommandSpec } from "../../src/app/commands/types";
import { setKeyContext } from "../../src/app/keymap/contextState";
import { sessionsStore } from "../../src/app/state/sessions";
import { createDocument } from "../../src/core/model";
import { contextMenuEntries } from "../../src/ui/commands/contextMenu";
import { renameCommand } from "./se-007-support";

// SE-007: command registry, and the menus, context menus and shortcuts generated from it.

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

describe("command registry", () => {
    it("resolves the optional fields of a command", () => {
        const registry = createCommandRegistry();
        registry.register(spec("plain"));
        registry.register(
            spec("full", {
                title: () => "Dynamic",
                enabled: () => false,
                shortcut: ["ctrl+y", "Ctrl+Shift+Z"],
                context: "canvas",
                menuPath: ["Edit"],
                menuOrder: 110,
                contextMenus: [{ menu: "layer" }, { menu: "cel", order: 20 }],
            }),
        );
        expect(registry.get("plain")).toMatchObject({
            id: "plain",
            planned: false,
            source: "runtime",
            shortcuts: [],
            contexts: ["global"],
            menuPath: null,
            menuOrder: 1000,
            contextMenus: [],
            release: null,
        });
        expect(registry.get("plain")?.title()).toBe("plain");
        expect(registry.get("plain")?.enabled()).toBe(true);

        const full = registry.get("full");
        expect(full?.title()).toBe("Dynamic");
        expect(full?.enabled()).toBe(false);
        expect(full?.shortcuts).toEqual(["Ctrl+Y", "Ctrl+Shift+Z"]);
        expect(full?.contexts).toEqual(["canvas"]);
        expect(full).toMatchObject({ menuPath: ["Edit"], menuOrder: 110 });
        expect(full?.contextMenus).toEqual([
            { menu: "layer", order: 1000 },
            { menu: "cel", order: 20 },
        ]);
    });

    it("lists commands by id and finds bindings by context and chord", () => {
        const registry = createCommandRegistry();
        registry.register(spec("b", { shortcut: "Enter", context: ["canvas", "timeline"] }));
        registry.register(spec("a", { shortcut: "Ctrl+S", context: ["global", "text"] }));
        registry.register(spec("c", { shortcut: "Enter", context: "floating" }));
        expect(registry.list().map((command) => command.id)).toEqual(["a", "b", "c"]);
        expect(registry.bindings("canvas", "Enter").map((command) => command.id)).toEqual(["b"]);
        expect(registry.bindings("floating", "Enter").map((command) => command.id)).toEqual(["c"]);
        expect(registry.bindings("global", "Enter")).toEqual([]);
        expect(registry.bindings("text", "Ctrl+S").map((command) => command.id)).toEqual(["a"]);
        expect(registry.isBound("Enter")).toBe(true);
        expect(registry.isBound("Ctrl+P")).toBe(false);
    });

    it("removes a command with the function `register` returns", () => {
        const registry = createCommandRegistry();
        const remove = registry.register(spec("a", { shortcut: "B", context: "canvas" }));
        remove();
        expect(registry.get("a")).toBeUndefined();
        expect(registry.isBound("B")).toBe(false);
        remove();
        registry.register(spec("a"));
        expect(registry.list()).toHaveLength(1);
    });

    it("notifies subscribers of every change and on refresh", () => {
        const registry = createCommandRegistry();
        let notified = 0;
        const stop = registry.subscribe(() => notified++);
        const before = registry.version();
        const remove = registry.register(spec("a"));
        remove();
        registry.refresh();
        expect(notified).toBe(3);
        expect(registry.version()).toBe(before + 3);
        stop();
        registry.refresh();
        expect(notified).toBe(3);
    });

    it("rejects a second command with the same id, naming both modules", () => {
        const registry = createCommandRegistry();
        registry.register(spec("edit.undo"), "./a.commands.ts");
        expect(() => registry.register(spec("edit.undo"), "./b.commands.ts")).toThrow(
            /"edit\.undo".*\.\/a\.commands\.ts.*\.\/b\.commands\.ts/,
        );
    });

    it("rejects commands it cannot use, naming the command", () => {
        const registry = createCommandRegistry();
        const register = (rest: Partial<CommandSpec>) => () =>
            registry.register(spec("bad", rest), "./bad.commands.ts");
        expect(register({ shortcut: "Hyper+Q" })).toThrow(CommandRegistryError);
        expect(register({ shortcut: "Hyper+Q" })).toThrow(/"bad" \(\.\/bad\.commands\.ts\)/);
        expect(register({ shortcut: ["Ctrl+S", "ctrl+s"] })).toThrow(/shortcut twice/);
        expect(register({ context: [] })).toThrow(/contexts/);
        expect(register({ context: ["canvas", "canvas"] })).toThrow(/contexts/);
        expect(register({ context: "nowhere" as "canvas" })).toThrow(/unknown context/);
        expect(register({ menuPath: [] })).toThrow(/empty menu path/);
        expect(register({ menuPath: ["Help"] })).toThrow(/names the menu "Help"/);
        expect(register({ menuPath: ["File", " "] })).toThrow(/empty menu path/);
        expect(register({ contextMenus: [{ menu: "" }] })).toThrow(/empty context menu/);
        expect(() => registry.register(spec(" "))).toThrow(/has no id/);
        expect(registry.list()).toEqual([]);
    });

    it("runs a command only while it is enabled", () => {
        const registry = createCommandRegistry();
        let enabled = false;
        let runs = 0;
        registry.register(spec("a", { enabled: () => enabled, run: () => void runs++ }));
        const command = registry.get("a");
        if (!command) throw new Error("missing command");
        const fail = () => {
            throw new Error("unexpected error");
        };
        expect(invokeCommand(command, fail)).toBe(false);
        enabled = true;
        expect(invokeCommand(command, fail)).toBe(true);
        expect(runs).toBe(1);
    });
});

describe("planned commands", () => {
    const plan = { id: "file.save", title: "Save", menuPath: ["File"], menuOrder: 200 };

    it("are listed disabled, without a shortcut, at their menu position", () => {
        const registry = createCommandRegistry();
        registry.plan(plan, "./planned.commands.ts");
        const command = registry.get("file.save");
        expect(command).toMatchObject({
            planned: true,
            shortcuts: [],
            menuPath: ["File"],
            menuOrder: 200,
        });
        expect(command?.enabled()).toBe(false);
        expect(command?.title()).toBe("Save");
        expect(command && invokeCommand(command, run)).toBe(false);
    });

    it("are implemented by a command with the same id, which keeps the menu position", () => {
        for (const order of ["plan first", "command first"]) {
            const registry = createCommandRegistry();
            const implementation = spec("file.save", { title: "Save", shortcut: "Ctrl+S" });
            if (order === "plan first") registry.plan(plan);
            const remove = registry.register(implementation, "./files.commands.ts");
            if (order === "command first") registry.plan(plan);

            expect(registry.list()).toHaveLength(1);
            expect(registry.get("file.save"), order).toMatchObject({
                planned: false,
                source: "./files.commands.ts",
                shortcuts: ["Ctrl+S"],
                menuPath: ["File"],
                menuOrder: 200,
            });
            expect(registry.get("file.save")?.enabled()).toBe(true);

            // Without its implementation the plan is back.
            remove();
            expect(registry.get("file.save")?.planned).toBe(true);
        }
    });

    it("let the implementation choose another menu position", () => {
        const registry = createCommandRegistry();
        registry.plan(plan);
        const remove = registry.register(spec("file.save", { menuPath: ["Edit"], menuOrder: 5 }));
        expect(registry.get("file.save")).toMatchObject({ menuPath: ["Edit"], menuOrder: 5 });
        remove();
        // Another order in the planned menu.
        const again = registry.register(spec("file.save", { menuOrder: 230 }));
        expect(registry.get("file.save")).toMatchObject({ menuPath: ["File"], menuOrder: 230 });
        again();
        // The planned order belongs to the planned menu: it does not follow to another one.
        registry.register(spec("file.save", { menuPath: ["File", "More"] }));
        expect(registry.get("file.save")).toMatchObject({
            menuPath: ["File", "More"],
            menuOrder: 1000,
        });
    });

    it("disappear when a command replaces them", () => {
        const registry = createCommandRegistry();
        registry.plan({ id: "view.symmetry", title: "Symmetry", menuPath: ["View"] });
        registry.plan({ id: "view.tiled", title: "Tiled Mode", menuPath: ["View"] });
        const remove = registry.register(
            spec("view.symmetryX", { menuPath: ["View", "Symmetry"], replaces: ["view.symmetry"] }),
        );
        expect(registry.list().map((command) => command.id)).toEqual([
            "view.symmetryX",
            "view.tiled",
        ]);
        expect(registry.get("view.symmetry")).toBeUndefined();
        remove();
        expect(registry.get("view.symmetry")?.planned).toBe(true);
    });

    it("reject a second plan with the same id and a path outside the menu bar", () => {
        const registry = createCommandRegistry();
        registry.plan(plan, "./a.commands.ts");
        expect(() => registry.plan(plan, "./b.commands.ts")).toThrow(
            /"file\.save".*\.\/a\.commands\.ts.*\.\/b\.commands\.ts/,
        );
        expect(() => registry.plan({ id: "x", title: "X", menuPath: ["Window"] })).toThrow(
            /names the menu "Window"/,
        );
    });
});

describe("command modules", () => {
    it("registers plans before commands, whatever the module order", () => {
        const registry = createCommandRegistry();
        registerCommandModules(registry, {
            "./a.commands.ts": { commands: [spec("file.save", { shortcut: "Ctrl+S" })] },
            "./z.commands.ts": {
                plannedCommands: [{ id: "file.save", title: "Save", menuPath: ["File"] }],
            },
        });
        expect(registry.get("file.save")).toMatchObject({
            planned: false,
            source: "./a.commands.ts",
            menuPath: ["File"],
        });
    });

    it("rejects a module that exports neither commands nor plans", () => {
        expect(() =>
            registerCommandModules(createCommandRegistry(), { "./a.commands.ts": {} }),
        ).toThrow('./a.commands.ts exports neither "commands" nor "plannedCommands".');
    });

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
                "app/keymap/regions.commands.ts",
                "app/state/history.commands.ts",
            ]),
        );
        // The registry names each command's module by its path from appCommands.ts.
        const fromRegistry = (path: string) => {
            const relative = posix.relative("app/commands", path);
            return relative.startsWith(".") ? relative : `./${relative}`;
        };
        expect([...commandModulePaths]).toEqual(modules.map(fromRegistry).sort());
        // Every command of the registry comes from one of them.
        for (const command of appCommands.list()) {
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

    it("the conflict check reports enabled commands that share a chord in a context", () => {
        const registry = createCommandRegistry();
        let selection = false;
        registry.register(
            spec("nudge", { shortcut: "ArrowLeft", context: "canvas", enabled: () => selection }),
        );
        registry.register(
            spec("previous-frame", {
                shortcut: "ArrowLeft",
                context: ["canvas", "timeline"],
                enabled: () => !selection,
            }),
        );
        registry.register(spec("cell-left", { shortcut: "ArrowLeft", context: "floating" }));
        // One chord in three contexts, and in canvas the conditions exclude each other.
        expect(findChordConflicts(registry)).toEqual([]);
        selection = true;
        expect(findChordConflicts(registry)).toEqual([]);

        registry.register(spec("pan-left", { shortcut: "ArrowLeft", context: "canvas" }));
        expect(findChordConflicts(registry)).toEqual([
            { context: "canvas", chord: "ArrowLeft", commands: ["nudge", "pan-left"] },
        ]);
        selection = false;
        expect(findChordConflicts(registry)).toEqual([
            { context: "canvas", chord: "ArrowLeft", commands: ["pan-left", "previous-frame"] },
        ]);
    });
});

describe("menus generated from the registry", () => {
    it("orders items, separates groups and nests submenus", () => {
        const registry = createCommandRegistry();
        const file = (id: string, menuOrder?: number, path = ["File"]) =>
            registry.register(spec(id, { menuPath: path, menuOrder }));
        file("save", 200);
        file("open", 110);
        file("new", 100);
        file("close", 500);
        file("recent-b", 125, ["File", "Open Recent"]);
        file("recent-a", 120, ["File", "Open Recent"]);
        file("clear-recent", 300, ["File", "Open Recent"]);
        file("unordered-b");
        file("unordered-a");
        registry.register(spec("undo", { menuPath: ["Edit"] }));
        registry.register(spec("no-menu"));

        expect(outline(buildMenu(registry.list(), ["File"]))).toEqual([
            "new",
            "open",
            { "Open Recent": ["recent-a", "recent-b", "---", "clear-recent"] },
            "---",
            "save",
            "---",
            "close",
            "---",
            "unordered-a",
            "unordered-b",
        ]);
        expect(outline(buildMenu(registry.list(), ["Edit"]))).toEqual(["undo"]);
        expect(buildMenu(registry.list(), ["View"])).toEqual([]);
        expect(
            menuCommands(buildMenu(registry.list(), ["File"])).map((command) => command.id),
        ).toContain("recent-a");
    });

    it("the menu bar has the seven menus of DESIGN §2, none of them empty", () => {
        expect(MENU_BAR).toEqual(["File", "Edit", "Sprite", "Layer", "Frame", "Select", "View"]);
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
        const registry = createCommandRegistry();
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

describe("context menus generated from the registry", () => {
    it("lists the commands of one context menu in order, with separators", () => {
        const registry = createCommandRegistry();
        registry.register(spec("layer.flatten", { contextMenus: [{ menu: "layer", order: 210 }] }));
        registry.register(
            spec("layer.mergeDown", {
                menuPath: ["Layer"],
                contextMenus: [{ menu: "layer", order: 200 }],
            }),
        );
        registry.register(
            spec("properties", {
                contextMenus: [
                    { menu: "layer", order: 100 },
                    { menu: "cel", order: 100 },
                ],
            }),
        );
        registry.register(spec("cel.clear", { contextMenus: [{ menu: "cel" }] }));
        expect(outline(buildContextMenu(registry.list(), "layer"))).toEqual([
            "properties",
            "---",
            "layer.mergeDown",
            "layer.flatten",
        ]);
        expect(outline(buildContextMenu(registry.list(), "cel"))).toEqual([
            "properties",
            "---",
            "cel.clear",
        ]);
        expect(buildContextMenu(registry.list(), "tag")).toEqual([]);
    });

    it("become entries of the ContextMenu primitive that run the command", () => {
        const registry = createCommandRegistry();
        let merged = 0;
        registry.register(
            spec("layer.mergeDown", {
                title: () => "Merge Down",
                shortcut: "Ctrl+ArrowDown",
                contextMenus: [{ menu: "layer", order: 100 }],
                run: () => void merged++,
            }),
        );
        registry.register(
            spec("layer.flatten", {
                title: "Flatten",
                enabled: () => false,
                contextMenus: [{ menu: "layer", order: 200 }],
            }),
        );
        const entries = contextMenuEntries("layer", registry.list());
        expect(entries).toMatchObject([
            { id: "layer.mergeDown", label: "Merge Down", shortcut: "Ctrl+↓", disabled: false },
            { type: "separator" },
            { id: "layer.flatten", label: "Flatten", shortcut: undefined, disabled: true },
        ]);
        const [first] = entries;
        if (!first || first.type === "separator") throw new Error("expected an item");
        first.onSelect();
        expect(merged).toBe(1);
    });
});
