import type { DeviceRect } from "../../engine/viewport/geometry";
import type { DeviceSize } from "../../engine/viewport/types";
import type { GridSettings } from "../../core/model";

// Where the overlay's lines go, in device pixels of the overlay canvas (SE-013). Pure: no DOM
// and no store, so the placement is unit-tested in Node.
//
// A grid line is 1 device pixel wide and lies on the first device pixel of a texel (of a
// tile, for the tile grid): at a zoom step of 1 or above that is exactly where NGNE starts the
// texel (`documentRect`, SPEC §6.4). As in the design mockup, every texel has its line, the
// first one included, so every cell shows the same width of clear pixels; the outline lies
// outside the document.

/** The pixel grid is drawn from this zoom up (DESIGN §6). */
export const PIXEL_GRID_MIN_SCALE = 8;
/**
 * The tile grid is drawn along an axis while one of its cells is at least this many device
 * pixels on screen there; closer lines would tint the document evenly.
 */
export const TILE_GRID_MIN_SPACING = 4;

/** The document along one axis of the canvas. */
export interface Axis {
    /** First device pixel of the document rectangle: `rect.x` or `rect.y`. */
    origin: number;
    /** Device pixels the rectangle covers: `rect.width` or `rect.height`. */
    extent: number;
    /** Document pixels: the document's width or height. */
    length: number;
    /** Device pixels of the canvas along the axis. */
    canvas: number;
}

/** The two axes of a document rectangle on a canvas. */
export function axesOf(
    rect: DeviceRect,
    doc: { width: number; height: number },
    canvas: DeviceSize,
): { x: Axis; y: Axis } {
    return {
        x: { origin: rect.x, extent: rect.width, length: doc.width, canvas: canvas.width },
        y: { origin: rect.y, extent: rect.height, length: doc.height, canvas: canvas.height },
    };
}

/**
 * The device pixel at which document position `position` starts: exact at the zoom steps of
 * 1 and above, rounded at the overview steps (as `ViewMapping.docToDevice`, rounded).
 */
export function devicePosition(axis: Axis, position: number): number {
    return axis.origin + Math.round((position * axis.extent) / axis.length);
}

/**
 * The device pixels (columns or rows) of the lines at the document positions
 * `start + n × step` from 0 up to the document's far edge (not included), that lie on the
 * canvas; ascending, each once. `start` and `step` are whole document pixels, `step` at
 * least 1.
 */
export function axisLines(axis: Axis, start: number, step: number): number[] {
    const lines: number[] = [];
    if (!(step >= 1) || axis.length < 1 || axis.extent <= 0) return lines;
    // The document positions on the canvas, widened by one so that rounding loses none.
    const first = Math.max(0, Math.floor((-axis.origin * axis.length) / axis.extent));
    const last = Math.min(
        axis.length - 1,
        Math.ceil(((axis.canvas - axis.origin) * axis.length) / axis.extent),
    );
    for (let n = Math.ceil((first - start) / step); start + n * step <= last; n++) {
        const device = devicePosition(axis, start + n * step);
        if (device < 0 || device >= axis.canvas) continue;
        // Inside the rectangle, also where the overview steps round.
        if (device < axis.origin || device >= axis.origin + axis.extent) continue;
        // At the overview steps two positions can start on the same device pixel.
        if (lines[lines.length - 1] !== device) lines.push(device);
    }
    return lines;
}

/** Lines of a grid: device columns of its vertical lines and rows of its horizontal ones. */
export interface GridLines {
    columns: number[];
    rows: number[];
}

/** The pixel grid: a line at the start of every texel; none below `PIXEL_GRID_MIN_SCALE`. */
export function pixelGridLines(axes: { x: Axis; y: Axis }, scale: number): GridLines {
    if (!(scale >= PIXEL_GRID_MIN_SCALE)) return { columns: [], rows: [] };
    return { columns: axisLines(axes.x, 0, 1), rows: axisLines(axes.y, 0, 1) };
}

/**
 * The tile grid of `DocSettings.grid`: a line at `offset + n × size` on each axis, whether
 * or not the grid is visible; none along an axis whose cells are closer than
 * `TILE_GRID_MIN_SPACING` device pixels on screen.
 */
export function tileGridLines(axes: { x: Axis; y: Axis }, grid: GridSettings): GridLines {
    const along = (axis: Axis, offset: number, size: number) =>
        (size * axis.extent) / axis.length >= TILE_GRID_MIN_SPACING
            ? axisLines(axis, offset, size)
            : [];
    return {
        columns: along(axes.x, grid.offsetX, grid.width),
        rows: along(axes.y, grid.offsetY, grid.height),
    };
}

/** The part of `rect` on a canvas of `size`; null when none of it is. */
export function visiblePart(rect: DeviceRect, size: DeviceSize): DeviceRect | null {
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const right = Math.min(size.width, rect.x + rect.width);
    const bottom = Math.min(size.height, rect.y + rect.height);
    if (right <= x || bottom <= y) return null;
    return { x, y, width: right - x, height: bottom - y };
}

/** The 1-pixel rectangles of `lines`, each across `area` (the visible document). */
export function lineRects(lines: GridLines, area: DeviceRect): DeviceRect[] {
    return [
        ...lines.columns.map((x) => ({ x, y: area.y, width: 1, height: area.height })),
        ...lines.rows.map((y) => ({ x: area.x, y, width: area.width, height: 1 })),
    ];
}

/**
 * The parts of `area` between `lines`: the rectangles left when every line is taken out.
 * Row by row, then column by column.
 */
export function cellsBetween(lines: GridLines, area: DeviceRect): DeviceRect[] {
    const spans = (from: number, to: number, cuts: readonly number[]) => {
        const result: [number, number][] = [];
        let start = from;
        for (const cut of cuts) {
            if (cut < from || cut >= to) continue;
            if (cut > start) result.push([start, cut]);
            start = cut + 1;
        }
        if (to > start) result.push([start, to]);
        return result;
    };
    const xs = spans(area.x, area.x + area.width, lines.columns);
    const ys = spans(area.y, area.y + area.height, lines.rows);
    return ys.flatMap(([top, bottom]) =>
        xs.map(([left, right]) => ({ x: left, y: top, width: right - left, height: bottom - top })),
    );
}

/** The 1-pixel ring just outside `rect`: top, bottom, left and right (DESIGN §6). */
export function outlineRects(rect: DeviceRect): DeviceRect[] {
    const { x, y, width, height } = rect;
    return [
        { x: x - 1, y: y - 1, width: width + 2, height: 1 },
        { x: x - 1, y: y + height, width: width + 2, height: 1 },
        { x: x - 1, y, width: 1, height },
        { x: x + width, y, width: 1, height },
    ];
}
