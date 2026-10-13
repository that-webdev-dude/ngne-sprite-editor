import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu } from "../../src/app/commands/menuModel";
import type { MenuNode } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import { resolveKey } from "../../src/app/keymap/resolve";
import type { KeyEnvironment } from "../../src/app/keymap/resolve";
import { createSurfaces, SURFACE_IDS, surfaces } from "../../src/app/surfaces/surfaces";
import type { SurfaceId } from "../../src/app/surfaces/surfaces";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";

// SE-064: the three commands of this ticket in the registry (their planned menu items, their
// chords from SPEC §7.8), and the store of the surfaces they open.

const COMMANDS: Record<SurfaceId, string> = {
    "command-palette": "edit.commandPalette",
    preferences: "edit.preferences",
    "shortcut-sheet": "edit.shortcuts",
};

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

/** The chords SPEC §7.8 lists for the row whose action is `action`, with their contexts. */
function specRow(action: string) {
    const bindings = readSpecKeyTable().bindings.filter((binding) =>
        binding.row.endsWith(`— ${action}`),
    );
    if (bindings.length === 0) throw new Error(`SPEC §7.8 has no row "${action}"`);
    return bindings.map(({ chord, context, text, hold }) => ({ chord, context, text, hold }));
}

/** The ids of a menu's commands, with "---" for a separator. */
function outline(nodes: readonly MenuNode[]): string[] {
    return nodes.map((node) => (node.kind === "command" ? node.command.id : "---"));
}

/** A key pressed with nothing open, on the viewport unless stated otherwise. */
function environment(overrides: Partial<KeyEnvironment> = {}): KeyEnvironment {
    return {
        overlayOpen: false,
        focus: "viewport",
        inTimeline: false,
        nativeKeys: new Set(),
        typeahead: false,
        gesture: false,
        floating: false,
        ...overrides,
    };
}

afterEach(() => {
    surfaces.close();
});

describe("the commands of SE-064 in the registry", () => {
    it("take the menu items planned for them, at the end of Edit", () => {
        for (const id of Object.values(COMMANDS)) {
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(plan, id).toBeDefined();
            expect(command(id), id).toMatchObject({
                planned: false,
                menuPath: ["Edit"],
                menuOrder: plan?.menuOrder,
            });
            expect(command(id).title(), id).toBe(plan?.title);
            // Always available: none of them needs a document.
            expect(command(id).enabled(), id).toBe(true);
        }
        expect(outline(buildMenu(appCommands.list(), ["Edit"])).slice(-4)).toEqual([
            "---",
            "edit.commandPalette",
            "edit.shortcuts",
            "edit.preferences",
        ]);
    });

    it("each registers from a module of its own", () => {
        expect(command("edit.commandPalette").source).toBe(
            "../commandPalette/commandPalette.commands.ts",
        );
        expect(command("edit.preferences").source).toBe("../preferences/preferences.commands.ts");
        expect(command("edit.shortcuts").source).toBe("../shortcuts/shortcuts.commands.ts");
    });

    it("the command palette binds the chord of SPEC §7.8: Ctrl+K, also in text fields", () => {
        expect(specRow("Command palette")).toEqual([
            { chord: "Ctrl+K", context: "global", text: true, hold: false },
        ]);
        expect(command("edit.commandPalette")).toMatchObject({
            shortcuts: ["Ctrl+K"],
            contexts: ["global", "text"],
            release: null,
        });
    });

    it("the shortcut sheet binds the chord of SPEC §7.8: ? in the canvas context only", () => {
        expect(specRow("Shortcut sheet")).toEqual([
            { chord: "?", context: "canvas", text: false, hold: false },
        ]);
        expect(command("edit.shortcuts")).toMatchObject({
            shortcuts: ["?"],
            contexts: ["canvas"],
            release: null,
        });
    });

    it("Preferences has no key: SPEC §7.8 lists none", () => {
        expect(command("edit.preferences").shortcuts).toEqual([]);
        const actions = readSpecKeyTable().bindings.map((binding) => binding.row);
        expect(actions.filter((row) => /preferences/i.test(row))).toEqual([]);
    });

    it("Ctrl+K reaches the palette everywhere but under a menu or a dialog", () => {
        const resolved = (overrides: Partial<KeyEnvironment>) =>
            resolveKey(appCommands, "Ctrl+K", environment(overrides));
        const palette = command("edit.commandPalette");
        expect(resolved({})).toMatchObject({ action: "run", command: palette });
        expect(resolved({ focus: "none" })).toMatchObject({ action: "run", command: palette });
        expect(resolved({ focus: "control" })).toMatchObject({ action: "run", command: palette });
        expect(resolved({ focus: "text" })).toMatchObject({
            action: "run",
            command: palette,
            context: "text",
        });
        expect(resolved({ inTimeline: true, focus: "control" })).toMatchObject({ action: "run" });
        // Bound but not acting: Chrome's own Ctrl+K is suppressed.
        expect(resolved({ overlayOpen: true })).toEqual({ action: "suppress" });
        expect(resolved({ overlayOpen: true, focus: "text" })).toEqual({ action: "suppress" });
    });

    it("? reaches the shortcut sheet in the canvas context, and is typed in a text field", () => {
        const resolved = (overrides: Partial<KeyEnvironment>) =>
            resolveKey(appCommands, "?", environment(overrides));
        const sheet = command("edit.shortcuts");
        expect(resolved({})).toMatchObject({ action: "run", command: sheet, context: "canvas" });
        expect(resolved({ focus: "none" })).toMatchObject({ action: "run", command: sheet });
        expect(resolved({ focus: "control" })).toMatchObject({ action: "run", command: sheet });
        expect(resolved({ inTimeline: true, focus: "control" })).toMatchObject({
            action: "run",
            command: sheet,
        });
        // The field types the character; a select uses it for typeahead; a dialog keeps it.
        expect(resolved({ focus: "text" })).toEqual({ action: "pass" });
        expect(resolved({ focus: "control", typeahead: true })).toEqual({ action: "pass" });
        expect(resolved({ overlayOpen: true })).toEqual({ action: "pass" });
    });

    it("each command opens its surface", () => {
        for (const id of SURFACE_IDS) {
            surfaces.close();
            expect(surfaces.store.getState().open).toBeNull();
            void command(COMMANDS[id]).run();
            expect(surfaces.store.getState().open, id).toBe(id);
        }
    });
});

describe("surfaces", () => {
    it("start closed", () => {
        expect(createSurfaces().store.getState()).toEqual({ open: null });
        expect(SURFACE_IDS).toEqual(["command-palette", "preferences", "shortcut-sheet"]);
    });

    it("open one at a time: a surface takes the place of the open one", () => {
        const own = createSurfaces();
        own.open("command-palette");
        expect(own.store.getState().open).toBe("command-palette");
        own.open("preferences");
        expect(own.store.getState().open).toBe("preferences");
    });

    it("close the open surface, or only the named one", () => {
        const own = createSurfaces();
        own.open("preferences");
        own.close("shortcut-sheet");
        expect(own.store.getState().open).toBe("preferences");
        own.close("preferences");
        expect(own.store.getState().open).toBeNull();
        own.open("shortcut-sheet");
        own.close();
        expect(own.store.getState().open).toBeNull();
    });

    it("notify subscribers of a change, and not of what changes nothing", () => {
        const own = createSurfaces();
        const seen: (SurfaceId | null)[] = [];
        own.store.subscribe((state) => seen.push(state.open));
        own.close();
        own.open("command-palette");
        own.open("command-palette");
        own.close("preferences");
        own.close();
        own.close();
        expect(seen).toEqual(["command-palette", null]);
    });
});
