/**
 * Straight-alpha (not premultiplied) RGBA8 image: row-major, four bytes per pixel, top-left
 * first. Same shape as `PixelBuffer` in SPEC §5.1.
 */
export interface PixelBuffer {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

/** Rectangle in pixel coordinates. `x` and `y` may lie outside a buffer. */
export interface PixelRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

function assertSize(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new RangeError(
            `Pixel buffer size must be positive integers, got ${width}x${height}.`,
        );
    }
}

function assertIntegers(...values: number[]): void {
    if (!values.every(Number.isInteger)) {
        throw new RangeError(`Pixel coordinates must be integers, got ${values.join(", ")}.`);
    }
}

function assertRect(rect: PixelRect): void {
    assertIntegers(rect.x, rect.y, rect.width, rect.height);
}

/** The part of `rect` inside a `width` × `height` area, or null when they do not overlap. */
function clip(rect: PixelRect, width: number, height: number): PixelRect | null {
    const x = Math.max(rect.x, 0);
    const y = Math.max(rect.y, 0);
    const right = Math.min(rect.x + rect.width, width);
    const bottom = Math.min(rect.y + rect.height, height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function whole(buffer: PixelBuffer): PixelRect {
    return { x: 0, y: 0, width: buffer.width, height: buffer.height };
}

/**
 * New buffer of `width` × `height` pixels, transparent black unless `color` (0xRRGGBBAA) is
 * given. Throws `RangeError` when a side is not a positive integer.
 */
export function createPixelBuffer(width: number, height: number, color = 0): PixelBuffer {
    assertSize(width, height);
    const buffer = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    if (color !== 0) {
        fillPixels(buffer, color);
    }
    return buffer;
}

/** Copy with its own storage. */
export function clonePixelBuffer(source: PixelBuffer): PixelBuffer {
    return { width: source.width, height: source.height, data: source.data.slice() };
}

/**
 * True when both buffers have the same size and the same bytes. RGB under alpha 0 counts, so
 * two buffers that look alike can still differ.
 */
export function pixelBuffersEqual(a: PixelBuffer, b: PixelBuffer): boolean {
    if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
        return false;
    }
    for (let i = 0; i < a.data.length; i++) {
        if (a.data[i] !== b.data[i]) {
            return false;
        }
    }
    return true;
}

/**
 * Sets every pixel of `rect` (default: the whole buffer) to `color` (0xRRGGBBAA). The
 * rectangle is clipped to the buffer.
 */
export function fillPixels(target: PixelBuffer, color: number, rect?: PixelRect): void {
    if (rect) {
        assertRect(rect);
    }
    const area = clip(rect ?? whole(target), target.width, target.height);
    if (!area) {
        return;
    }
    const { data } = target;
    const rowBytes = area.width * 4;
    const first = (area.y * target.width + area.x) * 4;
    for (let i = first; i < first + rowBytes; i += 4) {
        data[i] = color >>> 24;
        data[i + 1] = (color >>> 16) & 0xff;
        data[i + 2] = (color >>> 8) & 0xff;
        data[i + 3] = color & 0xff;
    }
    for (let row = 1; row < area.height; row++) {
        data.copyWithin(first + row * target.width * 4, first, first + rowBytes);
    }
}

/**
 * Copies pixels from `source` into `target` so that the top-left of `sourceRect` (default: the
 * whole source) lands on (`x`, `y`). Pixels are replaced, not blended. The copy is clipped to
 * both buffers. `target` and `source` may be the same buffer.
 */
export function blitPixels(
    target: PixelBuffer,
    source: PixelBuffer,
    x: number,
    y: number,
    sourceRect?: PixelRect,
): void {
    assertIntegers(x, y);
    if (sourceRect) {
        assertRect(sourceRect);
    }
    const from = clip(sourceRect ?? whole(source), source.width, source.height);
    if (!from) {
        return;
    }
    // A source pixel (sx, sy) goes to (sx + shiftX, sy + shiftY) in the target.
    const shiftX = x - (sourceRect?.x ?? 0);
    const shiftY = y - (sourceRect?.y ?? 0);
    const to = clip(
        { x: from.x + shiftX, y: from.y + shiftY, width: from.width, height: from.height },
        target.width,
        target.height,
    );
    if (!to) {
        return;
    }
    const rowBytes = to.width * 4;
    const sourceX = to.x - shiftX;
    const sourceY = to.y - shiftY;
    // Moving pixels down inside one buffer copies the bottom row first, so no row is read
    // after it was overwritten. `set` itself is safe for an overlap within a row.
    const bottomUp = target.data.buffer === source.data.buffer && to.y > sourceY;
    for (let i = 0; i < to.height; i++) {
        const row = bottomUp ? to.height - 1 - i : i;
        const start = ((sourceY + row) * source.width + sourceX) * 4;
        target.data.set(
            source.data.subarray(start, start + rowBytes),
            ((to.y + row) * target.width + to.x) * 4,
        );
    }
}

/**
 * New buffer with the size of `rect` holding that part of `source`. Where `rect` reaches
 * outside the source the result is transparent black. Throws `RangeError` when the size of
 * `rect` is not positive.
 */
export function cropPixels(source: PixelBuffer, rect: PixelRect): PixelBuffer {
    assertRect(rect);
    const result = createPixelBuffer(rect.width, rect.height);
    blitPixels(result, source, -rect.x, -rect.y);
    return result;
}

/** Smallest rectangle containing every pixel with alpha above 0, or null when there is none. */
export function nonTransparentBounds(source: PixelBuffer): PixelRect | null {
    const { width, height, data } = source;
    const rowHasAlpha = (y: number): boolean => {
        for (let i = y * width * 4 + 3, end = (y + 1) * width * 4; i < end; i += 4) {
            if (data[i] !== 0) {
                return true;
            }
        }
        return false;
    };
    let top = 0;
    while (top < height && !rowHasAlpha(top)) {
        top++;
    }
    if (top === height) {
        return null;
    }
    let bottom = height - 1;
    while (!rowHasAlpha(bottom)) {
        bottom--;
    }
    const columnHasAlpha = (x: number): boolean => {
        for (let y = top; y <= bottom; y++) {
            if (data[(y * width + x) * 4 + 3] !== 0) {
                return true;
            }
        }
        return false;
    };
    let left = 0;
    while (!columnHasAlpha(left)) {
        left++;
    }
    let right = width - 1;
    while (!columnHasAlpha(right)) {
        right--;
    }
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Normalization: sets R, G and B to 0 wherever alpha is 0, in place. Buffers that look alike
 * then also compare equal.
 */
export function zeroTransparentRgb(target: PixelBuffer): void {
    const { data } = target;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
        }
    }
}
