import { useEffect, useRef } from "react";
import { mountOverlay } from "../../app/overlay/mountOverlay";
import type { MountedOverlay } from "../../app/overlay/mountOverlay";
import { DEFAULT_OVERLAY_THEME } from "../../app/overlay/types";
import type { OverlayTheme } from "../../app/overlay/types";
import { attachToolPointer } from "../../app/tools/attachToolPointer";
import { parseHexColour } from "../preferences/hexColour";
import { useTheme } from "../theme/theme";
import type { Theme } from "../theme/theme";
import "./overlay.css";

/** Grid ink of DESIGN §6: white lines in the dark theme, black lines in the light one. */
const INK: Record<Theme, number> = { dark: 0xffffff, light: 0x000000 };

/** The colours the overlay takes from the theme (DESIGN §3.1, §6). */
function readOverlayTheme(theme: Theme): OverlayTheme {
    const style = getComputedStyle(document.documentElement);
    return {
        outline:
            parseHexColour(style.getPropertyValue("--border-strong")) ??
            DEFAULT_OVERLAY_THEME.outline,
        ink: INK[theme],
    };
}

/**
 * The overlay canvas of the viewport (SPEC §6.3, SE-013): stacked over the NGNE canvas at the
 * same backing size and box, it draws the editor's chrome and is the pointer target of the
 * viewport. It is the second child of the viewport element, beside the element NGNE fills
 * (never inside it: NGNE replaces its canvas there). The tools take their pointer input from
 * it (SE-014).
 */
export function OverlayCanvas() {
    const canvas = useRef<HTMLCanvasElement>(null);
    const mounted = useRef<MountedOverlay | null>(null);
    const theme = useTheme();

    useEffect(() => {
        const element = canvas.current;
        const container = element?.parentElement;
        // The element NGNE fills, the first child of the viewport element (`ViewportCanvas`).
        const ngne = container?.querySelector<HTMLElement>(":scope > [data-viewport-canvas]");
        if (!element || !container || !ngne) return;
        const overlay = mountOverlay(element, container, ngne);
        mounted.current = overlay;
        // The pointer pipeline of the tools (SE-014) maps strokes as the overlay maps the cursor.
        const detachTools = attachToolPointer(element, container, () => overlay.mapping());
        return () => {
            detachTools();
            mounted.current = null;
            overlay.dispose();
        };
    }, []);

    // After the effect above, and after `UiRoot` has put the theme on the page (a layout
    // effect): the tokens read here are those of `theme`.
    useEffect(() => {
        mounted.current?.setTheme(readOverlayTheme(theme));
    }, [theme]);

    return (
        <canvas
            ref={canvas}
            className="viewport-overlay"
            data-viewport-overlay=""
            // Chrome only; the viewport element is what assistive technology is told about.
            aria-hidden="true"
        />
    );
}
