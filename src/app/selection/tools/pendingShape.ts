import type { BitMask, DocSession, Rect } from "../../../core/model";
import type { PixelPoint } from "../../../core/raster";
import {
    createMask,
    ellipseMask,
    forEachLinePixelOn,
    maskBounds,
    polygonMask,
    rectMask,
    selectionBoundary,
    setMaskPixel,
} from "../../../core/selection";
import type { SelectionBoundary } from "../../../core/selection";
import { boundaryOf } from "../boundaryCache";

// The shape a selection tool's gesture would select (SE-031): kept while the gesture is in
// progress, so the overlay shows it (`selectionPreview.overlay.ts`), and turned into a mask of
// the document's size when the gesture completes. Pure apart from the small store of the
// pending shape; no DOM.

/** A selection tool's shape, in document pixels (whole numbers, also off the canvas). */
export type PendingShape =
    /** The rectangle `rect` (marquee). */
    | { readonly kind: "rectangle"; readonly rect: Rect }
    /** The filled ellipse that fits `rect` (elliptical marquee). */
    | { readonly kind: "ellipse"; readonly rect: Rect }
    /** The polygon through `points`, closed (lasso, polygon lasso). */
    | { readonly kind: "polygon"; readonly points: readonly PixelPoint[] }
    /** A mask of the document's size (magic wand). */
    | { readonly kind: "mask"; readonly mask: BitMask };

/** The rectangle with corners `a` and `b`, both pixels included. */
export function cornersRect(a: PixelPoint, b: PixelPoint): Rect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, width: Math.abs(b.x - a.x) + 1, height: Math.abs(b.y - a.y) + 1 };
}

/**
 * The mask of the pixels `shape` selects on a `width` × `height` canvas (SPEC §7.2): the
 * rectangle, the ellipse, the polygon (none for fewer than 3 points), or the mask itself.
 */
export function shapeMask(shape: PendingShape, width: number, height: number): BitMask {
    switch (shape.kind) {
        case "rectangle":
            return rectMask(width, height, shape.rect);
        case "ellipse":
            return ellipseMask(width, height, shape.rect);
        case "polygon":
            return polygonMask(width, height, shape.points);
        case "mask":
            return shape.mask;
    }
}

/** The part of `rect` on a `width` × `height` canvas, or null. */
function onCanvas(rect: Rect, width: number, height: number): Rect | null {
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const right = Math.min(width, rect.x + rect.width);
    const bottom = Math.min(height, rect.y + rect.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

const NO_BOUNDARY: SelectionBoundary = { horizontal: [], vertical: [], corners: [] };

/** `boundary` moved by `dx, dy` document pixels. */
function moved(boundary: SelectionBoundary, dx: number, dy: number): SelectionBoundary {
    return {
        horizontal: boundary.horizontal.map((edge) => ({
            ...edge,
            y: edge.y + dy,
            x0: edge.x0 + dx,
            x1: edge.x1 + dx,
        })),
        vertical: boundary.vertical.map((edge) => ({
            ...edge,
            x: edge.x + dx,
            y0: edge.y0 + dy,
            y1: edge.y1 + dy,
        })),
        corners: boundary.corners.map((corner) => ({
            ...corner,
            x: corner.x + dx,
            y: corner.y + dy,
        })),
    };
}

/**
 * The boundary of the pixels `fill` sets in a mask of `area` (a part of the canvas), in the
 * canvas's coordinates: the work grows with the area, not with the canvas.
 */
function boundaryWithin(area: Rect, fill: (mask: BitMask) => void): SelectionBoundary {
    const mask = createMask(area.width, area.height);
    fill(mask);
    return moved(selectionBoundary(mask), area.x, area.y);
}

/** The bounding rectangle of `points`. */
function pointsRect(points: readonly PixelPoint[]): Rect {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const { x, y } of points) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
    }
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * The boundary of the pixels the overlay shows for `shape` on a `width` × `height` canvas
 * (SE-031, the pending shape): those `shapeMask` selects, except that a polygon of fewer than
 * 3 points shows its path (the pixels of its line, or its one pixel), which selects nothing.
 * Only the shape's bounds are looked at, apart from a mask, whose boundary is its own.
 */
export function pendingBoundary(
    shape: PendingShape,
    width: number,
    height: number,
): SelectionBoundary {
    switch (shape.kind) {
        case "rectangle": {
            const rect = onCanvas(shape.rect, width, height);
            if (!rect) return NO_BOUNDARY;
            const right = rect.x + rect.width;
            const bottom = rect.y + rect.height;
            return {
                horizontal: [
                    { y: rect.y, x0: rect.x, x1: right, inside: "below" },
                    { y: bottom, x0: rect.x, x1: right, inside: "above" },
                ],
                vertical: [
                    { x: rect.x, y0: rect.y, y1: bottom, inside: "right" },
                    { x: right, y0: rect.y, y1: bottom, inside: "left" },
                ],
                corners: [
                    { x: rect.x, y: rect.y, selected: "bottom-right" },
                    { x: right, y: rect.y, selected: "bottom-left" },
                    { x: rect.x, y: bottom, selected: "top-right" },
                    { x: right, y: bottom, selected: "top-left" },
                ],
            };
        }
        case "ellipse": {
            const area = onCanvas(shape.rect, width, height);
            if (!area) return NO_BOUNDARY;
            const { rect } = shape;
            return boundaryWithin(area, (mask) => {
                const local = ellipseMask(area.width, area.height, {
                    ...rect,
                    x: rect.x - area.x,
                    y: rect.y - area.y,
                });
                mask.data.set(local.data);
            });
        }
        case "polygon": {
            const { points } = shape;
            if (points.length === 0) return NO_BOUNDARY;
            const area = onCanvas(pointsRect(points), width, height);
            if (!area) return NO_BOUNDARY;
            const local = points.map(({ x, y }) => ({ x: x - area.x, y: y - area.y }));
            return boundaryWithin(area, (mask) => {
                if (local.length >= 3) {
                    mask.data.set(polygonMask(area.width, area.height, local).data);
                    return;
                }
                const [from, to = from] = local;
                if (!from || !to) return;
                forEachLinePixelOn(from.x, from.y, to.x, to.y, area.width, area.height, (x, y) =>
                    setMaskPixel(mask, x, y),
                );
            });
        }
        case "mask":
            // Shared with the ants: the selection a pick becomes keeps its mask.
            return boundaryOf(shape.mask);
    }
}

/**
 * Document pixels on a `width` × `height` canvas that hold every pixel `pendingBoundary`
 * surrounds, not necessarily tight; null when there is none. Constant time but for a mask,
 * whose bounds are looked for.
 */
export function pendingBounds(shape: PendingShape, width: number, height: number): Rect | null {
    switch (shape.kind) {
        case "rectangle":
        case "ellipse":
            return onCanvas(shape.rect, width, height);
        case "polygon":
            return shape.points.length > 0
                ? onCanvas(pointsRect(shape.points), width, height)
                : null;
        case "mask":
            return maskBounds(shape.mask);
    }
}

/** The shape a gesture would select, on the document it works on. */
export interface Pending {
    readonly session: DocSession;
    readonly shape: PendingShape;
}

/** The pending shape of the gesture in progress; there is one pointer, so one at most. */
export interface PendingStore {
    get(): Pending | null;
    /** Shows `shape` as the pending shape of a gesture on `session`. */
    set(session: DocSession, shape: PendingShape): void;
    /** No pending shape: the gesture ended. */
    clear(): void;
    /** Calls `listener` at each change; returns the function that stops it. */
    subscribe(listener: () => void): () => void;
}

export function createPendingStore(): PendingStore {
    let pending: Pending | null = null;
    const listeners = new Set<() => void>();
    const changed = () => {
        for (const listener of [...listeners]) listener();
    };
    return {
        get: () => pending,
        set(session, shape) {
            pending = { session, shape };
            changed();
        },
        clear() {
            if (!pending) return;
            pending = null;
            changed();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

/** The pending shape of the app's selection tools. */
export const pendingSelection: PendingStore = createPendingStore();
