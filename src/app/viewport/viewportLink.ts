import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { DeviceSize, ViewportChecker, ViewportPort } from "../../engine/viewport/types";

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

/** A frame the viewport submitted: the frame key it drew and the version of its pixels. */
export interface DrawnFrame {
    key: string;
    /** `ViewportLink.version` when the pixels were read; undefined when none was given. */
    version: number | undefined;
}

/** What a mounted viewport gets back when it registers. */
export interface ViewportMount {
    /** The viewport element's size in device pixels changed. */
    resize(size: DeviceSize): void;
    /** The viewport submitted a frame (null: one without a frame image). */
    drawn(frame: DrawnFrame | null): void;
    /** The checkerboard the viewport draws behind the document. */
    checker(checker: ViewportChecker): void;
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
     * A number raised whenever the pixels the viewport reads change outside a history step: a
     * live stroke compositing into the cache's buffer (SE-015). The viewport reads it with
     * the pixels of every upload and reports it with each frame it draws from them
     * (`onDrawn`), so a change made at version `v` is on screen once a frame of version `v`
     * or later has been drawn.
     */
    readonly version: number;
    /** Raises `version` and returns it. */
    nextVersion(): number;
    /** Calls `listener` after each frame the mounted viewport submits. Returns its remover. */
    onDrawn(listener: (frame: DrawnFrame | null) => void): () => void;
    /** The checkerboard the mounted viewport draws behind the document; null while none is. */
    readonly checker: ViewportChecker | null;
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
    let version = 0;
    let checker: ViewportChecker | null = null;
    const drawnListeners = new Set<(frame: DrawnFrame | null) => void>();

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
        get version() {
            return version;
        },
        nextVersion: () => ++version,
        onDrawn(listener) {
            drawnListeners.add(listener);
            return () => {
                drawnListeners.delete(listener);
            };
        },
        get checker() {
            return checker;
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
                drawn(frame) {
                    if (current !== viewport) return;
                    for (const listener of [...drawnListeners]) listener(frame);
                },
                checker(next) {
                    if (current === viewport) checker = { ...next };
                },
                unmount() {
                    // A viewport mounted since stays registered.
                    if (current !== viewport) return;
                    current = null;
                    checker = null;
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
