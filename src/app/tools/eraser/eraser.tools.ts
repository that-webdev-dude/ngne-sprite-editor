import { eraseInk, paintInk } from "../../../core/raster";
import { BRUSH_SHAPE, BRUSH_SIZE, OPACITY, opacityOf, PIXEL_PERFECT } from "../brush/brushOptions";
import { freehandTool } from "../brush/freehandTool";
import type { ToolSpec } from "../types";

// The eraser (SPEC §7.1): freehand strokes with the brush. The left button makes pixels
// transparent (at an opacity below 255 their alpha falls by it); the right button erases to
// the background colour, composited over the pixels at the opacity, as erasing on an opaque
// background would show it. It has no ink option. Its rail slot, key (E) and icon are planned
// in `planned.tools.ts`.

export const eraserTool: ToolSpec = freehandTool({
    id: "eraser",
    label: "Eraser",
    options: [BRUSH_SIZE, BRUSH_SHAPE, PIXEL_PERFECT, OPACITY],
    ink: (context) =>
        context.button === "primary"
            ? eraseInk(opacityOf(context.options))
            : paintInk("alpha", context.colour, opacityOf(context.options)),
});

export const tools: ToolSpec[] = [eraserTool];
