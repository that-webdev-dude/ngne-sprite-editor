import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasAnimation } from "../../src/core/export";
import {
    DemandScheduler,
    frameDelay,
    TICK_MS,
    untilNextEntry,
} from "../../src/engine/preview/demandScheduler";

// SE-054: the preview's frames on demand. The next frame comes when the image can change: at
// once after a change, and at the tick the playing animation reaches its next entry; never
// for a still image. The game's clock skips the time a change of the rate says not to count.

const loop: AtlasAnimation = {
    playback: "loop",
    durationMs: 300,
    entries: [
        { frame: "a", ms: 100 },
        { frame: "b", ms: 50 },
        { frame: "c", ms: 150 },
    ],
};
const once: AtlasAnimation = { ...loop, playback: "once" };

describe("untilNextEntry", () => {
    it("is the time to the end of the entry shown, start-inclusive", () => {
        expect(untilNextEntry(loop, 0)).toBe(100);
        expect(untilNextEntry(loop, 99.5)).toBe(0.5);
        expect(untilNextEntry(loop, 100)).toBe(50);
        expect(untilNextEntry(loop, 260)).toBe(40);
        // A loop starts over.
        expect(untilNextEntry(loop, 300)).toBe(100);
        expect(untilNextEntry(loop, 1260)).toBe(40);
    });

    it("is Infinity when nothing will change", () => {
        expect(untilNextEntry(once, 299)).toBe(1);
        expect(untilNextEntry(once, 300)).toBe(Infinity);
        const single: AtlasAnimation = {
            playback: "loop",
            durationMs: 100,
            entries: [{ frame: "a", ms: 100 }],
        };
        expect(untilNextEntry(single, 20)).toBe(Infinity);
    });
});

describe("frameDelay", () => {
    it("counts whole ticks at the speed", () => {
        // 100 ms is six ticks of 16.67 ms (the sixth reaches it).
        expect(frameDelay(loop, 0, 1)).toBeCloseTo(6 * TICK_MS, 9);
        // At 4×, a tick is 66.7 game ms: two ticks.
        expect(frameDelay(loop, 0, 4)).toBeCloseTo(2 * TICK_MS, 9);
        // At least one tick.
        expect(frameDelay(loop, 99.9, 1)).toBeCloseTo(TICK_MS, 9);
        expect(frameDelay(loop, 0, 0)).toBe(Infinity);
        expect(frameDelay(once, 400, 1)).toBe(Infinity);
    });
});

describe("DemandScheduler", () => {
    let frames: FrameRequestCallback[];
    beforeEach(() => {
        vi.useFakeTimers();
        frames = [];
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.stubGlobal("cancelAnimationFrame", (id: number) => {
            frames[id - 1] = () => {
                throw new Error("cancelled frame ran");
            };
        });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    /** Runs the animation frames requested so far. */
    const runFrames = () => {
        const due = frames.splice(0);
        for (const frame of due) frame(performance.now());
        return due.length;
    };

    it("runs the first frame at the next animation frame, then waits for `due`", () => {
        let due = 100;
        const scheduler = new DemandScheduler(() => due);
        const ran: number[] = [];
        const callback = (time: number) => {
            ran.push(time);
            scheduler.request(callback);
        };
        scheduler.request(callback);
        expect(runFrames()).toBe(1);
        expect(ran).toHaveLength(1);
        // The next one waits `due` less half a tick, then for an animation frame.
        expect(runFrames()).toBe(0);
        vi.advanceTimersByTime(due - TICK_MS / 2 - 3);
        expect(runFrames()).toBe(0);
        // From that frame on there is nothing to wait for: no frame at all.
        due = Infinity;
        vi.advanceTimersByTime(6);
        expect(runFrames()).toBe(1);
        expect(ran).toHaveLength(2);
        vi.advanceTimersByTime(60_000);
        expect(runFrames()).toBe(0);
        // Until something changes.
        scheduler.wake();
        expect(runFrames()).toBe(1);
    });

    it("hands the game a clock that skip() stops for the time since the last frame", () => {
        const scheduler = new DemandScheduler(() => Infinity);
        const clock: number[] = [];
        const callback = (time: number) => {
            clock.push(time);
            scheduler.request(callback);
        };
        scheduler.request(callback);
        frames.splice(0)[0]!(1000);
        expect(clock).toEqual([1000]);
        expect(scheduler.lastFrameAt).toBe(1000);
        // 500 ms later the rate changes: those 500 ms are not the game's to count.
        scheduler.skip(1500);
        scheduler.wake();
        frames.splice(0)[0]!(1516);
        expect(clock[1]).toBeCloseTo(1016, 9);
        expect(scheduler.lastFrameAt).toBeCloseTo(1516, 9);
        // Never back in time, even for an animation frame stamped before the skip.
        scheduler.skip(1600);
        scheduler.wake();
        frames.splice(0)[0]!(1590);
        expect(clock[2]).toBeCloseTo(1016, 9);
    });

    it("wake() runs the frame at the next animation frame, also when asked for during a frame", () => {
        const scheduler = new DemandScheduler(() => Infinity);
        let woke = false;
        const callback = () => {
            if (!woke) {
                // A change made while the frame runs, after it drew.
                woke = true;
                scheduler.wake();
            }
            scheduler.request(callback);
        };
        scheduler.request(callback);
        expect(runFrames()).toBe(1);
        // The change of that frame is drawn by the next one, at once.
        expect(runFrames()).toBe(1);
        expect(runFrames()).toBe(0);
        scheduler.wake();
        expect(runFrames()).toBe(1);
    });

    it("cancel() runs no frame", () => {
        const scheduler = new DemandScheduler(() => 50);
        const callback = vi.fn();
        const id = scheduler.request(callback);
        scheduler.cancel(id);
        vi.advanceTimersByTime(2000);
        frames.splice(0);
        expect(callback).not.toHaveBeenCalled();
        scheduler.wake();
        expect(frames).toHaveLength(0);
    });
});
