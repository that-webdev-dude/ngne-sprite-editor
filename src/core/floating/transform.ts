import type { PixelBuffer, Rect } from "../model";
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

/**
 * The content with each pixel moved by `map` from (x, y) of the source to the pixel index it
 * returns in a `width` × `height` result: a permutation, every byte and mask bit carried over.
 */
function permute(
    content: FloatingContent,
    width: number,
    height: number,
    map: (x: number, y: number) => number,
): FloatingContent {
    const { pixels, mask } = content;
    const from = pixels.data;
    const data = new Uint8ClampedArray(width * height * 4);
    const out = createMask(width, height);
    const bits = mask.data;
    const outBits = out.data;
    for (let y = 0; y < pixels.height; y++) {
        for (let x = 0; x < pixels.width; x++) {
            const source = y * pixels.width + x;
            const target = map(x, y);
            const a = source * 4;
            const b = target * 4;
            data[b] = from[a]!;
            data[b + 1] = from[a + 1]!;
            data[b + 2] = from[a + 2]!;
            data[b + 3] = from[a + 3]!;
            if ((bits[source >> 3]! & (1 << (source & 7))) !== 0) {
                outBits[target >> 3]! |= 1 << (target & 7);
            }
        }
    }
    return { pixels: { width, height, data }, mask: out };
}

/** The content mirrored across `axis`: an exact permutation of its pixels and mask. */
export function flipContent(content: FloatingContent, axis: FlipAxis): FloatingContent {
    const { width, height } = content.pixels;
    return axis === "horizontal"
        ? permute(content, width, height, (x, y) => y * width + (width - 1 - x))
        : permute(content, width, height, (x, y) => (height - 1 - y) * width + x);
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
            // (x, y) → (height − 1 − y, x) in a height × width result.
            return permute(content, height, width, (x, y) => x * height + (height - 1 - y));
        case 2:
            return permute(
                content,
                width,
                height,
                (x, y) => (height - 1 - y) * width + (width - 1 - x),
            );
        case 3:
            // (x, y) → (y, width − 1 − x).
            return permute(content, height, width, (x, y) => (width - 1 - x) * height + y);
        default:
            return permute(content, width, height, (x, y) => y * width + x);
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

/** Slack for rounding noise when the box's corners are compared with pixel centres. */
const EPS = 1e-9;

/**
 * The rectangle of the pixels whose centres the turned box of `transform` may cover, from its
 * corners: a centre `c` with min ≤ c < max on each axis (the box's own test decides which of
 * them it covers). Untransformed or turned by a multiple of 90°, it is exactly the box's
 * pixels.
 */
export function transformBounds(transform: FreeTransform): Rect {
    const corners = boxCorners(transform);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of corners) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    // `+ 0`: never a negative zero.
    const x0 = Math.ceil(minX - 0.5 - EPS) + 0;
    const y0 = Math.ceil(minY - 0.5 - EPS) + 0;
    const x1 = Math.ceil(maxX - 0.5 + EPS);
    const y1 = Math.ceil(maxY - 0.5 + EPS);
    // A box of at least 1 × 1 covers at least the pixel at its centre.
    return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/**
 * The source pixel each document pixel takes under `transform` (SPEC §7.2): the index of
 * source pixel (⌊u · sw / width⌋, ⌊v · sh / height⌋), where (u, v) is the pixel's centre turned
 * back about the box's centre, or −1 when that centre is outside the box. The source's mask
 * is not consulted.
 */
export function transformSampler(
    source: FloatingContent,
    transform: FreeTransform,
): (px: number, py: number) => number {
    const { width: sw, height: sh } = source.pixels;
    const { width, height } = transform;
    const { cos, sin } = turnOf(transform.angle);
    const cx = transform.x + width / 2;
    const cy = transform.y + height / 2;
    return (px, py) => {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const u = dx * cos + dy * sin + width / 2;
        const v = -dx * sin + dy * cos + height / 2;
        if (!(u >= 0 && u < width && v >= 0 && v < height)) return -1;
        // ⌊u · sw / width⌋, the product taken first (SE-033 review D).
        const sx = Math.min(Math.floor((u * sw) / width), sw - 1);
        const sy = Math.min(Math.floor((v * sh) / height), sh - 1);
        return sy * sw + sx;
    };
}

/**
 * Renders `source` by `transform` with nearest-neighbour sampling: the pixels of
 * `transformBounds` (only those inside `clip`, when given) as content, with where it lies. A
 * pixel the turned box does not cover, or covers with a pixel from outside the source's mask,
 * is transparent and outside the result's mask. With the identity transform the source itself
 * is returned, unclipped. When nothing of the bounds lies in `clip`, the result is one
 * transparent pixel outside the mask at the bounds' corner, which is outside `clip`.
 */
export function renderTransform(
    source: FloatingContent,
    transform: FreeTransform,
    clip?: Rect,
): RenderedContent {
    const { width: sw, height: sh } = source.pixels;
    if (isIdentity(transform, sw, sh)) return { content: source, x: transform.x, y: transform.y };
    const bounds = transformBounds(transform);
    let x0 = bounds.x;
    let y0 = bounds.y;
    let x1 = bounds.x + bounds.width;
    let y1 = bounds.y + bounds.height;
    if (clip) {
        x0 = Math.max(x0, clip.x);
        y0 = Math.max(y0, clip.y);
        x1 = Math.min(x1, clip.x + clip.width);
        y1 = Math.min(y1, clip.y + clip.height);
    }
    if (x1 <= x0 || y1 <= y0) {
        return {
            content: {
                pixels: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
                mask: createMask(1, 1),
            },
            x: bounds.x,
            y: bounds.y,
        };
    }
    const rw = x1 - x0;
    const rh = y1 - y0;
    const data = new Uint8ClampedArray(rw * rh * 4);
    const mask = createMask(rw, rh);
    const bits = mask.data;
    const from = source.pixels.data;
    const sourceBits = source.mask.data;
    // `transformSampler` written out inline, with the same arithmetic in the same order (so
    // the same pixels on the box's edges), the row's terms taken out of the loop.
    const { width, height } = transform;
    const { cos, sin } = turnOf(transform.angle);
    const cx = transform.x + width / 2;
    const cy = transform.y + height / 2;
    const halfW = width / 2;
    const halfH = height / 2;
    for (let row = 0; row < rh; row++) {
        const dy = y0 + row + 0.5 - cy;
        const dySin = dy * sin;
        const dyCos = dy * cos;
        for (let column = 0; column < rw; column++) {
            const dx = x0 + column + 0.5 - cx;
            const u = dx * cos + dySin + halfW;
            if (!(u >= 0 && u < width)) continue;
            const v = -dx * sin + dyCos + halfH;
            if (!(v >= 0 && v < height)) continue;
            // ⌊u · sw / width⌋ (u ≥ 0, so a truncation), kept inside the source.
            let sx = ((u * sw) / width) | 0;
            let sy = ((v * sh) / height) | 0;
            if (sx >= sw) sx = sw - 1;
            if (sy >= sh) sy = sh - 1;
            const index = sy * sw + sx;
            if ((sourceBits[index >> 3]! & (1 << (index & 7))) === 0) continue;
            const to = row * rw + column;
            const a = index * 4;
            const b = to * 4;
            data[b] = from[a]!;
            data[b + 1] = from[a + 1]!;
            data[b + 2] = from[a + 2]!;
            data[b + 3] = from[a + 3]!;
            bits[to >> 3]! |= 1 << (to & 7);
        }
    }
    const pixels: PixelBuffer = { width: rw, height: rh, data };
    return { content: { pixels, mask }, x: x0, y: y0 };
}
