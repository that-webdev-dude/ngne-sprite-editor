import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Tag } from "../../src/core/model";
import { followFrames } from "../../src/core/tags";

// SE-021: `followFrames`, the rule by which tags follow their frames. A frame is one letter,
// a frame list a word, and a tag the run of letters it covers: the tag "bcd" of "abcdef"
// runs from frame b to frame d.

function tag(id: string, run: string): Tag {
    return {
        id,
        name: `tag ${id}`,
        color: 0x11223344,
        fromFrameId: run[0],
        toFrameId: run[run.length - 1],
        direction: "pingpong",
        repeat: 3,
    };
}

/** The frames a tag covers in a frame list, as a word. */
function runOf(frames: string, { fromFrameId, toFrameId }: Tag): string {
    return frames.slice(frames.indexOf(fromFrameId), frames.indexOf(toFrameId) + 1);
}

/**
 * The runs of the tags `runs` (by tag ID) after the frame list `before` became `after`;
 * a tag that was removed is absent.
 */
function follow(
    before: string,
    runs: Record<string, string>,
    after: string,
    moved = "",
): Record<string, string> {
    const tags = Object.entries(runs).map(([id, run]) => tag(id, run));
    const followed = followFrames(tags, {
        before: [...before],
        after: [...after],
        moved: [...moved],
    });
    return Object.fromEntries(followed.map((item) => [item.id, runOf(after, item)]));
}

/** `frames` with the frames of `moved` taken out and put back before position `beforeIndex`. */
function move(frames: string, moved: string, beforeIndex: number): string {
    const rest = [...frames].filter((frame) => !moved.includes(frame));
    const gap = [...frames.slice(0, beforeIndex)].filter((f) => !moved.includes(f)).length;
    const block = [...frames].filter((frame) => moved.includes(frame));
    return [...rest.slice(0, gap), ...block, ...rest.slice(gap)].join("");
}

/** `frames` with the run from position `from` to `to` reversed. */
function reverse(frames: string, from: number, to: number): string {
    const middle = [...frames.slice(from, to + 1)].reverse().join("");
    return frames.slice(0, from) + middle + frames.slice(to + 1);
}

/** Every way to pick some of the letters of `frames`, the empty one included. */
function subsets(frames: string): string[] {
    return Array.from({ length: 1 << frames.length }, (_, mask) =>
        [...frames].filter((_, index) => mask & (1 << index)).join(""),
    );
}

/** Every frame list of 1 to `max` frames with every run a tag can cover in it. */
function cases(max: number): { frames: string; run: string }[] {
    const all: { frames: string; run: string }[] = [];
    for (let length = 1; length <= max; length++) {
        const frames = "abcde".slice(0, length);
        for (let from = 0; from < length; from++) {
            for (let to = from; to < length; to++) {
                all.push({ frames, run: frames.slice(from, to + 1) });
            }
        }
    }
    return all;
}

describe("followFrames after a deletion", () => {
    it.each([
        { deleted: "c", after: "abde", run: "bd", why: "an inner frame" },
        { deleted: "b", after: "acde", run: "cd", why: "the first frame" },
        { deleted: "d", after: "abce", run: "bc", why: "the last frame" },
        { deleted: "bd", after: "ace", run: "c", why: "both ends" },
        { deleted: "bc", after: "ade", run: "d", why: "all but the last" },
        { deleted: "a", after: "bcde", run: "bcd", why: "a frame before it" },
        { deleted: "e", after: "abcd", run: "bcd", why: "a frame after it" },
        { deleted: "ace", after: "bd", run: "bd", why: "frames before, inside and after" },
    ])("of $why, the tag bcd of abcde covers $run", ({ after, run }) => {
        expect(follow("abcde", { t: "bcd" }, after)).toEqual({ t: run });
    });

    it("moves an endpoint to the nearest remaining frame inside the range", () => {
        const [followed] = followFrames([tag("t", "bcd")], {
            before: [..."abcde"],
            after: [..."ace"],
        });
        expect(followed).toMatchObject({ fromFrameId: "c", toFrameId: "c" });
    });

    it("removes a tag whose range becomes empty, and only that one", () => {
        expect(follow("abcde", { t: "bcd" }, "ae")).toEqual({});
        expect(follow("abcde", { one: "c" }, "abde")).toEqual({});
        expect(follow("abcde", { all: "abcde", t: "bcd", last: "e" }, "ae")).toEqual({
            all: "ae",
            last: "e",
        });
        expect(follow("abc", { t: "abc" }, "")).toEqual({});
    });

    it("for every deletion from up to 5 frames, a tag is left with exactly its remaining frames", () => {
        let checked = 0;
        for (const { frames, run } of cases(5)) {
            for (const deleted of subsets(frames)) {
                const after = [...frames].filter((frame) => !deleted.includes(frame)).join("");
                const remaining = [...run].filter((frame) => after.includes(frame)).join("");
                expect(follow(frames, { t: run }, after)).toEqual(
                    remaining === "" ? {} : { t: remaining },
                );
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(700);
    });
});

describe("followFrames after an addition", () => {
    it.each([
        { after: "abncde", run: "bncd", why: "inside the tag" },
        { after: "abcdne", run: "bcdn", why: "after the tag's last frame" },
        { after: "anbcde", run: "bcd", why: "before the tag's first frame" },
        { after: "abcden", run: "bcd", why: "further after the tag" },
        { after: "nabcde", run: "bcd", why: "at the start of the frames" },
    ])("a frame added $why leaves the tag bcd of abcde covering $run", ({ after, run }) => {
        expect(follow("abcde", { t: "bcd" }, after)).toEqual({ t: run });
    });

    it("a frame added after a frame belongs to every tag that frame belongs to", () => {
        expect(follow("abcde", { all: "abcde", t: "bcd", one: "d" }, "abcdne")).toEqual({
            all: "abcdne",
            t: "bcdn",
            one: "dn",
        });
        // The tag that starts after it does not take it in.
        expect(follow("abcd", { first: "ab", second: "cd" }, "abncd")).toEqual({
            first: "abn",
            second: "cd",
        });
    });

    it("takes in a run of new frames after the tag's last frame", () => {
        expect(follow("abcde", { t: "bc" }, "abcnmde")).toEqual({ t: "bcnm" });
        expect(follow("abcde", { t: "bc" }, "abcdnme")).toEqual({ t: "bc" });
    });

    it("for a frame added after any frame of up to 5, the tag grows exactly when that frame is in it", () => {
        for (const { frames, run } of cases(5)) {
            for (let at = 0; at < frames.length; at++) {
                const after = `${frames.slice(0, at + 1)}n${frames.slice(at + 1)}`;
                const grown = run.includes(frames[at]);
                const expected = [...after]
                    .filter((frame) => run.includes(frame) || (grown && frame === "n"))
                    .join("");
                expect(follow(frames, { t: run }, after)).toEqual({ t: expected });
            }
        }
    });
});

describe("followFrames after a move", () => {
    it.each([
        { moved: "c", to: 6, after: "abdefc", run: "bd", why: "an inner frame dragged away" },
        {
            moved: "c",
            to: 0,
            after: "cabdef",
            run: "bd",
            why: "an inner frame dragged to the front",
        },
        { moved: "b", to: 6, after: "acdefb", run: "cd", why: "the first frame dragged away" },
        { moved: "d", to: 0, after: "dabcef", run: "bc", why: "the last frame dragged away" },
        {
            moved: "bc",
            to: 6,
            after: "adefbc",
            run: "d",
            why: "two of its three frames dragged away",
        },
        {
            moved: "ce",
            to: 0,
            after: "ceabdf",
            run: "bd",
            why: "a member dragged away with a stranger",
        },
        {
            moved: "bcd",
            to: 6,
            after: "aefbcd",
            run: "bcd",
            why: "the whole tag dragged to the end",
        },
        {
            moved: "bcd",
            to: 0,
            after: "bcdaef",
            run: "bcd",
            why: "the whole tag dragged to the front",
        },
        {
            moved: "abcd",
            to: 6,
            after: "efabcd",
            run: "bcd",
            why: "the tag dragged inside a larger block",
        },
        { moved: "a", to: 3, after: "bcadef", run: "bcad", why: "a stranger dropped inside" },
        { moved: "f", to: 2, after: "abfcde", run: "bfcd", why: "a later stranger dropped inside" },
        {
            moved: "e",
            to: 1,
            after: "aebcdf",
            run: "bcd",
            why: "a stranger dropped before its first frame",
        },
        {
            moved: "a",
            to: 4,
            after: "bcdaef",
            run: "bcd",
            why: "a stranger dropped after its last frame",
        },
        { moved: "b", to: 3, after: "acbdef", run: "cbd", why: "a reorder inside" },
        { moved: "b", to: 4, after: "acdbef", run: "cdb", why: "a member dragged to its end" },
        { moved: "d", to: 1, after: "adbcef", run: "dbc", why: "a member dragged to its start" },
        { moved: "bc", to: 4, after: "adbcef", run: "dbc", why: "two members dragged to its end" },
    ])("$why: bcd of abcdef covers $run", ({ moved, to, after, run }) => {
        expect(move("abcdef", moved, to)).toBe(after);
        expect(follow("abcdef", { t: "bcd" }, after, moved)).toEqual({ t: run });
    });

    it("a frame dragged from one tag into another leaves the first and joins the second", () => {
        expect(follow("abcdef", { intro: "ab", walk: "cde" }, "acbdef", "c")).toEqual({
            intro: "acb",
            walk: "de",
        });
        expect(follow("abcdef", { intro: "abc", walk: "def" }, "acdbef", "b")).toEqual({
            intro: "ac",
            walk: "dbef",
        });
    });

    it("a tag over all frames stays over all frames", () => {
        for (const moved of subsets("abcde").slice(1)) {
            for (let to = 0; to <= 5; to++) {
                const after = move("abcde", moved, to);
                expect(follow("abcde", { all: "abcde" }, after, moved)).toEqual({ all: after });
            }
        }
    });

    it("the same new order can carry a tag differently: what moved decides", () => {
        // bcd dragged before a, or a dragged behind d: either way bcd is the tag.
        expect(follow("abcdef", { t: "bcd" }, "bcdaef", "bcd")).toEqual({ t: "bcd" });
        expect(follow("abcdef", { t: "bcd" }, "bcdaef", "a")).toEqual({ t: "bcd" });
        // b dragged behind c leaves the tag ab; c dragged between a and b joins it.
        expect(follow("abcd", { t: "ab" }, "acbd", "b")).toEqual({ t: "a" });
        expect(follow("abcd", { t: "ab" }, "acbd", "c")).toEqual({ t: "acb" });
    });

    it("for every move within up to 5 frames, a tag keeps what stayed and what landed beside it", () => {
        let checked = 0;
        for (const { frames, run } of cases(5)) {
            for (const moved of subsets(frames).slice(1)) {
                for (let to = 0; to <= frames.length; to++) {
                    const after = move(frames, moved, to);
                    const followed = follow(frames, { t: run }, after, moved).t;
                    const movedMember = (frame: string | undefined) =>
                        frame !== undefined && moved.includes(frame) && run.includes(frame);
                    const stayed = [...after].filter(
                        (frame) => run.includes(frame) && !moved.includes(frame),
                    );
                    // A move never removes a tag, and never makes it an empty or broken run.
                    expect(followed).toBeDefined();
                    expect(followed.length).toBeGreaterThan(0);
                    const start = after.indexOf(followed);
                    expect(start).toBeGreaterThanOrEqual(0);

                    if (stayed.length === 0) {
                        // It travelled: the same frames, wherever they are now.
                        expect([...followed].sort()).toEqual([...run].sort());
                    } else {
                        const core = after.slice(
                            after.indexOf(stayed[0]),
                            after.indexOf(stayed[stayed.length - 1]) + 1,
                        );
                        const [left, right] = followed.split(core);
                        expect(followed).toBe(left + core + right);
                        expect([...left, ...right].every(movedMember)).toBe(true);
                        // Nothing more could have joined.
                        expect(movedMember(after[start - 1])).toBe(false);
                        expect(movedMember(after[start + followed.length])).toBe(false);
                    }
                    checked++;
                }
            }
        }
        expect(checked).toBeGreaterThan(3000);
    });
});

describe("followFrames after a reversal", () => {
    it.each([
        { from: 1, to: 3, after: "adcbef", run: "bcd", now: "dcb", why: "its own range" },
        { from: 0, to: 5, after: "fedcba", run: "bcd", now: "dcb", why: "all frames" },
        {
            from: 0,
            to: 5,
            after: "fedcba",
            run: "ab",
            now: "ba",
            why: "all frames, tag at the start",
        },
        { from: 2, to: 3, after: "abdcef", run: "bcde", now: "bdce", why: "a range inside it" },
        { from: 3, to: 4, after: "abcedf", run: "bcde", now: "bced", why: "a range at its end" },
        { from: 1, to: 2, after: "acbdef", run: "bcde", now: "cbde", why: "a range at its start" },
        { from: 1, to: 3, after: "adcbef", run: "c", now: "c", why: "a range it is the middle of" },
        { from: 3, to: 5, after: "abcfed", run: "ab", now: "ab", why: "a range beside it" },
        {
            from: 2,
            to: 5,
            after: "abfedc",
            run: "bcd",
            now: "b",
            why: "a range that takes its end away",
        },
    ])("of $why: $run of abcdef covers $now", ({ from, to, after, run, now }) => {
        expect(reverse("abcdef", from, to)).toBe(after);
        const moved = "abcdef".slice(from, to + 1);
        expect(follow("abcdef", { t: run }, after, moved)).toEqual({ t: now });
    });

    it("gives the tag the reversed endpoints when its own range is reversed", () => {
        const [followed] = followFrames([tag("t", "bcd")], {
            before: [..."abcde"],
            after: [..."adcbe"],
            moved: [..."bcd"],
        });
        expect(followed).toMatchObject({ fromFrameId: "d", toFrameId: "b" });
    });

    it("for every reversed range of up to 5 frames, a tag inside or around it keeps its frames", () => {
        let checked = 0;
        for (const { frames, run } of cases(5)) {
            const first = frames.indexOf(run[0]);
            const last = first + run.length - 1;
            for (let from = 0; from < frames.length; from++) {
                for (let to = from + 1; to < frames.length; to++) {
                    const after = reverse(frames, from, to);
                    const followed = follow(
                        frames,
                        { t: run },
                        after,
                        frames.slice(from, to + 1),
                    ).t;
                    expect(followed.length).toBeGreaterThan(0);
                    expect(after).toContain(followed);
                    const inside = from <= first && last <= to;
                    const around = first <= from && to <= last;
                    const apart = to < first || last < from;
                    if (inside || around || apart) {
                        expect([...followed].sort()).toEqual([...run].sort());
                    }
                    checked++;
                }
            }
        }
        expect(checked).toBeGreaterThan(200);
    });
});

describe("followFrames, the function", () => {
    it("returns new tags in the old order, changed in their endpoints only", () => {
        const tags = [tag("one", "ab"), tag("two", "cd"), tag("three", "bcd")];
        const before = structuredClone(tags);

        const followed = followFrames(tags, { before: [..."abcd"], after: [..."abd"] });

        expect(tags).toStrictEqual(before);
        expect(followed).toEqual([
            { ...tags[0] },
            { ...tags[1], fromFrameId: "d", toFrameId: "d" },
            { ...tags[2], fromFrameId: "b", toFrameId: "d" },
        ]);
        followed.forEach((item, index) => expect(item).not.toBe(tags[index]));
    });

    it("leaves every tag as it is when nothing changes", () => {
        const tags = [tag("one", "ab"), tag("two", "d")];
        const frames = [..."abcd"];
        expect(followFrames(tags, { before: frames, after: frames })).toEqual(tags);
        expect(followFrames(tags, { before: frames, after: frames, moved: [] })).toEqual(tags);
    });

    it("rejects a tag that is not a run of the frames before the change", () => {
        const change = { before: [..."abc"], after: [..."ab"] };
        expect(() => followFrames([tag("t", "ax")], change)).toThrow(RangeError);
        expect(() => followFrames([tag("t", "xb")], change)).toThrow(RangeError);
        expect(() => followFrames([tag("t", "ca")], change)).toThrow(RangeError);
    });
});

// Any tags over any frame list, through any change a frame command makes.

interface Scenario {
    frames: string;
    runs: string[];
    after: string;
    moved: string;
}

const scenarios: fc.Arbitrary<Scenario> = fc.integer({ min: 1, max: 7 }).chain((length) => {
    const frames = "abcdefg".slice(0, length);
    const run = fc
        .tuple(fc.nat({ max: length - 1 }), fc.nat({ max: length - 1 }))
        .map(([a, b]) => frames.slice(Math.min(a, b), Math.max(a, b) + 1));
    const picked = fc
        .array(fc.boolean(), { minLength: length, maxLength: length })
        .map((flags) => [...frames].filter((_, index) => flags[index]).join(""));
    const position = fc.nat({ max: length });
    const change = fc.oneof(
        picked.map((deleted) => ({
            after: [...frames].filter((frame) => !deleted.includes(frame)).join(""),
            moved: "",
        })),
        fc.tuple(picked, position).map(([moved, to]) => ({
            after: move(frames, moved, to),
            moved,
        })),
        fc.tuple(position, position).map(([a, b]) => {
            const from = Math.min(a, b, length - 1);
            const to = Math.min(Math.max(a, b), length - 1);
            return { after: reverse(frames, from, to), moved: frames.slice(from, to + 1) };
        }),
        fc
            .tuple(fc.nat({ max: length - 1 }), fc.integer({ min: 1, max: 2 }))
            .map(([at, count]) => ({
                after: frames.slice(0, at + 1) + "xy".slice(0, count) + frames.slice(at + 1),
                moved: "",
            })),
    );
    return fc.tuple(fc.array(run, { maxLength: 4 }), change).map(([runs, { after, moved }]) => ({
        frames,
        runs,
        after,
        moved,
    }));
});

describe("followFrames, property", () => {
    it("every tag it returns names a run of the new frame list, and no other field changes", () => {
        fc.assert(
            fc.property(scenarios, ({ frames, runs, after, moved }) => {
                const tags = runs.map((run, index) => tag(`t${index}`, run));
                const untouched = structuredClone(tags);

                const followed = followFrames(tags, {
                    before: [...frames],
                    after: [...after],
                    moved: [...moved],
                });

                expect(tags).toStrictEqual(untouched);
                // The tags that are left, in the order they had.
                const ids = followed.map((item) => item.id);
                expect(tags.map((item) => item.id).filter((id) => ids.includes(id))).toEqual(ids);
                for (const item of followed) {
                    const from = after.indexOf(item.fromFrameId);
                    const to = after.indexOf(item.toFrameId);
                    expect(from).toBeGreaterThanOrEqual(0);
                    expect(to).toBeGreaterThanOrEqual(from);
                    const old = tags.find((candidate) => candidate.id === item.id);
                    expect({ ...item, fromFrameId: "", toFrameId: "" }).toEqual({
                        ...old,
                        fromFrameId: "",
                        toFrameId: "",
                    });
                }
                // A tag is removed only when none of its frames is left.
                for (const item of tags) {
                    const left = [...runOf(frames, item)].some((frame) => after.includes(frame));
                    expect(ids.includes(item.id)).toBe(left);
                }
            }),
            { numRuns: 1000 },
        );
    });
});
