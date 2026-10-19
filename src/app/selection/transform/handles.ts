import { boxCorners, fromBoxSpace, normalizeAngle, toBoxSpace } from "../../../core/floating";
import type { FreeTransform } from "../../../core/floating";
import type { Point } from "../../view/coordinates";

// The handles of a transform box (SE-033; DESIGN §5.2, §6): eight squares on the corners and
// the middles of the sides of a box turned about its centre, and the ring just outside it
// where a drag turns it. Pure geometry on a `FreeTransform` (document pixels, degrees), so the
// floating selection's box and a reference layer's (SE-046) share it: the overlay draws from
// it and the Move tool hit-tests with it.
//
//   nw ── n ── ne        a press on a handle scales the box: the handle's sides follow the
//   │           │        pointer, the opposite ones stay (Shift keeps the aspect ratio)
//   w           e        a press outside the box, within ROTATE_REACH of it, turns the box
//   │           │        about its centre (Shift snaps to 15°)
//   sw ── s ── se

/** A handle of the box: a corner or the middle of a side, named by compass direction. */
export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Which sides of the box a handle moves, in the box's own (unturned) space. */
interface HandleSides {
    /** −1: the left side, 1: the right side, 0: neither. */
    readonly h: -1 | 0 | 1;
    /** −1: the top side, 1: the bottom side, 0: neither. */
    readonly v: -1 | 0 | 1;
}

export const HANDLES: Readonly<Record<HandleId, HandleSides>> = {
    nw: { h: -1, v: -1 },
    n: { h: 0, v: -1 },
    ne: { h: 1, v: -1 },
    e: { h: 1, v: 0 },
    se: { h: 1, v: 1 },
    s: { h: 0, v: 1 },
    sw: { h: -1, v: 1 },
    w: { h: -1, v: 0 },
};

/** The handles in drawing and hit-testing order: corners first, they win where they overlap. */
export const HANDLE_IDS: readonly HandleId[] = ["nw", "ne", "se", "sw", "n", "e", "s", "w"];

/** Side of a handle's square as drawn, in CSS pixels. */
export const HANDLE_SIZE = 7;

/** Half the side of the square a press hits a handle within, in CSS pixels. */
export const HANDLE_REACH = 5;

/** How far outside the box a press turns it, in CSS pixels; farther, it applies the float. */
export const ROTATE_REACH = 16;

/** Shift snaps a turn to multiples of this many degrees (SE-033). */
export const ANGLE_SNAP = 15;

/** The position of a handle in the box's own space: (0, 0) top-left, (width, height) bottom-right. */
function handleInBox(transform: FreeTransform, id: HandleId): { u: number; v: number } {
    const { h, v } = HANDLES[id];
    return { u: ((h + 1) / 2) * transform.width, v: ((v + 1) / 2) * transform.height };
}

/** The document position of each handle, in `HANDLE_IDS` order. */
export function handlePoints(transform: FreeTransform): { id: HandleId; point: Point }[] {
    return HANDLE_IDS.map((id) => {
        const { u, v } = handleInBox(transform, id);
        return { id, point: fromBoxSpace(transform, u, v) };
    });
}

/** The box's corners in document coordinates, clockwise from its top-left. */
export function boxOutline(transform: FreeTransform): Point[] {
    return boxCorners(transform).map(([x, y]) => ({ x, y }));
}

/** What a press at a document position does to a transform box. */
export type BoxHit =
    | { kind: "handle"; handle: HandleId }
    | { kind: "rotate" }
    | { kind: "inside" }
    | { kind: "outside" };

/**
 * What a press at document position `point` hits on the box of `transform`, seen at `scale`
 * device pixels per document pixel and `ratio` device pixels per CSS pixel: a handle (within
 * `HANDLE_REACH` of it, the nearest one), the inside of the box, the ring of `ROTATE_REACH`
 * just outside it, or nothing.
 */
export function hitBox(
    transform: FreeTransform,
    point: Point,
    scale: number,
    ratio: number,
): BoxHit {
    const { u, v } = toBoxSpace(transform, point.x, point.y);
    // Distances along the box's own axes, in device pixels.
    const reach = HANDLE_REACH * ratio;
    let best: { handle: HandleId; distance: number } | null = null;
    for (const id of HANDLE_IDS) {
        const at = handleInBox(transform, id);
        const distance = Math.max(Math.abs(u - at.u), Math.abs(v - at.v)) * scale;
        if (distance <= reach && (!best || distance < best.distance)) {
            best = { handle: id, distance };
        }
    }
    if (best) return { kind: "handle", handle: best.handle };
    const outsideU = Math.max(0, -u, u - transform.width);
    const outsideV = Math.max(0, -v, v - transform.height);
    if (outsideU === 0 && outsideV === 0) return { kind: "inside" };
    const away = Math.hypot(outsideU, outsideV) * scale;
    return away <= ROTATE_REACH * ratio ? { kind: "rotate" } : { kind: "outside" };
}

/**
 * The box after a drag of handle `handle` from the box `start` to document position `point`
 * (SE-033): the handle's sides go to the pixel boundaries nearest the pointer, along the box's
 * own axes, the opposite sides stay, and no side gets shorter than 1 px or longer than
 * `limit` (the float's `MAX_TRANSFORM_SIDE` rule; SE-033 review A). With `keepAspect` both
 * sides scale by one factor, kept within the limit: a corner by the larger of its two changes
 * (the one farther from 1, shrinking as well as growing; review C), a side's middle by its
 * own, the other side centred where it was. The box stays turned by `start.angle` about its
 * new centre, rounded to whole pixels. It is for floating selections, whose boxes are whole
 * pixels; a reference layer (SE-046) needs its own.
 */
export function scaleBox(
    start: FreeTransform,
    handle: HandleId,
    point: Point,
    keepAspect: boolean,
    limit = Infinity,
): FreeTransform {
    const { h, v } = HANDLES[handle];
    const { width: w0, height: h0 } = start;
    const at = toBoxSpace(start, point.x, point.y);
    let left = 0;
    let right = w0;
    let top = 0;
    let bottom = h0;
    if (h < 0) left = Math.max(Math.min(Math.round(at.u), right - 1), right - limit);
    if (h > 0) right = Math.min(Math.max(Math.round(at.u), left + 1), left + limit);
    if (v < 0) top = Math.max(Math.min(Math.round(at.v), bottom - 1), bottom - limit);
    if (v > 0) bottom = Math.min(Math.max(Math.round(at.v), top + 1), top + limit);
    if (keepAspect) {
        const factorH = (right - left) / w0;
        const factorV = (bottom - top) / h0;
        const corner = Math.abs(factorH - 1) >= Math.abs(factorV - 1) ? factorH : factorV;
        const wanted = h !== 0 && v !== 0 ? corner : h !== 0 ? factorH : factorV;
        // Neither side past the limit: the factor is cut, so the aspect is kept.
        const factor = Math.min(wanted, limit / w0, limit / h0);
        const width = Math.min(limit, Math.max(1, Math.round(w0 * factor)));
        const height = Math.min(limit, Math.max(1, Math.round(h0 * factor)));
        // The sides the handle moves follow the factor; the others stay, or are centred.
        if (h < 0) left = right - width;
        else if (h > 0) right = left + width;
        else {
            left = Math.round((w0 - width) / 2);
            right = left + width;
        }
        if (v < 0) top = bottom - height;
        else if (v > 0) bottom = top + height;
        else {
            top = Math.round((h0 - height) / 2);
            bottom = top + height;
        }
    }
    const width = right - left;
    const height = bottom - top;
    const centre = fromBoxSpace(start, (left + right) / 2, (top + bottom) / 2);
    return {
        x: Math.round(centre.x - width / 2),
        y: Math.round(centre.y - height / 2),
        width,
        height,
        angle: start.angle,
    };
}

/**
 * The box after a turn dragged from document position `from` to `to` about the centre of
 * `start` (SE-033): its angle changes by the angle the pointer swept, in whole degrees, or in
 * multiples of `ANGLE_SNAP` with `snap`. Its box is unchanged.
 */
export function rotateBoxTo(
    start: FreeTransform,
    from: Point,
    to: Point,
    snap: boolean,
): FreeTransform {
    const cx = start.x + start.width / 2;
    const cy = start.y + start.height / 2;
    const swept =
        ((Math.atan2(to.y - cy, to.x - cx) - Math.atan2(from.y - cy, from.x - cx)) * 180) / Math.PI;
    const raw = start.angle + swept;
    const step = snap ? ANGLE_SNAP : 1;
    return { ...start, angle: normalizeAngle(Math.round(raw / step) * step) };
}
