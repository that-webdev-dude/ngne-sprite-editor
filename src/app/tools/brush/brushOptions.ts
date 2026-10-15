import { BRUSH_MAX_SIZE, BRUSH_MIN_SIZE, createBrush } from "../../../core/raster";
import type { Brush, BrushShape, InkKind } from "../../../core/raster";
import type {
    ChoiceToolOption,
    NumberToolOption,
    ToggleToolOption,
    Tool,
    ToolCursorState,
    ToolOptionValue,
} from "../types";

// The brush options of the paint tools (SPEC §7.1, SE-015): brush size, brush shape,
// pixel-perfect, ink and opacity. Every tool that paints with a brush lists these same option
// specs (the pencil and the eraser here, the shape tools of SE-017), in the order of the
// context bar (DESIGN §5.2: size · shape · mode toggles · ink · opacity). Their values are
// kept per tool, as Aseprite keeps them: the eraser remembers its own size and the pencil its
// own (SPEC §7.1, tool options are stored per tool id).
//
// A tool whose options include `BRUSH_SIZE` and `BRUSH_SHAPE` has a brush: the overlay draws
// its footprint under the pointer (`brushCursor.overlay.ts`).

export const BRUSH_SIZE: NumberToolOption = {
    kind: "number",
    key: "size",
    label: "Size",
    min: BRUSH_MIN_SIZE,
    max: BRUSH_MAX_SIZE,
    unit: "px",
    default: 1,
};

export const BRUSH_SHAPE: ChoiceToolOption = {
    kind: "choice",
    key: "shape",
    label: "Shape",
    choices: [
        { value: "circle", label: "Circle" },
        { value: "square", label: "Square" },
    ],
    default: "circle",
};

export const PIXEL_PERFECT: ToggleToolOption = {
    kind: "toggle",
    key: "pixelPerfect",
    label: "Pixel-perfect",
    default: false,
};

export const INK: ChoiceToolOption = {
    kind: "choice",
    key: "ink",
    label: "Ink",
    display: "select",
    choices: [
        { value: "simple", label: "Simple" },
        { value: "alpha", label: "Alpha compositing" },
        { value: "lockAlpha", label: "Lock alpha" },
    ],
    default: "simple",
};

export const OPACITY: NumberToolOption = {
    kind: "number",
    key: "opacity",
    label: "Opacity",
    min: 0,
    max: 255,
    default: 255,
};

/** Whether `tool` paints with a brush: its options include the brush's size and shape. */
export function hasBrush(tool: Pick<Tool, "options">): boolean {
    return tool.options.includes(BRUSH_SIZE) && tool.options.includes(BRUSH_SHAPE);
}

/** A whole number within `option`'s range: a typed fraction counts as its nearest value. */
function whole(option: NumberToolOption, value: ToolOptionValue | undefined): number {
    const number = typeof value === "number" && Number.isFinite(value) ? value : option.default;
    return Math.min(option.max, Math.max(option.min, Math.round(number)));
}

const brushes = new Map<string, Brush>();

/** The brush that a tool's option values describe. */
export function brushOf(values: Readonly<Record<string, ToolOptionValue>>): Brush {
    const size = whole(BRUSH_SIZE, values[BRUSH_SIZE.key]);
    const shape: BrushShape = values[BRUSH_SHAPE.key] === "square" ? "square" : "circle";
    const key = `${shape}:${size}`;
    let brush = brushes.get(key);
    if (!brush) {
        brush = createBrush(shape, size);
        brushes.set(key, brush);
    }
    return brush;
}

/** The opacity a tool's option values set, 0..255. */
export function opacityOf(values: Readonly<Record<string, ToolOptionValue>>): number {
    return whole(OPACITY, values[OPACITY.key]);
}

/** The ink a tool's option values name. */
export function inkOf(values: Readonly<Record<string, ToolOptionValue>>): InkKind {
    const ink = values[INK.key];
    return ink === "alpha" || ink === "lockAlpha" ? ink : "simple";
}

/**
 * The cursor of a paint tool (DESIGN §6): none over the document, where the overlay draws the
 * brush's outline instead; a crosshair over the rest of the viewport.
 */
export function paintCursor({ overDocument }: ToolCursorState): string {
    return overDocument ? "none" : "crosshair";
}
