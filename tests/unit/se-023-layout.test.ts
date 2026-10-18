import { describe, expect, it } from "vitest";
import { createSessionsStore } from "../../src/app/state/sessions";
import { resizedSpan, SHOWN_TAG_ROWS, tagRows } from "../../src/app/timeline/tagLayout";
import type { FrameSpan } from "../../src/app/timeline/tagLayout";
import { timelineSource, timelineTags } from "../../src/app/timeline/timelineModel";
import { createDocument, sequentialIds } from "../../src/core/model";
import type { SpriteDoc, Tag } from "../../src/core/model";
import { createTagCommand, deleteTagCommand, editTagCommand } from "../../src/core/tags";

// SE-023: the layout of the tag bar — the rows that keep overlapping tags apart (DESIGN §2),
// the range a drag of a span's end gives, and the tags in the timeline model the panel draws.

/** Whether two spans share a frame. */
const overlaps = (a: FrameSpan, b: FrameSpan) => a.from <= b.to && b.from <= a.to;

/** The most spans over one frame. */
function depth(spans: readonly FrameSpan[]): number {
    const last = Math.max(-1, ...spans.map((span) => span.to));
    let most = 0;
    for (let frame = 0; frame <= last; frame++) {
        most = Math.max(
            most,
            spans.filter((span) => span.from <= frame && frame <= span.to).length,
        );
    }
    return most;
}

/** Checks the rows of `spans`: no two overlapping spans share one, and no row is wasted. */
function expectValidRows(spans: readonly FrameSpan[]) {
    const { rows, count } = tagRows(spans);
    expect(rows).toHaveLength(spans.length);
    expect(count).toBe(depth(spans));
    for (const [index, span] of spans.entries()) {
        expect(rows[index]).toBeGreaterThanOrEqual(0);
        expect(rows[index]).toBeLessThan(count);
        for (const [other, next] of spans.entries()) {
            if (other !== index && overlaps(span, next)) expect(rows[index]).not.toBe(rows[other]);
        }
    }
    return { rows, count };
}

describe("rows of the tag bar", () => {
    it("has no row without tags and one row for tags that do not overlap", () => {
        expect(tagRows([])).toEqual({ rows: [], count: 0 });
        expect(
            tagRows([
                { from: 0, to: 2 },
                { from: 3, to: 3 },
                { from: 5, to: 7 },
            ]),
        ).toEqual({ rows: [0, 0, 0], count: 1 });
    });

    it("puts three overlapping tags in three rows, the first to start on top", () => {
        expect(
            tagRows([
                { from: 2, to: 5 },
                { from: 0, to: 3 },
                { from: 1, to: 4 },
            ]),
        ).toEqual({ rows: [2, 0, 1], count: 3 });
    });

    it("puts the longer of two tags that start together above, and nested tags that do not overlap side by side", () => {
        // A walk cycle over 0–7 with a step in 0–3 and another in 4–7.
        expect(
            tagRows([
                { from: 0, to: 3 },
                { from: 4, to: 7 },
                { from: 0, to: 7 },
            ]),
        ).toEqual({ rows: [1, 1, 0], count: 2 });
        // Equal ranges: the one created first on top.
        expect(
            tagRows([
                { from: 1, to: 2 },
                { from: 1, to: 2 },
            ]),
        ).toEqual({ rows: [0, 1], count: 2 });
    });

    it("may put a tag above one that it is nested in and that starts earlier (DESIGN §5.6)", () => {
        // A over 0–1, W over 1–7, S over 3–4 inside W: W cannot share A's row, S can.
        expect(
            tagRows([
                { from: 0, to: 1 },
                { from: 1, to: 7 },
                { from: 3, to: 4 },
            ]),
        ).toEqual({ rows: [0, 1, 0], count: 2 });
    });

    it("never gives overlapping tags one row, with as few rows as the deepest frame needs", () => {
        // Every set of up to five spans over six frames, from a fixed sequence.
        let seed = 7;
        const next = (limit: number) => {
            seed = (seed * 48271) % 2147483647;
            return seed % limit;
        };
        for (let round = 0; round < 500; round++) {
            const spans = Array.from({ length: 1 + next(5) }, () => {
                const a = next(6);
                const b = next(6);
                return { from: Math.min(a, b), to: Math.max(a, b) };
            });
            expectValidRows(spans);
        }
    });

    it("shows three rows before the bar scrolls (DESIGN §2)", () => {
        expect(SHOWN_TAG_ROWS).toBe(3);
    });
});

describe("resizing a tag by a drag of one end", () => {
    const span = { from: 2, to: 4 };

    it("moves the end dragged to the frame under the pointer", () => {
        expect(resizedSpan(span, "to", 6, 10)).toEqual({ from: 2, to: 6 });
        expect(resizedSpan(span, "to", 3, 10)).toEqual({ from: 2, to: 3 });
        expect(resizedSpan(span, "from", 0, 10)).toEqual({ from: 0, to: 4 });
        expect(resizedSpan(span, "from", 4, 10)).toEqual({ from: 4, to: 4 });
    });

    it("cannot extend past the first or the last frame", () => {
        expect(resizedSpan(span, "to", 10, 10)).toEqual({ from: 2, to: 9 });
        expect(resizedSpan(span, "to", 1000, 10)).toEqual({ from: 2, to: 9 });
        expect(resizedSpan(span, "from", -1, 10)).toEqual({ from: 0, to: 4 });
        expect(resizedSpan(span, "from", -1000, 10)).toEqual({ from: 0, to: 4 });
    });

    it("stops at the other end: a tag keeps at least one frame", () => {
        expect(resizedSpan(span, "to", 0, 10)).toEqual({ from: 2, to: 2 });
        expect(resizedSpan(span, "from", 9, 10)).toEqual({ from: 4, to: 4 });
    });
});

/** A document of `frames` frames with ids f1, f2, …, and the tags given by frame index. */
function documentWith(frames: number, tags: [string, number, number][]): SpriteDoc {
    const { doc } = createDocument({ name: "t", width: 2, height: 2 }, sequentialIds("x"));
    doc.frames = Array.from({ length: frames }, (_, index) => ({
        id: `f${index + 1}`,
        durationMs: 100,
    }));
    doc.tags = tags.map(([id, from, to]): Tag => ({
        id,
        name: id,
        color: 0x73bed3ff,
        fromFrameId: `f${from + 1}`,
        toFrameId: `f${to + 1}`,
        direction: "forward",
        repeat: 0,
    }));
    return doc;
}

describe("the tags of the timeline model", () => {
    it("gives each tag its frames by index and its row, and the active tag at the active frame", () => {
        const doc = documentWith(8, [
            ["outer", 0, 7],
            ["a", 0, 3],
            ["b", 2, 5],
        ]);
        const tags = timelineTags(doc, "f3");
        expect(tags.list).toEqual([
            { id: "outer", name: "outer", color: 0x73bed3ff, from: 0, to: 7, row: 0 },
            { id: "a", name: "a", color: 0x73bed3ff, from: 0, to: 3, row: 1 },
            { id: "b", name: "b", color: 0x73bed3ff, from: 2, to: 5, row: 2 },
        ]);
        expect(tags.rows).toBe(3);
        // Frame 3 is in all three; "a" and "b" are the shortest, "b" was created last.
        expect(tags.activeId).toBe("b");
        expect(timelineTags(doc, "f2").activeId).toBe("a");
        expect(timelineTags(doc, "f8").activeId).toBe("outer");
        expect(timelineTags(documentWith(4, []), "f1")).toMatchObject({
            list: [],
            rows: 0,
            activeId: null,
        });
    });

    it("has a key that changes with every tag property, row and the active tag, and only then", () => {
        const doc = documentWith(6, [
            ["a", 0, 2],
            ["b", 3, 5],
        ]);
        const key = timelineTags(doc, "f1").key;
        expect(timelineTags(doc, "f2").key).toBe(key);
        expect(timelineTags(doc, "f4").key).not.toBe(key);
        const changed = (change: Partial<Tag>) => {
            const copy = { ...doc, tags: doc.tags.map((tag) => ({ ...tag })) };
            Object.assign(copy.tags[0]!, change);
            return timelineTags(copy, "f1").key;
        };
        expect(changed({ name: "walk" })).not.toBe(key);
        expect(changed({ color: 0xff0000ff })).not.toBe(key);
        expect(changed({ toFrameId: "f2" })).not.toBe(key);
        expect(changed({ fromFrameId: "f2" })).not.toBe(key);
        // Overlapping now: another row.
        expect(changed({ toFrameId: "f5" })).not.toBe(key);
        // Direction and repeat are not drawn.
        expect(changed({ direction: "pingpong", repeat: 3 })).toBe(key);
    });

    it("is drawn again after a tag command, and kept after a change it does not show", () => {
        const store = createSessionsStore();
        const source = timelineSource(store);
        const stop = source.subscribe(() => {});
        const document = store
            .getState()
            .open(createDocument({ name: "a", width: 2, height: 2 }, sequentialIds("a")));
        const { session, history } = document;
        const frameId = session.activeFrameId;
        const before = source.current();
        expect(before?.tags.list).toEqual([]);

        const properties = {
            name: "walk",
            color: 0x73bed3ff,
            fromFrameId: frameId,
            toFrameId: frameId,
            direction: "forward" as const,
            repeat: 0,
        };
        history.execute(createTagCommand(session.doc, properties, () => "t1"));
        const created = source.current();
        expect(created).not.toBe(before);
        expect(created?.tags).toMatchObject({ rows: 1, activeId: "t1" });
        expect(created?.tags.list).toMatchObject([{ id: "t1", name: "walk", from: 0, to: 0 }]);

        // Repeat is not drawn: the same model.
        history.execute(editTagCommand(session.doc, "t1", { repeat: 4 })!);
        expect(source.current()).toBe(created);
        history.execute(editTagCommand(session.doc, "t1", { name: "run" })!);
        expect(source.current()?.tags.list[0]?.name).toBe("run");
        history.execute(deleteTagCommand(session.doc, "t1"));
        expect(source.current()?.tags).toMatchObject({ list: [], rows: 0, activeId: null });
        history.undo();
        expect(source.current()?.tags.list[0]?.name).toBe("run");
        stop();
    });
});
