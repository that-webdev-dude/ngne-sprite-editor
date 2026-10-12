import { readFileSync } from "node:fs";
import { normalizeChord } from "../../src/app/commands/chord";

// SE-007: the key table of SPEC §7.8, read from docs/SPEC.md. The end-to-end test presses
// every chord this parser returns, so the list cannot drift from the specification: a row the
// parser does not understand is an error, not a skipped row.

export type SpecContext = "gesture" | "floating" | "timeline" | "canvas" | "global";

/** One chord of the table in one of its contexts. */
export interface SpecBinding {
    /** The chord in the notation of src/app/commands/chord.ts. */
    chord: string;
    context: SpecContext;
    /** Marked †: also acts while a text field has focus. */
    text: boolean;
    /** Written "(hold)": acts while the key is down. */
    hold: boolean;
    /** The row applies only with ("selection") or without ("no-selection") a selection. */
    condition: "selection" | "no-selection" | null;
    /** The row's key cell and action, for messages. */
    row: string;
}

export interface SpecKeyTable {
    /** Every keyboard chord of the table, once per context it is listed in. */
    bindings: SpecBinding[];
    /** Key cells of the rows bound to the pointer, which are not keyboard chords. */
    pointerRows: string[];
}

const CONTEXTS: readonly SpecContext[] = ["gesture", "floating", "timeline", "canvas", "global"];
const ARROWS: Readonly<Record<string, string>> = {
    "←": "ArrowLeft",
    "→": "ArrowRight",
    "↑": "ArrowUp",
    "↓": "ArrowDown",
};
const ALL_ARROWS = Object.values(ARROWS);
const POINTER_CONTEXT = "pointer over viewport";

interface Key {
    chord: string;
    hold: boolean;
}

/** The chords one alternative of a key cell stands for: "Arrows" is four, "← →" two. */
function expand(token: string, row: string): Key[] {
    const hold = / \(hold\)$/.test(token);
    const name = token.replace(/ \(hold\)$/, "");
    let chords: string[];
    if (name === "Arrows") chords = ALL_ARROWS;
    else if (name === "Shift+arrows") chords = ALL_ARROWS.map((arrow) => `Shift+${arrow}`);
    else if (name.split(" ").every((part) => part in ARROWS)) {
        chords = name.split(" ").map((part) => ARROWS[part] ?? "");
    } else chords = [name];
    return chords.map((chord) => {
        try {
            return { chord: normalizeChord(chord), hold };
        } catch (error) {
            throw new Error(`SPEC §7.8 row "${row}": cannot read the key "${token}".`, {
                cause: error,
            });
        }
    });
}

/** The keys of a key cell with their † marks. */
function parseKeys(cell: string, row: string): (Key & { text: boolean })[] {
    return cell.split(/[,;]/).flatMap((entry) => {
        const text = entry.includes("†");
        // A mark after "A / B" belongs to both alternatives.
        const alternatives = entry.replace("†", "").split(" / ");
        return alternatives.flatMap((alternative) =>
            expand(alternative.trim(), row).map((key) => ({ ...key, text })),
        );
    });
}

interface Where {
    contexts: SpecContext[];
    condition: SpecBinding["condition"];
}

function parseContexts(cell: string, row: string): Where {
    const where: Where = { contexts: [], condition: null };
    for (const part of cell.split(",").map((text) => text.trim())) {
        const context = part.replace(" (viewport focused)", "") as SpecContext;
        if (CONTEXTS.includes(context)) where.contexts.push(context);
        else if (part === "with a selection") where.condition = "selection";
        else if (part === "no selection") where.condition = "no-selection";
        else throw new Error(`SPEC §7.8 row "${row}": cannot read the context "${part}".`);
    }
    if (where.contexts.length === 0) throw new Error(`SPEC §7.8 row "${row}" has no context.`);
    return where;
}

/** The rows of the "| Key | Context | Action |" table of the Keyboard section. */
function tableRows(markdown: string): string[][] {
    const lines = markdown.replace(/\r/g, "").split("\n");
    const section = lines.findIndex((line) => /^### 7\.8 Keyboard\s*$/.test(line));
    if (section === -1) throw new Error("docs/SPEC.md has no section 7.8 Keyboard.");
    const header = lines.findIndex(
        (line, index) =>
            index > section && /^\|\s*Key\s*\|\s*Context\s*\|\s*Action\s*\|$/.test(line),
    );
    if (header === -1) throw new Error("SPEC §7.8 has no Key / Context / Action table.");
    const rows: string[][] = [];
    for (const line of lines.slice(header + 2)) {
        if (!line.startsWith("|")) break;
        const cells = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
        if (cells.length !== 3) throw new Error(`SPEC §7.8: unexpected table row "${line}".`);
        rows.push(cells);
    }
    return rows;
}

/** Parses the key table out of the text of docs/SPEC.md. Throws on anything unexpected. */
export function parseSpecKeyTable(markdown: string): SpecKeyTable {
    const table: SpecKeyTable = { bindings: [], pointerRows: [] };
    for (const [keys = "", contexts = "", action = ""] of tableRows(markdown)) {
        const row = `${keys} — ${action}`;
        if (contexts === POINTER_CONTEXT) {
            table.pointerRows.push(keys);
            continue;
        }
        const where = parseContexts(contexts, row);
        for (const key of parseKeys(keys, row)) {
            for (const context of where.contexts) {
                table.bindings.push({ ...key, context, condition: where.condition, row });
            }
        }
    }
    return table;
}

export function readSpecKeyTable(): SpecKeyTable {
    return parseSpecKeyTable(readFileSync(new URL("../../docs/SPEC.md", import.meta.url), "utf8"));
}

/**
 * Chords Chrome keeps for itself in a normal browser window: the page never receives them, so
 * they cannot be bound (Chromium `IsReservedCommandOrKey`: new tab, new window, new incognito
 * window, close tab, close window, reopen tab, next and previous tab). Playwright sends keys
 * below that layer and cannot show the difference, so the test compares against this list.
 */
export const CHROME_RESERVED_CHORDS: readonly string[] = [
    "Ctrl+T",
    "Ctrl+N",
    "Ctrl+Shift+N",
    "Ctrl+W",
    "Ctrl+Shift+W",
    "Ctrl+Shift+T",
    "Ctrl+Tab",
    "Ctrl+Shift+Tab",
    "Ctrl+PageDown",
    "Ctrl+PageUp",
    "Ctrl+F4",
    "Alt+F4",
].map(normalizeChord);
