import { describe, expect, it } from "vitest";
import { entryAt, PlaybackClock, playbackSequence } from "../../src/core/animation";
import type { AnimationEntry, PlaybackSequence } from "../../src/core/animation";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { SpriteDoc, Tag } from "../../src/core/model";

// SE-024: the playback clock of SPEC §7.5 against a controlled time source. Frames are named
// by one letter, so a sequence reads as in the SPEC; time is whatever the test says it is.

/** A document with the frames `a`, `b`, … of the given durations. */
function sprite(durations: readonly number[], tags: readonly Partial<Tag>[] = []): SpriteDoc {
    const { doc } = createDocument({ name: "clock", width: 2, height: 2 }, sequentialIds());
    doc.frames = durations.map((durationMs, index) => ({
        id: String.fromCharCode(97 + index),
        durationMs,
    }));
    doc.tags = tags.map((tag, index) => ({
        id: `tag-${index}`,
        name: `tag ${index}`,
        color: 0xff0000ff,
        fromFrameId: "a",
        toFrameId: "a",
        direction: "forward",
        repeat: 0,
        ...tag,
    }));
    return doc;
}

/** The frame shown at each of `times` (ms after the start) of a clock started at time 0. */
function framesAt(sequence: PlaybackSequence, times: readonly number[], speed = 1): string {
    const clock = new PlaybackClock(sequence, 0, speed);
    return times
        .map((time) => {
            clock.advance(time);
            const { frameId, ended } = clock.position();
            return ended ? `${frameId}.` : frameId;
        })
        .join(" ");
}

const entries = (spec: string): AnimationEntry[] =>
    spec.split(" ").map((item) => {
        const [frameId = "", ms = "0"] = item.split(":");
        return { frameId, ms: Number(ms) };
    });

describe("entryAt: the entry at a time", () => {
    const mixed = entries("a:100 b:50 c:200 d:10");

    it("shows each entry from its start, included, to its end, excluded, for mixed durations", () => {
        const at = (time: number) => entryAt(mixed, time, true).index;
        expect([0, 99.999, 100, 149, 150, 349, 350, 359].map(at)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    });

    it("starts again at the total duration when it loops", () => {
        expect(entryAt(mixed, 360, true)).toEqual({ index: 0, ended: false });
        expect(entryAt(mixed, 360 + 100, true)).toEqual({ index: 1, ended: false });
        expect(entryAt(mixed, 3 * 360 + 355, true)).toEqual({ index: 3, ended: false });
    });

    it("stays on the last entry once a sequence that does not loop has ended", () => {
        expect(entryAt(mixed, 359, false)).toEqual({ index: 3, ended: false });
        expect(entryAt(mixed, 360, false)).toEqual({ index: 3, ended: true });
        expect(entryAt(mixed, 10_000, false)).toEqual({ index: 3, ended: true });
    });

    it("reads negative time as 0 and refuses an empty sequence", () => {
        expect(entryAt(mixed, -5, true)).toEqual({ index: 0, ended: false });
        expect(() => entryAt([], 0, true)).toThrow(RangeError);
    });
});

describe("playbackSequence: what plays from a frame", () => {
    it("plays every frame forward, looping, when no tag contains the frame", () => {
        const doc = sprite([100, 100, 100, 100], [{ fromFrameId: "c", toFrameId: "d" }]);
        const sequence = playbackSequence(doc, "b");
        expect(sequence.entries.map((entry) => entry.frameId).join(" ")).toBe("a b c d");
        expect(sequence).toMatchObject({ loop: true, start: 1, tagId: null });
    });

    it("plays the active tag at the frame: the shortest containing it", () => {
        const doc = sprite(
            [100, 100, 100, 100, 100],
            [
                { fromFrameId: "a", toFrameId: "e" },
                { fromFrameId: "b", toFrameId: "d", direction: "reverse", repeat: 2 },
            ],
        );
        const sequence = playbackSequence(doc, "c");
        expect(sequence.entries.map((entry) => entry.frameId).join(" ")).toBe("d c b d c b");
        expect(sequence).toMatchObject({ loop: false, start: 1, tagId: "tag-1" });
        expect(playbackSequence(doc, "a")).toMatchObject({ loop: true, start: 0, tagId: "tag-0" });
    });

    it("starts at the frame's first entry; a tag played once starts again from its end", () => {
        const doc = sprite([100, 100, 100], [{ fromFrameId: "a", toFrameId: "c", repeat: 1 }]);
        expect(playbackSequence(doc, "b").start).toBe(1);
        // At the last entry nothing would be left to play: from the first.
        expect(playbackSequence(doc, "c").start).toBe(0);
        const twice = sprite([100, 100, 100], [{ fromFrameId: "a", toFrameId: "c", repeat: 2 }]);
        expect(playbackSequence(twice, "c").start).toBe(2);
    });

    it("refuses a frame the document does not have", () => {
        expect(() => playbackSequence(sprite([100]), "z")).toThrow(RangeError);
    });
});

describe("PlaybackClock with a controlled time source", () => {
    it("shows the frame at time t for mixed durations, looping", () => {
        const doc = sprite([100, 50, 200]);
        const sequence = playbackSequence(doc, "a");
        expect(framesAt(sequence, [0, 99, 100, 149, 150, 349, 350, 450, 700])).toBe(
            "a a b b c c a b a",
        );
    });

    it("starts at the playhead", () => {
        const doc = sprite([100, 50, 200]);
        // From b: b shows 50 ms, then c, then a again.
        expect(framesAt(playbackSequence(doc, "b"), [0, 49, 50, 249, 250])).toBe("b b c c a");
    });

    it.each([
        { direction: "forward", expected: "b c d b c d" },
        { direction: "reverse", expected: "d c b d c b" },
        { direction: "pingpong", expected: "b c d c b c" },
    ] as const)("plays a looping $direction tag as $expected", ({ direction, expected }) => {
        const doc = sprite(
            [100, 100, 100, 100, 100],
            [{ fromFrameId: "b", toFrameId: "d", direction }],
        );
        const first = direction === "reverse" ? "d" : "b";
        const sequence = playbackSequence(doc, first);
        expect(framesAt(sequence, [0, 100, 200, 300, 400, 500])).toBe(expected);
    });

    it.each([
        { repeat: 1, times: [0, 100, 200, 299, 300, 1000], expected: "a b c c c. c." },
        {
            repeat: 3,
            times: [0, 300, 600, 899, 900, 5000],
            expected: "a a a c c. c.",
        },
    ])("plays a tag of repeat $repeat that many times and stops on its last entry", (row) => {
        const doc = sprite(
            [100, 100, 100],
            [{ fromFrameId: "a", toFrameId: "c", repeat: row.repeat }],
        );
        expect(framesAt(playbackSequence(doc, "a"), row.times)).toBe(row.expected);
    });

    it("stops a ping-pong tag of repeat 2 on its last entry", () => {
        const doc = sprite(
            [100, 100, 100],
            [{ fromFrameId: "a", toFrameId: "c", direction: "pingpong", repeat: 2 }],
        );
        // a b c b a b c b: 800 ms, ending on b.
        const sequence = playbackSequence(doc, "a");
        expect(framesAt(sequence, [0, 300, 400, 799, 800])).toBe("a b a b b.");
    });

    it("loops a tag of repeat 0 without end", () => {
        const doc = sprite([100, 100], [{ fromFrameId: "a", toFrameId: "b", repeat: 0 }]);
        const sequence = playbackSequence(doc, "a");
        expect(framesAt(sequence, [0, 100, 200, 100_000, 1_000_150])).toBe("a b a a b");
    });

    it("counts time at each speed from the moment the speed changes", () => {
        const doc = sprite([100, 100, 100, 100]);
        const clock = new PlaybackClock(playbackSequence(doc, "a"), 1000);
        const at = (now: number) => {
            clock.advance(now);
            return clock.position().frameId;
        };
        expect(at(1050)).toBe("a"); // 50 ms played
        clock.setSpeed(2, 1050);
        expect(at(1075)).toBe("b"); // + 25 × 2 = 100 ms
        expect(at(1125)).toBe("c"); // + 50 × 2 = 200 ms
        clock.setSpeed(0.25, 1125);
        expect(at(1524)).toBe("c"); // + 399 × 0.25 = 299.75 ms
        expect(at(1525)).toBe("d"); // + 400 × 0.25 = 300 ms
        clock.setSpeed(4, 1525);
        expect(at(1550)).toBe("a"); // + 25 × 4 = 400 ms: the loop
        expect(clock.speed).toBe(4);
    });

    it("plays from 0.25× to 4×: one pass takes four times as long, a quarter as long", () => {
        const doc = sprite([100, 100]);
        const sequence = playbackSequence(doc, "a");
        expect(framesAt(sequence, [0, 399, 400, 799, 800], 0.25)).toBe("a a b b a");
        expect(framesAt(sequence, [0, 24, 25, 49, 50], 4)).toBe("a a b b a");
    });

    it("does not count time while paused, and resumes where it was", () => {
        const doc = sprite([100, 100, 100]);
        const clock = new PlaybackClock(playbackSequence(doc, "a"), 0);
        clock.advance(150);
        clock.pause(150);
        expect(clock.paused).toBe(true);
        clock.advance(10_000);
        expect(clock.position().frameId).toBe("b");
        clock.resume(10_000);
        clock.advance(10_049);
        expect(clock.position().frameId).toBe("b");
        clock.advance(10_050);
        expect(clock.position().frameId).toBe("c");
        expect(clock.elapsed).toBe(200);
    });

    it("adds nothing for a clock read backwards", () => {
        const doc = sprite([100, 100]);
        const clock = new PlaybackClock(playbackSequence(doc, "a"), 500);
        clock.advance(400);
        expect(clock.elapsed).toBe(0);
        clock.advance(560);
        expect(clock.elapsed).toBe(60);
    });

    it("keeps a looping sequence's elapsed time within one pass", () => {
        const doc = sprite([100, 100]);
        const clock = new PlaybackClock(playbackSequence(doc, "a"), 0);
        clock.advance(1e9 + 150);
        expect(clock.elapsed).toBe(150);
        expect(clock.position().frameId).toBe("b");
    });

    it("refuses a speed that is not a positive number", () => {
        const sequence = playbackSequence(sprite([100]), "a");
        expect(() => new PlaybackClock(sequence, 0, 0)).toThrow(RangeError);
        const clock = new PlaybackClock(sequence, 0);
        expect(() => clock.setSpeed(-1, 0)).toThrow(RangeError);
        expect(() => clock.setSpeed(Number.NaN, 0)).toThrow(RangeError);
    });
});
