import { describe, expect, it } from "vitest";
import { clearCelsCommand, moveCelsCommand } from "../../src/core/cels";
import {
    deleteFramesCommand,
    duplicateFramesCommand,
    LastFrameError,
    setFrameDurationCommand,
} from "../../src/core/frames";
import { AllocationError, chainedCommand, compositeCommand } from "../../src/core/history";
import type {
    Command,
    CommandFactory,
    HistoryChange,
    PixelAllocator,
} from "../../src/core/history";
import { sequentialIds } from "../../src/core/model";
import type { IdGenerator, SpriteDoc } from "../../src/core/model";
import { createTagCommand, editTagCommand } from "../../src/core/tags";
import {
    expectSymmetric,
    failingAllocator,
    fixture,
    frameIds,
    IMAGE_BYTES,
    L1,
    L2,
    row,
    snapshot,
    some,
    tagRanges,
} from "./se-021-support";

// SE-021: `chainedCommand`, one undo step from commands that are each made after the one
// before it was done. The commands of this ticket are planned against the document, so this
// is how two of them share a step. The fixture is drawn in `se-021-support.ts`.

const durations = (doc: SpriteDoc) => doc.frames.map((frame) => frame.durationMs);

/** A command that changes nothing and writes its calls into `log`. */
function logged(name: string, log: string[], extra: Partial<Command> = {}): Command {
    return {
        label: name,
        bytes: 0,
        touched: { frameIds: [], layerIds: [], structure: false },
        do: () => void log.push(`do ${name}`),
        undo: () => void log.push(`undo ${name}`),
        ...extra,
    };
}

/** An allocator that fails while `broken` is set. */
function switchedAllocator(): { allocate: PixelAllocator; broken: boolean } {
    const memory = {
        broken: true,
        allocate: (byteLength: number) => {
            if (memory.broken) throw new RangeError("Array buffer allocation failed");
            return new Uint8ClampedArray(byteLength);
        },
    };
    return memory;
}

describe("chainedCommand", () => {
    it("makes each part after the part before it was done, as one undo step", () => {
        const { session, doc, history } = fixture();
        const before = snapshot(session);
        const newId = sequentialIds("n");
        const seen: string[][] = [];

        const command = some(
            chainedCommand("Duplicate And Tag", session, [
                (current) => duplicateFramesCommand(current.doc, ["f3"], newId),
                (current) => {
                    // The copy exists by now, and it is the active frame.
                    seen.push(frameIds(current.doc));
                    const tag = {
                        name: "pair",
                        color: 0x112233ff,
                        fromFrameId: "f3",
                        toFrameId: current.activeFrameId,
                        direction: "forward" as const,
                        repeat: 0,
                    };
                    return createTagCommand(current.doc, tag, newId);
                },
            ]),
        );
        // Made, not done: the second factory waits for the first part.
        expect(seen).toEqual([]);
        expect(snapshot(session)).toStrictEqual(before);

        history.execute(command);

        expect(seen).toEqual([["f1", "f2", "f3", "n1", "f4", "f5"]]);
        expect(frameIds(doc)).toEqual(["f1", "f2", "f3", "n1", "f4", "f5"]);
        // n1 is the frame, n2 and n3 its images, n4 the tag.
        expect(tagRanges(doc).n4).toEqual(["f3", "n1"]);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Duplicate And Tag");
        history.undo();
        expect(snapshot(session)).toStrictEqual(before);
        expect(history.undoCount).toBe(0);
    });

    it("do/undo/redo symmetry over several rounds; a redo does the same parts and calls no factory", () => {
        const { session, doc, history } = fixture();
        session.activeFrameId = "f1";
        let made = 0;
        let called = 0;
        const base = sequentialIds("n");
        const newId: IdGenerator = () => {
            made++;
            return base();
        };
        const factory =
            (make: CommandFactory): CommandFactory =>
            (current) => {
                called++;
                return make(current);
            };

        const command = chainedCommand("Rework", session, [
            factory((current) => duplicateFramesCommand(current.doc, ["f3", "f4"], newId)),
            factory((current) => deleteFramesCommand(current.doc, ["f1"])),
            factory((current) => setFrameDurationCommand(current.doc, ["f2", "f5"], 30)),
        ]);
        const { before, after } = expectSymmetric(history, command, 4);

        expect(frameIds(doc)).toEqual(["f2", "f3", "f4", "n1", "n2", "f5"]);
        expect(durations(doc)).toEqual([30, 200, 100, 200, 100, 30]);
        expect(before.activeFrameId).toBe("f1");
        expect(after.activeFrameId).toBe("n1");
        // Four redos later: every factory was called once, and no ID was made twice, so the
        // frames and images of each redo are the ones later steps of a history would name.
        expect(called).toBe(3);
        expect(made).toBe(4);
        expect(after.doc.images.map(([id]) => id)).toEqual(["a", "b", "c", "e", "g", "n3", "n4"]);
    });

    it("real use: moves cels to the next frame and deletes the frame they came from", () => {
        const { session, doc, history } = fixture();

        const command = chainedCommand("Shift And Delete", session, [
            (current) =>
                moveCelsCommand(
                    current.doc,
                    { layerIds: [L1, L2], frameIds: ["f3"] },
                    { layers: 0, frames: 1 },
                ),
            (current) => deleteFramesCommand(current.doc, ["f3"]),
        ]);
        const { before } = expectSymmetric(history, command);

        expect(frameIds(doc)).toEqual(["f1", "f2", "f4", "f5"]);
        expect(row(doc, L1)).toEqual(["a", "a", "b", "c"]);
        expect(row(doc, L2)).toEqual(["d", ".", "e", "."]);
        expect(history.undoCount).toBe(1);
        // The two commands alone, made from one state, do not run as one step.
        history.undo();
        expect(snapshot(session)).toStrictEqual(before);
        const together = compositeCommand("Shift And Delete", [
            some(
                moveCelsCommand(
                    doc,
                    { layerIds: [L1, L2], frameIds: ["f3"] },
                    { layers: 0, frames: 1 },
                ),
            ),
            deleteFramesCommand(doc, ["f3"]),
        ]);
        expect(() => history.execute(together)).toThrow(/changed since/);
        expect(snapshot(session)).toStrictEqual(before);
    });

    it("real use: duplicates a frame and stretches a tag over the copy", () => {
        const { session, doc, history } = fixture();
        const newId = sequentialIds("n");

        const command = chainedCommand("Duplicate Into Walk", session, [
            (current) => duplicateFramesCommand(current.doc, ["f5"], newId),
            (current) =>
                editTagCommand(current.doc, "walk", {
                    name: "walk on",
                    toFrameId: current.activeFrameId,
                }),
        ]);
        expectSymmetric(history, command);

        expect(frameIds(doc)).toEqual(["f1", "f2", "f3", "f4", "f5", "n1"]);
        // The copy joined end, which ended with f5; the edit stretched walk over both.
        expect(tagRanges(doc)).toEqual({
            intro: ["f1", "f2"],
            walk: ["f2", "n1"],
            end: ["f5", "n1"],
        });
        expect(doc.tags[1].name).toBe("walk on");
    });

    it("bytes and touched are those of the parts, and a history reads them after do", () => {
        const { session, doc, history } = fixture();
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        const command = some(
            chainedCommand("Tidy", session, [
                // Removes the image b; touches f3 on layer-1 and layer-2.
                (current) => deleteFramesCommand(current.doc, ["f3"]),
                // Removes the image c; touches f5 on layer-1.
                (current) => clearCelsCommand(current.doc, { layerIds: [L1], frameIds: ["f5"] }),
                (current) => setFrameDurationCommand(current.doc, ["f1"], 10),
            ]),
        );
        // Before `do` only the first part is made.
        expect(command.bytes).toBe(IMAGE_BYTES);

        history.execute(command);

        const touched = { frameIds: ["f3", "f5"], layerIds: [L1, L2], structure: true };
        expect(command.bytes).toBe(2 * IMAGE_BYTES);
        expect(command.touched).toEqual(touched);
        expect(history.bytes).toBe(2 * IMAGE_BYTES);
        expect(doc.images.has("b") || doc.images.has("c")).toBe(false);
        history.undo();
        history.redo();
        expect(changes).toEqual([
            { kind: "do", label: "Tidy", touched },
            { kind: "undo", label: "Tidy", touched },
            { kind: "redo", label: "Tidy", touched },
        ]);
        expect(command.bytes).toBe(2 * IMAGE_BYTES);
    });

    it("skips a factory that returns null; a step with no parts is null", () => {
        const { session, doc, history } = fixture();
        const before = snapshot(session);
        // f1 lasts 100 ms already.
        const nothing: CommandFactory = (current) =>
            setFrameDurationCommand(current.doc, ["f1"], 100);
        expect(nothing(session)).toBeNull();

        expect(chainedCommand("None", session, [])).toBeNull();
        expect(chainedCommand("None", session, [nothing])).toBeNull();
        expect(chainedCommand("None", session, [nothing, () => null, nothing])).toBeNull();

        const calls: string[] = [];
        const command = some(
            chainedCommand("Some", session, [
                (current) => (calls.push("a"), nothing(current)),
                (current) => (calls.push("b"), setFrameDurationCommand(current.doc, ["f2"], 30)),
                () => (calls.push("c"), null),
                (current) => (calls.push("d"), setFrameDurationCommand(current.doc, ["f3"], 40)),
            ]),
        );
        // Up to the first part, the factories are called when the command is made.
        expect(calls).toEqual(["a", "b"]);
        expect(snapshot(session)).toStrictEqual(before);

        history.execute(command);

        expect(calls).toEqual(["a", "b", "c", "d"]);
        expect(durations(doc)).toEqual([100, 30, 40, 100, 50]);
        expect(history.undoCount).toBe(1);
        history.undo();
        history.redo();
        expect(calls).toEqual(["a", "b", "c", "d"]);
        expect(durations(doc)).toEqual([100, 30, 40, 100, 50]);
    });

    it("a step whose later factories all return null has the one part", () => {
        const { session, doc, history } = fixture();
        const command = chainedCommand("One", session, [
            (current) => deleteFramesCommand(current.doc, ["f5"]),
            () => null,
        ]);
        expectSymmetric(history, command);
        expect(frameIds(doc)).toEqual(["f1", "f2", "f3", "f4"]);
    });

    it("a part that throws from do in the middle leaves the session as it was before the whole step", () => {
        const { session, history } = fixture();
        session.activeFrameId = "f1";
        const before = snapshot(session);
        const reached: string[] = [];

        const command = some(
            chainedCommand("Broken", session, [
                (current) => setFrameDurationCommand(current.doc, ["f2"], 30),
                (current) => clearCelsCommand(current.doc, { layerIds: [L2], frameIds: ["f1"] }),
                (current) => deleteFramesCommand(current.doc, ["f1"]),
                // Its two images cannot be allocated.
                (current) =>
                    duplicateFramesCommand(
                        current.doc,
                        ["f3"],
                        sequentialIds("n"),
                        failingAllocator,
                    ),
                (current) => (reached.push("last"), deleteFramesCommand(current.doc, ["f5"])),
            ]),
        );

        expect(() => history.execute(command)).toThrow(AllocationError);

        // The three parts that were done are undone: the duration, the cel with its image,
        // the frame and the active frame.
        expect(snapshot(session)).toStrictEqual(before);
        expect(reached).toEqual([]);
        expect(history.undoCount).toBe(0);
        expect(history.canRedo).toBe(false);
    });

    it("a factory that throws leaves the session as it was before the whole step", () => {
        const { session, history } = fixture();
        const before = snapshot(session);

        const command = some(
            chainedCommand("Too Much", session, [
                (current) => deleteFramesCommand(current.doc, ["f1", "f2"]),
                // Every frame that is left: refused when the part is made.
                (current) => deleteFramesCommand(current.doc, frameIds(current.doc)),
            ]),
        );

        expect(() => history.execute(command)).toThrow(LastFrameError);
        expect(snapshot(session)).toStrictEqual(before);
        expect(history.undoCount).toBe(0);
    });

    it("a first factory that throws is thrown when the command is made", () => {
        const { session } = fixture();
        const before = snapshot(session);
        expect(() =>
            chainedCommand("Refused", session, [
                () => null,
                (current) => deleteFramesCommand(current.doc, frameIds(current.doc)),
            ]),
        ).toThrow(LastFrameError);
        expect(snapshot(session)).toStrictEqual(before);
    });

    it("a step that failed can be executed again and makes its later parts again", () => {
        const { session, doc, history } = fixture();
        const before = snapshot(session);
        const memory = switchedAllocator();
        const newId = sequentialIds("n");
        let called = 0;

        const command = some(
            chainedCommand("Retry", session, [
                (current) => deleteFramesCommand(current.doc, ["f1"]),
                (current) => {
                    called++;
                    return duplicateFramesCommand(current.doc, ["f3"], newId, memory.allocate);
                },
            ]),
        );
        expect(() => history.execute(command)).toThrow(AllocationError);
        expect(snapshot(session)).toStrictEqual(before);
        // Only the first part is left of the attempt.
        expect(command.touched.frameIds).toEqual(["f1"]);

        memory.broken = false;
        expectSymmetric(history, command);

        expect(called).toBe(2);
        expect(frameIds(doc)).toHaveLength(5);
        expect(history.undoCount).toBe(1);
    });

    it("a redo that fails leaves the session as it was before the redo and can be repeated", () => {
        const { session, history } = fixture();
        const memory = switchedAllocator();
        memory.broken = false;
        const command = some(
            chainedCommand("Redo Me", session, [
                (current) => deleteFramesCommand(current.doc, ["f1"]),
                (current) =>
                    duplicateFramesCommand(
                        current.doc,
                        ["f3"],
                        sequentialIds("n"),
                        memory.allocate,
                    ),
            ]),
        );
        history.execute(command);
        const after = snapshot(session);
        history.undo();
        const undone = snapshot(session);

        memory.broken = true;
        expect(() => history.redo()).toThrow(AllocationError);
        expect(snapshot(session)).toStrictEqual(undone);
        expect(history.redoCount).toBe(1);

        memory.broken = false;
        expect(history.redo()).toBe(true);
        expect(snapshot(session)).toStrictEqual(after);
    });

    it("does the parts in order, undoes them in reverse, and redoes them in order", () => {
        const { session, history } = fixture();
        const log: string[] = [];
        const command = some(
            chainedCommand("Three", session, [
                () => (log.push("make a"), logged("a", log)),
                () => (log.push("make b"), logged("b", log)),
                () => (log.push("make c"), logged("c", log)),
            ]),
        );
        expect(log).toEqual(["make a"]);

        history.execute(command);
        history.undo();
        history.redo();

        expect(log).toEqual([
            "make a",
            "do a",
            "make b",
            "do b",
            "make c",
            "do c",
            "undo c",
            "undo b",
            "undo a",
            "do a",
            "do b",
            "do c",
        ]);
    });

    it("when a part throws in undo, repeats those already undone and rethrows", () => {
        const { session, history } = fixture();
        const log: string[] = [];
        let broken = true;
        const fragile = logged("b", log, {
            undo() {
                if (broken) throw new Error("undo failed");
                log.push("undo b");
            },
        });
        history.execute(
            some(
                chainedCommand("Fragile", session, [
                    () => logged("a", log),
                    () => fragile,
                    () => logged("c", log),
                    () => logged("d", log),
                ]),
            ),
        );
        log.length = 0;

        expect(() => history.undo()).toThrow("undo failed");

        expect(log).toEqual(["undo d", "undo c", "do c", "do d"]);
        expect(history.undoCount).toBe(1);
        broken = false;
        expect(history.undo()).toBe(true);
        expect(log.slice(4)).toEqual(["undo d", "undo c", "undo b", "undo a"]);
    });

    it("takes commands that are ready as parts, and another chained command", () => {
        const { session, doc, history } = fixture();
        const ready = some(setFrameDurationCommand(doc, ["f5"], 70));

        const command = chainedCommand("Outer", session, [
            () => ready,
            (current) =>
                chainedCommand("Inner", current, [
                    (inner) => deleteFramesCommand(inner.doc, ["f3"]),
                    (inner) => deleteFramesCommand(inner.doc, ["f1"]),
                ]),
            (current) => clearCelsCommand(current.doc, { layerIds: [L1], frameIds: ["f5"] }),
        ]);
        expectSymmetric(history, command);

        expect(frameIds(doc)).toEqual(["f2", "f4", "f5"]);
        expect(durations(doc)).toEqual([100, 100, 70]);
        // The images b (f3), d (f1) and c (cleared); a is still the cel of f2.
        expect(some(command).bytes).toBe(3 * IMAGE_BYTES);
        expect(history.bytes).toBe(3 * IMAGE_BYTES);
        expect(some(command).touched).toEqual({
            frameIds: ["f3", "f1", "f5"],
            layerIds: [L1, L2],
            structure: true,
        });
    });

    it("is made for the session as it is: run after another command, its first part refuses", () => {
        const { session, doc, history } = fixture();
        const command = some(
            chainedCommand("Late", session, [
                (current) => deleteFramesCommand(current.doc, ["f2"]),
                (current) => deleteFramesCommand(current.doc, ["f3"]),
            ]),
        );
        history.execute(deleteFramesCommand(doc, ["f5"]));
        const before = snapshot(session);

        expect(() => history.execute(command)).toThrow(/changed since/);

        expect(snapshot(session)).toStrictEqual(before);
        expect(history.undoCount).toBe(1);
    });
});
