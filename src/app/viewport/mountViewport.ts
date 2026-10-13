import { NgneViewport } from "../../engine/NgneViewport";
import type { DeviceSize, ViewportProbe } from "../../engine/NgneViewport";
import type {} from "../../import-meta";
import type { CompositeCache } from "../../core/composite";
import { connectViewport } from "./viewportController";
import type { ViewportTheme } from "./viewportController";

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The viewport on screen (SE-011): counters, canvas readback, upload scripting. */
        viewport?: ViewportProbe;
    }
}

export interface MountViewportOptions {
    /** A renderer problem to show the user, once per distinct message. */
    onError?(message: string): void;
    /** The viewport element's size in device pixels changed. */
    onResize?(size: DeviceSize): void;
}

/** The editing viewport of the app, mounted in an element and following the stores. */
export interface MountedViewport {
    setTheme(theme: ViewportTheme): void;
    /** The viewport element's size in device pixels: the canvas backing size. */
    readonly deviceSize: DeviceSize;
    /** The composite cache of the active document; null while none is open. */
    readonly composites: CompositeCache | null;
    dispose(): void;
}

/**
 * Creates the NGNE viewport inside `host` and connects it to the session, history and
 * preference stores. `host` must be an empty, positioned element; the viewport fills it with
 * its canvas. In development builds the viewport's probe is put on `window.__ngneTest`.
 */
export function mountViewport(
    host: HTMLElement,
    options: MountViewportOptions = {},
): MountedViewport {
    const viewport = new NgneViewport(host, {
        onError: (message) => options.onError?.(message),
        onResize: (size) => options.onResize?.(size),
    });
    const connection = connectViewport(viewport);
    const hooks = import.meta.env.DEV ? window.__ngneTest : undefined;
    if (hooks) hooks.viewport = viewport.probe;

    return {
        setTheme: (theme) => connection.setTheme(theme),
        get deviceSize() {
            return viewport.deviceSize;
        },
        get composites() {
            return connection.composites;
        },
        dispose() {
            if (hooks?.viewport === viewport.probe) delete hooks.viewport;
            connection.dispose();
            viewport.dispose();
        },
    };
}
