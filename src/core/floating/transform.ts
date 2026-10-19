import type { BitMask, PixelBuffer } from "../model";
import { createMask } from "../selection";
import type { FloatingContent } from "./floating";

// Transforms of floating content (SPEC §7.2, SE-033). Flips and quarter turns permute the
// pixels of the content exactly. A free transform places the content in a box of whole
// document pixels — its top-left corner and size — turned by an angle about the box's centre,
// and is drawn by nearest-neighbour sampling: a pixel of the result takes the source pixel
// under its centre, so it only ever holds colours of the source.
//
//   box (x, y, width, height), angle a (degrees, clockwise on screen, y pointing down)
//   a document pixel p belongs to the result when its centre, turned back by a about the
//   box's centre, lies inside the box: u in [0, width), v in [0, height); it takes the source
//   pixel (⌊u · sw / width⌋, ⌊v · sh / height⌋) when that pixel is in the source's mask
//
// Untransformed (the box the source's size, angle 0) the result is the source itself.

/** A box of whole document pixels: the top-left corner and a size of at least 1. */
export interface FloatBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A free transform: the box the content is scaled into, turned by `angle` about its centre. */
export interface FreeTransform extends FloatBox {
    /** Degrees, clockwise on screen, in (−180, 180]. */
    angle: number;
}

/** The axis a flip mirrors the content across: horizontal swaps left and right. */
export type FlipAxis = "horizontal" | "vertical";

/** Content rendered by a free transform, with the document position of its top-left pixel. */
export interface RenderedContent {
    content: FloatingContent;
    x: number;
    y: number;
}

/** An angle in degrees as the equal angle in (−180, 180]. */
export function normalizeAngle(degrees: number): number {
    if (!Number.isFinite(degrees)) throw new RangeError(`An angle must be finite, got ${degrees}.`);
    let angle = degrees % 360;
    if (angle <= -180) angle += 360;
    if (angle > 180) angle -= 360;
    // `+ 0`: never a negative zero.
    return angle + 0;
}

/**
 * Cosine and sine of `degrees`, exact (0, 1 or −1) at the multiples of 90°, so a quarter turn
 * typed in the context bar samples without rounding noise.
 */
export function turnOf(degrees: number): { cos: number; sin: number } {
    const angle = normalizeAngle(degrees);
    if (angle === 0) return { cos: 1, sin: 0 };
    if (angle === 90) return { cos: 0, sin: 1 };
    if (angle === 180) return { cos: -1, sin: 0 };
    if (angle === -90) return { cos: 0, sin: -1 };
    const radians = (angle * Math.PI) / 180;
    return { cos: Math.cos(radians), sin: Math.sin(radians) };
}

function bitOf(mask: BitMask, index: number): boolean {
    return (mask.data[index >> 3]! & (1 << (index & 7))) !== 0;
}

function setBit(mask: BitMask, index: number): void {
    mask.data[index >> 3]! |= 1 << (index & 7);
}

/**
 * The content with each pixel moved by `map` from (x, y) of the source to (tx, ty) of a
 * `width` × `height` result: a permutation, every byte and mask bit carried over.
 */
function permute(
    content: FloatingContent,
    width: number,
    height: number,
    map: (x: number, y: number) => [number, number],
): FloatingContent {
    const { pixels, mask } = content;
    const data = new Uint8ClampedArray(width * height * 4);
    const out = createMask(width, height);
    for (let y = 0; y < pixels.height; y++) {
        for (let x = 0; x < pixels.width; x++) {
            const from = y * pixels.width + x;
            const [tx, ty] = map(x, y);
            const to = ty * width + tx;
            data.set(pixels.data.subarray(from * 4, from * 4 + 4), to * 4);
            if (bitOf(mask, from)) setBit(out, to);
        }
    }
    return { pixels: { width, height, data }, mask: out };
}

/** The content mirrored across `axis`: an exact permutation of its pixels and mask. */
export function flipContent(content: FloatingContent, axis: FlipAxis): FloatingContent {
    const { width, height } = content.pixels;
    return axis === "horizontal"
        ? permute(content, width, height, (x, y) => [width - 1 - x, y])
        : permute(content, width, height, (x, y) => [x, height - 1 - y]);
}

/**
 * The content turned by `turns` quarter turns clockwise (negative: counter-clockwise): an
 * exact permutation; an odd number of turns swaps its width and height.
 */
export function rotateContent(content: FloatingContent, turns: number): FloatingContent {
    if (!Number.isInteger(turns)) throw new RangeError(`Quarter turns are whole, got ${turns}.`);
    const { width, height } = content.pixels;
    switch (((turns % 4) + 4) % 4) {
        case 1:
            return permute(content, height, width, (x, y) => [height - 1 - y, x]);
        case 2:
            return permute(content, width, height, (x, y) => [width - 1 - x, height - 1 - y]);
        case 3:
            return permute(content, height, width, (x, y) => [y, width - 1 - x]);
        default:
            return permute(content, width, height, (x, y) => [x, y]);
    }
}

/**
 * The box of `box` turned by `turns` quarter turns about its centre: width and height swap
 * for an odd number, and the corner moves by half their difference, truncated toward zero so
 * that four turns give the box back.
 */
export function rotateBox(box: FloatBox, turns: number): FloatBox {
    if (turns % 2 === 0) return { ...box };
    const dx = Math.trunc((box.width - box.height) / 2);
    const dy = Math.trunc((box.height - box.width) / 2);
    return { x: box.x + dx, y: box.y + dy, width: box.height, height: box.width };
}

/** Whether `transform` leaves content of `width` × `height` as it is. */
export function isIdentity(transform: FreeTransform, width: number, height: number): boolean {
    return transform.angle === 0 && transform.width === width && transform.height === height;
}

/** The four corners of the turned box in document coordinates: top-left, top-right, bottom-right, bottom-left. */
export function boxCorners(transform: FreeTransform): [number, number][] {
    const { x, y, width, height } = transform;
    const { cos, sin } = turnOf(transform.angle);
    const cx = x + width / 2;
    const cy = y + height / 2;
    const corner = (u: number, v: number): [number, number] => {
        const dx = u - width / 2;
        const dy = v - height / 2;
        return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    };
    return [corner(0, 0), corner(width, 0), corner(width, height), corner(0, height)];
}

/**
 * The position of document point `px, py` in the unturned box of `transform`: (0, 0) at its
 * top-left corner, (width, height) at its bottom-right one.
 */
export function toBoxSpace(
    transform: FreeTransform,
    px: number,
    py: number,
): { u: number; v: number } {
    const { cos, sin } = turnOf(transform.angle);
    const dx = px - (transform.x + transform.width / 2);
    const dy = py - (transform.y + transform.height / 2);
    return {
        u: dx * cos + dy * sin + transform.width / 2,
        v: -dx * sin + dy * cos + transform.height / 2,
    };
}

/** The document point of box-space `u, v` (the inverse of `toBoxSpace`). */
export function fromBoxSpace(
    transform: FreeTransform,
    u: number,
    v: number,
): { x: number; y: number } {
    const { cos, sin } = turnOf(transform.angle);
    const dx = u - transform.width / 2;
    const dy = v - transform.height / 2;
    return {
        x: transform.x + transform.width / 2 + dx * cos - dy * sin,
        y: transform.y + transform.height / 2 + dx * sin + dy * cos,
    };
}

/**
 * Renders `source` by `transform` with nearest-neighbour sampling: the pixels whose centres
 * the turned box covers, as content of their bounding rectangle, and where that lies. A pixel
 * covered by the box but taken from outside the source's mask is transparent and outside the
 * result's mask. With the identity transform the source itself is returned.
 */
export function renderTransform(
    source: FloatingContent,
    transform: FreeTransform,
): RenderedContent {
    const { width: sw, height: sh } = source.pixels;
    const { width, height } = transform;
    if (isIdentity(transform, sw, sh)) return { content: source, x: transform.x, y: transform.y };
    // Candidate pixels: those whose centres lie within the corners' bounds, one more each way
    // for rounding; the test below decides.
    const corners = boxCorners(transform);
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const left = Math.floor(Math.min(...xs)) - 1;
    const top = Math.floor(Math.min(...ys)) - 1;
    const right = Math.ceil(Math.max(...xs)) + 1;
    const bottom = Math.ceil(Math.max(...ys)) + 1;
    const { cos, sin } = turnOf(transform.angle);
    const cx = transform.x + width / 2;
    const cy = transform.y + height / 2;
    const scaleX = sw / width;
    const scaleY = sh / height;
    /** The source pixel index under the centre of pixel `px, py`, or −1 outside the box. */
    const sample = (px: number, py: number): number => {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const u = dx * cos + dy * sin + width / 2;
        const v = -dx * sin + dy * cos + height / 2;
        if (!(u >= 0 && u < width && v >= 0 && v < height)) return -1;
        const sx = Math.min(Math.floor(u * scaleX), sw - 1);
        const sy = Math.min(Math.floor(v * scaleY), sh - 1);
        return sy * sw + sx;
    };
    // The covered pixels' bounds: the result's rectangle.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let py = top; py < bottom; py++) {
        for (let px = left; px < right; px++) {
            if (sample(px, py) < 0) continue;
            if (px < x0) x0 = px;
            if (px > x1) x1 = px;
            if (py < y0) y0 = py;
            if (py > y1) y1 = py;
        }
    }
    if (x0 > x1) {
        // A box of at least 1 × 1 covers the pixel at its centre; kept for safety.
        x0 = x1 = Math.floor(cx);
        y0 = y1 = Math.floor(cy);
    }
    const rw = x1 - x0 + 1;
    const rh = y1 - y0 + 1;
    const pixels: PixelBuffer = { width: rw, height: rh, data: new Uint8ClampedArray(rw * rh * 4) };
    const mask = createMask(rw, rh);
    const from = source.pixels.data;
    for (let row = 0; row < rh; row++) {
        for (let column = 0; column < rw; column++) {
            const index = sample(x0 + column, y0 + row);
            if (index < 0 || !bitOf(source.mask, index)) continue;
            const to = row * rw + column;
            pixels.data.set(from.subarray(index * 4, index * 4 + 4), to * 4);
            setBit(mask, to);
        }
    }
    return { content: { pixels, mask }, x: x0, y: y0 };
}
