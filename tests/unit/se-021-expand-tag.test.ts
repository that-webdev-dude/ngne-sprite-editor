import { describe, expect, it } from "vitest";
import { expandTag } from "../../src/core/animation";
import type { TagPlayback } from "../../src/core/animation";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { SpriteDoc, Tag } from "../../src/core/model";

// SE-021: `expandTag`, the sequences of SPEC §7.4. Frames are named by one letter, so a
// sequence reads as in the SPEC: "a b c d c b".

type Direction = Tag["direction"];

/** A document with the frames `a`, `b`, … of durations 10, 20, … ms. */
function sprite(frames: number): SpriteDoc {
    const { doc } = createDocument({ name: "tags", width: 2, height: 2 }, sequentialIds());
    doc.frames = Array.from({ length: frames }, (_, index) => ({
        id: String.fromCharCode(97 + index),
        durationMs: (index + 1) * 10,
    }));
    return doc;
}

function playback(range: string, direction: Direction, repeat = 0): TagPlayback {
    const frames = range.split(" ");
    return { fromFrameId: frames[0], toFrameId: frames[frames.length - 1], direction, repeat };
}

/** The frames of the expansion, as letters. */
function sequence(doc: SpriteDoc, tag: TagPlayback): string {
    return expandTag(doc, tag)
        .map((entry) => entry.frameId)
        .join(" ");
}

describe("expandTag, one pass", () => {
    it.each([
        { range: "a", direction: "forward", expected: "a" },
        { range: "a", direction: "reverse", expected: "a" },
        { range: "a", direction: "pingpong", expected: "a" },
        { range: "a b", direction: "forward", expected: "a b" },
        { range: "a b", direction: "reverse", expected: "b a" },
        { range: "a b", direction: "pingpong", expected: "a b" },
        { range: "a b c d e", direction: "forward", expected: "a b c d e" },
        { range: "a b c d e", direction: "reverse", expected: "e d c b a" },
        { range: "a b c d e", direction: "pingpong", expected: "a b c d e d c b" },
    ] as const)("$direction over `$range` is `$expected`", ({ range, direction, expected }) => {
        const doc = sprite(5);
        expect(sequence(doc, playback(range, direction))).toBe(expected);
    });

    it("gives the sequences of SPEC §7.4 for the frames `a b c d`", () => {
        const doc = sprite(4);
        expect(sequence(doc, playback("a b c d", "forward"))).toBe("a b c d");
        expect(sequence(doc, playback("a b c d", "reverse"))).toBe("d c b a");
        expect(sequence(doc, playback("a b c d", "pingpong"))).toBe("a b c d c b");
    });

    it("ping-pong of three frames turns at the far end once", () => {
        expect(sequence(sprite(3), playback("a b c", "pingpong"))).toBe("a b c b");
    });

    it("covers the tag's range only, wherever it lies among the frames", () => {
        const doc = sprite(6);
        expect(sequence(doc, playback("c d e", "forward"))).toBe("c d e");
        expect(sequence(doc, playback("c d e", "reverse"))).toBe("e d c");
        expect(sequence(doc, playback("c d e", "pingpong"))).toBe("c d e d");
        expect(sequence(doc, playback("f", "pingpong"))).toBe("f");
    });

    it("gives each entry the duration of its frame", () => {
        const doc = sprite(5);
        expect(expandTag(doc, playback("b c d", "pingpong"))).toEqual([
            { frameId: "b", ms: 20 },
            { frameId: "c", ms: 30 },
            { frameId: "d", ms: 40 },
            { frameId: "c", ms: 30 },
        ]);
        expect(expandTag(doc, playback("d e", "reverse"))).toEqual([
            { frameId: "e", ms: 50 },
            { frameId: "d", ms: 40 },
        ]);
    });
});

describe("expandTag, repeat", () => {
    const passes: { direction: Direction; pass: string }[] = [
        { direction: "forward", pass: "a b c d e" },
        { direction: "reverse", pass: "e d c b a" },
        { direction: "pingpong", pass: "a b c d e d c b" },
    ];

    it.each(passes)("repeat 0 is one pass of $direction: the loop", ({ direction, pass }) => {
        expect(sequence(sprite(5), playback("a b c d e", direction, 0))).toBe(pass);
    });

    it.each(passes)("repeat 1 is one pass of $direction", ({ direction, pass }) => {
        expect(sequence(sprite(5), playback("a b c d e", direction, 1))).toBe(pass);
    });

    it.each(passes)("repeat 3 is three passes of $direction", ({ direction, pass }) => {
        expect(sequence(sprite(5), playback("a b c d e", direction, 3))).toBe(
            [pass, pass, pass].join(" "),
        );
    });

    it("repeats a range of one frame and of two frames", () => {
        const doc = sprite(2);
        for (const direction of ["forward", "reverse", "pingpong"] as const) {
            expect(sequence(doc, playback("a", direction, 0))).toBe("a");
            expect(sequence(doc, playback("a", direction, 3))).toBe("a a a");
        }
        expect(sequence(doc, playback("a b", "forward", 3))).toBe("a b a b a b");
        expect(sequence(doc, playback("a b", "reverse", 3))).toBe("b a b a b a");
        expect(sequence(doc, playback("a b", "pingpong", 3))).toBe("a b a b a b");
    });

    it("the total duration of repeat n is n times that of one pass", () => {
        const doc = sprite(5);
        const total = (repeat: number) =>
            expandTag(doc, playback("a b c d e", "pingpong", repeat)).reduce(
                (sum, entry) => sum + entry.ms,
                0,
            );
        // a b c d e d c b: 10 + 20 + 30 + 40 + 50 + 40 + 30 + 20.
        expect(total(1)).toBe(240);
        expect(total(0)).toBe(240);
        expect(total(3)).toBe(720);
    });
});

describe("expandTag, the function", () => {
    it("takes a tag of the document", () => {
        const doc = sprite(4);
        const tag: Tag = {
            id: "walk",
            name: "walk",
            color: 0xff0000ff,
            fromFrameId: "b",
            toFrameId: "d",
            direction: "pingpong",
            repeat: 2,
        };
        doc.tags = [tag];
        expect(sequence(doc, tag)).toBe("b c d c b c d c");
    });

    it("reads the document and changes nothing; every call returns new entries", () => {
        const doc = sprite(4);
        const tag = playback("a b c d", "pingpong", 2);
        const before = structuredClone({ doc, tag });

        const first = expandTag(doc, tag);
        const second = expandTag(doc, tag);

        expect({ doc, tag }).toStrictEqual(before);
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
        // Also within one result: the two passes do not share an entry object.
        expect(first[0]).toEqual(first[6]);
        expect(first[0]).not.toBe(first[6]);
    });

    it("follows the document: a changed duration or order shows in the next call", () => {
        const doc = sprite(3);
        const tag = playback("a b c", "forward");
        doc.frames[1].durationMs = 75;
        expect(expandTag(doc, tag).map((entry) => entry.ms)).toEqual([10, 75, 30]);
        doc.frames.splice(1, 1);
        expect(sequence(doc, tag)).toBe("a c");
    });

    it("rejects a range that is not a run of the document's frames", () => {
        const doc = sprite(3);
        const tag = (fromFrameId: string, toFrameId: string): TagPlayback => ({
            fromFrameId,
            toFrameId,
            direction: "forward",
            repeat: 0,
        });
        expect(() => expandTag(doc, tag("x", "b"))).toThrow(RangeError);
        expect(() => expandTag(doc, tag("a", "x"))).toThrow(RangeError);
        expect(() => expandTag(doc, tag("c", "a"))).toThrow(RangeError);
        expect(sequence(doc, tag("b", "b"))).toBe("b");
    });

    it("rejects a repeat that is not a count", () => {
        const doc = sprite(2);
        for (const repeat of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => expandTag(doc, playback("a b", "forward", repeat))).toThrow(RangeError);
        }
    });
});
