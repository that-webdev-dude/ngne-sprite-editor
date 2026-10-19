import { compositeFrame } from "../composite";
import type { ExportSettings, SpriteDoc } from "../model";
import type { PixelBuffer } from "../pixels";
import { resizeNearest } from "../pixels";
import { encodePng } from "../png";
import { MAX_ATLAS_SIDE, atlasFor, exportFrameIndices, exportName } from "../export";
import type { BundleFile } from "../export";
import { writeZip } from "../project/zip";

// The exports beside the NGNE bundle (SPEC §9.6, SE-052): the current frame as a PNG, scaled
// by a whole number with nearest-neighbour sampling; the sprite sheet PNG alone; the PNG
// sequence of the exported frames; and the zip that carries several files as one download.
// Each file is made from `compositeFrame`, as the bundle's are, through the public API of
// `core/export`, and is byte-deterministic. Files are `BundleFile`s: a name and its bytes.

/** Smallest and largest scale of a frame PNG. */
export const MIN_FRAME_PNG_SCALE = 1;
export const MAX_FRAME_PNG_SCALE = 16;

/**
 * Largest side of a frame PNG, in pixels: the side limit of an atlas. A larger document
 * offers a smaller largest scale (`maxFramePngScale`).
 */
export const MAX_FRAME_PNG_SIDE = MAX_ATLAS_SIDE;

/**
 * The largest scale a frame PNG of this document may have: 16, or less where 16 times the
 * longer side would pass `MAX_FRAME_PNG_SIDE`; 1 at least.
 */
export function maxFramePngScale(doc: Pick<SpriteDoc, "width" | "height">): number {
    const fit = Math.floor(MAX_FRAME_PNG_SIDE / Math.max(doc.width, doc.height, 1));
    return Math.min(MAX_FRAME_PNG_SCALE, Math.max(MIN_FRAME_PNG_SCALE, fit));
}

/**
 * The image scaled by a whole number with nearest-neighbour sampling: every pixel becomes a
 * `scale` × `scale` block of its colour. Scale 1 gives a copy. Throws `RangeError` for a scale
 * that is not an integer of at least 1.
 */
export function upscaleNearest(image: PixelBuffer, scale: number): PixelBuffer {
    if (!Number.isInteger(scale) || scale < 1) {
        throw new RangeError(`The scale must be a whole number of at least 1, got ${scale}.`);
    }
    return resizeNearest(image, image.width * scale, image.height * scale);
}

/** The index of a frame in the document; throws `RangeError` when it has no such frame. */
function frameIndex(doc: SpriteDoc, frameId: string): number {
    const index = doc.frames.findIndex((frame) => frame.id === frameId);
    if (index === -1) throw new RangeError(`The document has no frame "${frameId}".`);
    return index;
}

/**
 * The file name of a frame PNG: `<name>-<index>.png` at scale 1, `<name>-<index>@<scale>x.png`
 * otherwise, `<index>` being the frame's zero-based index in the document, as in its frame ID
 * (SPEC §9.3).
 */
export function framePngName(name: string, index: number, scale: number): string {
    return scale === 1 ? `${name}-${index}.png` : `${name}-${index}@${scale}x.png`;
}

/**
 * The composite of one frame as a PNG file, scaled by `scale` (1 to `maxFramePngScale`) with
 * nearest-neighbour sampling. `name` is the export name (`exportName`). Throws `RangeError`
 * for an unknown frame or a scale outside its range.
 */
export function framePngFile(
    doc: SpriteDoc,
    name: string,
    frameId: string,
    scale: number,
): BundleFile {
    const index = frameIndex(doc, frameId);
    const largest = maxFramePngScale(doc);
    if (!Number.isInteger(scale) || scale < MIN_FRAME_PNG_SCALE || scale > largest) {
        throw new RangeError(
            `The scale of a frame PNG must be a whole number from ${MIN_FRAME_PNG_SCALE} to ` +
                `${largest}, got ${scale}.`,
        );
    }
    const image = upscaleNearest(compositeFrame(doc, frameId), scale);
    return { name: framePngName(name, index, scale), bytes: encodePng(image) };
}

/**
 * The sprite sheet alone: the file `<name>.png` of the bundle the settings make, with the
 * same bytes, without the other files. Throws `ExportError` and `PackError` as `bundle` does.
 */
export function spriteSheetFile(
    doc: SpriteDoc,
    settings: ExportSettings = doc.exportSettings,
): BundleFile {
    const indices = exportFrameIndices(doc, settings);
    const frames = indices.map((index) => compositeFrame(doc, doc.frames[index].id));
    const { atlas } = atlasFor(frames, doc, settings);
    return { name: `${exportName(doc.name)}.png`, bytes: encodePng(atlas) };
}

/**
 * The PNG sequence: one file `<name>-<index>.png` per exported frame (every frame, or the
 * frames of the tag `settings.frames` names), each the frame's composite at its own size.
 * `<index>` is the frame's index in the document, as in its frame ID. Throws `ExportError` as
 * `bundle` does for the document and the settings.
 */
export function pngSequenceFiles(
    doc: SpriteDoc,
    settings: ExportSettings = doc.exportSettings,
): BundleFile[] {
    const name = exportName(doc.name);
    return exportFrameIndices(doc, settings).map((index) => ({
        name: framePngName(name, index, 1),
        bytes: encodePng(compositeFrame(doc, doc.frames[index].id)),
    }));
}

/**
 * A zip archive of files, in their order: PNG files stored (they are compressed already), the
 * others deflated. The same files give the same bytes (`writeZip`: fixed time stamps).
 */
export function zipFiles(files: readonly BundleFile[]): Uint8Array<ArrayBuffer> {
    return writeZip(
        files.map((file) => ({
            name: file.name,
            data: file.bytes,
            stored: file.name.endsWith(".png"),
        })),
    );
}
