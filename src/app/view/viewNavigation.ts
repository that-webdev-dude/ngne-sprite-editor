import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument, ViewState } from "../state/sessions";
import { createViewMapping } from "./coordinates";
import type { Point, ViewMapping } from "./coordinates";
import { fitView, panView, viewportCentre, zoomView } from "./navigate";
import type { Size } from "./navigate";
import { viewportSize } from "./viewportSize";
import { zoomStep } from "./zoom";

// View navigation on the app's stores (SE-012): commands, tools and pointer handling change
// the view of the active document through these functions (the first view of a document comes
// from `autoFit`). Every change goes through `sessions.setView`, which the viewport follows
// (`viewport/viewportController`), and every change keeps the pan limits.
//
// Positions are device pixels of the viewport element unless a name says otherwise.

/**
 * The viewport element: the container that holds the NGNE canvas (and the overlay canvas of
 * SE-013), as `ui` mounted it. Client positions are mapped against its box.
 */
let surface: HTMLElement | null = null;

/** Registers the viewport element; `null` when it left the page. */
export function setViewSurface(element: HTMLElement | null): void {
    surface = element;
}

/** The viewport element, or null while no document is open. */
export function viewSurface(): HTMLElement | null {
    return surface;
}

interface Navigable {
    document: OpenDocument;
    doc: Size;
    viewport: Size;
}

/** The active document and the viewport, when there is a view to navigate. */
function navigable(): Navigable | null {
    const document = activeDocument(sessionsStore.getState());
    const viewport = viewportSize.size;
    if (!document || viewport.width <= 0 || viewport.height <= 0) return null;
    const { width, height } = document.session.doc;
    return { document, doc: { width, height }, viewport };
}

/** Whether a document is open in a viewport that has a size: the view can be navigated. */
export function canNavigate(): boolean {
    return navigable() !== null;
}

/** The view of the active document, or null when none is open. */
export function activeView(): ViewState | null {
    return activeDocument(sessionsStore.getState())?.view ?? null;
}

function apply(target: Navigable, view: ViewState): void {
    const now = target.document.view;
    if (view.scale === now.scale && view.originX === now.originX && view.originY === now.originY) {
        return;
    }
    sessionsStore.getState().setView(target.document.id, view);
}

/**
 * The mapping between client, device and document coordinates for the active document as it
 * is on screen now (`coordinates.ts`), or null while no document is open or the viewport
 * element is not on the page. It reads the element's box, so it is made when it is needed —
 * per pointer event, per overlay redraw — and not kept.
 */
export function currentViewMapping(): ViewMapping | null {
    const document = activeDocument(sessionsStore.getState());
    if (!document || !surface) return null;
    const box = surface.getBoundingClientRect();
    const { width, height } = document.session.doc;
    return createViewMapping({
        view: document.view,
        docWidth: width,
        docHeight: height,
        ratio: window.devicePixelRatio,
        left: box.left,
        top: box.top,
    });
}

/** Moves the document by `dx`, `dy` device pixels, as far as the pan limits allow. */
export function panBy(dx: number, dy: number): void {
    const target = navigable();
    if (!target) return;
    apply(target, panView(target.document.view, dx, dy, target.doc, target.viewport));
}

/**
 * Sets the zoom to `scale`, a zoom step (`zoom.ts`), keeping the document position under
 * `anchor` in place; without an anchor, the one at the centre of the viewport.
 */
export function zoomTo(scale: number, anchor?: Point): void {
    const target = navigable();
    if (!target) return;
    const { document, doc, viewport } = target;
    apply(
        target,
        zoomView(document.view, scale, anchor ?? viewportCentre(viewport), doc, viewport),
    );
}

/** One zoom step in (`1`) or out (`-1`), about `anchor` or the centre of the viewport. */
export function zoomBy(direction: 1 | -1, anchor?: Point): void {
    const view = activeView();
    if (view) zoomTo(zoomStep(view.scale, direction), anchor);
}

/** Fits the active document: the largest zoom step at which it fits the viewport, centred. */
export function fitActiveView(): void {
    const target = navigable();
    if (target) apply(target, fitView(target.doc, target.viewport));
}
