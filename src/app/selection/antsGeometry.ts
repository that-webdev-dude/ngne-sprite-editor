import type { SelectionBoundary } from "../../core/selection";
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
// The dashes are black and white, 2 device pixels each, by the sum x + y of the canvas pixel:
// along every row and column of the ring they repeat every 4 pixels, also round corners, and
// a step of the phase moves them one pixel on.

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

/** The device span of the grid lines `from` to `to` along `axis`, at least one pixel long. */
function span(axis: Axis, from: number, to: number): [number, number] {
    const start = devicePosition(axis, from);
    const end = devicePosition(axis, to);
    return [start, Math.max(end, start + 1)];
}

/**
 * The ring of the ants for `boundary` (document grid lines) on a canvas of `size`, where the
 * document lies along `axes`: 1-pixel-thick rectangles, those off the canvas left out. They
 * may overlap where two runs meet.
 */
export function antsRing(
    boundary: SelectionBoundary,
    axes: { x: Axis; y: Axis },
    size: DeviceSize,
): DeviceRect[] {
    const rects: DeviceRect[] = [];
    const add = (rect: DeviceRect) => {
        const visible = onCanvas(rect, size);
        if (visible) rects.push(visible);
    };
    for (const edge of boundary.horizontal) {
        const [x0, x1] = span(axes.x, edge.x0, edge.x1);
        const line = devicePosition(axes.y, edge.y);
        // Outside is the row after the line when the selection is above it, else the row before.
        add({ x: x0, y: edge.inside === "above" ? line : line - 1, width: x1 - x0, height: 1 });
    }
    for (const edge of boundary.vertical) {
        const [y0, y1] = span(axes.y, edge.y0, edge.y1);
        const line = devicePosition(axes.x, edge.x);
        add({ x: edge.inside === "left" ? line : line - 1, y: y0, width: 1, height: y1 - y0 });
    }
    for (const corner of boundary.corners) {
        const x = devicePosition(axes.x, corner.x);
        const y = devicePosition(axes.y, corner.y);
        const left = corner.selected === "top-left" || corner.selected === "bottom-left";
        const top = corner.selected === "top-left" || corner.selected === "top-right";
        add({ x: left ? x : x - 1, y: top ? y : y - 1, width: 1, height: 1 });
    }
    return rects;
}

/** Whether the canvas pixel `x, y` is a black dash at `phase` (0 to `ANTS_PERIOD - 1`). */
export function isDarkDash(x: number, y: number, phase: number): boolean {
    const step = (((x + y - phase) % ANTS_PERIOD) + ANTS_PERIOD) % ANTS_PERIOD;
    return step < ANTS_DASH;
}

/** The black dashes of the pixels `[from, to)` of a line where the other coordinate is `other`. */
function darkRuns(from: number, to: number, other: number, phase: number): [number, number][] {
    const runs: [number, number][] = [];
    let at = from;
    while (at < to) {
        const step = (((at + other - phase) % ANTS_PERIOD) + ANTS_PERIOD) % ANTS_PERIOD;
        if (step < ANTS_DASH) {
            const end = Math.min(to, at + ANTS_DASH - step);
            runs.push([at, end]);
            at = end;
        } else {
            at += ANTS_PERIOD - step;
        }
    }
    return runs;
}

/**
 * The black dashes of the ring `rects` at `phase`: the parts of each rectangle whose pixels
 * `isDarkDash` names. The rest of the ring is white.
 */
export function antsDashes(rects: readonly DeviceRect[], phase: number): DeviceRect[] {
    const dashes: DeviceRect[] = [];
    for (const rect of rects) {
        if (rect.height === 1) {
            for (const [x0, x1] of darkRuns(rect.x, rect.x + rect.width, rect.y, phase)) {
                dashes.push({ x: x0, y: rect.y, width: x1 - x0, height: 1 });
            }
        } else if (rect.width === 1) {
            for (const [y0, y1] of darkRuns(rect.y, rect.y + rect.height, rect.x, phase)) {
                dashes.push({ x: rect.x, y: y0, width: 1, height: y1 - y0 });
            }
        } else {
            // Not made by `antsRing`; covered row by row all the same.
            for (let y = rect.y; y < rect.y + rect.height; y++) {
                for (const [x0, x1] of darkRuns(rect.x, rect.x + rect.width, y, phase)) {
                    dashes.push({ x: x0, y, width: x1 - x0, height: 1 });
                }
            }
        }
    }
    return dashes;
}
