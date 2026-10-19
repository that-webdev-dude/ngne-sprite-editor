import type { PixelBuffer } from "../../core/model";

// The `ed:play` image of editor playback (SPEC §6.4, SE-024): the frames of the playing range
// side by side in a plain grid, one cell per frame, no padding, so that a frame is drawn as a
// UV sub-rectangle of one texture. Local to the viewport: not the exporter's packer. Pure
// functions, no DOM and no NGNE.

/** The largest side of the grid image (SPEC §6.2 #11). */
export const PLAY_GRID_MAX_SIDE = 8192;
/** The largest grid image, in bytes of RGBA8 (SPEC §6.4). */
export const PLAY_GRID_MAX_BYTES = 64 * 1024 * 1024;

/** Where the cells of a grid are. */
export interface PlayGridLayout {
    /** Number of cells. */
    count: number;
    columns: number;
    rows: number;
    /** Size of one cell: the document's size. */
    cellWidth: number;
    cellHeight: number;
    /** Size of the image. */
    width: number;
    height: number;
}

/** The limits a grid must fit; the defaults are SPEC §6.4's. */
export interface PlayGridLimits {
    side: number;
    bytes: number;
}

export const PLAY_GRID_LIMITS: Readonly<PlayGridLimits> = {
    side: PLAY_GRID_MAX_SIDE,
    bytes: PLAY_GRID_MAX_BYTES,
};

/**
 * The grid for `count` cells of `cellWidth` × `cellHeight`, about as wide as it is tall, in
 * row-major order; null when it does not fit within `limits` (a side or the bytes), in which
 * case playback steps through the frame cache instead.
 */
export function playGridLayout(
    count: number,
    cellWidth: number,
    cellHeight: number,
    limits: Readonly<PlayGridLimits> = PLAY_GRID_LIMITS,
): PlayGridLayout | null {
    if (count < 1 || cellWidth < 1 || cellHeight < 1) return null;
    const maxColumns = Math.floor(limits.side / cellWidth);
    const maxRows = Math.floor(limits.side / cellHeight);
    if (maxColumns < 1 || maxRows < 1) return null;
    const square = Math.ceil(Math.sqrt((count * cellHeight) / cellWidth));
    let columns = Math.max(1, Math.min(count, maxColumns, square));
    let rows = Math.ceil(count / columns);
    if (rows > maxRows) {
        columns = Math.min(count, maxColumns);
        rows = Math.ceil(count / columns);
        if (rows > maxRows) return null;
    }
    const width = columns * cellWidth;
    const height = rows * cellHeight;
    if (width * height * 4 > limits.bytes) return null;
    return { count, columns, rows, cellWidth, cellHeight, width, height };
}

/** The top-left of cell `index` in the grid image, in pixels. */
export function cellOrigin(layout: PlayGridLayout, index: number): { x: number; y: number } {
    return {
        x: (index % layout.columns) * layout.cellWidth,
        y: Math.floor(index / layout.columns) * layout.cellHeight,
    };
}

/** The UV sub-rectangle of cell `index`, as NGNE takes it (0 to 1 over the image). */
export function cellUv(
    layout: PlayGridLayout,
    index: number,
): { u: number; v: number; uw: number; vh: number } {
    const { x, y } = cellOrigin(layout, index);
    return {
        u: x / layout.width,
        v: y / layout.height,
        uw: layout.cellWidth / layout.width,
        vh: layout.cellHeight / layout.height,
    };
}

/** A transparent grid image of `layout`'s size. */
export function createGridImage(layout: PlayGridLayout): PixelBuffer {
    return {
        width: layout.width,
        height: layout.height,
        data: new Uint8ClampedArray(layout.width * layout.height * 4),
    };
}

/**
 * Copies `image`, which must be one cell's size, into cell `index` of `grid`. Returns false,
 * copying nothing, when its size is not the cell's.
 */
export function blitCell(
    grid: PixelBuffer,
    layout: PlayGridLayout,
    index: number,
    image: PixelBuffer,
): boolean {
    if (image.width !== layout.cellWidth || image.height !== layout.cellHeight) return false;
    const { x, y } = cellOrigin(layout, index);
    const rowBytes = layout.cellWidth * 4;
    for (let row = 0; row < layout.cellHeight; row++) {
        const from = row * rowBytes;
        grid.data.set(
            image.data.subarray(from, from + rowBytes),
            ((y + row) * layout.width + x) * 4,
        );
    }
    return true;
}
