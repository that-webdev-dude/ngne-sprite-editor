import { useEffect, useLayoutEffect } from "react";
import type { ReactNode } from "react";
import { inertOutsideModalLayers } from "./focus/inertOutside";
import { trackFocusModality } from "./focus/modality";
import { TooltipProvider } from "./primitives/Tooltip";
import { useTheme } from "./theme/theme";
import { ToastViewport } from "./toast/ToastViewport";
import "./styles/tokens.css";
import "./styles/base.css";

/**
 * Everything the primitives need above them: tokens and base styles, the theme mirrored to
 * `<html data-theme>`, focus-modality tracking, `inert` outside modal layers, the tooltip
 * provider and the toast viewport.
 * Rendered once at the root of the app (and of any test page that mounts interface code).
 */
export function UiRoot({ children }: { children: ReactNode }) {
    const theme = useTheme();
    // A layout effect: the theme is on the page in the same frame as the first render.
    useLayoutEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);
    useEffect(() => trackFocusModality(), []);
    useEffect(() => inertOutsideModalLayers(), []);
    return (
        <TooltipProvider>
            {children}
            <ToastViewport />
        </TooltipProvider>
    );
}
