import type {} from "../../../import-meta";
import type { ToolContext, ToolPointer, ToolSpec } from "../types";

// Development only (SE-014): the "dot" tool writes one pixel per pointer sample, in the colour
// of the button (foreground or background) with its alpha scaled by the Alpha option. It
// exercises the pointer pipeline and the live-stroke path until the pencil exists, and has no
// rail slot and no key: tests select it through the editor store, developers from the command
// palette. SE-015 deletes this folder.

function writeDot(context: ToolContext, pointer: ToolPointer): void {
    const { paint } = context;
    if (!paint || !pointer.inside) return;
    const { x, y } = pointer.pixel;
    const { data, width } = paint.image;
    const at = (y * width + x) * 4;
    const alpha = Number(context.options.alpha);
    data[at] = context.colour >>> 24;
    data[at + 1] = (context.colour >>> 16) & 0xff;
    data[at + 2] = (context.colour >>> 8) & 0xff;
    data[at + 3] = Math.round(((context.colour & 0xff) * alpha) / 255);
    paint.markDirty({ x, y, width: 1, height: 1 });
}

export const dotTool: ToolSpec = {
    id: "dot",
    label: "Dot",
    paints: true,
    cursor: "crosshair",
    options: [{ kind: "number", key: "alpha", label: "Alpha", min: 0, max: 255, default: 255 }],
    onDown: writeDot,
    onMove: writeDot,
};

export const tools: ToolSpec[] = import.meta.env.DEV ? [dotTool] : [];
