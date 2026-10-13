import { describe, expect, it } from "vitest";
import { clearCelsCommand } from "../../src/core/cels";
import { compositeFrame } from "../../src/core/composite";
import {
    addFrameCommand,
    deleteFramesCommand,
    duplicateFramesCommand,
    FrameDurationError,
    isFrameDuration,
    LastFrameError,
    MAX_FRAME_DURATION_MS,
    MIN_FRAME_DURATION_MS,
    moveFramesCommand,
    reverseFramesCommand,
    setFrameDurationCommand,
} from "../../src/core/frames";
import {
    AllocationError,
    chainedCommand,
    compositeCommand,
    pixelPatchCommand,
} from "../../src/core/history";
import { celAt, createDocument, sequentialIds } from "../../src/core/model";
import type { SpriteDoc } from "../../src/core/model";
import { deleteTagCommand } from "../../src/core/tags";
import {
    celBytes,
    expectSymmetric,
    failingAllocator,
    fixture,
    flakyAllocator,
    frameIds,
    FRAMES,
    IMAGE_BYTES,
    L1,
    L2,
    L3,
    row,
    snapshot,
    some,
    tagRanges,
} from "./se-021-support";

// SE-021: the frame commands. The fixture is drawn in `se-021-support.ts`; new IDs are
// `n1`, `n2`, … in the order a command asks for them.

const ids = () => sequentialIds("n");

/** The composite of every frame, by frame ID. */
function pictures(doc: SpriteDoc): Record<string, number[]> {
    return Object.fromEntries(
        doc.frames.map((frame) => [frame.id, Array.from(compositeFrame(doc, frame.id).data)]),
    );
}

const durations = (doc: SpriteDoc) => doc.frames.map((frame) => frame.durationMs);

describe("addFrameCommand", () => {
    it("adds an empty frame after the given one, with its duration, and makes it active", () => {
        const { session, doc, history } = fixture();

        history.execute(addFrameCommand(doc, "f3", ids()));

        expect(frameIds(doc)).toEqual(["f1", "f2", "f3", "n1", "f4", "f5"]);
        expect(doc.frames[3]).toEqual({ id: "n1", durationMs: 200 });
        expect(session.activeFrameId).toBe("n1");
        // No cel anywhere in the new frame, and nothing else moved.
        expect(row(doc, L1)).toEqual(["a", "a", "b", ".", ".", "c"]);
        expect(row(doc, L2)).toEqual(["d", ".", "e", ".", "e", "."]);
        expect(row(doc, L3)).toEqual([".", ".", ".", ".", ".", "g"]);
        expect(doc.cels.size).toBe(8);
        expect(doc.images.size).toBe(6);
        expect(history.undoLabel).toBe("New Empty Frame");
    });

    it("adds after the last frame", () => {
        const { session, doc, history } = fixture();
        history.execute(addFrameCommand(doc, "f5", ids()));
        expect(frameIds(doc)).toEqual([...FRAMES, "n1"]);
        expect(doc.frames[5].durationMs).toBe(50);
        expect(session.activeFrameId).toBe("n1");
    });

    it("do/undo/redo symmetry, including activeFrameId", () => {
        const { session, doc, history } = fixture();
        session.activeFrameId = "f3";

        const { before, after } = expectSymmetric(history, addFrameCommand(doc, "f3", ids()));

        expect(before.activeFrameId).toBe("f3");
        expect(after.activeFrameId).toBe("n1");
    });

    it("a frame added after a frame of a tag belongs to that tag", () => {
        const added = (afterFrameId: string) => {
            const { doc, history } = fixture();
            expectSymmetric(history, addFrameCommand(doc, afterFrameId, ids()));
            return tagRanges(doc);
        };
        // Inside walk; the endpoints stay.
        expect(added("f3")).toEqual({ intro: ["f1", "f2"], walk: ["f2", "f4"], end: ["f5", "f5"] });
        // After the last frame of walk, and of end.
        expect(added("f4").walk).toEqual(["f2", "n1"]);
        expect(added("f5").end).toEqual(["f5", "n1"]);
        // f2 is the last frame of intro and the first of walk.
        expect(added("f2")).toMatchObject({ intro: ["f1", "n1"], walk: ["f2", "f4"] });
        // After f1, intro has it inside; walk starts later.
        expect(added("f1")).toMatchObject({ intro: ["f1", "f2"], walk: ["f2", "f4"] });
    });

    it("touches the new frame, reports a structure change and retains no pixels", () => {
        const { doc } = fixture();
        const command = addFrameCommand(doc, "f1", ids());
        expect(command.touched).toEqual({ frameIds: ["n1"], layerIds: [], structure: true });
        expect(command.bytes).toBe(0);
    });

    it("is not applied until the history executes it", () => {
        const { session, doc } = fixture();
        const before = snapshot(session);
        addFrameCommand(doc, "f1", ids());
        expect(snapshot(session)).toStrictEqual(before);
    });

    it("rejects a frame the document does not have", () => {
        const { session, doc } = fixture();
        const before = snapshot(session);
        expect(() => addFrameCommand(doc, "f9")).toThrow(RangeError);
        expect(snapshot(session)).toStrictEqual(before);
    });
});

describe("duplicateFramesCommand", () => {
    it("puts a copy with the same duration, cels and opacity after the frame and makes it active", () => {
        const { session, doc, history } = fixture();

        history.execute(duplicateFramesCommand(doc, ["f3"], ids()));

        expect(frameIds(doc)).toEqual(["f1", "f2", "f3", "n1", "f4", "f5"]);
        expect(doc.frames[3]).toEqual({ id: "n1", durationMs: 200 });
        expect(session.activeFrameId).toBe("n1");
        expect(row(doc, L1)).toEqual(["a", "a", "b", "n2", ".", "c"]);
        expect(row(doc, L2)).toEqual(["d", ".", "e", "n3", "e", "."]);
        expect(row(doc, L3)).toEqual([".", ".", ".", ".", ".", "g"]);
        expect(celAt(doc, L1, "n1")).toEqual({ imageId: "n2", opacity: 255 });
        expect(celAt(doc, L2, "n1")).toEqual({ imageId: "n3", opacity: 128 });
        expect(celBytes(doc, L1, "n1")).toEqual(celBytes(doc, L1, "f3"));
        expect(celBytes(doc, L2, "n1")).toEqual(celBytes(doc, L2, "f3"));
        expect(pictures(doc).n1).toEqual(pictures(doc).f3);
        expect(history.undoLabel).toBe("New Frame");
    });

    it("gives the copy images of its own: painting it leaves the original alone", () => {
        const { doc, history } = fixture();
        history.execute(duplicateFramesCommand(doc, ["f3"], ids()));
        const original = pictures(doc).f3;
        expect(doc.images.get("n2")?.data).not.toBe(doc.images.get("b")?.data);

        const white = { width: 1, height: 1, data: new Uint8ClampedArray(4).fill(255) };
        history.execute(
            pixelPatchCommand(doc, { label: "Dot", imageId: "n2", x: 0, y: 0, pixels: white }),
        );

        expect(pictures(doc).f3).toEqual(original);
        expect(pictures(doc).n1).not.toEqual(original);
    });

    it("keeps links among the copies and none to the originals", () => {
        const { doc, history } = fixture();

        history.execute(duplicateFramesCommand(doc, ["f1", "f2"], ids()));

        // Frames n1 and n2, then one image per image copied: a → n3, d → n4.
        expect(frameIds(doc)).toEqual(["f1", "f2", "n1", "n2", "f3", "f4", "f5"]);
        expect(row(doc, L1)).toEqual(["a", "a", "n3", "n3", "b", ".", "c"]);
        expect(row(doc, L2)).toEqual(["d", ".", "n4", ".", "e", "e", "."]);
        expect(doc.images.size).toBe(8);
    });

    it("puts the copies after the last named frame, in frame order, however they are named", () => {
        const { session, doc, history } = fixture();

        history.execute(duplicateFramesCommand(doc, ["f4", "f2", "f4"], ids()));

        // n1 copies f2, n2 copies f4.
        expect(frameIds(doc)).toEqual(["f1", "f2", "f3", "f4", "n1", "n2", "f5"]);
        expect(row(doc, L1)).toEqual(["a", "a", "b", ".", "n3", ".", "c"]);
        expect(row(doc, L2)).toEqual(["d", ".", "e", "e", ".", "n4", "."]);
        expect(session.activeFrameId).toBe("n1");
        expect(history.undoLabel).toBe("New Frames");
    });

    it("do/undo/redo symmetry, including activeFrameId and the images", () => {
        const { session, doc, history } = fixture();
        session.activeFrameId = "f2";

        const { before, after } = expectSymmetric(
            history,
            duplicateFramesCommand(doc, ["f3", "f4"], ids()),
        );

        expect(before.activeFrameId).toBe("f2");
        expect(after.activeFrameId).toBe("n1");
        expect(after.doc.images.map(([id]) => id)).toEqual([
            "a",
            "b",
            "c",
            "d",
            "e",
            "g",
            "n3",
            "n4",
        ]);
    });

    it("a tag that ends with the last duplicated frame takes the copies in", () => {
        const duplicated = (frames: string[]) => {
            const { doc, history } = fixture();
            expectSymmetric(history, duplicateFramesCommand(doc, frames, ids()));
            return tagRanges(doc);
        };
        expect(duplicated(["f4"]).walk).toEqual(["f2", "n1"]);
        expect(duplicated(["f3", "f4"]).walk).toEqual(["f2", "n2"]);
        // The copy of f3 lands inside walk; the endpoints stay.
        expect(duplicated(["f3"]).walk).toEqual(["f2", "f4"]);
        expect(duplicated(["f5"]).end).toEqual(["f5", "n1"]);
    });

    it("touches the copies and the layers that get a cel, and retains no pixels", () => {
        const { doc } = fixture();
        const command = duplicateFramesCommand(doc, ["f4", "f5"], ids());
        expect(command.touched).toEqual({
            frameIds: ["n1", "n2"],
            layerIds: [L1, L2, L3],
            structure: true,
        });
        // The images are made again from their originals on every do.
        expect(command.bytes).toBe(0);
        expect(duplicateFramesCommand(doc, ["f2"], ids()).touched).toEqual({
            frameIds: ["n1"],
            layerIds: [L1],
            structure: true,
        });
    });

    it("redo makes the images again, and a later patch of one still applies", () => {
        const { session, doc, history } = fixture();
        history.execute(duplicateFramesCommand(doc, ["f3"], ids()));
        const white = { width: 2, height: 1, data: new Uint8ClampedArray(8).fill(255) };
        history.execute(
            pixelPatchCommand(doc, { label: "Dash", imageId: "n3", x: 0, y: 1, pixels: white }),
        );
        const painted = snapshot(session);

        history.undo();
        history.undo();
        expect(doc.images.has("n3")).toBe(false);
        history.redo();
        history.redo();

        expect(snapshot(session)).toStrictEqual(painted);
    });

    it.each([
        { allocator: () => failingAllocator, failing: "the first image" },
        { allocator: () => flakyAllocator(1), failing: "the second image" },
    ])(
        "when $failing cannot be allocated, throws AllocationError and changes nothing",
        ({ allocator }) => {
            const { session, doc, history } = fixture();
            const before = snapshot(session);
            const command = duplicateFramesCommand(doc, ["f3"], ids(), allocator());

            expect(() => history.execute(command)).toThrow(AllocationError);

            expect(snapshot(session)).toStrictEqual(before);
            expect(history.undoCount).toBe(0);
        },
    );

    it("rejects no frame and a frame the document does not have", () => {
        const { doc } = fixture();
        expect(() => duplicateFramesCommand(doc, [])).toThrow(RangeError);
        expect(() => duplicateFramesCommand(doc, ["f1", "f9"])).toThrow(RangeError);
    });
});

describe("deleteFramesCommand", () => {
    it("deletes the frame with its cels and the images no other cel uses", () => {
        const { doc, history } = fixture();
        const command = deleteFramesCommand(doc, ["f3"]);

        history.execute(command);

        expect(frameIds(doc)).toEqual(["f1", "f2", "f4", "f5"]);
        expect(row(doc, L1)).toEqual(["a", "a", ".", "c"]);
        expect(row(doc, L2)).toEqual(["d", ".", "e", "."]);
        expect(doc.cels.size).toBe(6);
        // b was the cel of f3 alone; e is still the cel of f4.
        expect([...doc.images.keys()]).toEqual(["a", "c", "d", "e", "g"]);
        expect(command.bytes).toBe(IMAGE_BYTES);
        expect(history.undoLabel).toBe("Delete Frame");
    });

    it("keeps an image until the last frame that uses it is deleted", () => {
        const first = fixture();
        const one = deleteFramesCommand(first.doc, ["f1"]);
        first.history.execute(one);
        expect([...first.doc.images.keys()]).toEqual(["a", "b", "c", "e", "g"]);
        expect(one.bytes).toBe(IMAGE_BYTES);

        const second = fixture();
        const both = deleteFramesCommand(second.doc, ["f2", "f1"]);
        second.history.execute(both);
        expect([...second.doc.images.keys()]).toEqual(["b", "c", "e", "g"]);
        expect(both.bytes).toBe(2 * IMAGE_BYTES);
        expect(second.history.undoLabel).toBe("Delete Frames");
    });

    it.each([
        { frames: ["f3"] },
        { frames: ["f1", "f2"] },
        { frames: ["f2", "f3", "f4"] },
        { frames: ["f5"] },
        { frames: ["f1", "f3", "f5"] },
        { frames: ["f1", "f2", "f3", "f4"] },
    ])(
        "do/undo/redo symmetry deleting $frames: frames, cels, images and tags come back in place",
        ({ frames }) => {
            const { session, doc, history } = fixture();
            session.activeFrameId = frames[0];

            const { before, after } = expectSymmetric(history, deleteFramesCommand(doc, frames));

            expect(before.activeFrameId).toBe(frames[0]);
            expect(after.activeFrameId).not.toBe(frames[0]);
            expect(after.doc.frames).toHaveLength(5 - frames.length);
        },
    );

    it.each([
        { active: "f3", deleted: ["f3"], next: "f4", why: "the next frame" },
        { active: "f2", deleted: ["f2", "f3"], next: "f4", why: "the next remaining frame" },
        { active: "f5", deleted: ["f5"], next: "f4", why: "the last frame when none follows" },
        { active: "f4", deleted: ["f3", "f4", "f5"], next: "f2", why: "the last remaining frame" },
        { active: "f1", deleted: ["f3"], next: "f1", why: "the active frame when it remains" },
    ])(
        "with $active active, deleting $deleted makes $next active: $why",
        ({ active, deleted, next }) => {
            const { session, doc, history } = fixture();
            session.activeFrameId = active;

            history.execute(deleteFramesCommand(doc, deleted));
            expect(session.activeFrameId).toBe(next);

            history.undo();
            expect(session.activeFrameId).toBe(active);
            history.redo();
            expect(session.activeFrameId).toBe(next);
        },
    );

    it("tags keep the frames they have left; a tag with none left is deleted and restored by undo", () => {
        const deleted = (frames: string[]) => {
            const { doc, history } = fixture();
            expectSymmetric(history, deleteFramesCommand(doc, frames));
            return tagRanges(doc);
        };
        // f2 is the last frame of intro and the first of walk.
        expect(deleted(["f2"])).toEqual({
            intro: ["f1", "f1"],
            walk: ["f3", "f4"],
            end: ["f5", "f5"],
        });
        expect(deleted(["f3"])).toEqual({
            intro: ["f1", "f2"],
            walk: ["f2", "f4"],
            end: ["f5", "f5"],
        });
        expect(deleted(["f4"]).walk).toEqual(["f2", "f3"]);
        expect(deleted(["f5"])).toEqual({ intro: ["f1", "f2"], walk: ["f2", "f4"] });
        expect(deleted(["f2", "f3", "f4"])).toEqual({ intro: ["f1", "f1"], end: ["f5", "f5"] });
        expect(deleted(["f1", "f2", "f3", "f4"])).toEqual({ end: ["f5", "f5"] });
    });

    it("deleting frames never leaves a tag referencing a missing frame", () => {
        // Every way to delete some, but not all, of the five frames.
        const all: string[] = [...FRAMES];
        let checked = 0;
        for (let mask = 1; mask < (1 << all.length) - 1; mask++) {
            const frames = all.filter((_, index) => mask & (1 << index));
            const { session, doc, history } = fixture();
            const before = snapshot(session);
            const members = Object.entries(tagRanges(doc)).map(([id, [from, to]]) => ({
                id,
                frames: all.slice(all.indexOf(from), all.indexOf(to) + 1),
            }));

            // The history checks the invariants, which include both tag invariants.
            history.execute(deleteFramesCommand(doc, frames));

            const remaining = frameIds(doc);
            for (const tag of doc.tags) {
                const from = remaining.indexOf(tag.fromFrameId);
                const to = remaining.indexOf(tag.toFrameId);
                expect(from).toBeGreaterThanOrEqual(0);
                expect(to).toBeGreaterThanOrEqual(from);
            }
            const expected = members.flatMap(({ id, frames: old }) => {
                const left = old.filter((frame) => remaining.includes(frame));
                return left.length > 0 ? [[id, [left[0], left[left.length - 1]]]] : [];
            });
            expect(tagRanges(doc)).toEqual(Object.fromEntries(expected));

            history.undo();
            expect(snapshot(session)).toStrictEqual(before);
            checked++;
        }
        expect(checked).toBe(30);
    });

    it("resets exportSettings.frames when its tag goes with its frames, and undo restores it", () => {
        const { session, doc, history } = fixture();
        doc.exportSettings.frames = { tagId: "end" };

        const { before, after } = expectSymmetric(history, deleteFramesCommand(doc, ["f5"]));

        expect(before.doc.exportSettings.frames).toEqual({ tagId: "end" });
        expect(after.doc.exportSettings.frames).toBe("all");
        history.undo();
        expect(session.doc.exportSettings.frames).toEqual({ tagId: "end" });
    });

    it("leaves exportSettings.frames alone when its tag keeps a frame", () => {
        const { doc, history } = fixture();
        doc.exportSettings.frames = { tagId: "walk" };
        history.execute(deleteFramesCommand(doc, ["f2", "f4", "f5"]));
        expect(doc.exportSettings.frames).toEqual({ tagId: "walk" });
        expect(tagRanges(doc)).toEqual({ intro: ["f1", "f1"], walk: ["f3", "f3"] });
    });

    it("refuses to delete every frame with a typed error", () => {
        const { session, doc, history } = fixture();
        const before = snapshot(session);

        expect(() => deleteFramesCommand(doc, [...FRAMES])).toThrow(LastFrameError);
        expect(() => deleteFramesCommand(doc, ["f5", ...FRAMES])).toThrow(LastFrameError);
        expect(snapshot(session)).toStrictEqual(before);

        // Down to one frame, which then stays.
        history.execute(deleteFramesCommand(doc, ["f1", "f2", "f3", "f4"]));
        expect(() => deleteFramesCommand(doc, ["f5"])).toThrow(LastFrameError);

        const single = createDocument({ name: "one", width: 2, height: 2 }, sequentialIds());
        const error = (() => {
            try {
                deleteFramesCommand(single.doc, [single.activeFrameId]);
            } catch (thrown) {
                return thrown;
            }
        })();
        expect(error).toBeInstanceOf(LastFrameError);
        expect(error).toMatchObject({ name: "LastFrameError" });
    });

    it("touches the deleted frames and the layers that lose a cel", () => {
        const { doc } = fixture();
        expect(deleteFramesCommand(doc, ["f3", "f1"]).touched).toEqual({
            frameIds: ["f1", "f3"],
            layerIds: [L1, L2],
            structure: true,
        });
        expect(deleteFramesCommand(doc, ["f5"]).touched).toEqual({
            frameIds: ["f5"],
            layerIds: [L1, L3],
            structure: true,
        });
    });

    it("stays sound when the active frame and the export choice changed before a redo", () => {
        const { session, doc, history } = fixture();
        history.execute(deleteFramesCommand(doc, ["f5"]));
        history.undo();
        // Neither is a command (SPEC §5.2), so the redo below finds them changed.
        session.activeFrameId = "f5";
        doc.exportSettings.frames = { tagId: "end" };

        history.redo();

        expect(session.activeFrameId).toBe("f4");
        expect(doc.exportSettings.frames).toBe("all");
        history.undo();
        expect(session.activeFrameId).toBe("f5");
        expect(doc.exportSettings.frames).toEqual({ tagId: "end" });
    });

    it("rejects no frame and a frame the document does not have", () => {
        const { doc } = fixture();
        expect(() => deleteFramesCommand(doc, [])).toThrow(RangeError);
        expect(() => deleteFramesCommand(doc, ["f9"])).toThrow(RangeError);
    });
});

describe("moveFramesCommand", () => {
    it.each([
        { frames: ["f1"], before: 5, order: "f2 f3 f4 f5 f1" },
        { frames: ["f5"], before: 0, order: "f5 f1 f2 f3 f4" },
        { frames: ["f2"], before: 4, order: "f1 f3 f4 f2 f5" },
        { frames: ["f3"], before: 1, order: "f1 f3 f2 f4 f5" },
        { frames: ["f2", "f3"], before: 5, order: "f1 f4 f5 f2 f3" },
        { frames: ["f4", "f2"], before: 0, order: "f2 f4 f1 f3 f5" },
        { frames: ["f1", "f3"], before: 5, order: "f2 f4 f5 f1 f3" },
        { frames: ["f1", "f5"], before: 3, order: "f2 f3 f1 f5 f4" },
        { frames: ["f2", "f4"], before: 3, order: "f1 f3 f2 f4 f5" },
    ])("moving $frames before position $before gives $order", ({ frames, before, order }) => {
        const { doc, history } = fixture();
        history.execute(some(moveFramesCommand(doc, frames, before)));
        expect(frameIds(doc).join(" ")).toBe(order);
    });

    it("a frame keeps its duration and its cels", () => {
        const { doc, history } = fixture();
        const before = pictures(doc);

        history.execute(some(moveFramesCommand(doc, ["f3"], 0)));

        expect(frameIds(doc)).toEqual(["f3", "f1", "f2", "f4", "f5"]);
        expect(durations(doc)).toEqual([200, 100, 100, 100, 50]);
        expect(pictures(doc)).toEqual(before);
        expect(row(doc, L1)).toEqual(["b", "a", "a", ".", "c"]);
        expect(doc.cels.size).toBe(8);
        expect(history.undoLabel).toBe("Move Frame");
    });

    it("returns null when the order would not change", () => {
        const { doc } = fixture();
        expect(moveFramesCommand(doc, ["f2"], 1)).toBeNull();
        expect(moveFramesCommand(doc, ["f2"], 2)).toBeNull();
        expect(moveFramesCommand(doc, ["f2", "f3"], 1)).toBeNull();
        expect(moveFramesCommand(doc, ["f2", "f3"], 2)).toBeNull();
        expect(moveFramesCommand(doc, ["f2", "f3"], 3)).toBeNull();
        expect(moveFramesCommand(doc, ["f5"], 5)).toBeNull();
        for (let position = 0; position <= 5; position++) {
            expect(moveFramesCommand(doc, [...FRAMES], position)).toBeNull();
        }
        expect(moveFramesCommand(doc, ["f2", "f3"], 4)).not.toBeNull();
    });

    it("tags follow: a frame dragged away leaves its tag, one dropped inside joins", () => {
        const moved = (frames: string[], before: number) => {
            const { doc, history } = fixture();
            expectSymmetric(history, moveFramesCommand(doc, frames, before));
            return { order: frameIds(doc).join(" "), tags: tagRanges(doc) };
        };
        // f3 leaves walk.
        expect(moved(["f3"], 5)).toEqual({
            order: "f1 f2 f4 f5 f3",
            tags: { intro: ["f1", "f2"], walk: ["f2", "f4"], end: ["f5", "f5"] },
        });
        // f5 is dropped inside walk; end travels with its only frame.
        expect(moved(["f5"], 2)).toEqual({
            order: "f1 f2 f5 f3 f4",
            tags: { intro: ["f1", "f2"], walk: ["f2", "f4"], end: ["f5", "f5"] },
        });
        // The last frame of walk is dragged to the front: walk ends one frame earlier.
        expect(moved(["f4"], 0)).toEqual({
            order: "f4 f1 f2 f3 f5",
            tags: { intro: ["f1", "f2"], walk: ["f2", "f3"], end: ["f5", "f5"] },
        });
        // f1 is dropped inside walk and leaves intro.
        expect(moved(["f1"], 3)).toEqual({
            order: "f2 f3 f1 f4 f5",
            tags: { intro: ["f2", "f2"], walk: ["f2", "f4"], end: ["f5", "f5"] },
        });
    });

    it("tags follow: a tag dragged as a whole travels with its frames", () => {
        const { doc, history } = fixture();

        expectSymmetric(history, moveFramesCommand(doc, ["f2", "f3", "f4"], 5));

        expect(frameIds(doc).join(" ")).toBe("f1 f5 f2 f3 f4");
        // f2 was also the last frame of intro, which keeps f1.
        expect(tagRanges(doc)).toEqual({
            intro: ["f1", "f1"],
            walk: ["f2", "f4"],
            end: ["f5", "f5"],
        });
        expect(history.undoLabel).toBe("Move Frames");
    });

    it("do/undo/redo symmetry; the active frame stays the same frame", () => {
        const { session, doc, history } = fixture();
        session.activeFrameId = "f3";

        const { after } = expectSymmetric(history, moveFramesCommand(doc, ["f3", "f4"], 0));

        expect(after.doc.frames.map((frame) => frame.id)).toEqual(["f3", "f4", "f1", "f2", "f5"]);
        expect(after.activeFrameId).toBe("f3");
        // A move does not set the active frame, so neither does its undo.
        session.activeFrameId = "f5";
        history.undo();
        expect(session.activeFrameId).toBe("f5");
    });

    it("keeps its own copy of the frame list on both sides", () => {
        const { doc, history } = fixture();
        history.execute(some(moveFramesCommand(doc, ["f1"], 5)));
        // Written into the document's frame objects, behind the history's back.
        doc.frames[0].durationMs = 999;
        history.undo();
        expect(doc.frames).toEqual([
            { id: "f1", durationMs: 100 },
            { id: "f2", durationMs: 100 },
            { id: "f3", durationMs: 200 },
            { id: "f4", durationMs: 100 },
            { id: "f5", durationMs: 50 },
        ]);

        doc.frames[0].durationMs = 999;
        history.redo();
        expect(frameIds(doc)).toEqual(["f2", "f3", "f4", "f5", "f1"]);
        expect(durations(doc)).toEqual([100, 200, 100, 50, 100]);
        history.undo();
        expect(frameIds(doc)).toEqual([...FRAMES]);
        expect(durations(doc)).toEqual([100, 100, 200, 100, 50]);
    });

    it("touches no composite, reports a structure change and retains no pixels", () => {
        const { doc } = fixture();
        const command = some(moveFramesCommand(doc, ["f1"], 5));
        expect(command.touched).toEqual({ frameIds: [], layerIds: [], structure: true });
        expect(command.bytes).toBe(0);
    });

    it("rejects a position outside 0..frames, no frame and an unknown frame", () => {
        const { session, doc } = fixture();
        const before = snapshot(session);
        for (const position of [-1, 6, 1.5, Number.NaN]) {
            expect(() => moveFramesCommand(doc, ["f1"], position)).toThrow(RangeError);
        }
        expect(() => moveFramesCommand(doc, [], 0)).toThrow(RangeError);
        expect(() => moveFramesCommand(doc, ["f9"], 0)).toThrow(RangeError);
        expect(snapshot(session)).toStrictEqual(before);
    });
});

describe("reverseFramesCommand", () => {
    it.each([
        { frames: ["f2", "f3", "f4"], order: "f1 f4 f3 f2 f5" },
        { frames: ["f4", "f2", "f3"], order: "f1 f4 f3 f2 f5" },
        { frames: [...FRAMES], order: "f5 f4 f3 f2 f1" },
        { frames: ["f1", "f2"], order: "f2 f1 f3 f4 f5" },
        { frames: ["f1", "f3", "f5"], order: "f5 f2 f3 f4 f1" },
    ])("reversing $frames gives $order", ({ frames, order }) => {
        const { doc, history } = fixture();
        history.execute(some(reverseFramesCommand(doc, frames)));
        expect(frameIds(doc).join(" ")).toBe(order);
        expect(history.undoLabel).toBe("Reverse Frames");
    });

    it("the range then plays backwards: a frame keeps its duration and its cels", () => {
        const { doc, history } = fixture();
        const before = pictures(doc);
        const played = FRAMES.map((id) => before[id]);

        history.execute(some(reverseFramesCommand(doc, [...FRAMES])));

        expect(pictures(doc)).toEqual(before);
        expect(doc.frames.map((frame) => pictures(doc)[frame.id])).toEqual(played.reverse());
        expect(durations(doc)).toEqual([50, 100, 200, 100, 100]);
        expect(row(doc, L1)).toEqual(["c", ".", "b", "a", "a"]);
        expect(row(doc, L2)).toEqual([".", "e", "e", ".", "d"]);
    });

    it("tags follow: a tag inside the range travels, a tag around it stays", () => {
        const reversed = (frames: string[]) => {
            const { doc, history } = fixture();
            expectSymmetric(history, reverseFramesCommand(doc, frames));
            return tagRanges(doc);
        };
        // Order f1 f4 f3 f2 f5: walk is the same three frames, now from f4 to f2; intro
        // keeps f1, the frame that stayed.
        expect(reversed(["f2", "f3", "f4"])).toEqual({
            intro: ["f1", "f1"],
            walk: ["f4", "f2"],
            end: ["f5", "f5"],
        });
        // Order f5 f4 f3 f2 f1: every tag keeps its frames.
        expect(reversed([...FRAMES])).toEqual({
            intro: ["f2", "f1"],
            walk: ["f4", "f2"],
            end: ["f5", "f5"],
        });
        // Order f1 f2 f4 f3 f5: walk is around the range.
        expect(reversed(["f3", "f4"])).toEqual({
            intro: ["f1", "f2"],
            walk: ["f2", "f3"],
            end: ["f5", "f5"],
        });
    });

    it("do/undo/redo symmetry; reversing twice gives the first order back", () => {
        const { session, doc, history } = fixture();
        session.activeFrameId = "f4";
        const start = snapshot(session);

        const { after } = expectSymmetric(history, reverseFramesCommand(doc, ["f1", "f2", "f3"]));
        expect(after.activeFrameId).toBe("f4");

        history.execute(some(reverseFramesCommand(doc, ["f1", "f2", "f3"])));
        expect(frameIds(doc)).toEqual([...FRAMES]);
        history.undo();
        history.undo();
        expect(snapshot(session)).toStrictEqual(start);
    });

    it("returns null for fewer than two frames", () => {
        const { doc } = fixture();
        expect(reverseFramesCommand(doc, ["f3"])).toBeNull();
        expect(reverseFramesCommand(doc, ["f3", "f3"])).toBeNull();
    });

    it("touches no composite and reports a structure change", () => {
        const { doc } = fixture();
        const command = some(reverseFramesCommand(doc, ["f1", "f2"]));
        expect(command.touched).toEqual({ frameIds: [], layerIds: [], structure: true });
        expect(command.bytes).toBe(0);
    });

    it("rejects no frame and a frame the document does not have", () => {
        const { doc } = fixture();
        expect(() => reverseFramesCommand(doc, [])).toThrow(RangeError);
        expect(() => reverseFramesCommand(doc, ["f1", "f9"])).toThrow(RangeError);
    });
});

describe("setFrameDurationCommand", () => {
    it("sets the duration of one frame", () => {
        const { doc, history } = fixture();
        history.execute(some(setFrameDurationCommand(doc, ["f2"], 250)));
        expect(durations(doc)).toEqual([100, 250, 200, 100, 50]);
        expect(history.undoLabel).toBe("Frame Duration");
    });

    it("sets the duration of many frames as one undo step and changes exactly those", () => {
        const { doc, history } = fixture();

        history.execute(some(setFrameDurationCommand(doc, ["f5", "f1", "f3"], 80)));

        expect(durations(doc)).toEqual([80, 100, 80, 100, 80]);
        expect(history.undoCount).toBe(1);
        history.undo();
        expect(durations(doc)).toEqual([100, 100, 200, 100, 50]);
        history.redo();
        expect(durations(doc)).toEqual([80, 100, 80, 100, 80]);
    });

    it("duration accepts 1 and 65535", () => {
        expect(MIN_FRAME_DURATION_MS).toBe(1);
        expect(MAX_FRAME_DURATION_MS).toBe(65535);
        const { doc, history } = fixture();
        history.execute(some(setFrameDurationCommand(doc, ["f1"], 1)));
        history.execute(some(setFrameDurationCommand(doc, ["f2"], 65535)));
        history.execute(some(setFrameDurationCommand(doc, ["f3"], 32768)));
        expect(durations(doc)).toEqual([1, 65535, 32768, 100, 50]);
        for (const value of [1, 2, 100, 65534, 65535]) expect(isFrameDuration(value)).toBe(true);
    });

    it.each([0, 65536, -1, 1.5, 100000, Number.NaN, Number.POSITIVE_INFINITY])(
        "duration rejects %s with a typed error and changes nothing",
        (value) => {
            const { session, doc, history } = fixture();
            const before = snapshot(session);
            const thrown = (() => {
                try {
                    setFrameDurationCommand(doc, ["f1", "f2"], value);
                } catch (error) {
                    return error;
                }
            })();

            expect(thrown).toBeInstanceOf(FrameDurationError);
            expect(thrown).toBeInstanceOf(Error);
            expect(thrown).toMatchObject({ name: "FrameDurationError", durationMs: value });
            expect((thrown as Error).message).toContain("1 to 65535");
            expect(isFrameDuration(value)).toBe(false);
            expect(snapshot(session)).toStrictEqual(before);
            expect(history.undoCount).toBe(0);
        },
    );

    it("checks the duration before the frames", () => {
        const { doc } = fixture();
        expect(() => setFrameDurationCommand(doc, ["f9"], 0)).toThrow(FrameDurationError);
        expect(() => setFrameDurationCommand(doc, ["f9"], 100)).toThrow(RangeError);
        expect(() => setFrameDurationCommand(doc, [], 100)).toThrow(RangeError);
    });

    it("returns null when every named frame has the duration already", () => {
        const { doc } = fixture();
        expect(setFrameDurationCommand(doc, ["f1", "f2", "f4"], 100)).toBeNull();
        expect(setFrameDurationCommand(doc, ["f5"], 50)).toBeNull();
        expect(setFrameDurationCommand(doc, ["f1", "f3"], 100)).not.toBeNull();
    });

    it("do/undo/redo symmetry: each frame gets its own duration back", () => {
        const { doc, history } = fixture();

        const { before, after } = expectSymmetric(
            history,
            setFrameDurationCommand(doc, [...FRAMES], 100),
        );

        expect(before.doc.frames.map((frame) => frame.durationMs)).toEqual([
            100, 100, 200, 100, 50,
        ]);
        expect(after.doc.frames.map((frame) => frame.durationMs)).toEqual([
            100, 100, 100, 100, 100,
        ]);
    });

    it("touches nothing of the composite and no structure", () => {
        const { doc } = fixture();
        const command = some(setFrameDurationCommand(doc, ["f1"], 40));
        expect(command.touched).toEqual({ frameIds: [], layerIds: [], structure: false });
        expect(command.bytes).toBe(0);
    });
});

// A command is planned against the document as it is when the command is made (the frame
// list it leaves, the tags that follow, the cels that go). Run on another document it would
// put stale frames back, so it refuses.
describe("a frame command whose document changed since it was made", () => {
    it("throws instead of running and leaves the session as it is", () => {
        const { session, doc, history } = fixture();
        const stale = [
            addFrameCommand(doc, "f2", ids()),
            duplicateFramesCommand(doc, ["f2"], ids()),
            deleteFramesCommand(doc, ["f2"]),
            some(moveFramesCommand(doc, ["f5"], 0)),
            some(reverseFramesCommand(doc, ["f2", "f3"])),
            some(setFrameDurationCommand(doc, ["f1"], 30)),
        ];
        history.execute(deleteFramesCommand(doc, ["f1"]));
        const before = snapshot(session);

        for (const command of stale) {
            expect(() => history.execute(command)).toThrow(/changed since/);
            expect(snapshot(session)).toStrictEqual(before);
        }
        expect(history.undoCount).toBe(1);
    });

    it("also when the frames only have another order, or one more at the end", () => {
        const moved = fixture();
        moved.history.execute(deleteTagCommand(moved.doc, "intro"));
        moved.history.execute(deleteTagCommand(moved.doc, "end"));
        const late = some(setFrameDurationCommand(moved.doc, ["f1"], 30));
        const stale = deleteFramesCommand(moved.doc, ["f3"]);
        // f5 is in no tag any more, so this changes the order and nothing else.
        moved.history.execute(some(moveFramesCommand(moved.doc, ["f5"], 0)));
        expect(tagRanges(moved.doc)).toEqual({ walk: ["f2", "f4"] });
        const reordered = snapshot(moved.session);
        expect(() => moved.history.execute(stale)).toThrow(/changed since/);
        expect(snapshot(moved.session)).toStrictEqual(reordered);
        // A duration does not depend on the order: that command still runs.
        moved.history.execute(late);
        expect(frameIds(moved.doc)).toEqual(["f5", "f1", "f2", "f3", "f4"]);
        expect(durations(moved.doc)).toEqual([50, 30, 100, 200, 100]);

        const grown = fixture();
        const reverse = some(reverseFramesCommand(grown.doc, ["f1", "f2"]));
        grown.history.execute(addFrameCommand(grown.doc, "f5", ids()));
        const longer = snapshot(grown.session);
        expect(() => grown.history.execute(reverse)).toThrow(/changed since/);
        expect(snapshot(grown.session)).toStrictEqual(longer);
    });

    it("also when only its tags changed, or the cels it removes", () => {
        const tagged = fixture();
        const add = addFrameCommand(tagged.doc, "f4", ids());
        tagged.history.execute(deleteTagCommand(tagged.doc, "walk"));
        const untagged = snapshot(tagged.session);
        expect(() => tagged.history.execute(add)).toThrow(/changed since/);
        expect(snapshot(tagged.session)).toStrictEqual(untagged);

        const cleared = fixture();
        const remove = deleteFramesCommand(cleared.doc, ["f3"]);
        cleared.history.execute(
            some(clearCelsCommand(cleared.doc, { layerIds: [L1], frameIds: ["f3"] })),
        );
        const emptied = snapshot(cleared.session);
        expect(() => cleared.history.execute(remove)).toThrow(/changed since/);
        expect(snapshot(cleared.session)).toStrictEqual(emptied);

        const timed = fixture();
        const slow = some(setFrameDurationCommand(timed.doc, ["f1", "f2"], 300));
        timed.history.execute(some(setFrameDurationCommand(timed.doc, ["f2"], 40)));
        expect(() => timed.history.execute(slow)).toThrow(/changed since/);
        expect(durations(timed.doc)).toEqual([100, 40, 200, 100, 50]);
    });

    it("two commands made from one state do not run as one step: the step happens as a whole or not at all", () => {
        const { session, doc, history } = fixture();
        session.activeFrameId = "f2";
        const before = snapshot(session);
        const both = compositeCommand("Delete Two", [
            deleteFramesCommand(doc, ["f2"]),
            deleteFramesCommand(doc, ["f3"]),
        ]);

        expect(() => history.execute(both)).toThrow(/changed since/);

        expect(snapshot(session)).toStrictEqual(before);
        expect(history.undoCount).toBe(0);
    });

    it("a command made after the one before it has run does share a step: chainedCommand", () => {
        const { session, doc, history } = fixture();
        const before = snapshot(session);

        history.execute(
            some(
                chainedCommand("Delete Two", session, [
                    (current) => deleteFramesCommand(current.doc, ["f2"]),
                    (current) => deleteFramesCommand(current.doc, ["f3"]),
                ]),
            ),
        );

        expect(frameIds(doc)).toEqual(["f1", "f4", "f5"]);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Delete Two");
        history.undo();
        expect(snapshot(session)).toStrictEqual(before);
        history.redo();
        expect(frameIds(doc)).toEqual(["f1", "f4", "f5"]);
    });
});
