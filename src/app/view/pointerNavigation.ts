import { sessionsStore } from "../state/sessions";
import { statusStore } from "../state/status";
import type { Point } from "./coordinates";
import {
    canNavigate,
    currentViewMapping,
    panBy,
    setViewSurface,
    viewSurface,
    zoomBy,
} from "./viewNavigation";
import { viewportSize } from "./viewportSize";
import { createWheelPan, createWheelZoom, wheelPixels } from "./wheel";

// Pointer navigation of the viewport (SPEC §7.8, SE-012): the wheel zooms about the cursor
// (Ctrl+wheel the same), Shift+wheel pans horizontally, a middle-drag pans, and the status
// bar follows the cursor in document pixels.
//
// All of it is bound by pointer location, not by focus: the listeners are on the viewport
// element, and events of anything inside it — the NGNE canvas, the overlay canvas of SE-013
// that becomes the pointer target — bubble to it. Nothing here moves keyboard focus.

/** Set on the viewport element while a middle-drag pans, for the cursor. */
export const PANNING_ATTRIBUTE = "data-panning";

const MIDDLE_BUTTON = 1;
/** The middle button in `PointerEvent.buttons`. */
const MIDDLE_PRESSED = 4;

interface Pan {
    pointerId: number;
    /** Where the drag began, in client coordinates. */
    x: number;
    y: number;
    /** Device pixels of the drag already applied to the view. */
    movedX: number;
    movedY: number;
}

/**
 * Makes `element` the viewport element: client positions are mapped against its box
 * (`currentViewMapping`), and wheel, middle-drag and pointer movement over it navigate the
 * view of the active document. Returns the function that undoes all of it.
 */
export function attachViewNavigation(element: HTMLElement): () => void {
    const wheelZoom = createWheelZoom();
    const wheelPan = createWheelPan();
    /** Where the pointer is over the element, in client coordinates; null when it is not. */
    let pointer: Point | null = null;
    let pan: Pan | null = null;
    /** The cursor this module last gave the status bar. */
    let shown: Point | null = null;

    /**
     * The document pixel under the pointer, or null: no pointer over the viewport (a captured
     * drag may have left it), or a pointer beside the document.
     */
    const pixelUnderPointer = (): Point | null => {
        const mapping = pointer ? currentViewMapping() : null;
        if (!mapping || !pointer) return null;
        const device = mapping.clientToDevice(pointer.x, pointer.y);
        const { width, height } = viewportSize.size;
        if (device.x < 0 || device.y < 0 || device.x >= width || device.y >= height) return null;
        const pixel = mapping.clientToDoc(pointer.x, pointer.y);
        return mapping.contains(pixel) ? pixel : null;
    };

    /**
     * Keeps the cursor of the status bar: whole document pixels, none outside the document.
     * The store is written only when the pixel under the pointer changes, so a view that
     * changes with no pointer over the viewport leaves the store alone.
     */
    const showCursor = () => {
        const next = pixelUnderPointer();
        if (next?.x === shown?.x && next?.y === shown?.y) return;
        shown = next;
        statusStore.getState().setCursor(next);
    };

    /**
     * Where a wheel event happened. A wheel event reports whole CSS pixels, a pointer event
     * the exact position; at a ratio of 1.5 the two can be a device pixel apart. The position
     * the pointer was last seen at is taken while the wheel event agrees with it.
     */
    const wheelPosition = (event: WheelEvent): Point => {
        const exact =
            pointer !== null &&
            Math.abs(pointer.x - event.clientX) < 1 &&
            Math.abs(pointer.y - event.clientY) < 1;
        return exact && pointer ? pointer : { x: event.clientX, y: event.clientY };
    };

    const onWheel = (event: WheelEvent) => {
        // Over the viewport the wheel never scrolls or zooms the page (Ctrl+wheel).
        event.preventDefault();
        pointer = wheelPosition(event);
        const mapping = canNavigate() ? currentViewMapping() : null;
        if (mapping && event.shiftKey) {
            // With Shift held a browser may report the travel of a vertical wheel as
            // horizontal; whichever axis carries it is taken.
            const travel =
                Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            const distance = wheelPan(wheelPixels(travel, event.deltaMode), mapping.frame.ratio);
            // As a scroll would: wheel down moves the view right, the document left.
            if (distance !== 0) panBy(-distance, 0);
        } else if (mapping) {
            const direction = wheelZoom(wheelPixels(event.deltaY, event.deltaMode));
            if (direction !== 0) {
                zoomBy(direction, mapping.clientToDevice(pointer.x, pointer.y));
            }
        }
        showCursor();
    };

    const endPan = (pointerId: number) => {
        if (!pan || pan.pointerId !== pointerId) return;
        pan = null;
        element.removeAttribute(PANNING_ATTRIBUTE);
        if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    };

    const onPointerDown = (event: PointerEvent) => {
        pointer = { x: event.clientX, y: event.clientY };
        showCursor();
        if (event.button !== MIDDLE_BUTTON || pan || !canNavigate()) return;
        pan = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            movedX: 0,
            movedY: 0,
        };
        element.setAttribute(PANNING_ATTRIBUTE, "");
        // The drag goes on when the pointer leaves the viewport.
        element.setPointerCapture(event.pointerId);
    };

    // The middle button starts the browser's autoscroll and would move focus; over the
    // viewport it pans and does neither.
    const onMouseDown = (event: MouseEvent) => {
        if (event.button === MIDDLE_BUTTON) event.preventDefault();
    };

    // On Linux the release of the middle button pastes the selection of the window system
    // into the field that has the focus, unless the `mouseup` is cancelled.
    const onMouseUp = (event: MouseEvent) => {
        if (event.button === MIDDLE_BUTTON) event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
        pointer = { x: event.clientX, y: event.clientY };
        if (pan && pan.pointerId === event.pointerId) {
            if ((event.buttons & MIDDLE_PRESSED) === 0) {
                // Released while another button stayed down: no `pointerup` came for it.
                endPan(event.pointerId);
            } else {
                // The whole drag in device pixels, less what was applied: nothing is lost to
                // rounding, and a zoom during the drag is not undone.
                const ratio = window.devicePixelRatio;
                const x = Math.round((event.clientX - pan.x) * ratio);
                const y = Math.round((event.clientY - pan.y) * ratio);
                const dx = x - pan.movedX;
                const dy = y - pan.movedY;
                pan.movedX = x;
                pan.movedY = y;
                if (dx !== 0 || dy !== 0) panBy(dx, dy);
            }
        }
        showCursor();
    };

    const onPointerEnd = (event: PointerEvent) => endPan(event.pointerId);

    const onPointerLeave = () => {
        pointer = null;
        showCursor();
    };

    setViewSurface(element);
    // Not passive: the default of the wheel is prevented.
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("mousedown", onMouseDown);
    element.addEventListener("mouseup", onMouseUp);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerEnd);
    element.addEventListener("pointercancel", onPointerEnd);
    element.addEventListener("lostpointercapture", onPointerEnd);
    element.addEventListener("pointerleave", onPointerLeave);
    // A view or a size that changes under a resting pointer changes the pixel under it.
    const stopSessions = sessionsStore.subscribe(showCursor);
    const stopSize = viewportSize.subscribe(showCursor);

    return () => {
        stopSessions();
        stopSize();
        element.removeEventListener("wheel", onWheel);
        element.removeEventListener("pointerdown", onPointerDown);
        element.removeEventListener("mousedown", onMouseDown);
        element.removeEventListener("mouseup", onMouseUp);
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerup", onPointerEnd);
        element.removeEventListener("pointercancel", onPointerEnd);
        element.removeEventListener("lostpointercapture", onPointerEnd);
        element.removeEventListener("pointerleave", onPointerLeave);
        if (pan) endPan(pan.pointerId);
        pointer = null;
        showCursor();
        if (viewSurface() === element) setViewSurface(null);
    };
}
