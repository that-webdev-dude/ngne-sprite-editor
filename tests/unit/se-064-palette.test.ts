import { describe, expect, it } from "vitest";
import { fuzzyScore } from "../../src/app/commandPalette/fuzzy";
import {
    paletteEntries,
    paletteScore,
    runPaletteCommand,
} from "../../src/app/commandPalette/paletteModel";
import {
    createRecentCommandsStore,
    MAX_RECENT_COMMANDS,
    parseRecentCommands,
    RECENT_COMMANDS_STORAGE_KEY,
} from "../../src/app/commandPalette/recentCommands";
import { createCommandRegistry } from "../../src/app/commands/registry";
import type { CommandRegistry } from "../../src/app/commands/registry";
import type { Command, CommandSpec } from "../../src/app/commands/types";
import { memoryStorage } from "./se-007-support";

// SE-064: the command palette without the interface — fuzzy search over the registry, the
// order of its rows (recent commands first), the recent list, and how a chosen command runs.

function spec(id: string, overrides: Partial<CommandSpec> = {}): CommandSpec {
    return { id, title: id, run() {}, ...overrides };
}

/** A registry with the given commands, registered in this order. */
function registryOf(...specs: CommandSpec[]): CommandRegistry {
    const registry = createCommandRegistry();
    for (const each of specs) registry.register(each);
    return registry;
}

function command(registry: CommandRegistry, id: string): Command {
    const found = registry.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

/** The ids of the palette rows for a query. */
function rows(registry: CommandRegistry, query = "", recent: readonly string[] = []): string[] {
    return paletteEntries(registry.list(), recent, query).map((entry) => entry.command.id);
}

/** The score of a term that must match. */
function score(term: string, text: string): number {
    const value = fuzzyScore(term, text);
    if (value === null) throw new Error(`"${term}" does not match "${text}"`);
    return value;
}

describe("fuzzy matching", () => {
    it("matches the characters of the term in order, not necessarily adjacent", () => {
        expect(fuzzyScore("undo", "Undo")).not.toBeNull();
        expect(fuzzyScore("nsp", "New Sprite…")).not.toBeNull();
        expect(fuzzyScore("flh", "Flip Horizontal")).not.toBeNull();
        expect(fuzzyScore("e", "Paste")).not.toBeNull();
    });

    it("does not match characters that are missing or out of order", () => {
        expect(fuzzyScore("undox", "Undo")).toBeNull();
        expect(fuzzyScore("odnu", "Undo")).toBeNull();
        expect(fuzzyScore("z", "New Sprite…")).toBeNull();
        expect(fuzzyScore("uu", "Undo")).toBeNull();
        expect(fuzzyScore("a", "")).toBeNull();
    });

    it("ignores case", () => {
        expect(score("UNDO", "undo")).toBe(score("undo", "Undo"));
        expect(score("New", "NEW SPRITE")).toBe(score("new", "new sprite"));
    });

    it("matches everything with an empty term, with no preference", () => {
        expect(fuzzyScore("", "Undo")).toBe(0);
        expect(fuzzyScore("", "")).toBe(0);
    });

    it("prefers characters next to each other over scattered ones", () => {
        expect(score("save", "Save As…")).toBeGreaterThan(score("save", "Sprite: Advanced Values"));
        expect(score("und", "Undo")).toBeGreaterThan(score("und", "Duplicate Round"));
    });

    it("prefers the start of a word over its middle", () => {
        expect(score("s", "Save")).toBeGreaterThan(score("s", "Paste"));
        expect(score("ns", "New Sprite…")).toBeGreaterThan(score("ns", "Transform"));
        expect(score("f", "New Frame")).toBeGreaterThan(score("f", "Deflate"));
    });

    it("finds the best place for the term, not the first one", () => {
        // The letters of "save" are scattered before the word itself.
        const scattered = score("save", "Sprite: Advanced Values");
        expect(score("save", "Sprite: Advanced Values, Save")).toBeGreaterThan(scattered + 5);
        expect(score("save", "Sprite: Advanced Values, Save")).toBeGreaterThan(
            score("save", "Sprite: Advanced Values, S a v e"),
        );
    });

    it("prefers a match near the start of the text", () => {
        expect(score("grid", "Grid")).toBeGreaterThan(score("grid", "Pixel Grid"));
    });
});

describe("palette search", () => {
    it("needs every term of the query, in the title or in the menu path", () => {
        expect(paletteScore("sprite prop", "Properties…", "Sprite")).not.toBeNull();
        expect(paletteScore("prop sprite", "Properties…", "Sprite")).not.toBeNull();
        expect(paletteScore("new sp", "New Sprite…", "File")).not.toBeNull();
        expect(paletteScore("layer prop", "Properties…", "Sprite")).toBeNull();
        expect(paletteScore("file", "Focus Next Region", "")).toBeNull();
    });

    it("does not join the menu path and the title into one text", () => {
        // "pref" is in "Sprite Flip Canvas Horizontal" letter by letter, across both.
        expect(paletteScore("pref", "Flip Canvas Horizontal", "Sprite")).toBeNull();
        expect(paletteScore("pref", "Preferences…", "Edit")).not.toBeNull();
    });

    it("ignores white space around the query and matches all with an empty one", () => {
        expect(paletteScore("", "Undo", "Edit")).toBe(0);
        expect(paletteScore("   ", "Undo", "Edit")).toBe(0);
        expect(paletteScore("  undo ", "Undo", "Edit")).toBe(paletteScore("undo", "Undo", "Edit"));
    });

    it("counts a term in the title more than the same term in the menu path", () => {
        const inTitle = paletteScore("frame", "New Empty Frame", "Edit");
        const inPath = paletteScore("frame", "Play / Pause", "Frame");
        expect(inTitle).not.toBeNull();
        expect(inPath).not.toBeNull();
        expect(inTitle ?? 0).toBeGreaterThan(inPath ?? 0);
    });
});

describe("palette rows", () => {
    const registry = registryOf(
        spec("view.zoomIn", { title: "Zoom In", menuPath: ["View"], menuOrder: 100 }),
        spec("file.save", { title: "Save", menuPath: ["File"], menuOrder: 200 }),
        spec("file.new", { title: "New Sprite…", menuPath: ["File"], menuOrder: 100 }),
        spec("file.recent.b", { title: "b.ngsprite", menuPath: ["File", "Open Recent"] }),
        spec("tool.pencil", { title: "Pencil", shortcut: "B", context: "canvas" }),
        spec("focus.next", { title: "Focus Next Region", shortcut: "F6" }),
        spec("edit.undo", {
            title: () => "Undo Pencil",
            menuPath: ["Edit"],
            enabled: () => false,
        }),
    );

    it("lists every command of the registry, enabled or not, once", () => {
        expect(rows(registry).sort()).toEqual(
            registry
                .list()
                .map((entry) => entry.id)
                .sort(),
        );
        expect(command(registry, "edit.undo").enabled()).toBe(false);
        expect(rows(registry)).toContain("edit.undo");
    });

    it("lists planned commands too: they are in the registry, disabled", () => {
        const planned = registryOf(spec("file.new", { menuPath: ["File"] }));
        planned.plan({ id: "file.open", title: "Open…", menuPath: ["File"] });
        const entries = paletteEntries(planned.list(), [], "");
        expect(entries.map((entry) => entry.command.id)).toEqual(["file.new", "file.open"]);
        expect(entries[1]?.command).toMatchObject({ planned: true });
        expect(entries[1]?.command.enabled()).toBe(false);
    });

    it("orders them as the menu bar does, then the commands outside the menus by title", () => {
        expect(rows(registry)).toEqual([
            "file.new",
            "file.save",
            "file.recent.b",
            "edit.undo",
            "view.zoomIn",
            "focus.next",
            "tool.pencil",
        ]);
    });

    it("gives each row its title and its place in the menus", () => {
        const entries = paletteEntries(registry.list(), [], "");
        const row = (id: string) => entries.find((entry) => entry.command.id === id);
        expect(row("edit.undo")).toMatchObject({ title: "Undo Pencil", group: "Edit" });
        expect(row("file.recent.b")).toMatchObject({ group: "File › Open Recent" });
        expect(row("tool.pencil")).toMatchObject({ title: "Pencil", group: "" });
        // The row holds the registry's own command: its shortcut and its state.
        expect(row("tool.pencil")?.command).toBe(registry.get("tool.pencil"));
    });

    it("puts recent commands first, newest first", () => {
        expect(rows(registry, "", ["tool.pencil", "view.zoomIn"])).toEqual([
            "tool.pencil",
            "view.zoomIn",
            "file.new",
            "file.save",
            "file.recent.b",
            "edit.undo",
            "focus.next",
        ]);
        // A recent command that is disabled now keeps its place and its state.
        expect(rows(registry, "", ["edit.undo"])[0]).toBe("edit.undo");
        // An id the registry no longer has is ignored.
        expect(rows(registry, "", ["gone", "file.save"]).slice(0, 2)).toEqual([
            "file.save",
            "file.new",
        ]);
    });

    it("keeps only the commands that match the query, the best match first", () => {
        expect(rows(registry, "zoom")).toEqual(["view.zoomIn"]);
        expect(rows(registry, "pen")).toEqual(["tool.pencil", "edit.undo", "file.recent.b"]);
        expect(rows(registry, "no such command")).toEqual([]);
        // Through the menu path as well.
        expect(rows(registry, "file")).toEqual(["file.new", "file.save", "file.recent.b"]);
    });

    it("breaks a tie between equal matches by recency, then by menu order", () => {
        const flips = registryOf(
            spec("edit.flipHorizontal", { title: "Flip A", menuPath: ["Edit"], menuOrder: 100 }),
            spec("edit.flipVertical", { title: "Flip B", menuPath: ["Edit"], menuOrder: 110 }),
            spec("edit.fill", { title: "Fill", menuPath: ["Edit"], menuOrder: 120 }),
        );
        expect(rows(flips, "flip")).toEqual(["edit.flipHorizontal", "edit.flipVertical"]);
        expect(rows(flips, "flip", ["edit.flipVertical"])).toEqual([
            "edit.flipVertical",
            "edit.flipHorizontal",
        ]);
        // A better match stays ahead of a recent command.
        expect(rows(flips, "fi", ["edit.flipVertical"])).toEqual([
            "edit.fill",
            "edit.flipVertical",
            "edit.flipHorizontal",
        ]);
    });
});

describe("running a command from the palette", () => {
    const recorder = () => {
        const ids: string[] = [];
        return { ids, record: (id: string) => void ids.push(id) };
    };

    it("runs an enabled command through the registry's command and records it as recent", () => {
        let ran = 0;
        const registry = registryOf(spec("edit.fill", { run: () => void ran++ }));
        const recent = recorder();
        expect(runPaletteCommand(command(registry, "edit.fill"), () => {}, recent)).toBe(true);
        expect(ran).toBe(1);
        expect(recent.ids).toEqual(["edit.fill"]);
    });

    it("does nothing for a disabled command: it is listed but inert", () => {
        let ran = 0;
        let enabled = false;
        const registry = registryOf(
            spec("edit.undo", { enabled: () => enabled, run: () => void ran++ }),
        );
        registry.plan({ id: "file.open", title: "Open…", menuPath: ["File"] });
        const recent = recorder();
        expect(runPaletteCommand(command(registry, "edit.undo"), () => {}, recent)).toBe(false);
        expect(runPaletteCommand(command(registry, "file.open"), () => {}, recent)).toBe(false);
        expect(ran).toBe(0);
        expect(recent.ids).toEqual([]);
        // The state is read when the command is chosen.
        enabled = true;
        expect(runPaletteCommand(command(registry, "edit.undo"), () => {}, recent)).toBe(true);
        expect(ran).toBe(1);
    });

    it("hands a failure to the error handler, as menus and keys do", async () => {
        const registry = registryOf(
            spec("throws", {
                run() {
                    throw new Error("sync");
                },
            }),
            spec("rejects", { run: () => Promise.reject(new Error("async")) }),
        );
        const errors: string[] = [];
        const onError = (error: unknown, failed: Command) =>
            void errors.push(`${failed.id}: ${(error as Error).message}`);
        const recent = recorder();
        expect(runPaletteCommand(command(registry, "throws"), onError, recent)).toBe(true);
        expect(runPaletteCommand(command(registry, "rejects"), onError, recent)).toBe(true);
        await Promise.resolve();
        expect(errors).toEqual(["throws: sync", "rejects: async"]);
    });

    it("releases a hold binding after running it, like a key that is pressed and let go", () => {
        const calls: string[] = [];
        const registry = registryOf(
            spec("view.hand", {
                shortcut: "Space",
                context: "canvas",
                run: () => void calls.push("run"),
                release: () => void calls.push("release"),
            }),
        );
        expect(runPaletteCommand(command(registry, "view.hand"), () => {}, recorder())).toBe(true);
        expect(calls).toEqual(["run", "release"]);
    });
});

describe("recent commands", () => {
    it("starts empty when nothing is stored, or there is no storage", () => {
        expect(createRecentCommandsStore(memoryStorage()).getState().ids).toEqual([]);
        expect(createRecentCommandsStore(null).getState().ids).toEqual([]);
    });

    it("puts the newest command first and lists each command once", () => {
        const store = createRecentCommandsStore(null);
        for (const id of ["a", "b", "c", "a"]) store.getState().record(id);
        expect(store.getState().ids).toEqual(["a", "c", "b"]);
    });

    it("keeps at most eight commands", () => {
        const store = createRecentCommandsStore(null);
        for (let index = 0; index < 12; index++) store.getState().record(`command-${index}`);
        expect(MAX_RECENT_COMMANDS).toBe(8);
        expect(store.getState().ids).toHaveLength(8);
        expect(store.getState().ids[0]).toBe("command-11");
        expect(store.getState().ids.at(-1)).toBe("command-4");
    });

    it("persists the list and restores it in a new store", () => {
        const storage = memoryStorage();
        const store = createRecentCommandsStore(storage);
        store.getState().record("edit.undo");
        store.getState().record("file.new");
        expect(JSON.parse(storage.data.get(RECENT_COMMANDS_STORAGE_KEY) ?? "null")).toEqual([
            "file.new",
            "edit.undo",
        ]);
        expect(createRecentCommandsStore(storage).getState().ids).toEqual([
            "file.new",
            "edit.undo",
        ]);
    });

    it("notifies subscribers", () => {
        const store = createRecentCommandsStore(null);
        const seen: (readonly string[])[] = [];
        store.subscribe((state) => seen.push(state.ids));
        store.getState().record("edit.undo");
        expect(seen).toEqual([["edit.undo"]]);
    });

    it("reads anything that is not a list of ids as an empty list, without an error", () => {
        for (const stored of [undefined, null, 7, "edit.undo", {}, { ids: ["a"] }]) {
            expect(parseRecentCommands(stored)).toEqual([]);
        }
        expect(parseRecentCommands(["a", 3, null, "", "b", "a"])).toEqual(["a", "b"]);
        const storage = memoryStorage({ [RECENT_COMMANDS_STORAGE_KEY]: "{not json" });
        expect(createRecentCommandsStore(storage).getState().ids).toEqual([]);
    });

    it("keeps working when the storage refuses to write", () => {
        const store = createRecentCommandsStore({
            getItem: () => null,
            removeItem: () => {},
            setItem() {
                throw new Error("QuotaExceededError");
            },
        });
        expect(() => store.getState().record("edit.undo")).not.toThrow();
        expect(store.getState().ids).toEqual(["edit.undo"]);
    });
});
