import { AllocationError } from "../history";
import type { Command, PixelAllocator } from "../history";
import { resample } from "../import";
import {
    DocumentSizeError,
    MAX_DOCUMENT_SIDE,
    MIN_DOCUMENT_SIDE,
    assertWithinLimits,
    documentCounts,
} from "../model";
import type {
    DocSession,
    DocumentLimits,
    PixelBuffer,
    Rect,
    ReferenceLayer,
    Selection,
    SpriteDoc,
} from "../model";
import { blitPixels, nonTransparentBounds } from "../pixels";
import { MAX_REFERENCE_OFFSET, MAX_REFERENCE_SCALE, MIN_REFERENCE_SCALE } from "../project/format";
import type { Pivot } from "./properties";

// Sprite operations of SPEC §7.7: canvas size, sprite size, crop to selection, trim, rotate
// canvas and flip canvas. Each is one undoable command over every image of the document.
//
// - Every image is changed once, whatever number of cels names it, so linked cels stay
//   linked; the cels themselves are not touched.
// - The selection is cleared, and undo restores it (its mask has the old size).
// - Canvas size, sprite size, crop and trim move and scale reference layers so that they stay
//   over the same content (SPEC §7.6); rotate and flip leave them as they are.
// - The pivot stays over the same content and stays normalized (SPEC §5.1): canvas size, crop
//   and trim move it with the content and clamp it to 0..1; sprite size leaves it as it is;
//   flip mirrors it and rotate turns it with the canvas. Undo puts back the very value.
// - A size outside 1..1024 is refused with `DocumentSizeError`, pixel memory past the limit
//   with `DocumentLimitError` (SPEC §5.1), while the command is made.
// - A command that would change nothing is not made: the factory returns null.
// - Every new image is allocated by the command's allocator, and a failure to allocate is an
//   `AllocationError` with the session unchanged (SPEC §5.2).
//
// Like a stack command, a sprite operation keeps nothing of the session it was made from: each
// `do` reads the images, the selection, the pivot and the reference layers the session has
// then, and its `undo` puts back exactly what that `do` replaced. A redo computes the new
// images again from the old ones, so the command keeps the old images while it is done and
// nothing while it is undone: `bytes` is their pixel memory. The history keeps its newest
// command whatever its size (SPEC §5.2), so an operation larger than the budget can still be
// undone.
//
// Applying a floating selection first (SPEC §5.2) is the caller's part: the floating
// selection is app state.

/** Resampling of Sprite Size (SPEC §7.7). */
export type SpriteSizeMethod = "nearest" | "area";

/**
 * Where the old canvas sits in the new one, as a fraction of the difference in size on each
 * axis: 0 the left or top edge, 0.5 the centre, 1 the right or bottom edge. The nine anchors
 * of the dialog are the nine pivot presets (`PIVOT_PRESETS`).
 */
export interface CanvasAnchor {
    x: number;
    y: number;
}

/** Options shared by the sprite operations. */
export interface SpriteOperationOptions {
    /** Allocates the new images; a test replaces it to simulate failure. */
    allocate?: PixelAllocator;
    /** The limits checked (SPEC §5.1); the default is `DOCUMENT_LIMITS`. */
    limits?: Readonly<DocumentLimits>;
}

/** Where a reference layer lies: what canvas size, crop, trim and sprite size change. */
interface Placement {
    x: number;
    y: number;
    scale: number;
}

/** Target pixel (x, y) reads the source pixel with this index (row-major, in pixels). */
type Pick = (x: number, y: number) => number;

/** One sprite operation before it is bound to a session. */
interface Reshape {
    label: string;
    /** Size of the document afterwards. */
    width: number;
    height: number;
    /** Writes the new pixels of one image into `target`, a transparent buffer of the new size. */
    draw(source: PixelBuffer, target: PixelBuffer): void;
    /** The placement of a reference layer afterwards; absent: references stay as they are. */
    reference?(placement: Placement): Placement;
    /** The pivot afterwards, before it is clamped to 0..1; absent: it stays as it is. */
    pivot?(pivot: Pivot): Pivot;
}

const defaultAllocator: PixelAllocator = (byteLength) => new Uint8ClampedArray(byteLength);

function allocate(allocator: PixelAllocator, width: number, height: number): PixelBuffer {
    const bytes = width * height * 4;
    try {
        return { width, height, data: allocator(bytes) };
    } catch (cause) {
        throw new AllocationError(bytes, cause);
    }
}

function isDocumentSide(value: number): boolean {
    return Number.isInteger(value) && value >= MIN_DOCUMENT_SIDE && value <= MAX_DOCUMENT_SIDE;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A pivot inside 0..1 on both axes. */
function normalized({ x, y }: Pivot): Pivot {
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

/**
 * Writes into `target` the pixel of `source` that `pick` names, at each pixel of `target`: the
 * new pixels of a rotation, a flip or a nearest resize, without a buffer of their own.
 */
function remapInto(source: PixelBuffer, target: PixelBuffer, pick: Pick): void {
    const from = source.data;
    const to = target.data;
    let at = 0;
    for (let y = 0; y < target.height; y++) {
        for (let x = 0; x < target.width; x++, at += 4) {
            const start = pick(x, y) * 4;
            to[at] = from[start];
            to[at + 1] = from[start + 1];
            to[at + 2] = from[start + 2];
            to[at + 3] = from[start + 3];
        }
    }
}

/** Whether `remapInto` with `pick` gives `image` again, for a map onto its own size. */
function unchangedBy(image: PixelBuffer, pick: Pick): boolean {
    const { data, width, height } = image;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            const from = pick(x, y) * 4;
            const same =
                data[at] === data[from] &&
                data[at + 1] === data[from + 1] &&
                data[at + 2] === data[from + 2] &&
                data[at + 3] === data[from + 3];
            if (!same) return false;
        }
    }
    return true;
}

/**
 * A placement inside the ranges of the project format (FORMAT.md §1.4), so that nothing an
 * operation leaves is refused on save.
 */
function storable({ x, y, scale }: Placement): Placement {
    return {
        x: clamp(x, -MAX_REFERENCE_OFFSET, MAX_REFERENCE_OFFSET),
        y: clamp(y, -MAX_REFERENCE_OFFSET, MAX_REFERENCE_OFFSET),
        scale: clamp(scale, MIN_REFERENCE_SCALE, MAX_REFERENCE_SCALE),
    };
}

function referenceLayers(doc: SpriteDoc): ReferenceLayer[] {
    return doc.layers.filter((layer): layer is ReferenceLayer => layer.kind === "reference");
}

/** What one `do` replaced: what its `undo` puts back. */
interface Done {
    width: number;
    height: number;
    images: [string, PixelBuffer][];
    selection: Selection | null;
    placements: [string, Placement][];
    pivot: Pivot;
}

/**
 * The command of a sprite operation on `session`. Throws `DocumentSizeError` for a size
 * outside 1..1024 and `DocumentLimitError` when the images of the new size would pass the
 * pixel memory limit.
 */
function reshapeCommand(
    session: DocSession,
    reshape: Reshape,
    options: SpriteOperationOptions,
): Command {
    const { doc } = session;
    const { label, width, height } = reshape;
    if (!isDocumentSide(width) || !isDocumentSide(height)) {
        throw new DocumentSizeError(width, height);
    }
    const before = documentCounts(doc);
    assertWithinLimits(
        before,
        { pixelBytes: doc.images.size * width * height * 4 },
        options.limits,
    );
    const allocator = options.allocate ?? defaultAllocator;
    let done: Done | null = null;

    return {
        label,
        // The old images, kept while the command is done.
        bytes: before.pixelBytes,
        // Every frame and layer: the size of each composite changes.
        touched: {
            frameIds: doc.frames.map((frame) => frame.id),
            layerIds: doc.layers.map((layer) => layer.id),
            structure: true,
        },
        do(target) {
            const current = target.doc;
            // Everything that can fail happens here, before the session changes.
            const made = Array.from(current.images, ([imageId, image]): [string, PixelBuffer] => {
                const next = allocate(allocator, width, height);
                reshape.draw(image, next);
                return [imageId, next];
            });
            const references = referenceLayers(current);
            done = {
                width: current.width,
                height: current.height,
                images: [...current.images],
                selection: target.selection,
                placements: references.map((layer) => [
                    layer.id,
                    { x: layer.x, y: layer.y, scale: layer.scale },
                ]),
                pivot: current.pivot,
            };
            // From the canvas as it is, before its size changes.
            const pivot = reshape.pivot && normalized(reshape.pivot(current.pivot));
            current.width = width;
            current.height = height;
            // `set` on a key that is there keeps the order of the map.
            for (const [imageId, image] of made) current.images.set(imageId, image);
            if (reshape.reference) {
                for (const layer of references) {
                    Object.assign(layer, storable(reshape.reference(layer)));
                }
            }
            if (pivot) current.pivot = pivot;
            target.selection = null;
        },
        undo(target) {
            if (!done) throw new Error(`"${label}": cannot be undone, it is not done.`);
            const current = target.doc;
            current.width = done.width;
            current.height = done.height;
            for (const [imageId, image] of done.images) current.images.set(imageId, image);
            for (const [layerId, placement] of done.placements) {
                const layer = current.layers.find((candidate) => candidate.id === layerId);
                if (layer?.kind === "reference") Object.assign(layer, placement);
            }
            current.pivot = done.pivot;
            target.selection = done.selection;
            // The old images are the document's again; the command holds none while undone.
            done = null;
        },
    };
}

/**
 * The part of the canvas a rectangle crops to, or null when it is the whole canvas or lies
 * outside it. Throws `RangeError` for a rectangle that is not made of integers.
 */
function cropArea(doc: SpriteDoc, rect: Rect): Rect | null {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)) {
        throw new RangeError(
            `A crop rectangle is made of integers, got ${rect.x}, ${rect.y}, ` +
                `${rect.width}, ${rect.height}.`,
        );
    }
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const right = Math.min(doc.width, rect.x + rect.width);
    const bottom = Math.min(doc.height, rect.y + rect.height);
    if (right <= x || bottom <= y) return null;
    const area = { x, y, width: right - x, height: bottom - y };
    const whole = area.width === doc.width && area.height === doc.height;
    return whole ? null : area;
}

/** A crop of every image to `area`, a part of the canvas. */
function cropCommand(
    session: DocSession,
    area: Rect,
    label: string,
    options: SpriteOperationOptions,
): Command {
    const { width: oldWidth, height: oldHeight } = session.doc;
    return reshapeCommand(
        session,
        {
            label,
            width: area.width,
            height: area.height,
            draw: (source, target) => blitPixels(target, source, -area.x, -area.y),
            reference: ({ x, y, scale }) => ({ x: x - area.x, y: y - area.y, scale }),
            // The pivot's pixel position, moved with the content and normalized to the crop.
            pivot: ({ x, y }) => ({
                x: (x * oldWidth - area.x) / area.width,
                y: (y * oldHeight - area.y) / area.height,
            }),
        },
        options,
    );
}

/** The offset of the old canvas in a canvas of `size` anchored at `anchor` (0, 0.5 or 1). */
function anchorOffset(anchor: number, size: number, old: number): number {
    // Truncated towards zero, as an integer division: growing by one pixel and shrinking back
    // gives the original.
    return Math.trunc(anchor * (size - old)) || 0;
}

/**
 * Canvas Size: every image becomes `width` × `height`, with the old canvas placed by
 * `anchor` and cut where it does not fit; new pixels are transparent. Reference layers and
 * the pivot move with the content; the pivot is clamped to the new canvas. Returns null when
 * the size does not change. Throws `RangeError` for an anchor coordinate outside 0..1,
 * `DocumentSizeError` and `DocumentLimitError`.
 */
export function canvasSizeCommand(
    session: DocSession,
    size: { width: number; height: number; anchor: CanvasAnchor },
    options: SpriteOperationOptions = {},
): Command | null {
    const { doc } = session;
    const { width, height, anchor } = size;
    const inRange = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
    if (!inRange(anchor.x) || !inRange(anchor.y)) {
        throw new RangeError(`Anchor (${anchor.x}, ${anchor.y}) is not inside 0..1.`);
    }
    const { width: oldWidth, height: oldHeight } = doc;
    if (width === oldWidth && height === oldHeight) return null;
    const dx = isDocumentSide(width) ? anchorOffset(anchor.x, width, oldWidth) : 0;
    const dy = isDocumentSide(height) ? anchorOffset(anchor.y, height, oldHeight) : 0;
    return reshapeCommand(
        session,
        {
            label: "Canvas Size",
            width,
            height,
            draw: (source, target) => blitPixels(target, source, dx, dy),
            reference: ({ x, y, scale }) => ({ x: x + dx, y: y + dy, scale }),
            pivot: ({ x, y }) => ({
                x: (x * oldWidth + dx) / width,
                y: (y * oldHeight + dy) / height,
            }),
        },
        options,
    );
}

/**
 * Sprite Size: every image is resampled to `width` × `height`, by nearest neighbour (the
 * source pixel under the centre of each new pixel) or by area average (the source area each
 * new pixel covers, colours weighted by alpha). Reference layers are scaled with the content:
 * `x` and `y` by the factor of their axis, `scale` by the geometric mean of the two factors,
 * which is the factor itself when the aspect ratio is kept. The pivot, normalized, stays as
 * it is. Returns null when the size does not change. Throws `DocumentSizeError` and
 * `DocumentLimitError`.
 */
export function spriteSizeCommand(
    session: DocSession,
    size: { width: number; height: number; method: SpriteSizeMethod },
    options: SpriteOperationOptions = {},
): Command | null {
    const { doc } = session;
    const { width, height, method } = size;
    if (width === doc.width && height === doc.height) return null;
    const sx = width / doc.width;
    const sy = height / doc.height;
    return reshapeCommand(
        session,
        {
            label: "Sprite Size",
            width,
            height,
            draw(source, target) {
                if (method === "nearest") {
                    // The source pixel under the centre of each new pixel (`resizeNearest`).
                    const near = (index: number, count: number, sourceCount: number) =>
                        Math.floor(((2 * index + 1) * sourceCount) / (2 * count));
                    remapInto(source, target, (x, y) => {
                        const row = near(y, height, source.height);
                        return row * source.width + near(x, width, source.width);
                    });
                    return;
                }
                let result: PixelBuffer;
                try {
                    result = resample(source, width, height, { method: "area", fit: "stretch" });
                } catch (cause) {
                    // `resample` allocates its result itself: memory running out there is the
                    // command's allocation failure as well (SPEC §5.2).
                    if (cause instanceof RangeError) {
                        throw new AllocationError(width * height * 4, cause);
                    }
                    throw cause;
                }
                target.data.set(result.data);
            },
            reference: ({ x, y, scale }) => ({
                x: x * sx,
                y: y * sy,
                scale: sx === sy ? scale * sx : scale * Math.sqrt(sx * sy),
            }),
        },
        options,
    );
}

/**
 * Crop to Selection: the canvas becomes the bounding rectangle of the selection, as in
 * Aseprite; pixels inside the rectangle and outside the mask are kept. Reference layers and the
 * pivot move with the content; the pivot is clamped to the new canvas. Returns null without a
 * selection, or when its bounds are the whole canvas.
 */
export function cropToSelectionCommand(
    session: DocSession,
    options: SpriteOperationOptions = {},
): Command | null {
    const { selection } = session;
    if (!selection) return null;
    const area = cropArea(session.doc, selection.bounds);
    return area && cropCommand(session, area, "Crop to Selection", options);
}

/**
 * The bounding rectangle of the pixels with alpha above 0 in every image of the document: all
 * frames and all pixel layers, hidden ones included. Null when every pixel is transparent.
 */
export function contentBounds(doc: SpriteDoc): Rect | null {
    let union: { left: number; top: number; right: number; bottom: number } | null = null;
    for (const image of doc.images.values()) {
        const bounds = nonTransparentBounds(image);
        if (!bounds) continue;
        const right = bounds.x + bounds.width;
        const bottom = bounds.y + bounds.height;
        union = union
            ? {
                  left: Math.min(union.left, bounds.x),
                  top: Math.min(union.top, bounds.y),
                  right: Math.max(union.right, right),
                  bottom: Math.max(union.bottom, bottom),
              }
            : { left: bounds.x, top: bounds.y, right, bottom };
    }
    return (
        union && {
            x: union.left,
            y: union.top,
            width: union.right - union.left,
            height: union.bottom - union.top,
        }
    );
}

/**
 * Trim: the canvas becomes the bounding rectangle of the content of every frame
 * (`contentBounds`), so content that differs per frame is trimmed to the union of all frames.
 * Hidden layers count, so trim cuts nothing that only undo could bring back. Reference layers
 * and the pivot move as for a crop. Returns null when there is no content or it reaches every
 * edge.
 */
export function trimCommand(
    session: DocSession,
    options: SpriteOperationOptions = {},
): Command | null {
    const bounds = contentBounds(session.doc);
    const area = bounds && cropArea(session.doc, bounds);
    return area && cropCommand(session, area, "Trim", options);
}

/**
 * Whether a rotation or a flip changes nothing: the canvas keeps its size, every image is its
 * own transform, and the pivot is its own transform as well.
 */
function changesNothing(
    doc: SpriteDoc,
    width: number,
    height: number,
    pick: Pick,
    pivot: Pivot,
): boolean {
    if (width !== doc.width || height !== doc.height) return false;
    if (pivot.x !== doc.pivot.x || pivot.y !== doc.pivot.y) return false;
    for (const image of doc.images.values()) if (!unchangedBy(image, pick)) return false;
    return true;
}

/** Rotations of Rotate Canvas, clockwise in degrees; 270 is a quarter turn counter-clockwise. */
export type CanvasRotation = 90 | 180 | 270;

const ROTATION_LABELS: Record<CanvasRotation, string> = {
    90: "Rotate Canvas 90°",
    180: "Rotate Canvas 180°",
    270: "Rotate Canvas 90° CCW",
};

/** The pivot of the old canvas on the turned one, turned clockwise by the angle. */
const TURNED_PIVOTS: Record<CanvasRotation, (pivot: Pivot) => Pivot> = {
    90: ({ x, y }) => ({ x: 1 - y, y: x }),
    180: ({ x, y }) => ({ x: 1 - x, y: 1 - y }),
    270: ({ x, y }) => ({ x: y, y: 1 - x }),
};

/**
 * Rotate Canvas: every image turned clockwise by `degrees`; 90 and 270 swap width and height.
 * The pivot turns with the canvas: (x, y) becomes (1 − y, x) at 90°, (1 − x, 1 − y) at 180°
 * and (y, 1 − x) at 270°. Reference layers stay as they are (SPEC §7.6). Returns null when
 * nothing would change (`changesNothing`). Throws `RangeError` for another angle and
 * `DocumentLimitError` (only a lowered limit can refuse it).
 */
export function rotateCanvasCommand(
    session: DocSession,
    degrees: CanvasRotation,
    options: SpriteOperationOptions = {},
): Command | null {
    if (!Object.hasOwn(ROTATION_LABELS, degrees)) {
        throw new RangeError(`Rotation must be 90, 180 or 270 degrees, got ${String(degrees)}.`);
    }
    const { doc } = session;
    const { width: w, height: h } = doc;
    // As `rotatePixels`: the source pixel each pixel of the turned image shows.
    const picks: Record<CanvasRotation, Pick> = {
        90: (x, y) => (h - 1 - x) * w + y,
        180: (x, y) => (h - 1 - y) * w + w - 1 - x,
        270: (x, y) => x * w + (w - 1 - y),
    };
    const pick = picks[degrees];
    const quarter = degrees !== 180;
    const width = quarter ? h : w;
    const height = quarter ? w : h;
    const turn = TURNED_PIVOTS[degrees];
    if (changesNothing(doc, width, height, pick, normalized(turn(doc.pivot)))) return null;
    return reshapeCommand(
        session,
        {
            label: ROTATION_LABELS[degrees],
            width,
            height,
            draw: (source, target) => remapInto(source, target, pick),
            pivot: turn,
        },
        options,
    );
}

/** Axes of Flip Canvas: "horizontal" swaps left and right, "vertical" top and bottom. */
export type CanvasFlip = "horizontal" | "vertical";

/**
 * Flip Canvas: every image mirrored. The pivot is mirrored with it: x becomes 1 − x for a
 * horizontal flip, y becomes 1 − y for a vertical one. Reference layers stay as they are
 * (SPEC §7.6). Returns null when nothing would change (`changesNothing`). Throws `RangeError`
 * for another axis.
 */
export function flipCanvasCommand(
    session: DocSession,
    axis: CanvasFlip,
    options: SpriteOperationOptions = {},
): Command | null {
    if (axis !== "horizontal" && axis !== "vertical") {
        throw new RangeError(`A canvas flips "horizontal" or "vertical", got "${String(axis)}".`);
    }
    const { doc } = session;
    const { width, height } = doc;
    const horizontal = axis === "horizontal";
    const pick: Pick = horizontal
        ? (x, y) => y * width + (width - 1 - x)
        : (x, y) => (height - 1 - y) * width + x;
    const mirror = ({ x, y }: Pivot): Pivot => (horizontal ? { x: 1 - x, y } : { x, y: 1 - y });
    if (changesNothing(doc, width, height, pick, normalized(mirror(doc.pivot)))) return null;
    return reshapeCommand(
        session,
        {
            label: horizontal ? "Flip Canvas Horizontal" : "Flip Canvas Vertical",
            width,
            height,
            draw: (source, target) => remapInto(source, target, pick),
            pivot: mirror,
        },
        options,
    );
}
