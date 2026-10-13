import type { ViewState } from "../state/sessions";
import type { Point } from "./coordinates";
import { fitZoom, scaledLength } from "./zoom";

// View navigation (SE-012): where the document rectangle goes when the user pans, zooms or
// fits. Pure: views in, views out, everything in device pixels of the viewport element. A
// function that changes nothing returns the view it was given.

export interface Size {
    width: number;
    height: number;
}

/** Device pixels of the document that stay visible along each axis, however far it is panned. */
export const MIN_VISIBLE = 32;

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

function same(a: ViewState, b: ViewState): boolean {
    return a.scale === b.scale && a.originX === b.originX && a.originY === b.originY;
}

/** The document's size on screen at `scale`: the size of the rectangle the engine draws. */
export function scaledSize(doc: Size, scale: number): Size {
    return { width: scaledLength(doc.width, scale), height: scaledLength(doc.height, scale) };
}

/**
 * The origins a view may have along one axis. At least `MIN_VISIBLE` device pixels of the
 * document stay inside the viewport; a document (or a viewport) smaller than that stays
 * visible (or covered) in full.
 */
function originRange(length: number, viewLength: number): { low: number; high: number } {
    const visible = Math.min(MIN_VISIBLE, length, viewLength);
    return { low: visible - length, high: viewLength - visible };
}

/** How much of the document is inside the viewport along each axis, in device pixels. */
export function visibleExtent(view: ViewState, doc: Size, viewport: Size): Size {
    const size = scaledSize(doc, view.scale);
    const along = (origin: number, length: number, viewLength: number) =>
        Math.max(0, Math.min(origin + length, viewLength) - Math.max(origin, 0));
    return {
        width: along(Math.round(view.originX), size.width, viewport.width),
        height: along(Math.round(view.originY), size.height, viewport.height),
    };
}

/**
 * The view moved back inside the pan limits: whole origins, and at least `MIN_VISIBLE` device
 * pixels of the document visible along each axis. A viewport without a size limits nothing.
 */
export function clampView(view: ViewState, doc: Size, viewport: Size): ViewState {
    const next = { ...view, originX: Math.round(view.originX), originY: Math.round(view.originY) };
    if (viewport.width > 0 && viewport.height > 0) {
        const size = scaledSize(doc, view.scale);
        const x = originRange(size.width, viewport.width);
        const y = originRange(size.height, viewport.height);
        next.originX = clamp(next.originX, x.low, x.high);
        next.originY = clamp(next.originY, y.low, y.high);
    }
    return same(next, view) ? view : next;
}

/** The view moved by `dx`, `dy` device pixels, inside the pan limits. */
export function panView(
    view: ViewState,
    dx: number,
    dy: number,
    doc: Size,
    viewport: Size,
): ViewState {
    const next = clampView(
        { ...view, originX: view.originX + dx, originY: view.originY + dy },
        doc,
        viewport,
    );
    return same(next, view) ? view : next;
}

/**
 * The origin along one axis after a zoom from `from` to `to` that keeps the document position
 * under `anchor` where it is. Between two steps of 1 and above the document pixel under the
 * anchor is the same one before and after, whatever the rounding of the origin would do.
 */
function zoomOrigin(origin: number, length: number, from: number, to: number, anchor: number) {
    const per = scaledLength(length, from) / length;
    const nextPer = scaledLength(length, to) / length;
    const at = (anchor - origin) / per;
    const next = Math.round(anchor - at * nextPer);
    if (from < 1 || to < 1) return next;
    const pixel = Math.floor(at);
    // The origins that leave the anchor inside the pixel: pixel·to ≤ anchor − origin < (pixel + 1)·to.
    const high = Math.floor(anchor - pixel * to);
    const low = Math.floor(anchor - (pixel + 1) * to) + 1;
    return clamp(next, low, high);
}

/**
 * The view at `scale` with the document position under `anchor` (device pixels) kept in
 * place, then moved inside the pan limits. Used with the cursor as the anchor for the wheel
 * and the zoom tool, and with the centre of the viewport for keys and menu commands.
 */
export function zoomView(
    view: ViewState,
    scale: number,
    anchor: Point,
    doc: Size,
    viewport: Size,
): ViewState {
    const originX = Math.round(view.originX);
    const originY = Math.round(view.originY);
    return clampView(
        scale === view.scale
            ? view
            : {
                  scale,
                  originX: zoomOrigin(originX, doc.width, view.scale, scale, anchor.x),
                  originY: zoomOrigin(originY, doc.height, view.scale, scale, anchor.y),
              },
        doc,
        viewport,
    );
}

/** The centre of a viewport, the anchor of the zoom commands that have no cursor. */
export function viewportCentre(viewport: Size): Point {
    return { x: viewport.width / 2, y: viewport.height / 2 };
}

/**
 * The view of a new or opened document (SPEC §6.4): the largest zoom step at which the
 * document fits the viewport, centred. Also "Fit" (key 0).
 */
export function fitView(doc: Size, viewport: Size): ViewState {
    const scale = fitZoom(doc.width, doc.height, viewport.width, viewport.height);
    const size = scaledSize(doc, scale);
    return {
        scale,
        originX: Math.floor((viewport.width - size.width) / 2),
        originY: Math.floor((viewport.height - size.height) / 2),
    };
}
