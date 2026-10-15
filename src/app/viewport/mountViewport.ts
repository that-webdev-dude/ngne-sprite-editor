import { NgneViewport } from "../../engine/NgneViewport";
import type { ViewportProbe } from "../../engine/NgneViewport";
import type {} from "../../import-meta";
import { appViewportSources, connectViewport } from "./viewportController";
import type { ViewportTheme } from "./viewportController";
import { viewportLink } from "./viewportLink";

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The viewport on screen (SE-011): counters, canvas readback, upload scripting. */
        viewport?: ViewportProbe;
    }
}

export interface MountViewportOptions {
    /** A renderer problem to show the user, once per distinct message. */
    onError?(message: string): void;
}

/** The editing viewport of the app, mounted in an element and following the stores. */
export interface MountedViewport {
    setTheme(theme: ViewportTheme): void;
    dispose(): void;
}

/**
 * Creates the NGNE viewport inside `host` and connects it to the session, composite and
 * preference stores. `host` must be an empty, positioned element; the viewport fills it with
 * its canvas. The viewport registers with `viewportLink`, through which other modules read
 * its size and reach its `invalidate`. In development builds its probe is put on
 * `window.__ngneTest`.
 */
export function mountViewport(
    host: HTMLElement,
    options: MountViewportOptions = {},
): MountedViewport {
    const viewport: NgneViewport = new NgneViewport(host, {
        onError: (message) => options.onError?.(message),
        onResize: (size) => linked.resize(size),
        // Readers of the link learn which pixels are on screen (the stroke echo, SE-015).
        onDrawn: (frame) => linked.drawn(frame),
    });
    const linked = viewportLink.mount(viewport, viewport.deviceSize);
    // The checkerboard goes to the link too, as the viewport is told it.
    const connection = connectViewport(viewport, {
        ...appViewportSources(),
        checker: (checker) => linked.checker(checker),
    });
    const hooks = import.meta.env.DEV ? window.__ngneTest : undefined;
    if (hooks) hooks.viewport = viewport.probe;

    return {
        setTheme: (theme) => connection.setTheme(theme),
        dispose() {
            if (hooks?.viewport === viewport.probe) delete hooks.viewport;
            connection.dispose();
            linked.unmount();
            viewport.dispose();
        },
    };
}
