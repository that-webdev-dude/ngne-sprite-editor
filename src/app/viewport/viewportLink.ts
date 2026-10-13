import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { DeviceSize, ViewportPort } from "../../engine/viewport/types";

export { frameKey } from "../../engine/viewport/types";

// The mounted viewport, as the rest of the app reaches it: its size in device pixels, which
// view navigation and coordinate mapping need, and a way to tell it that the pixels of a
// frame changed. The viewport itself lives in a component of `ui`; whatever mounts it
// registers here, so no other module goes through that component.

export interface ViewportLinkState {
    /** True while a viewport is on the page. */
    mounted: boolean;
    /**
     * Size of the viewport element in device pixels, which is the canvas backing size
     * (SPEC §6.4). 0 × 0 while no viewport is mounted or its element is not laid out.
     */
    deviceSize: DeviceSize;
}

/** What a mounted viewport gets back when it registers. */
export interface ViewportMount {
    /** The viewport element's size in device pixels changed. */
    resize(size: DeviceSize): void;
    /** The viewport is gone. */
    unmount(): void;
}

export interface ViewportLink {
    /** `mounted` and `deviceSize` as a store, for `useViewportLink` and `subscribe`. */
    readonly store: StoreApi<ViewportLinkState>;
    readonly mounted: boolean;
    readonly deviceSize: DeviceSize;
    /**
     * Tells the mounted viewport that the pixels behind these frame keys (`frameKey`)
     * changed, so it uploads the current one again; "all" also covers the document's size.
     * For changes the composite cache already holds, such as a live stroke handed to it:
     * a history step and `activeComposites.invalidate` reach the viewport on their own.
     * Does nothing while no viewport is mounted.
     */
    invalidate(keys: readonly string[] | "all"): void;
    /** Calls `listener` when `mounted` or `deviceSize` changes. Returns the function that stops it. */
    subscribe(listener: (state: ViewportLinkState) => void): () => void;
    /**
     * Registers the viewport that was mounted; the one registered before, if any, is
     * replaced. Used by `mountViewport`.
     */
    mount(viewport: Pick<ViewportPort, "invalidate">, size: DeviceSize): ViewportMount;
}

const NO_SIZE: DeviceSize = { width: 0, height: 0 };

/** A link without a viewport. The app has one: `viewportLink`. */
export function createViewportLink(): ViewportLink {
    const store = createStore<ViewportLinkState>(() => ({ mounted: false, deviceSize: NO_SIZE }));
    let current: Pick<ViewportPort, "invalidate"> | null = null;

    const setSize = (size: DeviceSize) => {
        const now = store.getState().deviceSize;
        if (size.width === now.width && size.height === now.height) return;
        store.setState({ deviceSize: { width: size.width, height: size.height } });
    };

    return {
        store,
        get mounted() {
            return store.getState().mounted;
        },
        get deviceSize() {
            return store.getState().deviceSize;
        },
        invalidate(keys) {
            current?.invalidate(keys);
        },
        subscribe(listener) {
            return store.subscribe((state) => listener(state));
        },
        mount(viewport, size) {
            current = viewport;
            store.setState({
                mounted: true,
                deviceSize: { width: size.width, height: size.height },
            });
            return {
                resize(next) {
                    if (current === viewport) setSize(next);
                },
                unmount() {
                    // A viewport mounted since stays registered.
                    if (current !== viewport) return;
                    current = null;
                    store.setState({ mounted: false, deviceSize: NO_SIZE });
                },
            };
        },
    };
}

/** The link to the app's viewport. */
export const viewportLink = createViewportLink();

/** A value of the viewport link; the component renders again when it changes. */
export function useViewportLink<Slice>(selector: (state: ViewportLinkState) => Slice): Slice {
    return useStore(viewportLink.store, selector);
}
