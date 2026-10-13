import { createStore } from "zustand/vanilla";
import { backingSize } from "../../engine/viewport/geometry";
import type { DeviceSize } from "../../engine/viewport/types";
import { viewportLink } from "../viewport/viewportLink";
import type { ViewportLink } from "../viewport/viewportLink";

// The size of the viewport in device pixels, as view navigation needs it (SE-012).
//
// The mounted viewport reports its size through `viewportLink`, but it is mounted only while
// a document is open, and its first size arrives an animation frame after that. A document
// opened then would show at 1× in the corner for a frame before it is fitted, and what the
// stores hold would change once more after `open` has returned. So the region the viewport
// fills is observed as well, all the time the shell is on the page: both are the same box,
// and with its size known a document is fitted in the task that opens it.

const NO_SIZE: DeviceSize = { width: 0, height: 0 };

function hasSize(size: DeviceSize): boolean {
    return size.width > 0 && size.height > 0;
}

/** The region of the shell that the viewport fills, as observed by the interface. */
export interface ViewportRegion {
    /** Its size in device pixels; 0 × 0 while it is not observed or not laid out. */
    readonly size: DeviceSize;
    /** The size was observed. */
    report(size: DeviceSize): void;
    /** Calls `listener` when the size changes. Returns the function that stops it. */
    subscribe(listener: () => void): () => void;
}

/** A region nobody observes yet. The app has one: `viewportRegion`. */
export function createViewportRegion(): ViewportRegion {
    const store = createStore<{ size: DeviceSize }>(() => ({ size: NO_SIZE }));
    return {
        get size() {
            return store.getState().size;
        },
        report(size) {
            const now = store.getState().size;
            if (size.width === now.width && size.height === now.height) return;
            store.setState({ size: { width: size.width, height: size.height } });
        },
        subscribe: (listener) => store.subscribe(() => listener()),
    };
}

/** The size of the viewport: where the document is placed and what the pan limits refer to. */
export interface ViewportSize {
    /**
     * The mounted viewport's size while it has one (the canvas backing size, SPEC §6.4),
     * otherwise the size of the region it fills; 0 × 0 when neither is known.
     */
    readonly size: DeviceSize;
    /**
     * Calls `listener` after a size was reported, in a task of its own and once for all the
     * reports of one task. Returns the function that stops it.
     *
     * Sizes are reported from inside the delivery of a `ResizeObserver`. A listener that
     * changes a store there makes React render there, together with whatever another observer
     * of that delivery has queued (the tool rail's change of columns): elements change size
     * while sizes are being delivered, and the browser reports a "ResizeObserver loop" error.
     * `size` itself is current at once.
     */
    subscribe(listener: () => void): () => void;
}

export function createViewportSize(
    link: Pick<ViewportLink, "deviceSize" | "subscribe">,
    region: ViewportRegion,
): ViewportSize {
    return {
        get size() {
            const mounted = link.deviceSize;
            return hasSize(mounted) ? mounted : region.size;
        },
        subscribe(listener) {
            let pending: ReturnType<typeof setTimeout> | undefined;
            const later = () => {
                pending ??= setTimeout(() => {
                    pending = undefined;
                    listener();
                }, 0);
            };
            const stopLink = link.subscribe(later);
            const stopRegion = region.subscribe(later);
            return () => {
                stopLink();
                stopRegion();
                clearTimeout(pending);
                pending = undefined;
            };
        },
    };
}

/** The viewport region of the app. */
export const viewportRegion = createViewportRegion();

/** The viewport size of the app: `viewportLink`, or else `viewportRegion`. */
export const viewportSize = createViewportSize(viewportLink, viewportRegion);

/**
 * Keeps `region` at the size of `element` in device pixels, measured as the viewport
 * measures its own element (`devicePixelContentBoxSize`, the same rounding). Returns the
 * function that stops observing; the region then has no size.
 */
export function observeViewportRegion(
    element: HTMLElement,
    region: ViewportRegion = viewportRegion,
): () => void {
    const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const box = entry.devicePixelContentBoxSize?.[0];
        region.report(
            box
                ? backingSize(box.inlineSize, box.blockSize)
                : backingSize(
                      entry.contentRect.width * devicePixelRatio,
                      entry.contentRect.height * devicePixelRatio,
                  ),
        );
    });
    try {
        observer.observe(element, { box: "device-pixel-content-box" });
    } catch {
        // Not supported: the content box times the pixel ratio is used instead.
        observer.observe(element);
    }
    return () => {
        observer.disconnect();
        region.report(NO_SIZE);
    };
}
