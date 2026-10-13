import { expandTag } from "../animation";
import type { ExportSettings, SpriteDoc } from "../model";
import type { PixelBuffer } from "../pixels";
import { ATLAS_FORMAT, ATLAS_GENERATOR, ATLAS_VERSION } from "./atlasFormat";
import type { AtlasMeta } from "./atlasFormat";
import { AtlasError, ExportError } from "./errors";
import { planExport } from "./exportPlan";
import type { ExportPlan } from "./exportPlan";
import { frameId } from "./names";
import { pack } from "./pack";
import type { PackedRect } from "./pack";
import { validateAtlas } from "./validateAtlas";

/** A packed atlas: its image and the content of its `<name>.atlas.json`. */
export interface AtlasResult {
    /** The atlas image. Every pixel with alpha 0 is 0,0,0,0. */
    atlas: PixelBuffer;
    meta: AtlasMeta;
}

/**
 * The document indices of the frames an export holds, ascending (SPEC §9.3): every frame,
 * or with `settings.frames = { tagId }` the frames of that tag's range. `atlasFor` takes one
 * composite for each of them, in this order.
 *
 * Throws `ExportError` as `atlasFor` does for the document and the settings.
 */
export function exportFrameIndices(
    doc: SpriteDoc,
    settings: ExportSettings = doc.exportSettings,
): number[] {
    return planExport(doc, settings).frameIndices;
}

/**
 * The atlas of an export whose plan is made: packs the composites and writes the metadata.
 * Shared with `bundle`, which needs the plan for its other files.
 */
export function atlasOfPlan(
    frames: readonly PixelBuffer[],
    doc: SpriteDoc,
    settings: ExportSettings,
    plan: ExportPlan,
): AtlasResult {
    const { name, frameIndices, animations } = plan;
    if (frames.length !== frameIndices.length) {
        throw new ExportError(
            "frames",
            `The export has ${frameIndices.length} frames, but ${frames.length} composites ` +
                `were given: one is needed for each, in the order of exportFrameIndices.`,
        );
    }
    const { atlas, rects } = pack(frames, settings);

    const rectOf = new Array<PackedRect>(frames.length);
    for (const rect of rects) {
        for (const index of rect.frameIndices) rectOf[index] = rect;
    }
    /** By the ID of a frame in the document: its ID in the atlas. */
    const atlasIds = new Map<string, string>();
    const frameMembers = frameIndices.map((documentIndex, index) => {
        const id = frameId(name, documentIndex);
        atlasIds.set(doc.frames[documentIndex].id, id);
        // Frames merged into one rectangle have equal members under their own IDs.
        const { x, y, w, h, sourceW, sourceH, offsetX, offsetY } = rectOf[index];
        const pivot = [doc.pivot.x, doc.pivot.y];
        return [id, { x, y, w, h, sourceW, sourceH, offsetX, offsetY, pivot }] as const;
    });
    const animationMembers = animations.map(({ id, playback }) => {
        // `expandTag` writes every pass of a repeat out; one pass when the tag loops.
        const entries = expandTag(doc, playback).map((entry) => ({
            frame: atlasIds.get(entry.frameId),
            ms: entry.ms,
        }));
        const durationMs = entries.reduce((sum, entry) => sum + entry.ms, 0);
        const mode = playback.repeat === 0 ? "loop" : "once";
        return [id, { playback: mode, durationMs, entries }] as const;
    });

    const written = {
        format: ATLAS_FORMAT,
        version: ATLAS_VERSION,
        generator: ATLAS_GENERATOR,
        image: `${name}.png`,
        width: atlas.width,
        height: atlas.height,
        frames: Object.fromEntries(frameMembers),
        animations: Object.fromEntries(animationMembers),
    };
    // The reader's own check, so that what is written can be read: a document that breaks
    // a rule of the format (a duration of 0, a pivot outside the frame) is refused here.
    try {
        return { atlas, meta: validateAtlas(written, atlas) };
    } catch (cause) {
        if (!(cause instanceof AtlasError)) throw cause;
        throw new ExportError(
            "document",
            `The document cannot be exported as a sprite atlas: ${cause.message}`,
            { cause },
        );
    }
}

/**
 * Packs the composites of a document's frames and describes the result (SPEC §9.2–§9.4):
 * `bundle` without the file writers, for a caller that draws from the atlas in memory (the
 * preview panel).
 *
 * `frames` holds one composite per exported frame, in the order of `exportFrameIndices`
 * (every frame of the document unless `settings.frames` names a tag). Of the document only
 * `name`, `frames`, `tags` and `pivot` are read, so a copy without cels and images will do.
 *
 * - Frame IDs are `<name>-<index>` with the index of the frame in the document, also when
 *   one tag is exported. Frames merged into one rectangle keep their own IDs.
 * - Every tag becomes an animation under the ID `animationIds` gives it, written out by
 *   `expandTag`: `repeat` 0 as a `"loop"` of one pass, `repeat` n as a `"once"` of n passes.
 *   A document with several frames and no tag gets one `"loop"` over all frames, named
 *   `<name>`. With `settings.frames = { tagId }` the atlas holds that tag's animation alone.
 * - Every frame carries the document's pivot.
 * - `meta` has passed `validateAtlas` against the atlas image.
 *
 * Deterministic: the same composites, document and settings give the same pixels and the
 * same `meta`, member for member and in the same order.
 *
 * Throws `ExportError` ("settings", "frames", "too-many-frames", "too-many-entries",
 * "document"), each before anything is packed except "document" for a value the finished
 * atlas shows to be outside the format, and the `PackError` of `pack`.
 */
export function atlasFor(
    frames: readonly PixelBuffer[],
    doc: SpriteDoc,
    settings: ExportSettings = doc.exportSettings,
): AtlasResult {
    return atlasOfPlan(frames, doc, settings, planExport(doc, settings));
}
