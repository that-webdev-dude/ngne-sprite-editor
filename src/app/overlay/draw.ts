import type { DeviceRect } from "../../engine/viewport/geometry";

// Small Canvas2D helpers for draw layers (SE-013). Rectangles with whole-pixel edges are
// filled without anti-aliasing, so a line of 1 device pixel covers exactly that pixel.

/** A colour 0xRRGGBB at `alpha` (0..1) as a CSS colour. */
export function cssColour(colour: number, alpha = 1): string {
    const r = (colour >> 16) & 0xff;
    const g = (colour >> 8) & 0xff;
    const b = colour & 0xff;
    return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/**
 * Fills `rects` in one operation: where two of them overlap, the pixel is painted once, so a
 * translucent colour keeps its strength where lines cross.
 */
export function fillRects(
    context: CanvasRenderingContext2D,
    rects: readonly DeviceRect[],
    colour: number,
    alpha = 1,
): void {
    if (rects.length === 0) return;
    context.fillStyle = cssColour(colour, alpha);
    context.beginPath();
    for (const rect of rects) context.rect(rect.x, rect.y, rect.width, rect.height);
    context.fill();
}

/** Restricts what is drawn next to the union of `rects` (until the layer's `restore`). */
export function clipToRects(context: CanvasRenderingContext2D, rects: readonly DeviceRect[]): void {
    context.beginPath();
    for (const rect of rects) context.rect(rect.x, rect.y, rect.width, rect.height);
    context.clip();
}
