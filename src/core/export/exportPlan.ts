import type { TagPlayback } from "../animation";
import type { ExportSettings, SpriteDoc, Tag } from "../model";
import { MAX_ATLAS_ENTRIES, MAX_ATLAS_FRAMES } from "./atlasFormat";
import { ExportError } from "./errors";
import { animationIds, exportName } from "./names";

// What an export holds, decided from the document and the settings before a pixel is
// touched (SPEC §9.3): which frames, under which IDs, and which animations. Not part of the
// public API of `core/export`; `atlasFor`, `bundle` and the Aseprite writer share it.

/** One animation of an export, before its entries are written out. */
export interface PlannedAnimation {
    /** Its ID in the atlas. */
    id: string;
    /** What it plays: a tag of the document, or all frames forward without end. */
    playback: TagPlayback;
    /** Document index of the first frame of its range. */
    from: number;
    /** Document index of the last frame of its range. */
    to: number;
    /** Number of entries it has once written out. */
    entries: number;
    /** Colour of its tag, 0xRRGGBBAA; undefined when it is not made from a tag. */
    color: number | undefined;
}

export interface ExportPlan {
    /** `<name>` of SPEC §9.1. */
    name: string;
    /** Document indices of the exported frames, ascending. */
    frameIndices: number[];
    animations: PlannedAnimation[];
}

/** Entries of one pass over `frames` frames (SPEC §7.4, as `expandTag` writes it). */
function passLength(frames: number, direction: Tag["direction"]): number {
    return direction === "pingpong" && frames > 2 ? 2 * frames - 2 : frames;
}

/**
 * The plan of an export. Throws `ExportError`: "settings" when `settings.frames` cannot be
 * applied, "document" for a document without frames or with a tag that has no valid range
 * or repeat count, "too-many-frames" and "too-many-entries" for an export beyond the limits
 * of the format.
 */
export function planExport(doc: SpriteDoc, settings: ExportSettings): ExportPlan {
    const name = exportName(doc.name);
    const count = doc.frames.length;
    if (count === 0) throw new ExportError("document", "The document has no frame to export.");
    const indexOf = new Map(doc.frames.map((frame, index) => [frame.id, index]));

    const planned = (tag: Tag, id: string): PlannedAnimation => {
        const from = indexOf.get(tag.fromFrameId);
        const to = indexOf.get(tag.toFrameId);
        if (from === undefined || to === undefined || from > to) {
            throw new ExportError(
                "document",
                `The tag of animation "${id}" does not span a run of the document's frames.`,
            );
        }
        if (!Number.isInteger(tag.repeat) || tag.repeat < 0) {
            throw new ExportError(
                "document",
                `The tag of animation "${id}" has the repeat count ${tag.repeat}.`,
            );
        }
        const entries = passLength(to - from + 1, tag.direction) * Math.max(tag.repeat, 1);
        return { id, playback: tag, from, to, entries, color: tag.color };
    };

    const ids = animationIds(doc);
    const selected = settings.frames;
    let frameIndices: number[];
    let animations: PlannedAnimation[];
    if (selected === "all") {
        frameIndices = Array.from({ length: count }, (_, index) => index);
        if (doc.tags.length > 0) {
            animations = doc.tags.map((tag, index) => planned(tag, ids[index].id));
        } else if (count > 1) {
            // A document with several frames and no tag plays all of them, without end.
            const playback: TagPlayback = {
                fromFrameId: doc.frames[0].id,
                toFrameId: doc.frames[count - 1].id,
                direction: "forward",
                repeat: 0,
            };
            const all = { id: name, playback, from: 0, to: count - 1, entries: count };
            animations = [{ ...all, color: undefined }];
        } else {
            animations = [];
        }
    } else {
        const tagId: unknown = typeof selected === "object" && selected ? selected.tagId : null;
        const index = doc.tags.findIndex((tag) => tag.id === tagId);
        if (index === -1) {
            throw new ExportError(
                "settings",
                typeof tagId === "string"
                    ? `The export is limited to a tag the document does not have ("${tagId}").`
                    : 'The frames to export must be "all" or one tag of the document.',
            );
        }
        const animation = planned(doc.tags[index], ids[index].id);
        frameIndices = [];
        for (let frame = animation.from; frame <= animation.to; frame++) frameIndices.push(frame);
        animations = [animation];
    }

    if (frameIndices.length > MAX_ATLAS_FRAMES) {
        throw new ExportError(
            "too-many-frames",
            `The export has ${frameIndices.length} frames; an atlas holds at most ` +
                `${MAX_ATLAS_FRAMES}.`,
            { count: frameIndices.length, limit: MAX_ATLAS_FRAMES },
        );
    }
    const entries = animations.reduce((sum, animation) => sum + animation.entries, 0);
    if (entries > MAX_ATLAS_ENTRIES) {
        throw new ExportError(
            "too-many-entries",
            `The animations of the export have ${entries} entries when every repeat is ` +
                `written out; an atlas holds at most ${MAX_ATLAS_ENTRIES}. Lower a repeat ` +
                `count, shorten a tag, or export one tag at a time.`,
            { count: entries, limit: MAX_ATLAS_ENTRIES },
        );
    }
    return { name, frameIndices, animations };
}
