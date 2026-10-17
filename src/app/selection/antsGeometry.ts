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
// Only what lies in a clip — the canvas, or a strip of it a pan uncovered (SE-031) — is looked
// at: the boundary's segments are sorted by line, so the lines in the clip, and the segments
// of each line in it, are found by binary search, and the work grows with what is visible, not
// with the selection. The runs reach the visitor as numbers, with no object made per run.
// Where the ring can lie at all is known in constant time from the selection's bounds
// (`ringBounds`).
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

/** The part `a` and `b` share; null when they share none (or `a` is null). */
export function intersection(a: DeviceRect | null, b: DeviceRect): DeviceRect | null {
    if (!a) return null;
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
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
 * lines) that lies in `clip` (device pixels: the canvas, or a part of it), where the document
 * lies along `axes`: 1-pixel-thick runs `x, y, width, height`, clipped to `clip`, which may
 * overlap where two runs meet. No object is made per run. Returns how many boundary items were
 * looked at, which grows with the part of the boundary in `clip`, not with the boundary.
 */
export function forEachRingRun(
    boundary: SelectionBoundary,
    axes: { x: Axis; y: Axis },
    clip: DeviceRect,
    visit: (x: number, y: number, width: number, height: number) => void,
): number {
    let examined = 0;
    const left = clip.x;
    const top = clip.y;
    const right = clip.x + clip.width;
    const bottom = clip.y + clip.height;
    if (right <= left || bottom <= top) return 0;
    const add = (x: number, y: number, width: number, height: number) => {
        const x0 = Math.max(left, x);
        const y0 = Math.max(top, y);
        const x1 = Math.min(right, x + width);
        const y1 = Math.min(bottom, y + height);
        if (x1 > x0 && y1 > y0) visit(x0, y0, x1 - x0, y1 - y0);
    };

    // A horizontal edge on line y covers the row before or after `devicePosition(y)`: lines
    // at device rows `top` to `bottom`. Within a line the edges run left to right.
    const horizontal: readonly HorizontalEdge[] = boundary.horizontal;
    const [rowFirst, rowLast] = linesWithin(axes.y, top, bottom);
    for (let line = rowFirst; line <= rowLast; line++) {
        const row = devicePosition(axes.y, line);
        let index = firstIndex(horizontal.length, (at) => {
            const edge = horizontal[at];
            if (edge.y !== line) return edge.y > line;
            return spanEnd(axes.x, devicePosition(axes.x, edge.x0), edge.x1) > left;
        });
        for (; index < horizontal.length && horizontal[index].y === line; index++) {
            const edge = horizontal[index];
            const x0 = devicePosition(axes.x, edge.x0);
            if (x0 >= right) break;
            examined++;
            const x1 = spanEnd(axes.x, x0, edge.x1);
            // Outside is the row after the line when the selection is above it, else the row before.
            add(x0, edge.inside === "above" ? row : row - 1, x1 - x0, 1);
        }
    }

    const vertical: readonly VerticalEdge[] = boundary.vertical;
    const [columnFirst, columnLast] = linesWithin(axes.x, left, right);
    for (let line = columnFirst; line <= columnLast; line++) {
        const column = devicePosition(axes.x, line);
        let index = firstIndex(vertical.length, (at) => {
            const edge = vertical[at];
            if (edge.x !== line) return edge.x > line;
            return spanEnd(axes.y, devicePosition(axes.y, edge.y0), edge.y1) > top;
        });
        for (; index < vertical.length && vertical[index].x === line; index++) {
            const edge = vertical[index];
            const y0 = devicePosition(axes.y, edge.y0);
            if (y0 >= bottom) break;
            examined++;
            const y1 = spanEnd(axes.y, y0, edge.y1);
            add(edge.inside === "left" ? column : column - 1, y0, 1, y1 - y0);
        }
    }

    // A corner's pixel is at or just before its grid point on both axes.
    const corners: readonly OuterCorner[] = boundary.corners;
    for (let line = rowFirst; line <= rowLast; line++) {
        const y = devicePosition(axes.y, line);
        let index = firstIndex(corners.length, (at) => {
            const corner = corners[at];
            if (corner.y !== line) return corner.y > line;
            return devicePosition(axes.x, corner.x) >= left;
        });
        for (; index < corners.length && corners[index].y === line; index++) {
            const corner = corners[index];
            const x = devicePosition(axes.x, corner.x);
            if (x > right) break;
            examined++;
            const leftward = corner.selected === "top-left" || corner.selected === "bottom-left";
            const upward = corner.selected === "top-left" || corner.selected === "top-right";
            add(leftward ? x : x - 1, upward ? y : y - 1, 1, 1);
        }
    }
    return examined;
}

/**
 * Calls `visit` with each rectangle of the ring of the ants for `boundary` on a canvas of
 * `size` (`forEachRingRun` with the canvas as the clip), as a rectangle. Returns how many
 * boundary items were looked at.
 */
export function forEachRingRect(
    boundary: SelectionBoundary,
    axes: { x: Axis; y: Axis },
    size: DeviceSize,
    visit: (rect: DeviceRect) => void,
): number {
    return forEachRingRun(
        boundary,
        axes,
        { x: 0, y: 0, width: size.width, height: size.height },
        (x, y, width, height) => visit({ x, y, width, height }),
    );
}

/**
 * Where the ring of a selection whose selected texels lie in `bounds` (document pixels) can
 * be on a canvas of `size`: the device rectangle of `bounds` grown by 1 pixel on every side,
 * cut to the canvas; null when none of it is on the canvas. Worked out in constant time; the
 * ring's pixels lie in it at every zoom step, also where an overview step keeps a run of 1
 * pixel past the bounds' last device column or row.
 */
export function ringBounds(
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
    axes: { x: Axis; y: Axis },
    size: DeviceSize,
): DeviceRect | null {
    return onCanvas(
        {
            x: devicePosition(axes.x, bounds.x) - 1,
            y: devicePosition(axes.y, bounds.y) - 1,
            width:
                devicePosition(axes.x, bounds.x + bounds.width) -
                devicePosition(axes.x, bounds.x) +
                2,
            height:
                devicePosition(axes.y, bounds.y + bounds.height) -
                devicePosition(axes.y, bounds.y) +
                2,
        },
        size,
    );
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
 * Paints the part of the ring in `clip` into `rgba`, the straight RGBA pixels of `area`
 * (row by row, `area.width` a row): opaque white on the ring, the rest left as it is. `clip`
 * is `area` itself unless only a part of it is painted (a strip a pan uncovered), and lies in
 * `area` and on the canvas of `size`. Returns how many runs of the ring it painted.
 */
export function paintRing(
    boundary: SelectionBoundary,
    axes: { x: Axis; y: Axis },
    size: DeviceSize,
    area: DeviceRect,
    rgba: Uint8ClampedArray,
    clip: DeviceRect = area,
): number {
    const visible = intersection(onCanvas(clip, size), area);
    if (!visible) return 0;
    let runs = 0;
    forEachRingRun(boundary, axes, visible, (x0, y0, width, height) => {
        runs++;
        for (let y = y0; y < y0 + height; y++) {
            const start = ((y - area.y) * area.width + x0 - area.x) * 4;
            rgba.fill(255, start, start + width * 4);
        }
    });
    return runs;
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
