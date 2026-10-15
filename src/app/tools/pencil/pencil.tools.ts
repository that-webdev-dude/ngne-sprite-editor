import { paintInk } from "../../../core/raster";
import {
    BRUSH_SHAPE,
    BRUSH_SIZE,
    INK,
    inkOf,
    OPACITY,
    opacityOf,
    PIXEL_PERFECT,
} from "../brush/brushOptions";
import { freehandTool } from "../brush/freehandTool";
import type { ToolSpec } from "../types";

// The pencil (SPEC §7.1): freehand strokes with the brush, the left button in the foreground
// colour and the right in the background colour, with the chosen ink and opacity. The default
// tool of the editor. Its rail slot, key (B) and icon are planned in `planned.tools.ts`.

export const pencilTool: ToolSpec = freehandTool({
    id: "pencil",
    label: "Pencil",
    options: [BRUSH_SIZE, BRUSH_SHAPE, PIXEL_PERFECT, INK, OPACITY],
    ink: (context) => paintInk(inkOf(context.options), context.colour, opacityOf(context.options)),
});

export const tools: ToolSpec[] = [pencilTool];
