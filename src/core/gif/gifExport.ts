import { GIFEncoder } from "gifenc";
import type { GifPaletteColor } from "gifenc";
import { expandTag } from "../animation";
import type { AnimationEntry } from "../animation";
import { compositeFrame } from "../composite";
import { animationIds, exportName } from "../export";
import type { BundleFile } from "../export";
import { buildPalette, mapToPalette } from "../import";
import type { SpriteDoc } from "../model";
import type { PixelBuffer } from "../pixels";

// The animated GIF export of SPEC §9.6 (SE-063), encoded with `gifenc`:
//
// - The frames are the composites of `compositeFrame`, in the order of one pass of the
//   sequence: every frame forward, or the frames one tag plays (`expandTag`, ping-pong and
//   reverse included). How often the pass plays is the GIF's loop count.
// - Each frame has a palette of its own, from `buildPalette`: the frame's colours when there
//   are few enough, else that many colours chosen by it, every pixel then taking the nearest
//   (OKLab, no dithering). A frame holds 256 colours, one of them the transparent one when
//   the frame has a transparent pixel.
// - Transparency is one bit: a pixel with alpha of at least `GIF_ALPHA_THRESHOLD` shows its
//   colour as if opaque, any other pixel is transparent.
// - Each frame covers the whole canvas and is cleared after it shows (disposal 2), so a
//   transparent pixel shows nothing of the frame before.
// - Delays are the frames' durations rounded to 10 ms, at least `MIN_GIF_DELAY_MS`.
// - The image is scaled by a whole number, 1–8, with nearest-neighbour sampling.
//
// Pure: no DOM. The same document and options give the same bytes, made at once (`gifFile`)
// or in steps that let the event loop run between frames (`encodeGif`).

/** Smallest and largest scale of a GIF. */
export const MIN_GIF_SCALE = 1;
export const MAX_GIF_SCALE = 8;

/** Alpha from which a pixel shows its colour; below it the pixel is transparent. */
export const GIF_ALPHA_THRESHOLD = 128;

/** The shortest delay written: browsers show shorter ones far slower (as 100 ms). */
export const MIN_GIF_DELAY_MS = 20;

/** Colours of one frame's colour table, the transparent one included. */
export const MAX_GIF_COLORS = 256;

/** What a GIF holds: every frame, or the frames one tag plays. */
export type GifFrames = "all" | { tagId: string };

/** One pass of a GIF's animation, and how often it plays. */
export interface GifSequence {
    /** The frames of one pass, in order, with their durations in ms (not yet rounded). */
    entries: AnimationEntry[];
    /** How many times the pass plays; 0 plays it without end. */
    plays: number;
}

/**
 * The sequence of a GIF: every frame forward, playing without end; or one pass of a tag
 * (`expandTag`), playing as many times as the tag repeats (its `repeat`; 0 without end).
 * Throws `RangeError` for a tag the document does not have.
 */
export function gifSequence(doc: SpriteDoc, frames: GifFrames): GifSequence {
    if (frames === "all") {
        return {
            entries: doc.frames.map((frame) => ({ frameId: frame.id, ms: frame.durationMs })),
            plays: 0,
        };
    }
    const tag = doc.tags.find((entry) => entry.id === frames.tagId);
    if (!tag) throw new RangeError(`The document has no tag "${frames.tagId}".`);
    return { entries: expandTag(doc, { ...tag, repeat: 1 }), plays: tag.repeat };
}

/**
 * The delay a GIF writes for a frame of `ms` milliseconds: rounded to 10 ms (halves up), at
 * least `MIN_GIF_DELAY_MS`.
 */
export function gifDelayMs(ms: number): number {
    return Math.max(MIN_GIF_DELAY_MS, Math.round(ms / 10) * 10);
}

/**
 * The loop count of the GIF's NETSCAPE2.0 block for a pass that plays `plays` times, as
 * `gifenc` takes it: 0 (the block's 0) loops without end; a single play writes no block (-1);
 * `n` plays repeat the pass `n - 1` times after the first.
 */
export function gifLoopCount(plays: number): number {
    if (plays === 0) return 0;
    return plays === 1 ? -1 : plays - 1;
}

/**
 * The file name of a GIF: `<name>.gif` for every frame, `<name>-<animation ID>.gif` for one
 * tag (its ID in the bundle, SPEC §9.3), with `@<scale>x` before `.gif` above scale 1.
 * `name` is the export name (`exportName`).
 */
export function gifFileName(
    doc: Pick<SpriteDoc, "tags">,
    name: string,
    frames: GifFrames,
    scale: number,
): string {
    let stem = name;
    if (frames !== "all") {
        const id = animationIds(doc).find((entry) => entry.tagId === frames.tagId)?.id;
        if (id) stem = `${name}-${id}`;
    }
    return scale === 1 ? `${stem}.gif` : `${stem}@${scale}x.gif`;
}

/** One frame as a GIF holds it, at the size of its image. */
export interface GifFrameImage {
    width: number;
    height: number;
    /** The colours, 0xRRGGBBAA (opaque), dark to light as `buildPalette` orders them. */
    colors: number[];
    /** The index of the transparent colour, after `colors`; -1 when no pixel is transparent. */
    transparentIndex: number;
    /** Per pixel, row by row: its index into `colors`, or `transparentIndex`. */
    indices: Uint8Array;
    /** True when the image had more colours than the frame holds and they were reduced. */
    reduced: boolean;
}

/**
 * An image as a frame of a GIF: transparency by `GIF_ALPHA_THRESHOLD`, the palette of
 * `buildPalette` over the pixels that show, and each pixel's index into it (its own colour,
 * or the nearest when the colours were reduced). The image is only read.
 */
export function gifFrameImage(image: PixelBuffer): GifFrameImage {
    const { width, height, data } = image;
    const count = width * height;
    // The image as the GIF shows it: opaque where alpha reaches the threshold, else nothing.
    const shown = new Uint8ClampedArray(count * 4);
    let transparent = false;
    const distinct = new Set<number>();
    for (let p = 0, i = 0; p < count; p++, i += 4) {
        if (data[i + 3] < GIF_ALPHA_THRESHOLD) {
            transparent = true;
            continue;
        }
        shown[i] = data[i];
        shown[i + 1] = data[i + 1];
        shown[i + 2] = data[i + 2];
        shown[i + 3] = 255;
        distinct.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    const room = transparent ? MAX_GIF_COLORS - 1 : MAX_GIF_COLORS;
    const reduced = distinct.size > room;
    const visible: PixelBuffer = { width, height, data: shown };
    const colors =
        distinct.size === 0 ? [] : buildPalette([visible], Math.min(room, distinct.size));
    const mapped = reduced ? mapToPalette(visible, colors, { dither: "none" }).data : shown;

    const indexOf = new Map(colors.map((color, index) => [color >>> 8, index]));
    const transparentIndex = transparent ? colors.length : -1;
    const indices = new Uint8Array(count);
    for (let p = 0, i = 0; p < count; p++, i += 4) {
        if (shown[i + 3] === 0) {
            indices[p] = transparentIndex;
            continue;
        }
        const index = indexOf.get((mapped[i] << 16) | (mapped[i + 1] << 8) | mapped[i + 2]);
        if (index === undefined) throw new Error("gifFrameImage: a pixel has no palette colour.");
        indices[p] = index;
    }
    return { width, height, colors, transparentIndex, indices, reduced };
}

/** The indices scaled by a whole number: each becomes a `scale` × `scale` block. */
function scaledIndices(frame: GifFrameImage, scale: number): Uint8Array {
    if (scale === 1) return frame.indices;
    const { width, height, indices } = frame;
    const wide = width * scale;
    const out = new Uint8Array(wide * height * scale);
    for (let y = 0; y < height; y++) {
        const row = new Uint8Array(wide);
        for (let x = 0; x < width; x++)
            row.fill(indices[y * width + x], x * scale, (x + 1) * scale);
        for (let copy = 0; copy < scale; copy++) out.set(row, (y * scale + copy) * wide);
    }
    return out;
}

/** The colour table `gifenc` writes for a frame: its colours, then the transparent one. */
function colorTable(frame: GifFrameImage): GifPaletteColor[] {
    const table = frame.colors.map((color): GifPaletteColor => [
        color >>> 24,
        (color >>> 16) & 0xff,
        (color >>> 8) & 0xff,
    ]);
    if (frame.transparentIndex !== -1) table.push([0, 0, 0]);
    return table;
}

export interface GifOptions {
    frames: GifFrames;
    /** 1 to 8. */
    scale: number;
}

export interface GifResult {
    /** `gifFileName`'s name and the GIF's bytes. */
    file: BundleFile;
    /** How many frames the GIF holds: one pass of the sequence. */
    frameCount: number;
    /** How many of the document's frames had their colours reduced (each counted once). */
    reducedFrames: number;
}

/**
 * The steps of an encode: each `next()` writes one frame of the GIF; the last returns the
 * result. Checks the scale and the frames when it is made, before any step runs.
 */
function gifSteps(doc: SpriteDoc, options: GifOptions): Generator<void, GifResult, void> {
    const { frames, scale } = options;
    if (!Number.isInteger(scale) || scale < MIN_GIF_SCALE || scale > MAX_GIF_SCALE) {
        throw new RangeError(
            `The scale of a GIF must be a whole number from ${MIN_GIF_SCALE} to ` +
                `${MAX_GIF_SCALE}, got ${scale}.`,
        );
    }
    const { entries, plays } = gifSequence(doc, frames);
    return (function* () {
        const width = doc.width * scale;
        const height = doc.height * scale;
        /** By frame ID: a frame a ping-pong shows twice is composited and indexed once. */
        const images = new Map<string, GifFrameImage>();
        const encoder = GIFEncoder();
        for (const [position, entry] of entries.entries()) {
            if (position > 0) yield;
            let image = images.get(entry.frameId);
            if (!image) {
                image = gifFrameImage(compositeFrame(doc, entry.frameId));
                images.set(entry.frameId, image);
            }
            encoder.writeFrame(scaledIndices(image, scale), width, height, {
                palette: colorTable(image),
                transparent: image.transparentIndex !== -1,
                transparentIndex: Math.max(0, image.transparentIndex),
                delay: gifDelayMs(entry.ms),
                // Read with the first frame only.
                repeat: position === 0 ? gifLoopCount(plays) : 0,
                dispose: 2,
            });
        }
        encoder.finish();
        const reducedFrames = [...images.values()].filter((image) => image.reduced).length;
        const name = gifFileName(doc, exportName(doc.name), frames, scale);
        return {
            file: { name, bytes: encoder.bytes() },
            frameCount: entries.length,
            reducedFrames,
        };
    })();
}

/**
 * The animated GIF of a document (see the top of this module), made at once. Throws
 * `RangeError` for a scale outside 1–8 or a tag the document does not have.
 */
export function gifFile(doc: SpriteDoc, options: GifOptions): GifResult {
    const steps = gifSteps(doc, options);
    for (;;) {
        const step = steps.next();
        if (step.done) return step.value;
    }
}

/** Waits for the next task of the event loop: whatever else is queued runs first. */
export function nextTask(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * `gifFile` in steps, for a page that must stay responsive: `pause` is awaited between one
 * frame and the next (by default the next task of the event loop), so timers, input and
 * rendering run meanwhile. What `pause` throws stops the encode and is thrown from here; it
 * is where a caller checks that the document has not changed meanwhile. The bytes are those
 * of `gifFile`. Throws as `gifFile` does before the first frame.
 */
export async function encodeGif(
    doc: SpriteDoc,
    options: GifOptions,
    pause: () => Promise<void> = nextTask,
): Promise<GifResult> {
    const steps = gifSteps(doc, options);
    for (;;) {
        const step = steps.next();
        if (step.done) return step.value;
        await pause();
    }
}
