import type { SymmetrySettings } from "../../core/model";
import type { DeviceRect } from "../../engine/viewport/geometry";
import type { DeviceSize } from "../../engine/viewport/types";
import type { Point, ViewMapping } from "../view/coordinates";

// Where the symmetry axes and their handles are on the overlay (SE-062), in the canvas's
// device pixels. Pure: the draw layer (`axes.overlay.ts`) draws them and the axis drag
// (`axisDrag.ts`) hit-tests them, both from this.
//
// An axis is a line of 1 device pixel across the document: the device pixel its position lies
// in, at or before it (its floor), as a grid line is the first device pixel of a texel (DESIGN
// §6), so an axis on a texel boundary lies where a grid line would and one through a texel's
// middle on that texel's middle column. A handle sits at each end of the line, just outside
// the document (past its outline), so a press there drags the axis and a press on the document
// paints.
//
// Where the document's edge is off the canvas (zoomed in, or panned), a handle would be out of
// reach: it is held inside the canvas along its axis (SE-062 review C). It then stays in the
// margin outside the document while the canvas shows one, and is otherwise at the canvas's
// edge, over the document: there, in its own square, a press takes the axis, not the paint.

/** Side of a handle in CSS pixels, as the transform box's handles (SE-033). */
export const AXIS_HANDLE_SIZE = 7;
/** Gap between the document's edge and a handle, in CSS pixels: past the outline. */
export const AXIS_HANDLE_GAP = 3;
/** How far around a handle a press still grabs it, in CSS pixels. */
export const AXIS_HANDLE_SLOP = 3;

/**
 * Which axis: "x" is the vertical line of horizontal symmetry (mode "x", `axisX`), "y" the
 * horizontal line of vertical symmetry (mode "y", `axisY`).
 */
export type AxisName = "x" | "y";

export interface AxisLine {
    axis: AxisName;
    /** The device column ("x") or row ("y") of the line. */
    at: number;
    /** The line's extent along the document: its device rectangle of 1 pixel across. */
    rect: DeviceRect;
}

export interface AxisHandle {
    axis: AxisName;
    rect: DeviceRect;
}

export interface AxisGeometry {
    lines: AxisLine[];
    handles: AxisHandle[];
}

/** `value` held within `[0, limit - size]`; as it is when `limit` is unknown (0). */
function within(value: number, size: number, limit: number): number {
    if (limit <= 0) return value;
    return Math.max(0, Math.min(limit - size, value));
}

/**
 * The axes `symmetry` shows on the document `mapping` places, and their handles, held inside
 * a canvas of `bounds` along their axis (none when absent or 0).
 */
export function axisGeometry(
    mapping: ViewMapping,
    symmetry: Readonly<SymmetrySettings>,
    bounds: DeviceSize = { width: 0, height: 0 },
): AxisGeometry {
    const lines: AxisLine[] = [];
    const handles: AxisHandle[] = [];
    const { rect } = mapping;
    const ratio = mapping.frame.ratio > 0 ? mapping.frame.ratio : 1;
    const size = Math.max(5, Math.round(AXIS_HANDLE_SIZE * ratio));
    const half = Math.floor(size / 2);
    const gap = Math.max(2, Math.round(AXIS_HANDLE_GAP * ratio));
    const { mode } = symmetry;
    if (mode === "x" || mode === "both") {
        const at = Math.floor(mapping.docToDevice(symmetry.axisX / 2, 0).x);
        lines.push({ axis: "x", at, rect: { x: at, y: rect.y, width: 1, height: rect.height } });
        const top = within(rect.y - gap - size, size, bounds.height);
        const bottom = within(rect.y + rect.height + gap, size, bounds.height);
        handles.push(
            { axis: "x", rect: { x: at - half, y: top, width: size, height: size } },
            { axis: "x", rect: { x: at - half, y: bottom, width: size, height: size } },
        );
    }
    if (mode === "y" || mode === "both") {
        const at = Math.floor(mapping.docToDevice(0, symmetry.axisY / 2).y);
        lines.push({ axis: "y", at, rect: { x: rect.x, y: at, width: rect.width, height: 1 } });
        const left = within(rect.x - gap - size, size, bounds.width);
        const right = within(rect.x + rect.width + gap, size, bounds.width);
        handles.push(
            { axis: "y", rect: { x: left, y: at - half, width: size, height: size } },
            { axis: "y", rect: { x: right, y: at - half, width: size, height: size } },
        );
    }
    return { lines, handles };
}

/**
 * The axis whose handle is under `device` (canvas pixels), with `AXIS_HANDLE_SLOP` around
 * each handle; null for none. Of two, the nearer handle's.
 */
export function handleAt(geometry: AxisGeometry, device: Point, ratio: number): AxisName | null {
    const slop = Math.max(2, Math.round(AXIS_HANDLE_SLOP * (ratio > 0 ? ratio : 1)));
    let best: AxisName | null = null;
    let bestDistance = Infinity;
    for (const { axis, rect } of geometry.handles) {
        const dx = Math.max(rect.x - device.x, 0, device.x - (rect.x + rect.width));
        const dy = Math.max(rect.y - device.y, 0, device.y - (rect.y + rect.height));
        if (dx > slop || dy > slop) continue;
        const distance = Math.hypot(dx, dy);
        if (distance < bestDistance) {
            best = axis;
            bestDistance = distance;
        }
    }
    return best;
}
