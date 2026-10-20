import type { TiledMode } from "../../core/model";
import type { DeviceRect } from "../../engine/viewport/geometry";
import { activeDocument, sessionsStore } from "../state/sessions";
import { fillRects } from "./draw";
import { outlineRects } from "./gridLines";
import type { OverlayLayer } from "./types";

// The document outline (DESIGN §6): 1 device pixel of `--border-strong` just outside the
// document's bounds. On an axis tiled mode repeats (SE-062) the sides across it are left out,
// so the seams between the document and its copies show as the copies' own pixels; it then
// follows the active document's tiled mode as well as the view and the theme.

/** The outline of `rect` without the sides that face a copy in tiled mode `tiled`. */
export function tiledOutlineRects(rect: DeviceRect, tiled: TiledMode): DeviceRect[] {
    const [top, bottom, left, right] = outlineRects(rect);
    const acrossX = tiled === "x" || tiled === "both";
    const acrossY = tiled === "y" || tiled === "both";
    const rects: DeviceRect[] = [];
    if (!acrossY) {
        // Without the corners, which lie over the copies left and right.
        const span = acrossX ? { x: rect.x, width: rect.width } : {};
        rects.push({ ...top!, ...span }, { ...bottom!, ...span });
    }
    if (!acrossX) rects.push(left!, right!);
    return rects;
}

const tiledOf = () =>
    activeDocument(sessionsStore.getState())?.session.doc.settings.tiled ?? "none";

export const overlayLayers: OverlayLayer[] = [
    {
        id: "document-outline",
        order: 100,
        draw({ context, document, mapping, theme }) {
            const { tiled } = document.session.doc.settings;
            fillRects(context, tiledOutlineRects(mapping.rect, tiled), theme.outline);
        },
        watch(redraw) {
            let seen = tiledOf();
            return sessionsStore.subscribe(() => {
                const next = tiledOf();
                if (next === seen) return;
                seen = next;
                redraw();
            });
        },
    },
];
