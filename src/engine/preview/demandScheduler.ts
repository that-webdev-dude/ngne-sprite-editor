import type { AtlasAnimation } from "../../core/export/sprite-runtime";

// The preview's frames on demand (SE-054). NGNE's `BrowserGame` asks its scheduler for the next
// frame after each one; with `requestAnimationFrame` it would draw at the display's rate
// whether or not anything changed. This scheduler runs the next frame only when the image can
// differ: at once after a change the host reports (`wake`), and when the playing animation
// reaches its next entry. A preview that shows a still image submits no frame.
//
// The game's fixed step counts the time between two frames; the scheduler hands it a clock of
// its own, which `skip` stops for the time since the last frame, so that a change of the rate
// (pause, speed) does not apply to time that passed before it.

/** NGNE's fixed tick (`Game.dt` default), in milliseconds. */
export const TICK_MS = 1000 / 60;

/** What `FrameScheduler` is in NGNE: `request` and `cancel` of an animation frame. */
export interface FrameSchedulerLike {
    request(callback: FrameRequestCallback): number;
    cancel(id: number): void;
}

/**
 * Game milliseconds from `ageMs` until `animation` shows another entry; Infinity when it
 * never will (a "once" animation at its end, or a loop of one entry).
 */
export function untilNextEntry(animation: AtlasAnimation, ageMs: number): number {
    const { playback, durationMs, entries } = animation;
    if (entries.length === 0 || !(durationMs > 0)) return Infinity;
    const age = Math.max(ageMs, 0);
    if (playback === "once" && age >= durationMs) return Infinity;
    if (playback === "loop" && entries.length === 1) return Infinity;
    const local = playback === "loop" ? age % durationMs : age;
    let end = 0;
    for (const entry of entries) {
        end += entry.ms;
        if (local < end) return end - local;
    }
    return Infinity;
}

/**
 * Milliseconds of real time until the frame after which `animation`, playing at `speed` from
 * `ageMs`, shows another entry: whole ticks, since the age moves a tick at a time.
 */
export function frameDelay(animation: AtlasAnimation, ageMs: number, speed: number): number {
    if (!(speed > 0)) return Infinity;
    const game = untilNextEntry(animation, ageMs);
    if (!Number.isFinite(game)) return Infinity;
    const ticks = Math.max(1, Math.ceil(game / (TICK_MS * speed) - 1e-9));
    return ticks * TICK_MS;
}

/**
 * A `FrameScheduler` that runs the frame the game asks for after `due()` milliseconds (at the
 * animation frame after that), never while `due()` is Infinity, and at the next animation
 * frame after `wake()`.
 */
export class DemandScheduler implements FrameSchedulerLike {
    readonly #due: () => number;
    #pending: FrameRequestCallback | null = null;
    #id = 0;
    #frame = 0;
    #timer: ReturnType<typeof setTimeout> | undefined;
    /** A change waits to be drawn. */
    #dirty = true;
    /** Real time less the time handed to the game. */
    #offset = 0;
    /** The time handed to the game for its last frame; null before one. */
    #last: number | null = null;

    constructor(due: () => number) {
        this.#due = due;
    }

    /** The real time (`performance.now()`) of the last frame; null before one. */
    get lastFrameAt(): number | null {
        return this.#last === null ? null : this.#last + this.#offset;
    }

    request(callback: FrameRequestCallback): number {
        this.#pending = callback;
        this.#arm();
        return ++this.#id;
    }

    cancel(id: number): void {
        if (id !== this.#id) return;
        this.#pending = null;
        this.#disarm();
    }

    /** Something drawn changed: the next frame runs at the next animation frame. */
    wake(): void {
        this.#dirty = true;
        if (this.#pending) this.#arm();
    }

    /** The time since the last frame is not counted by the game: its clock stood still. */
    skip(now = performance.now()): void {
        if (this.#last !== null) this.#offset = now - this.#last;
    }

    #disarm(): void {
        if (this.#frame) cancelAnimationFrame(this.#frame);
        this.#frame = 0;
        clearTimeout(this.#timer);
        this.#timer = undefined;
    }

    #arm(): void {
        this.#disarm();
        if (!this.#pending) return;
        const due = this.#dirty ? 0 : Math.max(this.#due(), 0);
        if (!Number.isFinite(due)) return;
        // A frame waits for the animation frame after the delay: it lands on a vsync.
        const delay = due - TICK_MS / 2;
        if (delay <= 0) {
            this.#frame = requestAnimationFrame(this.#run);
        } else {
            this.#timer = setTimeout(() => {
                this.#timer = undefined;
                this.#frame = requestAnimationFrame(this.#run);
            }, delay);
        }
    }

    readonly #run = (time: number): void => {
        this.#frame = 0;
        const callback = this.#pending;
        if (!callback) return;
        this.#pending = null;
        this.#dirty = false;
        // Never back in time: the game's fixed step refuses a negative duration.
        const clock = Math.max(time - this.#offset, this.#last ?? -Infinity);
        this.#last = clock;
        callback(clock);
    };
}
