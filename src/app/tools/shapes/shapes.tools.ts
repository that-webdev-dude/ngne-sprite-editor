import { BRUSH_SHAPE, BRUSH_SIZE, INK, OPACITY } from "../brush/brushOptions";
import type { ToolSpec } from "../types";
import { FILLED, shapeTool } from "./shapeTool";

// The line, rectangle and ellipse tools (SPEC §7.1, SE-017). Their rail slots, keys (L, U,
// Shift+U) and icons are planned in `planned.tools.ts`. Each keeps its own option values
// (SPEC §7.1: options per tool id): the brush's size and shape, Filled for the closed shapes,
// ink and opacity.

export const lineTool: ToolSpec = shapeTool({
    id: "line",
    label: "Line",
    kind: "line",
    options: [BRUSH_SIZE, BRUSH_SHAPE, INK, OPACITY],
    hint: "Shift: 45° steps · Ctrl: from the centre",
});

export const rectangleTool: ToolSpec = shapeTool({
    id: "rectangle",
    label: "Rectangle",
    kind: "rectangle",
    options: [BRUSH_SIZE, BRUSH_SHAPE, FILLED, INK, OPACITY],
    hint: "Shift: square · Ctrl: from the centre",
});

export const ellipseTool: ToolSpec = shapeTool({
    id: "ellipse",
    label: "Ellipse",
    kind: "ellipse",
    options: [BRUSH_SIZE, BRUSH_SHAPE, FILLED, INK, OPACITY],
    hint: "Shift: circle · Ctrl: from the centre",
});

export const tools: ToolSpec[] = [lineTool, rectangleTool, ellipseTool];
