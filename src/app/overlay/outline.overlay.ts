import { fillRects } from "./draw";
import { outlineRects } from "./gridLines";
import type { OverlayLayer } from "./types";

// The document outline (DESIGN §6): 1 device pixel of `--border-strong` just outside the
// document's bounds. It follows the view and the theme only, so it needs no `watch`.

export const overlayLayers: OverlayLayer[] = [
    {
        id: "document-outline",
        order: 100,
        draw({ context, mapping, theme }) {
            fillRects(context, outlineRects(mapping.rect), theme.outline);
        },
    },
];
