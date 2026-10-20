import { clonePixelBuffer } from "../../../core/pixels";
import { ShapeStroke } from "../../../core/raster";
import type { PixelPoint, Shape, ShapeKind } from "../../../core/raster";
import { paintCursor } from "../brush/brushOptions";
import { paintStrokeOptions } from "../brush/strokeOptions";
import type {
    ToggleToolOption,
    ToolContext,
    ToolModifiers,
    ToolOptionSpec,
    ToolPointer,
    ToolSpec,
} from "../types";

// The shape tools (SPEC §7.1, SE-017): line, rectangle and ellipse, drawn as a rubber band
// into the stroke's transaction. The press fixes the first point; every pointer sample, and
// every press or release of Shift or Ctrl while the button is held, draws the whole shape again
// in place of the one before (`ShapeStroke` puts the pixels the new shape leaves back to their
// value at the press and reports them with the new ones), so the preview is the stroke's own
// pixels, shown and echoed as any stroke's. The release keeps the shape drawn last: one undo
// step, or none when it changes nothing; Escape takes it back.
//
// The brush (size and shape of `brushOptions.ts`) is stamped along the outline; a filled
// rectangle or ellipse also covers every pixel inside it, mirrored and wrapped with the
// document's symmetry and tiled mode at the press (SE-062, `paintStrokeOptions`). Modifiers,
// as the pointer or the keyboard reports them at each draw:
//
//   Shift   line: the end snaps to the nearest 45° step; rectangle and ellipse: a square
//           or a circle, as large as the larger side of the drag
//   Ctrl    from the centre: the press is the shape's centre and the drag one corner (a
//           line extends as far the other way)

/** Rectangle and ellipse: outline or filled (DESIGN §5.2, a mode toggle). */
export const FILLED: ToggleToolOption = {
    kind: "toggle",
    key: "filled",
    label: "Filled",
    default: false,
};

/** What a shape tool's module declares. */
export interface ShapeToolSpec {
    id: string;
    label: string;
    kind: ShapeKind;
    /** In the order of the context bar: the brush options, with `FILLED` for a closed shape. */
    options: readonly ToolOptionSpec[];
    /** One-line hint of the modifiers (DESIGN §5.7). */
    hint: string;
}

/** The modifiers a shape reads. */
export interface ShapeModifiers {
    /** Line: 45° steps; rectangle and ellipse: square or circle. */
    readonly shift: boolean;
    /** From the centre. */
    readonly ctrl: boolean;
}

/** −1 for a negative number, 1 otherwise. */
const direction = (value: number) => (value < 0 ? -1 : 1);

/** tan 22.5°: below it from an axis, a line snaps to the axis. */
const TAN_22_5 = Math.SQRT2 - 1;

/**
 * The shape a drag from `start` (the press) to `end` (the pointer) makes with `modifiers`:
 * a line from `start` to `end`, or the shape that fits the rectangle of the two as corners.
 * With Shift a line's end snaps to the nearest of the eight 45° directions, an axis when the
 * drag lies within 22.5° of it and otherwise a diagonal as long as the drag's larger side; a
 * rectangle or an ellipse becomes a square or a circle whose side is the drag's larger one,
 * towards the pointer. With Ctrl `start` is the centre: the shape reaches as far on its other
 * side.
 */
export function dragShape(
    kind: ShapeKind,
    start: PixelPoint,
    end: PixelPoint,
    modifiers: ShapeModifiers,
    filled: boolean,
): Shape {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    if (modifiers.shift) {
        const across = Math.abs(dx);
        const down = Math.abs(dy);
        if (kind === "line" && down <= across * TAN_22_5) {
            dy = 0;
        } else if (kind === "line" && across <= down * TAN_22_5) {
            dx = 0;
        } else {
            const side = Math.max(across, down);
            dx = direction(dx) * side;
            dy = direction(dy) * side;
        }
    }
    const to = { x: start.x + dx, y: start.y + dy };
    const from = modifiers.ctrl ? { x: start.x - dx, y: start.y - dy } : { x: start.x, y: start.y };
    return { kind, from, to, filled: kind !== "line" && filled };
}

interface Drag {
    readonly stroke: ShapeStroke;
    readonly start: PixelPoint;
    readonly filled: boolean;
    end: PixelPoint;
    modifiers: ShapeModifiers;
}

/** The drag in progress, by the context of its stroke. */
const drags = new WeakMap<ToolContext, Drag>();

function modifiersOf(modifiers: Readonly<ToolModifiers>): ShapeModifiers {
    return { shift: modifiers.shift, ctrl: modifiers.ctrl };
}

/** A shape tool. */
export function shapeTool(spec: ShapeToolSpec): ToolSpec {
    const draw = (context: ToolContext, drag: Drag) => {
        const shape = dragShape(spec.kind, drag.start, drag.end, drag.modifiers, drag.filled);
        const changed = drag.stroke.draw(shape);
        if (changed) context.paint?.markDirty(changed);
    };
    const follow = (context: ToolContext, pointer: ToolPointer) => {
        const drag = drags.get(context);
        if (!drag) return;
        drag.end = { x: pointer.pixel.x, y: pointer.pixel.y };
        drag.modifiers = modifiersOf(pointer.modifiers);
        draw(context, drag);
    };

    return {
        id: spec.id,
        label: spec.label,
        paints: true,
        hint: spec.hint,
        options: spec.options,
        cursor: paintCursor,
        onDown(context, pointer) {
            const { paint, options: values } = context;
            if (!paint) return;
            // The image as the stroke found it: the inks read it, and each draw puts back
            // from it what the previous one covered.
            const original = clonePixelBuffer(paint.image);
            const stroke = new ShapeStroke(paint.image, original, paintStrokeOptions(context));
            const start = { x: pointer.pixel.x, y: pointer.pixel.y };
            const drag: Drag = {
                stroke,
                start,
                filled: values[FILLED.key] === true,
                end: start,
                modifiers: modifiersOf(pointer.modifiers),
            };
            drags.set(context, drag);
            draw(context, drag);
        },
        onMove: follow,
        onUp(context, pointer) {
            follow(context, pointer);
            drags.delete(context);
        },
        onKey(context, key) {
            if (key.key !== "Shift" && key.key !== "Ctrl") return false;
            const drag = drags.get(context);
            if (!drag) return false;
            drag.modifiers = modifiersOf(key.modifiers);
            draw(context, drag);
            return true;
        },
        onCancel(context) {
            drags.delete(context);
        },
    };
}
