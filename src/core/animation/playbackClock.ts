import { activeTagAt, frameIndex } from "../model";
import type { SpriteDoc } from "../model";
import { expandTag } from "./expandTag";
import type { AnimationEntry } from "./expandTag";

// The clock of editor playback (SPEC §7.5, SE-024): which entry of a sequence shows at a given
// elapsed time. Time is whatever the caller measures: the editor counts visible time only, so
// the clock is paused while the page is hidden. No DOM and no timers here.
//
// A tag played n times is one pass and a pass count, never n passes written out: a tag of
// 65 535 frames with `repeat = 255` would otherwise be millions of entries at Play, and the
// entry at a time is found by a binary search over the pass's start times (SE-024 review F).

/** What editor playback plays from a frame: one pass, how many, where it starts. */
export interface PlaybackSequence {
    /** One pass of the sequence, in playing order; at least one entry. */
    readonly pass: readonly AnimationEntry[];
    /** How many passes play: the tag's `repeat`; 0 plays without end. */
    readonly passes: number;
    /** True when the sequence repeats without end: no tag, or a tag with `repeat = 0`. */
    readonly loop: boolean;
    /** The entry of the first pass playback starts at. */
    readonly start: number;
    /** The tag played, or null for all frames. */
    readonly tagId: string | null;
    /**
     * Every entry of every pass, written out (`expandTag`'s sequence). Built when read, for
     * tests and readers of short sequences; playback itself reads `pass`.
     */
    readonly entries: readonly AnimationEntry[];
}

/**
 * The sequence editor playback plays from `frameId` (SPEC §7.5): the active tag at that frame
 * (`expandTag`'s pass and the tag's repeat count), or every frame forward, looping, when no tag
 * contains it. Playback starts at the frame's first entry; a sequence that does not loop and
 * would start at its last entry, with nothing left to play, starts at its first instead.
 * Throws `RangeError` when the document has no such frame.
 */
export function playbackSequence(doc: SpriteDoc, frameId: string): PlaybackSequence {
    const index = frameIndex(doc, frameId);
    const first = doc.frames[0];
    const last = doc.frames[doc.frames.length - 1];
    if (index === -1 || !first || !last) {
        throw new RangeError(`playbackSequence: the document has no frame "${frameId}".`);
    }
    const tag = activeTagAt(doc, index);
    const range = tag ?? {
        fromFrameId: first.id,
        toFrameId: last.id,
        direction: "forward" as const,
        repeat: 0,
    };
    // One pass: `expandTag` writes `repeat` passes, and one for 0.
    const pass = expandTag(doc, { ...range, repeat: 1 });
    const passes = tag ? tag.repeat : 0;
    const loop = passes === 0;
    let start = Math.max(
        0,
        pass.findIndex((entry) => entry.frameId === frameId),
    );
    if (passes === 1 && start === pass.length - 1) start = 0;
    let expanded: AnimationEntry[] | null = null;
    return {
        pass,
        passes,
        loop,
        start,
        tagId: tag?.id ?? null,
        get entries() {
            expanded ??= Array.from({ length: Math.max(passes, 1) }, () => pass).flat();
            return expanded;
        },
    };
}

/** Where a sequence is at some elapsed time. */
export interface PlaybackPosition {
    /** The entry showing, counted over every pass. */
    index: number;
    frameId: string;
    /** True once a sequence that does not loop has played to its end: it stays on its last entry. */
    ended: boolean;
}

/** Total duration of `entries`, in milliseconds. */
export function sequenceDuration(entries: readonly AnimationEntry[]): number {
    let total = 0;
    for (const entry of entries) total += entry.ms;
    return total;
}

/**
 * The entry showing `elapsed` milliseconds into a sequence: each entry shows from its start,
 * included, to its end, excluded. A looping sequence starts again at its total duration; one
 * that does not loop stays on its last entry from then on (`ended`). Negative time is 0.
 */
export function entryAt(
    entries: readonly AnimationEntry[],
    elapsed: number,
    loop: boolean,
): { index: number; ended: boolean } {
    const last = entries.length - 1;
    if (last < 0) throw new RangeError("entryAt: the sequence has no entry.");
    const ends = entryEnds(entries);
    const total = ends[last]!;
    let time = Math.max(0, elapsed);
    if (time >= total) {
        if (!loop) return { index: last, ended: true };
        time %= total;
    }
    return { index: entryEndingAfter(ends, time), ended: false };
}

/** The end of each entry, in milliseconds from the start of the pass. */
function entryEnds(entries: readonly AnimationEntry[]): Float64Array {
    const ends = new Float64Array(entries.length);
    let end = 0;
    for (let index = 0; index < entries.length; index++) {
        end += entries[index]!.ms;
        ends[index] = end;
    }
    return ends;
}

/** The first entry whose end is after `time` (`time` below the last end): a binary search. */
function entryEndingAfter(ends: Float64Array, time: number): number {
    let low = 0;
    let high = ends.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (ends[middle]! > time) high = middle;
        else low = middle + 1;
    }
    return low;
}

/** Whether `speed` is a playback speed: a finite number above 0. */
function checkSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0) {
        throw new RangeError(`PlaybackClock: ${speed} is not a playback speed.`);
    }
}

/** What a clock plays: a sequence's pass and passes, or entries played once or looping. */
export type ClockSequence =
    | Pick<PlaybackSequence, "pass" | "passes" | "start">
    | {
          readonly entries: readonly AnimationEntry[];
          readonly loop: boolean;
          readonly start: number;
      };

/**
 * Plays a sequence against a time source the caller reads: `advance(now)` adds the time since
 * the last reading, times the speed, to the elapsed time. Time while paused does not count, and
 * a change of speed applies from the moment it is made. The clock keeps the time within the
 * current pass and counts the passes, so neither the time nor the work of a reading grows with
 * how long it plays or how many passes there are: a reading is a binary search in the pass.
 */
export class PlaybackClock {
    /** One pass. */
    readonly pass: readonly AnimationEntry[];
    /** Passes to play; 0 plays without end. */
    readonly passes: number;
    readonly loop: boolean;
    readonly #ends: Float64Array;
    readonly #passMs: number;
    /** Passes played in full. */
    #done = 0;
    /** Milliseconds played of the current pass. */
    #time: number;
    #ended = false;
    #speed: number;
    /** The time last read; null while paused. */
    #last: number | null;

    constructor(sequence: ClockSequence, now: number, speed = 1) {
        checkSpeed(speed);
        if ("pass" in sequence) {
            this.pass = sequence.pass;
            this.passes = sequence.passes;
        } else {
            this.pass = sequence.entries;
            this.passes = sequence.loop ? 0 : 1;
        }
        if (this.pass.length === 0) throw new RangeError("PlaybackClock: no entry.");
        if (!Number.isInteger(this.passes) || this.passes < 0) {
            throw new RangeError(`PlaybackClock: ${this.passes} is not a pass count.`);
        }
        this.loop = this.passes === 0;
        this.#ends = entryEnds(this.pass);
        this.#passMs = this.#ends[this.#ends.length - 1]!;
        const start = Math.max(0, Math.floor(sequence.start));
        const length = this.pass.length;
        this.#done = this.loop ? 0 : Math.min(Math.floor(start / length), this.passes - 1);
        const inPass = start % length;
        this.#time = inPass === 0 ? 0 : this.#ends[inPass - 1]!;
        this.#speed = speed;
        this.#last = now;
    }

    /**
     * Milliseconds of the sequence played: within one pass for a looping sequence, from the
     * start of the first pass otherwise.
     */
    get elapsed(): number {
        return this.#done * this.#passMs + this.#time;
    }

    get speed(): number {
        return this.#speed;
    }

    get paused(): boolean {
        return this.#last === null;
    }

    /** Counts the time up to `now` at the old speed, then plays on at `speed`. */
    setSpeed(speed: number, now: number): void {
        checkSpeed(speed);
        this.advance(now);
        this.#speed = speed;
    }

    /** Counts the time up to `now`; time from then until `resume` does not count. */
    pause(now: number): void {
        this.advance(now);
        this.#last = null;
    }

    /** Counts time again from `now`. */
    resume(now: number): void {
        if (this.#last === null) this.#last = now;
    }

    /** Adds the time since the last reading, times the speed. A clock read backwards adds nothing. */
    advance(now: number): void {
        const last = this.#last;
        if (last === null || this.#ended) return;
        this.#last = Math.max(last, now);
        this.#time += Math.max(0, now - last) * this.#speed;
        if (this.#time < this.#passMs) return;
        const passes = Math.floor(this.#time / this.#passMs);
        this.#time -= passes * this.#passMs;
        if (this.loop) return;
        this.#done += passes;
        if (this.#done >= this.passes) {
            this.#done = this.passes - 1;
            this.#time = this.#passMs;
            this.#ended = true;
        }
    }

    /** The entry showing now (as of the last `advance`). */
    position(): PlaybackPosition {
        const last = this.pass.length - 1;
        const index = this.#ended ? last : entryEndingAfter(this.#ends, this.#time);
        return {
            index: this.#done * this.pass.length + index,
            frameId: this.pass[index]!.frameId,
            ended: this.#ended,
        };
    }
}
