import { describe, expect, it } from "vitest";
import { activeTagAt, sequentialIds } from "../../src/core/model";
import {
    createTagCommand,
    deleteTagCommand,
    editTagCommand,
    isTagRepeat,
    MAX_TAG_REPEAT,
    TagRangeError,
    TagRepeatError,
} from "../../src/core/tags";
import type { TagProperties } from "../../src/core/tags";
import { assertSound, expectSymmetric, fixture, snapshot, some } from "./se-021-support";

// SE-021: the tag commands. The fixture has the frames f1 … f5 and the tags intro (f1–f2),
// walk (f2–f4, ping-pong) and end (f5, reverse, repeat 2), created in that order.

const ids = () => sequentialIds("n");

function properties(changes: Partial<TagProperties> = {}): TagProperties {
    return {
        name: "run",
        color: 0xcc3344ff,
        fromFrameId: "f3",
        toFrameId: "f5",
        direction: "reverse",
        repeat: 4,
        ...changes,
    };
}

function thrownBy(run: () => unknown): unknown {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error("nothing was thrown");
}

describe("createTagCommand", () => {
    it("adds the tag at the end of the list, with a new ID", () => {
        const { doc, history } = fixture();

        history.execute(createTagCommand(doc, properties(), ids()));

        expect(doc.tags.map((tag) => tag.id)).toEqual(["intro", "walk", "end", "n1"]);
        expect(doc.tags[3]).toEqual({
            id: "n1",
            name: "run",
            color: 0xcc3344ff,
            fromFrameId: "f3",
            toFrameId: "f5",
            direction: "reverse",
            repeat: 4,
        });
        expect(history.undoLabel).toBe("New Tag");
    });

    it("the new tag is the one created last: it wins a tie for the active tag", () => {
        const { doc, history } = fixture();
        expect(activeTagAt(doc, 2)?.id).toBe("walk");
        history.execute(
            createTagCommand(doc, properties({ fromFrameId: "f2", toFrameId: "f4" }), ids()),
        );
        expect(activeTagAt(doc, 2)?.id).toBe("n1");
    });

    it("accepts a range of one frame and the range of all frames", () => {
        const { doc, history } = fixture();
        history.execute(createTagCommand(doc, properties({ fromFrameId: "f3", toFrameId: "f3" })));
        history.execute(createTagCommand(doc, properties({ fromFrameId: "f1", toFrameId: "f5" })));
        expect(doc.tags).toHaveLength(5);
    });

    it.each([
        { fromFrameId: "f9", toFrameId: "f2", reason: "unknown-frame" },
        { fromFrameId: "f1", toFrameId: "f9", reason: "unknown-frame" },
        { fromFrameId: "f8", toFrameId: "f9", reason: "unknown-frame" },
        { fromFrameId: "", toFrameId: "f2", reason: "unknown-frame" },
        { fromFrameId: "f4", toFrameId: "f2", reason: "from-after-to" },
        { fromFrameId: "f5", toFrameId: "f1", reason: "from-after-to" },
    ] as const)(
        "a tag cannot be given the range $fromFrameId to $toFrameId outside the document's frames: typed error, $reason",
        ({ fromFrameId, toFrameId, reason }) => {
            const { session, doc, history } = fixture();
            const before = snapshot(session);

            const error = thrownBy(() =>
                createTagCommand(doc, properties({ fromFrameId, toFrameId })),
            );

            expect(error).toBeInstanceOf(TagRangeError);
            expect(error).toBeInstanceOf(Error);
            expect(error).toMatchObject({ name: "TagRangeError", fromFrameId, toFrameId, reason });
            expect(snapshot(session)).toStrictEqual(before);
            expect(history.undoCount).toBe(0);
        },
    );

    it("repeat accepts 0 to 65535 and rejects other values with a typed error", () => {
        const { session, doc, history } = fixture();
        expect(MAX_TAG_REPEAT).toBe(65535);
        history.execute(createTagCommand(doc, properties({ repeat: 0 })));
        history.execute(createTagCommand(doc, properties({ repeat: 65535 })));
        const before = snapshot(session);

        for (const repeat of [-1, 65536, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            const error = thrownBy(() => createTagCommand(doc, properties({ repeat })));
            expect(error).toBeInstanceOf(TagRepeatError);
            expect(error).toMatchObject({ name: "TagRepeatError", repeat });
            expect(isTagRepeat(repeat)).toBe(false);
        }
        expect(isTagRepeat(0)).toBe(true);
        expect(isTagRepeat(65535)).toBe(true);
        expect(snapshot(session)).toStrictEqual(before);
    });

    it("stores the properties of a tag only, in an object of its own", () => {
        const { doc, history } = fixture();
        const given = { ...properties(), stray: true };

        history.execute(createTagCommand(doc, given, ids()));
        given.name = "changed later";

        expect(Object.keys(doc.tags[3]).sort()).toEqual([
            "color",
            "direction",
            "fromFrameId",
            "id",
            "name",
            "repeat",
            "toFrameId",
        ]);
        expect(doc.tags[3].name).toBe("run");
        // Nor is the document's tag the object a redo installs again.
        doc.tags[3].name = "edited in place";
        history.undo();
        history.redo();
        expect(doc.tags[3].name).toBe("run");
    });

    it("do/undo/redo symmetry", () => {
        const { doc, history } = fixture();
        const { before, after } = expectSymmetric(
            history,
            createTagCommand(doc, properties(), ids()),
        );
        expect(before.doc.tags).toHaveLength(3);
        expect(after.doc.tags).toHaveLength(4);
    });

    it("touches no composite, reports a structure change and is not applied until executed", () => {
        const { session, doc } = fixture();
        const before = snapshot(session);
        const command = createTagCommand(doc, properties(), ids());
        expect(command.touched).toEqual({ frameIds: [], layerIds: [], structure: true });
        expect(command.bytes).toBe(0);
        expect(snapshot(session)).toStrictEqual(before);
    });
});

describe("editTagCommand", () => {
    it.each([
        { field: "name", changes: { name: "stroll" } },
        { field: "colour", changes: { color: 0x00ff00ff } },
        { field: "direction", changes: { direction: "reverse" } },
        { field: "repeat", changes: { repeat: 7 } },
        { field: "first frame", changes: { fromFrameId: "f1" } },
        { field: "last frame", changes: { toFrameId: "f5" } },
        { field: "range", changes: { fromFrameId: "f4", toFrameId: "f5" } },
    ] as const)("changes the $field of a tag and nothing else", ({ changes }) => {
        const { doc, history } = fixture();
        const walk = { ...doc.tags[1] };
        const others = [{ ...doc.tags[0] }, { ...doc.tags[2] }];

        history.execute(some(editTagCommand(doc, "walk", changes)));

        // The same tag at the same place, with the new values.
        expect(doc.tags[1]).toEqual({ ...walk, ...changes });
        expect([doc.tags[0], doc.tags[2]]).toEqual(others);
        expect(history.undoLabel).toBe("Edit Tag");
    });

    it("changes name, colour, range, direction and repeat in one step", () => {
        const { doc, history } = fixture();
        const changes = properties();

        history.execute(some(editTagCommand(doc, "intro", changes)));

        expect(doc.tags[0]).toEqual({ id: "intro", ...changes });
        expect(history.undoCount).toBe(1);
        history.undo();
        expect(doc.tags[0]).toMatchObject({ name: "intro", fromFrameId: "f1", toFrameId: "f2" });
    });

    it("sets a colour of 0 and a repeat of 0", () => {
        const { doc, history } = fixture();
        history.execute(some(editTagCommand(doc, "end", { color: 0, repeat: 0 })));
        expect(doc.tags[2]).toMatchObject({ color: 0, repeat: 0 });
    });

    it("a tag cannot be given a range outside the document's frames by an edit either", () => {
        const { session, doc } = fixture();
        const before = snapshot(session);
        // walk runs from f2 to f4.
        const cases = [
            { changes: { fromFrameId: "f5" }, reason: "from-after-to" },
            { changes: { toFrameId: "f1" }, reason: "from-after-to" },
            { changes: { fromFrameId: "f9" }, reason: "unknown-frame" },
            { changes: { toFrameId: "f9" }, reason: "unknown-frame" },
            { changes: { fromFrameId: "f3", toFrameId: "f2" }, reason: "from-after-to" },
        ];
        for (const { changes, reason } of cases) {
            const error = thrownBy(() => editTagCommand(doc, "walk", changes));
            expect(error).toBeInstanceOf(TagRangeError);
            expect(error).toMatchObject({ reason, fromFrameId: "f2", toFrameId: "f4", ...changes });
        }
        expect(() => editTagCommand(doc, "walk", { repeat: -1 })).toThrow(TagRepeatError);
        expect(snapshot(session)).toStrictEqual(before);
    });

    it("returns null when nothing would change", () => {
        const { doc } = fixture();
        expect(editTagCommand(doc, "walk", {})).toBeNull();
        expect(editTagCommand(doc, "walk", { name: "walk" })).toBeNull();
        expect(editTagCommand(doc, "walk", { direction: "pingpong", repeat: 0 })).toBeNull();
        expect(editTagCommand(doc, "walk", { fromFrameId: "f2", toFrameId: "f4" })).toBeNull();
        expect(editTagCommand(doc, "walk", { name: undefined, repeat: undefined })).toBeNull();
        expect(editTagCommand(doc, "walk", { repeat: 1 })).not.toBeNull();
    });

    it("rejects a tag the document does not have", () => {
        const { doc } = fixture();
        expect(() => editTagCommand(doc, "nope", { name: "a" })).toThrow(RangeError);
    });

    it("do/undo/redo symmetry", () => {
        const { doc, history } = fixture();
        const { before, after } = expectSymmetric(
            history,
            editTagCommand(doc, "walk", { name: "stroll", toFrameId: "f5", repeat: 2 }),
        );
        expect(before.doc.tags[1]).toMatchObject({ name: "walk", toFrameId: "f4", repeat: 0 });
        expect(after.doc.tags[1]).toMatchObject({ name: "stroll", toFrameId: "f5", repeat: 2 });
    });

    it("touches nothing: the list of tags is the same", () => {
        const { doc } = fixture();
        const command = some(editTagCommand(doc, "walk", { name: "stroll" }));
        expect(command.touched).toEqual({ frameIds: [], layerIds: [], structure: false });
        expect(command.bytes).toBe(0);
    });

    it("leaves exportSettings.frames naming the edited tag", () => {
        const { doc, history } = fixture();
        doc.exportSettings.frames = { tagId: "walk" };
        history.execute(some(editTagCommand(doc, "walk", { toFrameId: "f3" })));
        expect(doc.exportSettings.frames).toEqual({ tagId: "walk" });
        history.undo();
        expect(doc.exportSettings.frames).toEqual({ tagId: "walk" });
    });
});

describe("deleteTagCommand", () => {
    it("deletes the tag and keeps the others in order", () => {
        const { doc, history } = fixture();
        history.execute(deleteTagCommand(doc, "walk"));
        expect(doc.tags.map((tag) => tag.id)).toEqual(["intro", "end"]);
        expect(doc.frames).toHaveLength(5);
        expect(history.undoLabel).toBe("Delete Tag");
    });

    it("do/undo/redo symmetry: undo puts the tag back in its place", () => {
        const { doc, history } = fixture();
        const { before } = expectSymmetric(history, deleteTagCommand(doc, "walk"));
        expect(before.doc.tags.map((tag) => tag.id)).toEqual(["intro", "walk", "end"]);
        history.undo();
        expect(doc.tags.map((tag) => tag.id)).toEqual(["intro", "walk", "end"]);
        expect(doc.tags[1]).toMatchObject({ direction: "pingpong", fromFrameId: "f2" });
    });

    it("deleting the tag named by exportSettings.frames resets it to all, and undo restores it", () => {
        const { session, doc, history } = fixture();
        doc.exportSettings.frames = { tagId: "walk" };

        const { before, after } = expectSymmetric(history, deleteTagCommand(doc, "walk"));

        expect(before.doc.exportSettings.frames).toEqual({ tagId: "walk" });
        expect(after.doc.exportSettings.frames).toBe("all");
        expect(session.doc.exportSettings.frames).toBe("all");
        history.undo();
        expect(session.doc.exportSettings.frames).toEqual({ tagId: "walk" });
        // Nothing else of the export settings is touched.
        expect({ ...after.doc.exportSettings, frames: 0 }).toEqual({
            ...before.doc.exportSettings,
            frames: 0,
        });
    });

    it("leaves exportSettings.frames alone when it names another tag or all frames", () => {
        const named = fixture();
        named.doc.exportSettings.frames = { tagId: "intro" };
        named.history.execute(deleteTagCommand(named.doc, "walk"));
        expect(named.doc.exportSettings.frames).toEqual({ tagId: "intro" });
        named.history.undo();
        expect(named.doc.exportSettings.frames).toEqual({ tagId: "intro" });

        const all = fixture();
        all.history.execute(deleteTagCommand(all.doc, "walk"));
        expect(all.doc.exportSettings.frames).toBe("all");
        all.history.undo();
        expect(all.doc.exportSettings.frames).toBe("all");
    });

    it("touches no composite and reports a structure change", () => {
        const { doc } = fixture();
        const command = deleteTagCommand(doc, "end");
        expect(command.touched).toEqual({ frameIds: [], layerIds: [], structure: true });
        expect(command.bytes).toBe(0);
    });

    it("rejects a tag the document does not have", () => {
        const { session, doc } = fixture();
        const before = snapshot(session);
        expect(() => deleteTagCommand(doc, "nope")).toThrow(RangeError);
        expect(snapshot(session)).toStrictEqual(before);
    });
});

describe("a tag command whose document changed since it was made", () => {
    it("throws instead of running and leaves the session as it is", () => {
        const { session, doc, history } = fixture();
        const stale = [
            createTagCommand(doc, properties(), ids()),
            some(editTagCommand(doc, "walk", { name: "stroll" })),
            deleteTagCommand(doc, "end"),
        ];
        history.execute(some(editTagCommand(doc, "intro", { name: "opening" })));
        const before = snapshot(session);

        for (const command of stale) {
            expect(() => history.execute(command)).toThrow(/changed since/);
            expect(snapshot(session)).toStrictEqual(before);
        }
        expect(history.undoCount).toBe(1);
    });
});

// `exportSettings.frames` is set without a history entry (SPEC §5.2), so a command can find
// it changed between its do, undo and redo. The invariant holds whatever it was set to.
describe("tag commands and an export choice made outside the history", () => {
    it("undoing the creation of the tag chosen for export resets the choice; redo restores it", () => {
        const { session, doc, history } = fixture();
        history.execute(createTagCommand(doc, properties(), ids()));
        doc.exportSettings.frames = { tagId: "n1" };

        history.undo();
        expect(doc.exportSettings.frames).toBe("all");
        assertSound(session);
        history.redo();
        expect(doc.exportSettings.frames).toEqual({ tagId: "n1" });
    });

    it("redoing the deletion of a tag chosen after the undo resets the choice", () => {
        const { doc, history } = fixture();
        history.execute(deleteTagCommand(doc, "walk"));
        history.undo();
        doc.exportSettings.frames = { tagId: "walk" };

        history.redo();
        expect(doc.exportSettings.frames).toBe("all");
        history.undo();
        expect(doc.exportSettings.frames).toEqual({ tagId: "walk" });
    });

    it("undo does not overrule a choice made after the reset", () => {
        const { doc, history } = fixture();
        doc.exportSettings.frames = { tagId: "walk" };
        history.execute(deleteTagCommand(doc, "walk"));
        expect(doc.exportSettings.frames).toBe("all");
        doc.exportSettings.frames = { tagId: "intro" };

        history.undo();
        expect(doc.exportSettings.frames).toEqual({ tagId: "intro" });
        // Nor does a later redo and undo bring the old choice back.
        history.redo();
        history.undo();
        expect(doc.exportSettings.frames).toEqual({ tagId: "intro" });
    });
});
