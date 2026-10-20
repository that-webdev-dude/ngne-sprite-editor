import type { OverlayLayer } from "../overlay/types";
import { activeDocument, sessionsStore } from "../state/sessions";
import { axisGeometry } from "./axisGeometry";
import type { DeviceRect } from "../../engine/viewport/geometry";

// The symmetry axes (SPEC §6.3: the overlay draws them; SE-062): while the active document
// has symmetry on, each axis is a line across the document with a handle at each end, outside
// the document, which a press drags (`axisDrag.ts`). Two tones so they show on any content,
// as the transform box's (SE-033): a white line of 1 device pixel on a black one of 3, and
// white handles with a black border. Over the grids (200, 300), under the ants (500) and the
// brush cursor (900). Tiled mode does not repeat them: they belong to the document.

/** Order of the layer in the overlay's stack. */
export const SYMMETRY_AXES_ORDER = 400;

const DARK = "rgb(0 0 0)";
const LIGHT = "rgb(255 255 255)";

/** Fills the parts of `rects` on a canvas of `size`; nothing outside it is drawn. */
function fill(
    context: CanvasRenderingContext2D,
    rects: readonly DeviceRect[],
    style: string,
    size: { width: number; height: number },
) {
    context.fillStyle = style;
    context.beginPath();
    let any = false;
    for (const rect of rects) {
        const x = Math.max(0, rect.x);
        const y = Math.max(0, rect.y);
        const right = Math.min(size.width, rect.x + rect.width);
        const bottom = Math.min(size.height, rect.y + rect.height);
        if (right <= x || bottom <= y) continue;
        context.rect(x, y, right - x, bottom - y);
        any = true;
    }
    if (any) context.fill();
}

/** The active document's symmetry as a key: what the layer draws from besides the view. */
function symmetryKey(): string | null {
    const document = activeDocument(sessionsStore.getState());
    if (!document) return null;
    const { mode, axisX, axisY } = document.session.doc.settings.symmetry;
    return `${mode}:${axisX}:${axisY}`;
}

export const overlayLayers: OverlayLayer[] = [
    {
        id: "symmetry-axes",
        order: SYMMETRY_AXES_ORDER,
        draw({ context, document, mapping, size }) {
            const { symmetry } = document.session.doc.settings;
            if (symmetry.mode === "none") return;
            const { lines, handles } = axisGeometry(mapping, symmetry, size);
            // The dark line one pixel wider on each side, under the light one.
            fill(
                context,
                lines.map(({ axis, rect }) =>
                    axis === "x"
                        ? { x: rect.x - 1, y: rect.y, width: 3, height: rect.height }
                        : { x: rect.x, y: rect.y - 1, width: rect.width, height: 3 },
                ),
                DARK,
                size,
            );
            fill(
                context,
                lines.map((line) => line.rect),
                LIGHT,
                size,
            );
            fill(
                context,
                handles.map((handle) => handle.rect),
                DARK,
                size,
            );
            fill(
                context,
                handles.map(({ rect }) => ({
                    x: rect.x + 1,
                    y: rect.y + 1,
                    width: rect.width - 2,
                    height: rect.height - 2,
                })),
                LIGHT,
                size,
            );
        },
        watch(redraw) {
            let seen = symmetryKey();
            return sessionsStore.subscribe(() => {
                const next = symmetryKey();
                if (next === seen) return;
                seen = next;
                redraw();
            });
        },
    },
];
