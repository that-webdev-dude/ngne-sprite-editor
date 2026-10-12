import { frameIndex } from "../model";
import type { SpriteDoc, Tag } from "../model";

/** One step of an animation: a frame and how long it shows, in milliseconds. */
export interface AnimationEntry {
    frameId: string;
    ms: number;
}

/**
 * What of a tag decides its playback. A tag of the document has these fields; so can a value
 * made for the occasion, such as "all frames, forward, without end".
 */
export type TagPlayback = Pick<Tag, "fromFrameId" | "toFrameId" | "direction" | "repeat">;

/**
 * The frames a tag plays, in order, each with its duration (SPEC §7.4). Editor playback and
 * every export take the sequence from here, so they cannot disagree.
 *
 * One pass over the frames `a b c d` of the tag's range is:
 * - forward: `a b c d`
 * - reverse: `d c b a`
 * - ping-pong: `a b c d c b`: forward, then back without repeating either end, so that a
 *   loop of it does not show a frame twice in a row. For one frame it is `a`, for two `a b`.
 *
 * `repeat = n > 0` gives n passes one after the other; playback stops on the last entry.
 * `repeat = 0` means the tag loops without end, and the result is one pass: the caller
 * repeats it for as long as it plays (SPEC §9.3 writes it as a `"loop"` animation).
 *
 * The document is only read; the entries are new objects. Throws `RangeError` when the
 * range is not a run of the document's frames or `repeat` is not an integer of 0 or more.
 */
export function expandTag(doc: SpriteDoc, tag: TagPlayback): AnimationEntry[] {
    const from = frameIndex(doc, tag.fromFrameId);
    const to = frameIndex(doc, tag.toFrameId);
    if (from === -1 || to === -1 || from > to) {
        throw new RangeError(
            `expandTag: frames "${tag.fromFrameId}" to "${tag.toFrameId}" are not a run of ` +
                `the document's frames.`,
        );
    }
    if (!Number.isInteger(tag.repeat) || tag.repeat < 0) {
        throw new RangeError(`expandTag: ${tag.repeat} is not a repeat count.`);
    }

    const range = doc.frames.slice(from, to + 1);
    const back = [...range].reverse();
    const pass = {
        forward: range,
        reverse: back,
        // Without its first entry, the far end, and its last, the near end.
        pingpong: [...range, ...back.slice(1, -1)],
    }[tag.direction];

    const entries: AnimationEntry[] = [];
    for (let done = 0; done < Math.max(tag.repeat, 1); done++) {
        for (const frame of pass) entries.push({ frameId: frame.id, ms: frame.durationMs });
    }
    return entries;
}
