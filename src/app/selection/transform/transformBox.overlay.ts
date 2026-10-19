import type { FreeTransform } from "../../../core/floating";
import type { StoreApi } from "zustand/vanilla";
import type {} from "../../../import-meta";
import type { OverlayLayer } from "../../overlay/types";
import type { ViewMapping } from "../../view/coordinates";
import { floatingState } from "../floatingState";
import type { FloatShown } from "../floatingState";
import { boxOutline, HANDLE_SIZE, handlePoints } from "./handles";

// The transform box of a floating selection (SE-033; DESIGN §5.2, §6): its outline, turned
// as the float is, and its eight handles, drawn on the overlay while a selection floats. Over
// the ants and the pending selection (500, 600), under the brush cursor (900). The outline is
// a white line of 1 device pixel on a black one of 3, the handles white squares with a black
// border, so both show on any content, as the brush cursor's two tones do. `drawTransformBox`
// draws any box, so a reference layer's (SE-046) can share it.

/** Order of the layer in the overlay's stack. */
export const TRANSFORM_BOX_ORDER = 700;

const DARK = "rgb(0 0 0)";
const LIGHT = "rgb(255 255 255)";

/**
 * Draws the box of `transform` and its handles on `context`, mapped by `mapping` (device
 * pixels; `ratio` device pixels per CSS pixel sizes the handles).
 */
export function drawTransformBox(
    context: CanvasRenderingContext2D,
    mapping: ViewMapping,
    transform: FreeTransform,
    ratio: number,
): void {
    const corners = boxOutline(transform).map((point) => mapping.docToDevice(point.x, point.y));
    context.lineJoin = "miter";
    context.beginPath();
    corners.forEach((point, index) => {
        // Half a device pixel in: a line of 1 px covers whole pixels when the box is not turned.
        const x = Math.round(point.x) - 0.5;
        const y = Math.round(point.y) - 0.5;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    });
    context.closePath();
    context.strokeStyle = DARK;
    context.lineWidth = 3;
    context.stroke();
    context.strokeStyle = LIGHT;
    context.lineWidth = 1;
    context.stroke();

    const size = Math.max(5, Math.round(HANDLE_SIZE * ratio));
    const half = Math.floor(size / 2);
    context.beginPath();
    for (const { point } of handlePoints(transform)) {
        const device = mapping.docToDevice(point.x, point.y);
        context.rect(Math.round(device.x) - half, Math.round(device.y) - half, size, size);
    }
    context.fillStyle = DARK;
    context.fill();
    context.beginPath();
    for (const { point } of handlePoints(transform)) {
        const device = mapping.docToDevice(point.x, point.y);
        context.rect(
            Math.round(device.x) - half + 1,
            Math.round(device.y) - half + 1,
            size - 2,
            size - 2,
        );
    }
    context.fillStyle = LIGHT;
    context.fill();
}

/** The transform-box layer of the float `shown` describes. */
export function createTransformBoxLayer(shown: StoreApi<FloatShown>): OverlayLayer {
    return {
        id: "transform-box",
        order: TRANSFORM_BOX_ORDER,
        draw({ context, document, mapping }) {
            const { session, transform, selects } = shown.getState();
            // A whole cel lifted with no selection is applied at its release: no box.
            if (!transform || !selects || session !== document.session) return;
            drawTransformBox(context, mapping, transform, mapping.frame.ratio);
        },
        watch: (redraw) => shown.subscribe(redraw),
    };
}

export const overlayLayers: OverlayLayer[] = [createTransformBoxLayer(floatingState.shown)];
