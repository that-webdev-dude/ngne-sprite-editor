import { SprayCan } from "lucide-react";
import { clonePixelBuffer } from "../../../core/pixels";
import {
    SPRAY_MAX_DENSITY,
    SPRAY_MAX_RADIUS,
    SPRAY_MIN_DENSITY,
    SPRAY_MIN_RADIUS,
    SprayStroke,
} from "../../../core/raster";
import type { Rect } from "../../../core/model";
import { BRUSH_SHAPE, BRUSH_SIZE, INK, OPACITY, paintCursor } from "../brush/brushOptions";
import { paintStrokeOptions } from "../brush/strokeOptions";
import type { NumberToolOption, ToolContext, ToolOptionValue, ToolSpec } from "../types";

// The spray (SPEC §7.1, SE-065): dots of the brush scattered over a disk around the pointer's
// path (`core/raster/spray.ts`), the left button in the foreground colour and the right in the
// background colour, with the ink and opacity chosen. Each stroke takes a seed of its own for
// the dots, from the seed source the tool is made with, so a stroke is drawn the same for the
// same seed and samples; the stroke is one undo step, and undo and redo put back the very
// pixels it wrote. A variant of the eraser's rail slot (Shift+B), whose keys have other
// letters, so B keeps the pencil (DESIGN §5.1).

/** The disk the dots fall in: its radius, in pixels. */
export const SPRAY_RADIUS: NumberToolOption = {
    kind: "number",
    key: "radius",
    label: "Radius",
    min: SPRAY_MIN_RADIUS,
    max: SPRAY_MAX_RADIUS,
    unit: "px",
    default: 8,
};

/** The share of the area under the spray that the dots fall on, in percent. */
export const SPRAY_DENSITY: NumberToolOption = {
    kind: "number",
    key: "density",
    label: "Density",
    min: SPRAY_MIN_DENSITY,
    max: SPRAY_MAX_DENSITY,
    unit: "%",
    default: 20,
};

/** Where the spray's strokes take their seeds. */
export interface SpraySeeds {
    /** The seed of the next stroke: any number, taken as an unsigned 32-bit integer. */
    next(): number;
}

/** A whole number within `option`'s range: a typed fraction counts as its nearest value. */
function whole(option: NumberToolOption, value: ToolOptionValue | undefined): number {
    const number = typeof value === "number" && Number.isFinite(value) ? value : option.default;
    return Math.min(option.max, Math.max(option.min, Math.round(number)));
}

function report(context: ToolContext, changed: Rect | null): void {
    if (changed) context.paint?.markDirty(changed);
}

/** The spray tool, its strokes seeded from `seeds`. */
export function createSprayTool(seeds: SpraySeeds): ToolSpec {
    const strokes = new WeakMap<ToolContext, SprayStroke>();
    return {
        id: "spray",
        label: "Spray",
        icon: SprayCan,
        shortcut: "Shift+B",
        variantOf: "eraser",
        railOrder: 111,
        paints: true,
        options: [BRUSH_SIZE, BRUSH_SHAPE, SPRAY_RADIUS, SPRAY_DENSITY, INK, OPACITY],
        cursor: paintCursor,
        onDown(context, pointer) {
            const { paint, options: values } = context;
            if (!paint) return;
            // The image as the stroke found it, which the ink reads.
            const stroke = new SprayStroke(paint.image, clonePixelBuffer(paint.image), {
                ...paintStrokeOptions(context),
                radius: whole(SPRAY_RADIUS, values[SPRAY_RADIUS.key]),
                density: whole(SPRAY_DENSITY, values[SPRAY_DENSITY.key]),
                seed: seeds.next(),
            });
            strokes.set(context, stroke);
            report(context, stroke.start(pointer.pixel));
        },
        onMove(context, pointer) {
            const stroke = strokes.get(context);
            if (stroke) report(context, stroke.to(pointer.pixel));
        },
        onUp(context, pointer) {
            const stroke = strokes.get(context);
            if (!stroke) return;
            strokes.delete(context);
            report(context, stroke.to(pointer.pixel));
        },
        onCancel(context) {
            strokes.delete(context);
        },
    };
}
