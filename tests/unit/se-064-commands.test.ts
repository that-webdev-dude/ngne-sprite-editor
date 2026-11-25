import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/testing/pageModules";
import { buildMenu } from "@ngne/editor-ui/commands";
import type { MenuNode } from "@ngne/editor-ui/commands";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "@ngne/editor-ui/commands";
import { resolveKey } from "@ngne/editor-ui/commands";
import type { KeyEnvironment } from "@ngne/editor-ui/commands";
import { surfaces } from "../../src/app/testing/pageModules";
import { readSpecKeyTable } from "../e2e/se-007-spec-keys";

// SE-064: the three commands of this ticket in the registry (their planned menu items, their
// chords from SPEC §7.8), and the store of the surfaces they open.

/** The surfaces the commands of SE-064 open. */
type SurfaceId = "command-palette" | "preferences" | "shortcut-sheet";
const SURFACE_IDS: readonly SurfaceId[] = ["command-palette", "preferences", "shortcut-sheet"];

const COMMANDS: Record<SurfaceId, string> = {
    "command-palette": "edit.commandPalette",
    preferences: "edit.preferences",
    "shortcut-sheet": "edit.shortcuts",
};

/** The menu each command's planned item is in: Keyboard Shortcuts… moved to Help (#8). */
const MENUS: Record<SurfaceId, string> = {
    "command-palette": "Edit",
    preferences: "Edit",
    "shortcut-sheet": "Help",
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
        nativeKeys: new Set(),
        typeahead: false,
        ...overrides,
    };
}

/** The app's contexts active for a key: in the timeline, or none. */
type Active = readonly "timeline"[];

afterEach(() => {
    surfaces.close();
});

describe("the commands of SE-064 in the registry", () => {
    it("take the menu items planned for them, at the end of Edit and at the head of Help", () => {
        for (const surface of SURFACE_IDS) {
            const id = COMMANDS[surface];
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(plan, id).toBeDefined();
            expect(command(id), id).toMatchObject({
                planned: false,
                menuPath: [MENUS[surface]],
                // Keyboard Shortcuts… is the package's, first in Help (its canon): order 0.
                menuOrder: surface === "shortcut-sheet" ? 0 : plan?.menuOrder,
            });
            expect(command(id).title(), id).toBe(plan?.title);
            // Always available: none of them needs a document.
            expect(command(id).enabled(), id).toBe(true);
        }
        expect(outline(buildMenu(appCommands.list(), ["Edit"])).slice(-3)).toEqual([
            "---",
            "edit.commandPalette",
            "edit.preferences",
        ]);
        expect(outline(buildMenu(appCommands.list(), ["Edit"]))).not.toContain("edit.shortcuts");
        expect(outline(buildMenu(appCommands.list(), ["Help"]))).toEqual([
            "edit.shortcuts",
            "---",
            "help.about",
        ]);
    });

    it("each registers from a module of its own", () => {
        expect(command("edit.commandPalette").source).toBe(
            "@ngne/editor-ui/commands/commandPalette.commands.ts",
        );
        expect(command("edit.preferences").source).toBe("./preferences/preferences.commands.ts");
        expect(command("edit.shortcuts").source).toBe(
            "@ngne/editor-ui/commands/shortcutSheet.commands.ts",
        );
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
        const resolved = (overrides: Partial<KeyEnvironment>, active: Active = []) =>
            resolveKey(appCommands, "Ctrl+K", environment(overrides), active);
        const palette = command("edit.commandPalette");
        expect(resolved({})).toMatchObject({ action: "run", command: palette });
        expect(resolved({ focus: "none" })).toMatchObject({ action: "run", command: palette });
        expect(resolved({ focus: "control" })).toMatchObject({ action: "run", command: palette });
        expect(resolved({ focus: "text" })).toMatchObject({
            action: "run",
            command: palette,
            context: "text",
        });
        expect(resolved({ focus: "control" }, ["timeline"])).toMatchObject({ action: "run" });
        // Bound but not acting: Chrome's own Ctrl+K is suppressed.
        expect(resolved({ overlayOpen: true })).toEqual({ action: "suppress" });
        expect(resolved({ overlayOpen: true, focus: "text" })).toEqual({ action: "suppress" });
    });

    it("? reaches the shortcut sheet in the canvas context, and is typed in a text field", () => {
        const resolved = (overrides: Partial<KeyEnvironment>, active: Active = []) =>
            resolveKey(appCommands, "?", environment(overrides), active);
        const sheet = command("edit.shortcuts");
        expect(resolved({})).toMatchObject({ action: "run", command: sheet, context: "canvas" });
        expect(resolved({ focus: "none" })).toMatchObject({ action: "run", command: sheet });
        expect(resolved({ focus: "control" })).toMatchObject({ action: "run", command: sheet });
        expect(resolved({ focus: "control" }, ["timeline"])).toMatchObject({
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
