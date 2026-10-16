import type { Command } from "../history";
import { assertNameLength, MAX_DOCUMENT_SIDE, MAX_NAME_LENGTH } from "../model";
import type { DocSettings, GridSettings, SpriteDoc, Touched } from "../model";

// Sprite properties of SPEC §7.7. Name and pivot change through undoable commands; the grid is
// a view preference in `DocSettings`, changed by a plain setter that makes no history entry
// (SPEC §5.2).

/** Normalized, 0..1 on both axes; (0, 0) is the top-left corner of the canvas (SPEC §5.1). */
export type Pivot = SpriteDoc["pivot"];

/** Size and offset of the grid, in document pixels: `GridSettings` without its visibility. */
export type GridGeometry = Omit<GridSettings, "visible">;

/** Smallest and largest side of a grid cell, in document pixels. */
export const MIN_GRID_SIDE = 1;
export const MAX_GRID_SIDE = MAX_DOCUMENT_SIDE;
/** Largest grid offset in either direction, in document pixels. */
export const MAX_GRID_OFFSET = MAX_DOCUMENT_SIDE;

/** Thrown when a document is given a name that is empty or only white space. */
export class SpriteNameError extends Error {
    override readonly name = "SpriteNameError";

    constructor() {
        super("A sprite name cannot be empty.");
    }
}

/** Thrown when a pivot coordinate is not a number in 0..1 (SPEC §5.1). */
export class PivotRangeError extends Error {
    override readonly name = "PivotRangeError";
    readonly x: number;
    readonly y: number;

    constructor(x: number, y: number) {
        super(`Pivot (${x}, ${y}) is not allowed: each coordinate must be from 0 to 1.`);
        this.x = x;
        this.y = y;
    }
}

/** Thrown when a grid size or offset is outside its range. */
export class GridRangeError extends Error {
    override readonly name = "GridRangeError";
    readonly field: keyof GridGeometry;
    readonly value: number;

    constructor(field: keyof GridGeometry, value: number) {
        const range =
            field === "width" || field === "height"
                ? `${MIN_GRID_SIDE} to ${MAX_GRID_SIDE}`
                : `${-MAX_GRID_OFFSET} to ${MAX_GRID_OFFSET}`;
        super(`Grid ${field} ${value} is not allowed: it must be an integer from ${range}.`);
        this.field = field;
        this.value = value;
    }
}

/** Neither command changes pixels, layers or frames. */
function nothingTouched(): Touched {
    return { frameIds: [], layerIds: [], structure: false };
}

/**
 * The name as a document stores it: without surrounding white space. Throws `SpriteNameError`
 * for an empty name, and `DocumentLimitError` for one longer than `MAX_NAME_LENGTH` UTF-16
 * code units (FORMAT.md §1.2), which no file could hold.
 */
export function normalizeSpriteName(name: string): string {
    const trimmed = name.trim();
    if (trimmed === "") throw new SpriteNameError();
    assertNameLength(trimmed);
    return trimmed;
}

/** Whether `normalizeSpriteName` accepts the name. */
export function isSpriteName(name: string): boolean {
    const trimmed = name.trim();
    return trimmed !== "" && trimmed.length <= MAX_NAME_LENGTH;
}

/** Whether both coordinates are numbers in 0..1. */
export function isPivot(pivot: Pivot): boolean {
    const inRange = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
    return inRange(pivot.x) && inRange(pivot.y);
}

/**
 * Renames the document (the name is also the export base name, SPEC §5.1). Throws
 * `SpriteNameError` for an empty name and `DocumentLimitError` for one that is too long; the
 * command is then not created.
 */
export function renameSpriteCommand(name: string): Command {
    const next = normalizeSpriteName(name);
    let previous = "";
    return {
        label: "Rename Sprite",
        // Two short strings.
        bytes: 0,
        touched: nothingTouched(),
        do(session) {
            previous = session.doc.name;
            session.doc.name = next;
        },
        undo(session) {
            session.doc.name = previous;
        },
    };
}

/**
 * Sets the pivot of the document. Throws `PivotRangeError` for a coordinate outside 0..1; the
 * command is then not created.
 */
export function setPivotCommand(pivot: Pivot): Command {
    if (!isPivot(pivot)) throw new PivotRangeError(pivot.x, pivot.y);
    const next: Pivot = { x: pivot.x, y: pivot.y };
    let previous: Pivot = { x: 0, y: 0 };
    return {
        label: "Set Pivot",
        // Four numbers.
        bytes: 0,
        touched: nothingTouched(),
        do(session) {
            previous = session.doc.pivot;
            session.doc.pivot = { ...next };
        },
        undo(session) {
            session.doc.pivot = previous;
        },
    };
}

/** One of the nine pivots of the 3×3 preset grid (SPEC §7.7). */
export interface PivotPreset {
    /** "top-left" … "bottom-right". */
    id: string;
    /** "Top left" … "Bottom right". */
    name: string;
    pivot: Readonly<Pivot>;
}

const PIVOT_STOPS = [0, 0.5, 1] as const;
const PIVOT_ROWS = ["top", "centre", "bottom"] as const;
const PIVOT_COLUMNS = ["left", "centre", "right"] as const;

/** Number of presets in a row of the preset grid. */
export const PIVOT_PRESET_COLUMNS = PIVOT_COLUMNS.length;

/** The preset grid, row by row from the top-left corner. */
export const PIVOT_PRESETS: readonly PivotPreset[] = PIVOT_ROWS.flatMap((row, rowIndex) =>
    PIVOT_COLUMNS.map((column, columnIndex): PivotPreset => {
        const id = row === column ? "centre" : `${row}-${column}`;
        const words = id.replace("-", " ");
        return {
            id,
            name: words.charAt(0).toUpperCase() + words.slice(1),
            pivot: { x: PIVOT_STOPS[columnIndex] ?? 0, y: PIVOT_STOPS[rowIndex] ?? 0 },
        };
    }),
);

/** The preset at exactly this pivot, or `undefined`. */
export function pivotPresetAt(pivot: Pivot): PivotPreset | undefined {
    return PIVOT_PRESETS.find((preset) => preset.pivot.x === pivot.x && preset.pivot.y === pivot.y);
}

function isInteger(value: number, min: number, max: number): boolean {
    return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Sets the size and offset of the grid, or some of them. A `DocSettings` setter: it makes no
 * history entry and does not make the document dirty (SPEC §5.2). Throws `GridRangeError`
 * with the settings unchanged.
 */
export function setGrid(settings: DocSettings, grid: Partial<GridGeometry>): void {
    const next: GridGeometry = {
        width: grid.width ?? settings.grid.width,
        height: grid.height ?? settings.grid.height,
        offsetX: grid.offsetX ?? settings.grid.offsetX,
        offsetY: grid.offsetY ?? settings.grid.offsetY,
    };
    for (const field of ["width", "height"] as const) {
        if (!isInteger(next[field], MIN_GRID_SIDE, MAX_GRID_SIDE)) {
            throw new GridRangeError(field, next[field]);
        }
    }
    for (const field of ["offsetX", "offsetY"] as const) {
        if (!isInteger(next[field], -MAX_GRID_OFFSET, MAX_GRID_OFFSET)) {
            throw new GridRangeError(field, next[field]);
        }
    }
    Object.assign(settings.grid, next);
}
