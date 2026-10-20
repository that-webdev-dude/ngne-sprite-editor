import type { DeviceSize, ViewportView } from "./types";

// Where the viewport's quads go, in integer device pixels (SPEC §6.4). Pure functions: no
// DOM and no NGNE, so the placement is unit-tested without a renderer.

/** A rectangle in device pixels, top-left origin. */
export interface DeviceRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * The NGNE `layer` of each kind of quad, bottom to top (SPEC §6.4, quad order). The workspace
 * is this viewport's own: the colour around the document, drawn as a rect under everything.
 */
export const QUAD_LAYER = {
    workspace: 0,
    checker: 1,
    referenceBehind: 2,
    onionBehind: 3,
    frame: 4,
    onionFront: 5,
    referenceFront: 6,
} as const;

/** One textured quad as NGNE takes it: centre, size, texture slot and layer. */
export interface Quad {
    texture: string;
    layer: number;
    /** Centre, in device pixels. */
    x: number;
    y: number;
    width: number;
    height: number;
    /**
     * The part of the texture drawn, 0 to 1 over it (NGNE's `u`, `v`, `uw`, `vh`); the whole
     * texture when absent. Editor playback draws a cell of the `ed:play` grid (SE-024).
     */
    u?: number;
    v?: number;
    uw?: number;
    vh?: number;
    /** NGNE's `alpha`, 0 to 1; opaque when absent. A reference's opacity (SE-045). */
    alpha?: number;
}

/**
 * The rectangle an image of `width` × `height` document pixels covers:
 * `[originX, originY, width × scale, height × scale]`, each a whole number of device pixels
 * and at least one pixel wide and high. At the zoom steps of 1 and above every texel is then
 * `scale` × `scale` device pixels; the overview steps below 1 round the size.
 */
export function documentRect(view: ViewportView, width: number, height: number): DeviceRect {
    return {
        x: Math.round(view.originX),
        y: Math.round(view.originY),
        width: Math.max(1, Math.round(width * view.scale)),
        height: Math.max(1, Math.round(height * view.scale)),
    };
}

/**
 * The quad that draws a slot's image over its document rectangle. NGNE places sprites by
 * their centre and, with `pixelSnap` off, rounds nothing: the centre of an odd-sized
 * rectangle is a half pixel, and its edges fall on whole device pixels (SPEC §6.2 #7).
 */
export function imageQuad(
    texture: string,
    layer: number,
    view: ViewportView,
    image: { width: number; height: number },
): Quad {
    const rect = documentRect(view, image.width, image.height);
    return {
        texture,
        layer,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        width: rect.width,
        height: rect.height,
    };
}

/** The axes tiled mode repeats the canvas on (`DocSettings.tiled`, SE-062). */
export type TiledMode = "none" | "x" | "y" | "both";

/**
 * The copies tiled mode draws of `quad` around it (SPEC §6.4, SE-062): one on each side of
 * the repeated axes, a whole quad's width or height away — two for X or Y, eight for both,
 * which with the quad make the 3 × 3. Its edges are whole device pixels, so are the copies'.
 * None for "none".
 */
export function tiledCopies(quad: Quad, tiled: TiledMode): Quad[] {
    if (tiled === "none") return [];
    const across = tiled === "x" || tiled === "both" ? [-1, 0, 1] : [0];
    const down = tiled === "y" || tiled === "both" ? [-1, 0, 1] : [0];
    const copies: Quad[] = [];
    for (const row of down) {
        for (const column of across) {
            if (row === 0 && column === 0) continue;
            copies.push({
                ...quad,
                x: quad.x + column * quad.width,
                y: quad.y + row * quad.height,
            });
        }
    }
    return copies;
}

/** Largest canvas side WebGPU allows by default (SPEC §6.2 #11). */
export const MAX_BACKING_SIDE = 8192;

/**
 * The canvas backing size for an observed element size in device pixels: whole numbers,
 * capped at the largest texture NGNE can present to. 0 on either side means "not laid out".
 */
export function backingSize(width: number, height: number): DeviceSize {
    const side = (value: number) =>
        Number.isFinite(value) ? Math.min(MAX_BACKING_SIDE, Math.max(0, Math.round(value))) : 0;
    return { width: side(width), height: side(height) };
}
