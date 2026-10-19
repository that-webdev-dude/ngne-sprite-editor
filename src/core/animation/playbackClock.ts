import { activeTagAt, frameIndex } from "../model";
import type { SpriteDoc } from "../model";
import { expandTag } from "./expandTag";
import type { AnimationEntry } from "./expandTag";

// The clock of editor playback (SPEC §7.5, SE-024): which entry of a sequence shows at a given
// elapsed time. Time is whatever the caller measures: the editor counts visible time only, so
// the clock is paused while the page is hidden. No DOM and no timers here.

/** What editor playback plays from a frame: the sequence, whether it loops, where it starts. */
export interface PlaybackSequence {
    /** The entries in playing order; at least one. */
    readonly entries: readonly AnimationEntry[];
    /** True when the sequence repeats without end: no tag, or a tag with `repeat = 0`. */
    readonly loop: boolean;
    /** The entry playback starts at. */
    readonly start: number;
    /** The tag played, or null for all frames. */
    readonly tagId: string | null;
}

/**
 * The sequence editor playback plays from `frameId` (SPEC §7.5): the active tag at that frame
 * expanded (`expandTag`), or every frame forward, looping, when no tag contains it. Playback
 * starts at the frame's first entry; a sequence that does not loop and would start at its last
 * entry, with nothing left to play, starts at its first instead. Throws `RangeError` when the
 * document has no such frame.
 */
export function playbackSequence(doc: SpriteDoc, frameId: string): PlaybackSequence {
    const index = frameIndex(doc, frameId);
    const first = doc.frames[0];
    const last = doc.frames[doc.frames.length - 1];
    if (index === -1 || !first || !last) {
        throw new RangeError(`playbackSequence: the document has no frame "${frameId}".`);
    }
    const tag = activeTagAt(doc, index);
    const entries = expandTag(
        doc,
        tag ?? { fromFrameId: first.id, toFrameId: last.id, direction: "forward", repeat: 0 },
    );
    const loop = !tag || tag.repeat === 0;
    let start = Math.max(
        0,
        entries.findIndex((entry) => entry.frameId === frameId),
    );
    if (!loop && start === entries.length - 1) start = 0;
    return { entries, loop, start, tagId: tag?.id ?? null };
}

/** Where a sequence is at some elapsed time. */
export interface PlaybackPosition {
    /** The entry showing. */
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
    const total = sequenceDuration(entries);
    let time = Math.max(0, elapsed);
    if (time >= total) {
        if (!loop) return { index: last, ended: true };
        time %= total;
    }
    let end = 0;
    for (const [index, entry] of entries.entries()) {
        end += entry.ms;
        if (time < end) return { index, ended: false };
    }
    return { index: last, ended: false };
}

/** Whether `speed` is a playback speed: a finite number above 0. */
function checkSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0) {
        throw new RangeError(`PlaybackClock: ${speed} is not a playback speed.`);
    }
}

/**
 * Plays a sequence against a time source the caller reads: `advance(now)` adds the time since
 * the last reading, times the speed, to the sequence's elapsed time. Time while paused does not
 * count, and a change of speed applies from the moment it is made. The elapsed time of a looping
 * sequence is kept within one pass, so it does not lose precision however long it plays.
 */
export class PlaybackClock {
    readonly entries: readonly AnimationEntry[];
    readonly loop: boolean;
    readonly #total: number;
    #elapsed: number;
    #speed: number;
    /** The time last read; null while paused. */
    #last: number | null;

    constructor(
        sequence: Pick<PlaybackSequence, "entries" | "loop" | "start">,
        now: number,
        speed = 1,
    ) {
        checkSpeed(speed);
        if (sequence.entries.length === 0) throw new RangeError("PlaybackClock: no entry.");
        this.entries = sequence.entries;
        this.loop = sequence.loop;
        this.#total = sequenceDuration(sequence.entries);
        this.#elapsed = sequenceDuration(sequence.entries.slice(0, sequence.start));
        this.#speed = speed;
        this.#last = now;
    }

    /** Milliseconds of the sequence played, within one pass for a looping sequence. */
    get elapsed(): number {
        return this.#elapsed;
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
        if (last === null) return;
        this.#last = Math.max(last, now);
        this.#elapsed += Math.max(0, now - last) * this.#speed;
        if (this.#elapsed >= this.#total) {
            this.#elapsed = this.loop ? this.#elapsed % this.#total : this.#total;
        }
    }

    /** The entry showing now (as of the last `advance`). */
    position(): PlaybackPosition {
        const { index, ended } = entryAt(this.entries, this.#elapsed, this.loop);
        return { index, frameId: this.entries[index]!.frameId, ended };
    }
}
