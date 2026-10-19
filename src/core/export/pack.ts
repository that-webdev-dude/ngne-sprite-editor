import { defaultExportSettings } from "../model";
import type { ExportSettings } from "../model";
import {
    blitPixels,
    clonePixelBuffer,
    createPixelBuffer,
    nonTransparentBounds,
    zeroTransparentRgb,
} from "../pixels";
import type { PixelBuffer } from "../pixels";
import { MAX_ATLAS_EXTRUDE, MAX_ATLAS_PADDING, MAX_ATLAS_SIDE, PackError } from "./packErrors";

// The atlas packer of SPEC §9.4. `pack` cuts every frame to the rectangle it needs, merges
// the cuts of identical frames, lays the rest out on a uniform grid, checks the size of that
// grid against the limit, and only then allocates the atlas and copies the pixels.

/**
 * The packing settings of SPEC §9.4, under the names they have in `ExportSettings`: a
 * document's `exportSettings` can be passed as they are.
 */
export type PackOptions = Pick<
    ExportSettings,
    "layout" | "padding" | "extrude" | "trim" | "mergeDuplicates"
>;

/**
 * One rectangle of the atlas and the frames drawn from it: the geometry fields of a frame
 * in `ngne-sprite-atlas` (SPEC §9.2). Every number is an integer, in pixels.
 */
export interface PackedRect {
    /** Left edge in the atlas. An extrude gutter lies outside the rectangle. */
    x: number;
    /** Top edge in the atlas. */
    y: number;
    /** Width, always even and at least 2. */
    w: number;
    /** Height, always even and at least 2. */
    h: number;
    /** Width of the source frame. */
    sourceW: number;
    /** Height of the source frame. */
    sourceH: number;
    /** Where the rectangle's left edge sits inside the source frame. */
    offsetX: number;
    /** Where the rectangle's top edge sits inside the source frame. */
    offsetY: number;
    /**
     * Width of the part that lies inside the source frame, `min(w, sourceW − offsetX)`: `w`,
     * or `w − 1` when the even size took the rectangle one column past the frame.
     */
    contentW: number;
    /** Height of that part, `min(h, sourceH − offsetY)`. */
    contentH: number;
    /** Indices in `frames` of the frames drawn from this rectangle, ascending; never empty. */
    frameIndices: number[];
}

/** A limit a caller sets beyond those of SPEC §9.4. */
export interface PackLimits {
    /**
     * Most bytes the atlas image may take (4 per pixel). A larger atlas is refused with the
     * "memory" error, with its size in `required`, before it is allocated.
     */
    maxBytes?: number;
}

export interface PackResult {
    /** The atlas image. Every pixel with alpha 0 is 0,0,0,0. */
    atlas: PixelBuffer;
    /**
     * The rectangles in the order of the first frame each serves, which is also their order
     * in the grid. Without merging, `rects[i]` is the rectangle of `frames[i]`.
     */
    rects: PackedRect[];
}

/** The rectangle of one frame before it has a place in the atlas. */
interface Cut {
    /** The frame, with no colour under alpha 0. */
    source: PixelBuffer;
    offsetX: number;
    offsetY: number;
    w: number;
    h: number;
    contentW: number;
    contentH: number;
    frameIndices: number[];
}

const LAYOUTS: readonly string[] = ["grid", "row", "column"];

/** The options with the defaults of SPEC §9.4 filled in. Throws the `options` error. */
function resolveOptions(options: Partial<PackOptions>): PackOptions {
    const defaults = defaultExportSettings();
    const resolved: PackOptions = {
        layout: options.layout ?? defaults.layout,
        padding: options.padding ?? defaults.padding,
        extrude: options.extrude ?? defaults.extrude,
        trim: options.trim ?? defaults.trim,
        mergeDuplicates: options.mergeDuplicates ?? defaults.mergeDuplicates,
    };
    if (!LAYOUTS.includes(resolved.layout)) {
        throw new PackError(
            "options",
            `Layout must be one of ${LAYOUTS.join(", ")}, got ${String(resolved.layout)}.`,
        );
    }
    const ranges: [string, number, number][] = [
        ["Padding", resolved.padding, MAX_ATLAS_PADDING],
        ["Extrude", resolved.extrude, MAX_ATLAS_EXTRUDE],
    ];
    for (const [name, value, max] of ranges) {
        if (!Number.isInteger(value) || value < 0 || value > max) {
            throw new PackError("options", `${name} must be an integer 0..${max}, got ${value}.`);
        }
    }
    const switches: [string, boolean][] = [
        ["Trim", resolved.trim],
        ["Merge duplicates", resolved.mergeDuplicates],
    ];
    for (const [name, value] of switches) {
        if (typeof value !== "boolean") {
            throw new PackError("options", `${name} must be true or false, got ${String(value)}.`);
        }
    }
    return resolved;
}

/** Throws the `no-frames` or the `frame` error unless `frames` are pixel buffers to pack. */
function assertFrames(frames: readonly PixelBuffer[]): void {
    if (frames.length === 0) {
        throw new PackError("no-frames", "There is no frame to pack.");
    }
    frames.forEach(({ width, height, data }, index) => {
        const valid =
            Number.isInteger(width) &&
            Number.isInteger(height) &&
            width >= 1 &&
            height >= 1 &&
            data.length === width * height * 4;
        if (!valid) {
            throw new PackError("frame", `Frame ${index} is not a valid pixel buffer.`);
        }
    });
}

/**
 * `frame` itself when it holds no colour under alpha 0, otherwise a copy in which those
 * pixels are 0,0,0,0. A composite (SPEC §5.3) is never copied.
 */
function normalized(frame: PixelBuffer): PixelBuffer {
    const { data } = frame;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0 && (data[i] | data[i + 1] | data[i + 2]) !== 0) {
            const copy = clonePixelBuffer(frame);
            zeroTransparentRgb(copy);
            return copy;
        }
    }
    return frame;
}

/** `size` when it is even and above 0, otherwise the next even number (SPEC §9.2). */
function evenSize(size: number): number {
    return Math.max(2, size + (size % 2));
}

/**
 * The rectangle of the frame at `index`: the whole frame, or with `trim` the bounds of its
 * pixels with alpha above 0, grown to even sides on the right and bottom. A frame without
 * such a pixel is cut at its top-left corner.
 */
function cutOf(frame: PixelBuffer, index: number, trim: boolean): Cut {
    const whole = { x: 0, y: 0, width: frame.width, height: frame.height };
    const empty = { x: 0, y: 0, width: 0, height: 0 };
    const bounds = trim ? (nonTransparentBounds(frame) ?? empty) : whole;
    const w = evenSize(bounds.width);
    const h = evenSize(bounds.height);
    return {
        source: normalized(frame),
        offsetX: bounds.x,
        offsetY: bounds.y,
        w,
        h,
        contentW: Math.min(w, frame.width - bounds.x),
        contentH: Math.min(h, frame.height - bounds.y),
        frameIndices: [index],
    };
}

/** Where row `row` of a cut's content starts in the data of its source. */
function contentRow(cut: Cut, row: number): number {
    return ((cut.offsetY + row) * cut.source.width + cut.offsetX) * 4;
}

/** FNV-1a hash of a cut's content. It only narrows the search; `sameContent` decides. */
function contentHash(cut: Cut): number {
    const { data } = cut.source;
    const rowBytes = cut.contentW * 4;
    let hash = 0x811c9dc5;
    for (let row = 0; row < cut.contentH; row++) {
        const start = contentRow(cut, row);
        for (let i = start; i < start + rowBytes; i++) {
            hash = Math.imul(hash ^ data[i], 0x01000193);
        }
    }
    return hash >>> 0;
}

/** True when two cuts of the same geometry, from frames of one size, hold the same pixels. */
function sameContent(a: Cut, b: Cut): boolean {
    const rowBytes = a.contentW * 4;
    for (let row = 0; row < a.contentH; row++) {
        const start = contentRow(a, row);
        for (let i = start; i < start + rowBytes; i++) {
            if (a.source.data[i] !== b.source.data[i]) return false;
        }
    }
    return true;
}

/**
 * One cut per group of identical frames, in the order of each group's first frame; the cut
 * lists every frame of its group. Frames are identical when they have the same size and,
 * colour under alpha 0 aside, the same pixels: their cuts then have the same geometry and
 * content, and nothing but transparent pixels around it.
 */
function mergeIdentical(cuts: readonly Cut[]): Cut[] {
    const kept: Cut[] = [];
    const byKey = new Map<string, Cut[]>();
    for (const cut of cuts) {
        const { source, offsetX, offsetY, w, h } = cut;
        const geometry = [source.width, source.height, offsetX, offsetY, w, h];
        const key = `${geometry.join()},${contentHash(cut)}`;
        const alike = byKey.get(key);
        const twin = alike?.find((candidate) => sameContent(candidate, cut));
        if (twin) {
            twin.frameIndices.push(...cut.frameIndices);
        } else {
            byKey.set(key, [...(alike ?? []), cut]);
            kept.push(cut);
        }
    }
    return kept;
}

/** Columns and rows of the grid that holds `count` rectangles, filled row by row. */
function gridOf(layout: PackOptions["layout"], count: number): { columns: number; rows: number } {
    if (layout === "row") return { columns: count, rows: 1 };
    if (layout === "column") return { columns: 1, rows: count };
    // Near-square: the smallest square of cells that holds them all, without its empty rows.
    const columns = Math.ceil(Math.sqrt(count));
    return { columns, rows: Math.ceil(count / columns) };
}

/** A transparent atlas. Any failure to allocate it is the `memory` error. */
function allocateAtlas(width: number, height: number): PixelBuffer {
    try {
        return createPixelBuffer(width, height);
    } catch (cause) {
        throw new PackError(
            "memory",
            `An atlas of ${width}x${height} px is too large to allocate.`,
            { cause },
        );
    }
}

/**
 * Repeats the edge pixels of the `w` × `h` rectangle at (`x`, `y`) into the `extrude` pixels
 * around it, corners included. The gutter lies inside the atlas. Where an edge is the
 * transparent padding of an odd side, so is its gutter (SPEC §9.2).
 */
function extrudeRect(
    atlas: PixelBuffer,
    x: number,
    y: number,
    w: number,
    h: number,
    extrude: number,
): void {
    const { data } = atlas;
    const stride = atlas.width * 4;
    for (let row = 0; row < h; row++) {
        const first = (y + row) * stride + x * 4;
        const last = first + (w - 1) * 4;
        for (let step = 1; step <= extrude; step++) {
            data.copyWithin(first - step * 4, first, first + 4);
            data.copyWithin(last + step * 4, last, last + 4);
        }
    }
    // The first and last row with the gutters just written, so a corner takes the corner pixel.
    const top = y * stride + (x - extrude) * 4;
    const bottom = top + (h - 1) * stride;
    const rowBytes = (w + 2 * extrude) * 4;
    for (let step = 1; step <= extrude; step++) {
        data.copyWithin(top - step * stride, top, top + rowBytes);
        data.copyWithin(bottom + step * stride, bottom, bottom + rowBytes);
    }
}

/**
 * Packs frames into one atlas image (SPEC §9.2, §9.4). The frames are composites of
 * `compositeFrame`; they need not have one size.
 *
 * - Rectangle: the whole frame, or with `trim` the bounds of its pixels with alpha above 0.
 *   An odd side grows by one pixel on the right or bottom, so `w` and `h` are always even.
 *   The rectangle shows the source frame from (`offsetX`, `offsetY`); the column or row
 *   that reaches past the frame (`contentW < w`, `contentH < h`) is transparent. With
 *   `trim`, a fully transparent frame keeps a 2 × 2 rectangle at offset 0, 0.
 * - `mergeDuplicates`: frames of the same size and pixels share one rectangle, which lists
 *   them in `frameIndices`. Without it every frame has a rectangle of its own.
 * - Layout: a uniform grid whose cell is as wide as the widest and as tall as the tallest
 *   rectangle, filled row by row in frame order; a smaller rectangle sits at the top-left
 *   of its cell. `grid` has ⌈√r⌉ columns for r rectangles, `row` one row, `column` one
 *   column. On each axis the atlas measures `n × (cell + padding + 2 × extrude) + padding`
 *   for n cells, and the rectangle of cell i starts at
 *   `padding + extrude + i × (cell + padding + 2 × extrude)`: `padding` transparent pixels
 *   lie between the gutters of two neighbours and at every border of the atlas.
 * - `extrude`: the edge pixels of every rectangle are repeated that many pixels outwards.
 *   The transparent column or row of an odd side is such an edge, so nothing shows there.
 * - Every pixel of the atlas with alpha 0 is 0,0,0,0, and a frame counts as it is after
 *   that normalization: colour under alpha 0 makes no difference to merging.
 * - Options left out take the defaults of SPEC §9.4: `grid`, padding 1, extrude 0, no
 *   trim, merging.
 * - Deterministic: the same frames and options give the same atlas bytes and rectangles.
 *   The frames are not changed and the atlas shares no storage with them.
 *
 * Throws `PackError`: "options" for an option outside its range (a layout other than the
 * three, a padding that is not an integer 0..8, an extrude that is not an integer 0..2);
 * "no-frames" for an empty list; "frame" for a buffer whose data does not match its size;
 * "atlas-size" when a side of the atlas would exceed `MAX_ATLAS_SIDE`, with the size it
 * needs in `required` and before anything is allocated for it; "memory" when the atlas
 * cannot be allocated, or when it would take more than `limits.maxBytes` (with the size in
 * `required`, before it is allocated).
 */
export function pack(
    frames: readonly PixelBuffer[],
    options: Partial<PackOptions> = {},
    limits: PackLimits = {},
): PackResult {
    const { layout, padding, extrude, trim, mergeDuplicates } = resolveOptions(options);
    assertFrames(frames);

    const cuts = frames.map((frame, index) => cutOf(frame, index, trim));
    const cells = mergeDuplicates ? mergeIdentical(cuts) : cuts;
    let cellW = 0;
    let cellH = 0;
    for (const cut of cells) {
        cellW = Math.max(cellW, cut.w);
        cellH = Math.max(cellH, cut.h);
    }
    const { columns, rows } = gridOf(layout, cells.length);
    const pitchX = cellW + padding + 2 * extrude;
    const pitchY = cellH + padding + 2 * extrude;
    const width = columns * pitchX + padding;
    const height = rows * pitchY + padding;
    if (width > MAX_ATLAS_SIDE || height > MAX_ATLAS_SIDE) {
        throw new PackError(
            "atlas-size",
            `The atlas needs ${width}x${height} px; the limit is ${MAX_ATLAS_SIDE} px per side.`,
            { required: { width, height } },
        );
    }

    const { maxBytes } = limits;
    if (maxBytes !== undefined && width * height * 4 > maxBytes) {
        throw new PackError(
            "memory",
            `The atlas would take ${width}x${height} px, ${width * height * 4} bytes; ` +
                `the limit is ${maxBytes} bytes.`,
            { required: { width, height } },
        );
    }

    const atlas = allocateAtlas(width, height);
    const rects = cells.map((cut, cell): PackedRect => {
        const { source, offsetX, offsetY, w, h, contentW, contentH, frameIndices } = cut;
        const x = padding + extrude + (cell % columns) * pitchX;
        const y = padding + extrude + Math.floor(cell / columns) * pitchY;
        const content = { x: offsetX, y: offsetY, width: contentW, height: contentH };
        blitPixels(atlas, source, x, y, content);
        extrudeRect(atlas, x, y, w, h, extrude);
        const sourceW = source.width;
        const sourceH = source.height;
        return { x, y, w, h, sourceW, sourceH, offsetX, offsetY, contentW, contentH, frameIndices };
    });
    return { atlas, rects };
}
