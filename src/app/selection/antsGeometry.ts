import type {
    HorizontalEdge,
    OuterCorner,
    SelectionBoundary,
    VerticalEdge,
} from "../../core/selection";
import type { DeviceRect } from "../../engine/viewport/geometry";
import type { DeviceSize } from "../../engine/viewport/types";
import { devicePosition } from "../overlay/gridLines";
import type { Axis } from "../overlay/gridLines";

// Where the marching ants go, in device pixels of the overlay canvas (DESIGN §6, SE-030).
// Pure: no DOM and no store, so the placement is unit-tested in Node.
//
// The ants are the device pixels just outside the selection that touch it, diagonally too:
// a 1-pixel ring around the selected texels on every side, as the document outline lies 1 px
// outside the document (SE-013) and as the design mockup draws them. Each boundary segment
// gives the run of device pixels on its outer side; each outer corner of the selection gives
// the one pixel diagonally out from it, which closes the ring there. At an inner corner the
// runs of the two segments meet by themselves. Where the selection reaches the document's
// edge the ants lie over the outline. At the zoom steps of 1 and above (`devicePosition` is
// exact there) the ring is exactly the pixels outside the selected texels within one device
// pixel of them; at the overview steps a run that rounds to nothing keeps one pixel.
//
// Only what lies on the canvas is looked at: the boundary's segments are sorted by line, so
// the lines on the canvas, and the segments of each line on it, are found by binary search,
// and the work grows with what is visible, not with the selection.
//
// The dashes are black and white, 2 device pixels each, by the sum x + y of the canvas pixel:
// along every row and column of the ring they repeat every 4 pixels, also round corners, and
// a step of the phase moves them one pixel on. The draw layer paints them with a 4 × 4 tile
// (`dashTile`) repeated from an offset (`dashShift`).

/** Length of one dash, and of the black and white pair (DESIGN §6: a 4 px period). */
export const ANTS_DASH = 2;
export const ANTS_PERIOD = 2 * ANTS_DASH;

/** The part of `rect` on a canvas of `size`; null when none of it is. */
function onCanvas(rect: DeviceRect, size: DeviceSize): DeviceRect | null {
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const right = Math.min(size.width, rect.x + rect.width);
    const bottom = Math.min(size.height, rect.y + rect.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** The end of the device span of grid lines `from` to `to` that starts at `start`: at least one pixel on. */
function spanEnd(axis: Axis, start: number, to: number): number {
    return Math.max(devicePosition(axis, to), start + 1);
}

/** The first index in `[0, count)` for which `test` holds, `test` being false then true; else `count`. */
function firstIndex(count: number, test: (index: number) => boolean): number {
    let low = 0;
    let high = count;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (test(middle)) high = middle;
        else low = middle + 1;
    }
    return low;
}

/**
 * The grid lines `[first, last]` of `axis` whose device position lies in `[from, to]`
 * (`devicePosition` grows with the line); `first > last` when there is none.
 */
function linesWithin(axis: Axis, from: number, to: number): [number, number] {
    const count = axis.length + 1;
    const first = firstIndex(count, (line) => devicePosition(axis, line) >= from);
    const last = firstIndex(count, (line) => devicePosition(axis, line) > to) - 1;
    return [first, last];
}

/**
 * Calls `visit` with each rectangle of the ring of the ants for `boundary` (document grid
 * lines) on a canvas of `size`, where the document lies along `axes`: 1-pixel-thick
 * rectangles, clipped to the canvas, which may overlap where two runs meet. Returns how many
 * boundary items were looked at, which grows with the part on the canvas.
 */
export function forEachRingRect(
    boundary: SelectionBoundary,
    axes: { x: Axis; y: Axis },
    size: DeviceSize,
    visit: (rect: DeviceRect) => void,
): number {
    let examined = 0;
    const add = (rect: DeviceRect) => {
        const visible = onCanvas(rect, size);
        if (visible) visit(visible);
    };

    // A horizontal edge on line y covers the row before or after `devicePosition(y)`: lines
    // at device rows 0 to height. Within a line the edges run left to right.
    const horizontal: readonly HorizontalEdge[] = boundary.horizontal;
    const [rowFirst, rowLast] = linesWithin(axes.y, 0, size.height);
    for (let line = rowFirst; line <= rowLast; line++) {
        const row = devicePosition(axes.y, line);
        let index = firstIndex(horizontal.length, (at) => {
            const edge = horizontal[at];
            if (edge.y !== line) return edge.y > line;
            return spanEnd(axes.x, devicePosition(axes.x, edge.x0), edge.x1) > 0;
        });
        for (; index < horizontal.length && horizontal[index].y === line; index++) {
            const edge = horizontal[index];
            const x0 = devicePosition(axes.x, edge.x0);
            if (x0 >= size.width) break;
            examined++;
            const x1 = spanEnd(axes.x, x0, edge.x1);
            // Outside is the row after the line when the selection is above it, else the row before.
            add({ x: x0, y: edge.inside === "above" ? row : row - 1, width: x1 - x0, height: 1 });
        }
    }

    const vertical: readonly VerticalEdge[] = boundary.vertical;
    const [columnFirst, columnLast] = linesWithin(axes.x, 0, size.width);
    for (let line = columnFirst; line <= columnLast; line++) {
        const column = devicePosition(axes.x, line);
        let index = firstIndex(vertical.length, (at) => {
            const edge = vertical[at];
            if (edge.x !== line) return edge.x > line;
            return spanEnd(axes.y, devicePosition(axes.y, edge.y0), edge.y1) > 0;
        });
        for (; index < vertical.length && vertical[index].x === line; index++) {
            const edge = vertical[index];
            const y0 = devicePosition(axes.y, edge.y0);
            if (y0 >= size.height) break;
            examined++;
            const y1 = spanEnd(axes.y, y0, edge.y1);
            add({
                x: edge.inside === "left" ? column : column - 1,
                y: y0,
                width: 1,
                height: y1 - y0,
            });
        }
    }

    // A corner's pixel is at or just before its grid point on both axes.
    const corners: readonly OuterCorner[] = boundary.corners;
    for (let line = rowFirst; line <= rowLast; line++) {
        const y = devicePosition(axes.y, line);
        let index = firstIndex(corners.length, (at) => {
            const corner = corners[at];
            if (corner.y !== line) return corner.y > line;
            return devicePosition(axes.x, corner.x) >= 0;
        });
        for (; index < corners.length && corners[index].y === line; index++) {
            const corner = corners[index];
            const x = devicePosition(axes.x, corner.x);
            if (x > size.width) break;
            examined++;
            const left = corner.selected === "top-left" || corner.selected === "bottom-left";
            const top = corner.selected === "top-left" || corner.selected === "top-right";
            add({ x: left ? x : x - 1, y: top ? y : y - 1, width: 1, height: 1 });
        }
    }
    return examined;
}

/** The ring of the ants (see `forEachRingRect`) as a list of rectangles. */
export function antsRing(
    boundary: SelectionBoundary,
    axes: { x: Axis; y: Axis },
    size: DeviceSize,
): DeviceRect[] {
    const rects: DeviceRect[] = [];
    forEachRingRect(boundary, axes, size, (rect) => rects.push(rect));
    return rects;
}

/**
 * The bounding rectangle of the ring's pixels on the canvas; null when none of them is on
 * it. Never larger than the canvas.
 */
export function ringArea(
    boundary: SelectionBoundary,
    axes: { x: Axis; y: Axis },
    size: DeviceSize,
): DeviceRect | null {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    forEachRingRect(boundary, axes, size, (rect) => {
        left = Math.min(left, rect.x);
        top = Math.min(top, rect.y);
        right = Math.max(right, rect.x + rect.width);
        bottom = Math.max(bottom, rect.y + rect.height);
    });
    return right > left ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

/**
 * Paints the ring into `rgba`, the straight RGBA pixels of `area` (row by row, `area.width`
 * a row, cleared): opaque white on the ring, the rest left as it is.
 */
export function paintRing(
    boundary: SelectionBoundary,
    axes: { x: Axis; y: Axis },
    size: DeviceSize,
    area: DeviceRect,
    rgba: Uint8ClampedArray,
): void {
    forEachRingRect(boundary, axes, size, (rect) => {
        const left = Math.max(rect.x, area.x);
        const right = Math.min(rect.x + rect.width, area.x + area.width);
        const top = Math.max(rect.y, area.y);
        const bottom = Math.min(rect.y + rect.height, area.y + area.height);
        for (let y = top; y < bottom; y++) {
            let at = ((y - area.y) * area.width + left - area.x) * 4;
            for (let x = left; x < right; x++, at += 4) {
                rgba[at] = 255;
                rgba[at + 1] = 255;
                rgba[at + 2] = 255;
                rgba[at + 3] = 255;
            }
        }
    });
}

/** Whether the canvas pixel `x, y` is a black dash at `phase` (0 to `ANTS_PERIOD - 1`). */
export function isDarkDash(x: number, y: number, phase: number): boolean {
    const step = (((x + y - phase) % ANTS_PERIOD) + ANTS_PERIOD) % ANTS_PERIOD;
    return step < ANTS_DASH;
}

/**
 * The 4 × 4 tile of the dashes, straight RGBA: pixel (i, j) is `dark` where
 * `isDarkDash(i, j, 0)`, `light` elsewhere (0xRRGGBB each), both opaque.
 */
export function dashTile(dark: number, light: number): Uint8ClampedArray {
    const tile = new Uint8ClampedArray(ANTS_PERIOD * ANTS_PERIOD * 4);
    for (let j = 0; j < ANTS_PERIOD; j++) {
        for (let i = 0; i < ANTS_PERIOD; i++) {
            const colour = isDarkDash(i, j, 0) ? dark : light;
            const at = (j * ANTS_PERIOD + i) * 4;
            tile[at] = (colour >> 16) & 0xff;
            tile[at + 1] = (colour >> 8) & 0xff;
            tile[at + 2] = colour & 0xff;
            tile[at + 3] = 255;
        }
    }
    return tile;
}

/**
 * How far right the tile is shifted, 0 to 3, so that at `phase` it shows the dashes of the
 * canvas on a surface whose pixel (0, 0) is canvas pixel (x, y): the surface's pixel
 * (u, v) then shows tile pixel ((u − shift) mod 4, v mod 4), which is dark exactly where
 * `isDarkDash(x + u, y + v, phase)`.
 */
export function dashShift(phase: number, x: number, y: number): number {
    return (((phase - x - y) % ANTS_PERIOD) + ANTS_PERIOD) % ANTS_PERIOD;
}
