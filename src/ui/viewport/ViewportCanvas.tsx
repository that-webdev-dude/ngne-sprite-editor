import { useEffect, useRef } from "react";
import { mountViewport } from "../../app/viewport/mountViewport";
import type { MountedViewport } from "../../app/viewport/mountViewport";
import { DEFAULT_VIEWPORT_THEME } from "../../app/viewport/viewportController";
import type { ViewportTheme } from "../../app/viewport/viewportController";
import { parseHexColour } from "../preferences/hexColour";
import { useTheme } from "../theme/theme";
import { toast } from "../toast/toast";
import "./viewport.css";

/** The colours the viewport takes from the theme (DESIGN §3.1, §6), read from its tokens. */
function readViewportTheme(): ViewportTheme {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: number) =>
        parseHexColour(style.getPropertyValue(name)) ?? fallback;
    return {
        checkerA: token("--check-a", DEFAULT_VIEWPORT_THEME.checkerA),
        checkerB: token("--check-b", DEFAULT_VIEWPORT_THEME.checkerB),
        workspace: token("--bg-workspace", DEFAULT_VIEWPORT_THEME.workspace),
    };
}

/**
 * The editing viewport of the active document (DESIGN §6): an element that the NGNE viewport
 * fills with its canvas. The canvas draws the workspace colour, the checkerboard and the
 * current frame; the overlay and the pointer handling join it in SE-012 and SE-013.
 */
export function ViewportCanvas() {
    const host = useRef<HTMLDivElement>(null);
    const mounted = useRef<MountedViewport | null>(null);
    const theme = useTheme();

    useEffect(() => {
        if (!host.current) return;
        const viewport = mountViewport(host.current, {
            // DESIGN §4: an asynchronous failure is reported by a toast.
            onError: (message) => toast.error(`Viewport: ${message}`),
        });
        mounted.current = viewport;
        return () => {
            mounted.current = null;
            viewport.dispose();
        };
    }, []);

    // After the effect above, and after `UiRoot` has put the theme on the page (a layout
    // effect): the tokens read here are those of `theme`.
    useEffect(() => {
        mounted.current?.setTheme(readViewportTheme());
    }, [theme]);

    return <div ref={host} className="viewport-canvas" data-viewport-canvas="" />;
}
