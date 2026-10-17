import { Spline } from "lucide-react";
import { clonePixelBuffer } from "../../../core/pixels";
import { ShapeStroke } from "../../../core/raster";
import type { PixelPoint } from "../../../core/raster";
import { BRUSH_SHAPE, BRUSH_SIZE, INK, OPACITY, paintCursor } from "../brush/brushOptions";
import { paintStrokeOptions } from "../brush/strokeOptions";
import type { ToolContext, ToolPointer, ToolSpec } from "../types";

// The curve (SPEC §7.1, SE-065): a cubic Bézier drawn with the brush, in Aseprite's flow of a
// drag and two clicks — one gesture of three presses (`ToolContext.openGesture`; the keymap's
// `gesture` context, SPEC §7.8), one undo step:
//
//   press, drag, release   the press fixes the start and the drag moves the end; both
//                          control points lie on the end, so the curve is a straight line
//   move, click            the pointer moves both control points; the release fixes the first
//   move, click            the pointer moves the second; the release fixes it and keeps the
//                          curve (`ToolContext.closeGesture`)
//
// A press and its drag move what the pointer moved before the press. Enter or a double click
// keeps the curve as it is shown; Escape, a pointer cancel during a press, a change of tool or
// document takes it back (the Space and Alt holds do nothing meanwhile). The curve is a rubber
// band (`ShapeStroke`, as the line's): each change draws it again from the image as the first
// press found it, with the options read at that press. A variant of the ellipse's rail slot
// (Shift+L), whose keys have other letters, so L keeps the line (DESIGN §5.1).

/** The status-bar hint of the curve. */
export const CURVE_HINT =
    "Drag from end to end, then click each control point · Enter or double-click: keep";

/** What the pointer moves: the end, both control points, or the second. */
type Phase = "end" | "controls" | "second";

interface Curve {
    readonly stroke: ShapeStroke;
    readonly start: PixelPoint;
    end: PixelPoint;
    first: PixelPoint;
    second: PixelPoint;
    phase: Phase;
}

/** The curve in progress, by the context of its stroke. */
const curves = new WeakMap<ToolContext, Curve>();

/** The points of the curve: start, first control, second control, end. */
export function curvePoints(curve: Pick<Curve, "start" | "first" | "second" | "end">) {
    return [curve.start, curve.first, curve.second, curve.end];
}

function draw(context: ToolContext, curve: Curve): void {
    const changed = curve.stroke.draw({ kind: "curve", points: curvePoints(curve) });
    if (changed) context.paint?.markDirty(changed);
}

/** The pointer at `pixel`: it moves what the phase gives it. */
function follow(context: ToolContext, pointer: ToolPointer): void {
    const curve = curves.get(context);
    if (!curve) return;
    const pixel = { x: pointer.pixel.x, y: pointer.pixel.y };
    switch (curve.phase) {
        case "end":
            curve.end = curve.first = curve.second = pixel;
            break;
        case "controls":
            curve.first = curve.second = pixel;
            break;
        case "second":
            curve.second = pixel;
            break;
    }
    draw(context, curve);
}

export const curveTool: ToolSpec = {
    id: "curve",
    label: "Curve",
    icon: Spline,
    shortcut: "Shift+L",
    variantOf: "ellipse",
    railOrder: 221,
    paints: true,
    hint: CURVE_HINT,
    options: [BRUSH_SIZE, BRUSH_SHAPE, INK, OPACITY],
    cursor: paintCursor,
    onDown(context, pointer) {
        const { paint } = context;
        if (!paint) return;
        if (curves.has(context)) {
            follow(context, pointer);
            return;
        }
        // The image as the first press found it: the ink reads it, and each draw puts back
        // from it what the previous one covered.
        const stroke = new ShapeStroke(
            paint.image,
            clonePixelBuffer(paint.image),
            paintStrokeOptions(context),
        );
        const start = { x: pointer.pixel.x, y: pointer.pixel.y };
        const curve: Curve = {
            stroke,
            start,
            end: start,
            first: start,
            second: start,
            phase: "end",
        };
        curves.set(context, curve);
        context.openGesture();
        draw(context, curve);
    },
    onMove: follow,
    onHover: follow,
    onUp(context, pointer) {
        follow(context, pointer);
        const curve = curves.get(context);
        if (!curve) return;
        if (curve.phase === "end") curve.phase = "controls";
        else if (curve.phase === "controls") curve.phase = "second";
        else context.closeGesture();
    },
    onClose(context) {
        curves.delete(context);
    },
    onCancel(context) {
        curves.delete(context);
    },
};

export const tools: ToolSpec[] = [curveTool];
