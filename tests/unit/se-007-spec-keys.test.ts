import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeChord } from "../../src/app/commands/chord";
import { createCommandRegistry } from "../../src/app/commands/registry";
import { isBrowserChord, isTextEditingChord } from "../../src/app/keymap/keyClasses";
import {
    CHROME_RESERVED_CHORDS,
    parseSpecKeyTable,
    readSpecKeyTable,
} from "../e2e/se-007-spec-keys";

// SE-007: the parser that derives the chord list of the end-to-end test from SPEC §7.8, and
// what the keymap relies on in that table.

const spec = readFileSync(new URL("../../docs/SPEC.md", import.meta.url), "utf8").replace(
    /\r/g,
    "",
);
const table = readSpecKeyTable();
const chordsIn = (context: string) =>
    table.bindings.filter((binding) => binding.context === context).map((binding) => binding.chord);

/** A document with a §7.8 table of the given rows. */
function document(...rows: string[]): string {
    return [
        "### 7.8 Keyboard",
        "",
        "| Key | Context | Action |",
        "| --- | ------- | ------ |",
        ...rows,
        "",
        "- † also acts while a text field has focus.",
    ].join("\n");
}

describe("SPEC §7.8 key table", () => {
    it("reads every row of the table", () => {
        const section = spec.slice(spec.indexOf("### 7.8 Keyboard"), spec.indexOf("## 8. "));
        const tableText = section.slice(section.search(/^\| Key\s+\| Context/m));
        const rows = tableText.split("\n\n")[0]?.trim().split("\n").slice(2) ?? [];
        expect(rows.length).toBeGreaterThan(30);
        const parsedRows = new Set(table.bindings.map((binding) => binding.row));
        expect(parsedRows.size + table.pointerRows.length).toBe(rows.length);
    });

    it("sets the pointer rows aside: they are not keyboard chords", () => {
        expect(table.pointerRows).toEqual(["Wheel", "Shift+wheel", "Middle-drag"]);
    });

    it("expands lists, alternatives and arrow shorthands", () => {
        expect(chordsIn("canvas")).toEqual(
            expect.arrayContaining([
                "B",
                "E",
                "I",
                "G",
                "Shift+U",
                "Shift+Q",
                "0",
                "6",
                "?",
                "Tab",
            ]),
        );
        expect(chordsIn("floating")).toEqual([
            "Enter",
            "Escape",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Shift+ArrowLeft",
            "Shift+ArrowRight",
            "Shift+ArrowUp",
            "Shift+ArrowDown",
        ]);
        expect(chordsIn("timeline")).toEqual([
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
            "Enter",
        ]);
        expect(chordsIn("gesture")).toEqual(["Enter"]);
        expect(chordsIn("global")).toEqual(
            expect.arrayContaining(["Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z", "Delete", "Shift+N"]),
        );
    });

    it("writes every chord in the notation of the registry", () => {
        expect(table.bindings.length).toBeGreaterThan(60);
        for (const { chord } of table.bindings) expect(normalizeChord(chord)).toBe(chord);
    });

    it("lists a chord in two contexts once for each", () => {
        const enter = table.bindings.filter((binding) => binding.chord === "Enter");
        expect(enter.map((binding) => binding.context).sort()).toEqual([
            "canvas",
            "floating",
            "gesture",
            "timeline",
        ]);
    });

    it("reads the hold marks", () => {
        expect(
            table.bindings.filter((binding) => binding.hold).map((binding) => binding.chord),
        ).toEqual(["Alt", "Space"]);
    });

    it("reads the selection conditions of the canvas arrow rows", () => {
        const arrows = table.bindings.filter(
            (binding) => binding.context === "canvas" && binding.chord === "ArrowLeft",
        );
        expect(arrows.map((binding) => binding.condition).sort()).toEqual([
            "no-selection",
            "selection",
        ]);
        expect(
            table.bindings.filter(
                (binding) => binding.condition !== null && binding.context !== "canvas",
            ),
        ).toEqual([]);
    });

    it("reads the † marks, on both sides of an alternative", () => {
        const marked = table.bindings.filter((binding) => binding.text);
        expect(marked.map((binding) => binding.chord)).toEqual(
            expect.arrayContaining(["F6", "Shift+F6", "Ctrl+S", "Ctrl+Shift+S", "Alt+W", "Ctrl+K"]),
        );
        expect(marked.map((binding) => binding.chord)).not.toContain("Ctrl+Z");
        expect(marked.map((binding) => binding.chord)).not.toContain("F3");
    });

    it("marks † only chords a text field does not need: the registry accepts them in `text`", () => {
        const registry = createCommandRegistry();
        for (const binding of table.bindings.filter((entry) => entry.text)) {
            expect(binding.context).toBe("global");
            expect(isBrowserChord(binding.chord), binding.chord).toBe(true);
            expect(isTextEditingChord(binding.chord), binding.chord).toBe(false);
            registry.register({
                id: binding.chord,
                title: binding.row,
                shortcut: binding.chord,
                context: ["global", "text"],
                run() {},
            });
        }
    });

    it("lists no chord that Chrome keeps for itself", () => {
        expect(CHROME_RESERVED_CHORDS).toContain("Ctrl+N");
        expect(CHROME_RESERVED_CHORDS).toContain("Ctrl+W");
        for (const { chord, row } of table.bindings) {
            expect(CHROME_RESERVED_CHORDS, row).not.toContain(chord);
        }
    });
});

describe("the key table parser", () => {
    it("parses a table of its own", () => {
        expect(
            parseSpecKeyTable(
                document(
                    "| B, Shift+B | canvas | Pencil, spray |",
                    "| Wheel | pointer over viewport | Zoom |",
                    "| Enter / Escape † | global | Yes / no |",
                    "| ← → | canvas (viewport focused), no selection | Frames |",
                    "| Space (hold) | canvas, timeline | Hand |",
                ),
            ),
        ).toEqual({
            pointerRows: ["Wheel"],
            bindings: [
                {
                    chord: "B",
                    context: "canvas",
                    text: false,
                    hold: false,
                    condition: null,
                    row: "B, Shift+B — Pencil, spray",
                },
                {
                    chord: "Shift+B",
                    context: "canvas",
                    text: false,
                    hold: false,
                    condition: null,
                    row: "B, Shift+B — Pencil, spray",
                },
                {
                    chord: "Enter",
                    context: "global",
                    text: true,
                    hold: false,
                    condition: null,
                    row: "Enter / Escape † — Yes / no",
                },
                {
                    chord: "Escape",
                    context: "global",
                    text: true,
                    hold: false,
                    condition: null,
                    row: "Enter / Escape † — Yes / no",
                },
                {
                    chord: "ArrowLeft",
                    context: "canvas",
                    text: false,
                    hold: false,
                    condition: "no-selection",
                    row: "← → — Frames",
                },
                {
                    chord: "ArrowRight",
                    context: "canvas",
                    text: false,
                    hold: false,
                    condition: "no-selection",
                    row: "← → — Frames",
                },
                {
                    chord: "Space",
                    context: "canvas",
                    text: false,
                    hold: true,
                    condition: null,
                    row: "Space (hold) — Hand",
                },
                {
                    chord: "Space",
                    context: "timeline",
                    text: false,
                    hold: true,
                    condition: null,
                    row: "Space (hold) — Hand",
                },
            ],
        });
    });

    it("fails on a row it does not understand instead of skipping it", () => {
        const parse = (row: string) => () => parseSpecKeyTable(document(row));
        expect(parse("| Hyper+B | canvas | Unknown modifier |")).toThrow(/cannot read the key/);
        expect(parse("| Double-click | canvas | Not a key |")).toThrow(/cannot read the key/);
        expect(parse("| B | sidebar | Unknown context |")).toThrow(/cannot read the context/);
        expect(parse("| B | with a selection | No context |")).toThrow(/has no context/);
        expect(parse("| B | canvas |")).toThrow(/unexpected table row/);
        expect(() => parseSpecKeyTable("# No keyboard section")).toThrow(/no section 7\.8/);
        expect(() => parseSpecKeyTable("### 7.8 Keyboard\n\nNo table.")).toThrow(/no Key/);
    });
});
