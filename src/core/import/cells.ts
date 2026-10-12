import { cropPixels } from "../pixels";
import type { PixelBuffer, PixelRect } from "../pixels";
import { ImportError, assertFrameCount, assertInteger } from "./errors";

// Steps 2 and 3 of SPEC §8: the region of a source image and the cells it is cut into. One
// cell becomes one frame.

/** A decoded image and the name of the file it came from. */
export interface ImportSource {
    name: string;
    pixels: PixelBuffer;
}

/** How a sprite sheet divides into cells. Every number is an integer, in pixels. */
export interface GridOptions {
    /** The size of one cell, or the number of columns and rows the sheet divides into. */
    cell: { width: number; height: number } | { columns: number; rows: number };
    /** Distance of the first cell from the top-left of the image; (0, 0) when absent. */
    offset?: { x: number; y: number };
    /** Gap between neighbouring cells; (0, 0) when absent. */
    spacing?: { x: number; y: number };
    /** Leave out cells whose pixels are all fully transparent. Off when absent. */
    skipEmpty?: boolean;
}

/**
 * A grid resolved against an image size. On each axis, cell `index` starts at
 * `offset + index × (cell size + spacing)`.
 */
export interface GridLayout {
    columns: number;
    rows: number;
    cellWidth: number;
    cellHeight: number;
    offsetX: number;
    offsetY: number;
    spacingX: number;
    spacingY: number;
}

/**
 * Step 2: a copy of the part of `source` inside `rect`. Throws `ImportError` ("settings")
 * unless `rect` has integer coordinates, a positive size and lies inside the image.
 */
export function crop(source: PixelBuffer, rect: PixelRect): PixelBuffer {
    const { x, y, width, height } = rect;
    const inside =
        [x, y, width, height].every(Number.isInteger) &&
        x >= 0 &&
        y >= 0 &&
        width >= 1 &&
        height >= 1 &&
        x + width <= source.width &&
        y + height <= source.height;
    if (!inside) {
        throw new ImportError(
            "settings",
            `The region ${width}x${height} at (${x}, ${y}) is not a rectangle inside the ` +
                `${source.width}x${source.height} image.`,
        );
    }
    return cropPixels(source, rect);
}

/**
 * The columns, rows and cell size of `grid` on an image of `width` × `height` pixels.
 *
 * With a cell size, as many whole cells are taken as fit between the offset and the right and
 * bottom edges; a cell cut off by an edge is left out. With columns × rows, that area is
 * divided evenly and pixels left over at the right and bottom are left out.
 *
 * Throws `ImportError` ("settings") for a value that is not an integer in range, and when not
 * even one cell fits.
 */
export function gridLayout(width: number, height: number, grid: GridOptions): GridLayout {
    const offsetX = grid.offset?.x ?? 0;
    const offsetY = grid.offset?.y ?? 0;
    const spacingX = grid.spacing?.x ?? 0;
    const spacingY = grid.spacing?.y ?? 0;
    assertInteger("Grid offset X", offsetX, 0);
    assertInteger("Grid offset Y", offsetY, 0);
    assertInteger("Grid spacing X", spacingX, 0);
    assertInteger("Grid spacing Y", spacingY, 0);

    let columns: number;
    let rows: number;
    let cellWidth: number;
    let cellHeight: number;
    if ("columns" in grid.cell) {
        ({ columns, rows } = grid.cell);
        assertInteger("Grid columns", columns, 1);
        assertInteger("Grid rows", rows, 1);
        cellWidth = Math.floor((width - offsetX - (columns - 1) * spacingX) / columns);
        cellHeight = Math.floor((height - offsetY - (rows - 1) * spacingY) / rows);
    } else {
        ({ width: cellWidth, height: cellHeight } = grid.cell);
        assertInteger("Grid cell width", cellWidth, 1);
        assertInteger("Grid cell height", cellHeight, 1);
        columns = Math.floor((width - offsetX + spacingX) / (cellWidth + spacingX));
        rows = Math.floor((height - offsetY + spacingY) / (cellHeight + spacingY));
    }
    if (columns < 1 || rows < 1 || cellWidth < 1 || cellHeight < 1) {
        throw new ImportError(
            "settings",
            `No grid cell fits the ${width}x${height} image with these grid settings.`,
        );
    }
    return { columns, rows, cellWidth, cellHeight, offsetX, offsetY, spacingX, spacingY };
}

/** True when every pixel of `rect`, which lies inside `source`, has alpha 0. */
function isEmpty(source: PixelBuffer, rect: PixelRect): boolean {
    const { data } = source;
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        const end = (y * source.width + rect.x + rect.width) * 4;
        for (let i = (y * source.width + rect.x) * 4 + 3; i < end; i += 4) {
            if (data[i] !== 0) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Step 3, grid: the cells of a sprite sheet as buffers of their own, in row-major order (left
 * to right, then top to bottom). With `skipEmpty`, cells that are fully transparent are left
 * out, so the result may be empty.
 *
 * Throws `ImportError`: "settings" as `gridLayout` does, "frame-count" when more than
 * `MAX_IMPORT_FRAMES` cells result (before they are copied).
 */
export function sliceGrid(source: PixelBuffer, grid: GridOptions): PixelBuffer[] {
    const layout = gridLayout(source.width, source.height, grid);
    const rects: PixelRect[] = [];
    if (!grid.skipEmpty) {
        assertFrameCount(layout.columns * layout.rows);
    }
    for (let row = 0; row < layout.rows; row++) {
        for (let column = 0; column < layout.columns; column++) {
            const rect = {
                x: layout.offsetX + column * (layout.cellWidth + layout.spacingX),
                y: layout.offsetY + row * (layout.cellHeight + layout.spacingY),
                width: layout.cellWidth,
                height: layout.cellHeight,
            };
            if (!grid.skipEmpty || !isEmpty(source, rect)) {
                rects.push(rect);
                assertFrameCount(rects.length);
            }
        }
    }
    return rects.map((rect) => cropPixels(source, rect));
}

function isDigit(code: number): boolean {
    return code >= 48 && code <= 57;
}

/**
 * Compares two strings character by character, except that a run of digits in both counts as
 * one number. Letters are compared without case, by UTF-16 code unit.
 */
function compareRuns(first: string, second: string): number {
    const a = first.toLowerCase();
    const b = second.toLowerCase();
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (!isDigit(a.charCodeAt(i)) || !isDigit(b.charCodeAt(j))) {
            const difference = a.charCodeAt(i) - b.charCodeAt(j);
            if (difference !== 0) {
                return difference;
            }
            i++;
            j++;
            continue;
        }
        // Two numbers of any length: without leading zeros the longer one is larger, and
        // numbers of one length compare digit by digit.
        while (a.charCodeAt(i) === 48) i++;
        while (b.charCodeAt(j) === 48) j++;
        let endA = i;
        let endB = j;
        while (isDigit(a.charCodeAt(endA))) endA++;
        while (isDigit(b.charCodeAt(endB))) endB++;
        if (endA - i !== endB - j) {
            return endA - i - (endB - j);
        }
        for (; i < endA; i++, j++) {
            const difference = a.charCodeAt(i) - b.charCodeAt(j);
            if (difference !== 0) {
                return difference;
            }
        }
    }
    return a.length - i - (b.length - j);
}

/** The file name without its extension (the part from the last dot). */
function stem(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Natural order of file names: negative when `a` sorts before `b`, positive when after, 0
 * only for identical names. Runs of digits compare as numbers, so `a2` comes before `a10`;
 * letters compare without case. The extension takes part only when the names are otherwise
 * equal, so `walk.png` comes before `walk-2.png`.
 *
 * The order is a fixed rule of this function and uses no locale, so it is the same on every
 * machine. Names that are equal as numbers and without case fall back to plain code-unit
 * order (`a01` before `a1`, `A` before `a`).
 */
export function compareNatural(a: string, b: string): number {
    return compareRuns(stem(a), stem(b)) || compareRuns(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Step 3, one cell per file: the files' buffers (not copies) in natural order of their names
 * (`compareNatural`). Files with identical names keep the order they were given in.
 *
 * Throws `ImportError` ("frame-count") for more than `MAX_IMPORT_FRAMES` files.
 */
export function cellsFromFiles(files: readonly ImportSource[]): PixelBuffer[] {
    assertFrameCount(files.length);
    return [...files].sort((a, b) => compareNatural(a.name, b.name)).map((file) => file.pixels);
}
