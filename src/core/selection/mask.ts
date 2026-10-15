import type { BitMask, Rect, Selection } from "../model";

// 1-bit masks (SPEC §5.2, SE-030), in the layout of `BitMask`: pixel (x, y) is bit
// `i = y * width + x`, stored in `data[i >> 3]` at `1 << (i & 7)`, and the unused bits of the
// last byte are 0. A selection is a mask with the bounding rectangle of its set bits; "no
// selection" is null, never an empty mask.
//
// Masks and selections are values: nothing here changes a mask it was given, and the
// selection commands never change the `Selection` a session holds; they put another one in
// its place. A transaction can therefore take the session's mask as its clip and keep it.

function assertSize(width: number, height: number, caller: string): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new RangeError(
            `${caller}: a mask is at least 1 × 1 whole pixels, got ${width} × ${height}.`,
        );
    }
}

/** An empty `width` × `height` mask. */
export function createMask(width: number, height: number): BitMask {
    assertSize(width, height, "createMask");
    return { width, height, data: new Uint8Array(Math.ceil((width * height) / 8)) };
}

/** A copy of `mask` that shares no memory with it. */
export function copyMask(mask: BitMask): BitMask {
    return { width: mask.width, height: mask.height, data: mask.data.slice() };
}

/** Whether pixel `x, y` is set; false outside the mask. */
export function maskHas(mask: BitMask, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
    const bit = y * mask.width + x;
    return (mask.data[bit >> 3] & (1 << (bit & 7))) !== 0;
}

/** Sets pixel `x, y` of a mask being built; a pixel outside it is ignored. */
export function setMaskPixel(mask: BitMask, x: number, y: number): void {
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
    const bit = y * mask.width + x;
    mask.data[bit >> 3] |= 1 << (bit & 7);
}

/** Sets the pixels `[x0, x1)` of row `y` of a mask being built, clipped to the mask. */
export function setMaskRun(mask: BitMask, y: number, x0: number, x1: number): void {
    if (y < 0 || y >= mask.height) return;
    const from = Math.max(0, x0);
    const to = Math.min(mask.width, x1);
    for (let x = from; x < to; x++) {
        const bit = y * mask.width + x;
        mask.data[bit >> 3] |= 1 << (bit & 7);
    }
}

/** Whether two masks have the same size and the same pixels. */
export function masksEqual(a: BitMask, b: BitMask): boolean {
    if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
        return false;
    }
    for (let index = 0; index < a.data.length; index++) {
        if (a.data[index] !== b.data[index]) return false;
    }
    return true;
}

/** The bounding rectangle of the set pixels, or null when none is set. */
export function maskBounds(mask: BitMask): Rect | null {
    const { width, height, data } = mask;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const bit = row + x;
            const byte = data[bit >> 3];
            // A whole byte of 0 skips its remaining bits.
            if (byte === 0 && (bit & 7) === 0 && x + 8 <= width) {
                x += 7;
                continue;
            }
            if ((byte & (1 << (bit & 7))) === 0) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            maxY = y;
        }
    }
    return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * The selection of the set pixels of `mask`, with their bounds; null when no pixel is set.
 * This is how a flood mask (SE-017's flood fill, the magic wand of SE-031) or any mask of the
 * document's size becomes a selection. The selection keeps `mask` itself: the caller hands it
 * over and does not change it afterwards.
 */
export function selectionOf(mask: BitMask): Selection | null {
    const bounds = maskBounds(mask);
    return bounds ? { mask, bounds } : null;
}

/** Whether two selections (or their absence) select the same pixels. */
export function selectionsEqual(a: Selection | null, b: Selection | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return masksEqual(a.mask, b.mask);
}
