import { describe, expect, it } from "vitest";
import {
    AllocationError,
    History,
    compositeCommand,
    pixelPatchCommand,
} from "../../src/core/history";
import type { HistoryChange, PixelAllocator } from "../../src/core/history";
import { assertInvariants } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import {
    FRAME,
    LAYER,
    addCel,
    addLayer,
    commit,
    copyOf,
    countingBytes,
    execute,
    failingAllocator,
    flakyAllocator,
    newSession,
    paint,
    pixel,
    redo,
    undo,
} from "./se-004-support";

// Allocation failure is simulated by the allocator given to the history (or to
// `pixelPatchCommand`): it throws what the platform throws when memory runs out. The code
// under test is the real begin, commit, redo and command path.

const TARGET = { layerId: LAYER, frameId: FRAME };
const RED = [255, 0, 0, 255];

function emptySession(): DocSession {
    return newSession(4, 3);
}

function filledSession(): { session: DocSession; image: PixelBuffer } {
    const session = newSession(4, 3);
    const image = addCel(session, LAYER, FRAME, "image-a", countingBytes(48));
    return { session, image };
}

function thrownBy(run: () => unknown): unknown {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error("nothing was thrown");
}

/** A history that records what it reports, so "unchanged" covers the history as well. */
function watched(
    session: DocSession,
    allocate: PixelAllocator,
): { history: History; changes: HistoryChange[] } {
    const history = new History(session, { allocate });
    const changes: HistoryChange[] = [];
    history.subscribe((change) => changes.push(change));
    return { history, changes };
}

describe("simulated allocation failure", () => {
    it("is reported as an AllocationError naming the size and the platform error", () => {
        const { session } = filledSession();
        const { history } = watched(session, failingAllocator);

        const error = thrownBy(() => history.begin(TARGET));

        expect(error).toBeInstanceOf(AllocationError);
        expect(error).toBeInstanceOf(Error);
        const allocation = error as AllocationError;
        expect(allocation.name).toBe("AllocationError");
        expect(allocation.bytes).toBe(48);
        expect(allocation.message).toContain("48 bytes");
        expect(allocation.cause).toBeInstanceOf(RangeError);
    });

    it("in begin on an existing cel leaves the session unchanged and throws the typed error", () => {
        const { session } = filledSession();
        const before = copyOf(session);
        const { history, changes } = watched(session, failingAllocator);

        expect(() => history.begin(TARGET)).toThrow(AllocationError);

        expect(session).toStrictEqual(before);
        assertInvariants(session);
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(0);
        expect(changes).toEqual([]);
    });

    it("in begin on an empty cel creates neither the cel nor its image", () => {
        const session = emptySession();
        const before = copyOf(session);
        const { history, changes } = watched(session, failingAllocator);

        expect(() => history.begin(TARGET)).toThrow(AllocationError);

        expect(session).toStrictEqual(before);
        expect(session.doc.cels.size).toBe(0);
        expect(session.doc.images.size).toBe(0);
        assertInvariants(session);
        expect(history.transaction).toBeNull();
        expect(changes).toEqual([]);
    });

    it.each([
        { successes: 1, failing: "the first sub-buffer" },
        { successes: 2, failing: "the second sub-buffer" },
    ])("in commit ($failing) restores the pixels at begin", ({ successes }) => {
        const { session } = filledSession();
        const before = copyOf(session);
        // One allocation for the snapshot of `begin`, then those of `commit`.
        const memory = flakyAllocator(successes);
        const { history, changes } = watched(session, memory.allocate);

        const transaction = history.begin(TARGET);
        paint(transaction, 0, 0, RED);
        paint(transaction, 3, 2, RED);
        expect(session).not.toStrictEqual(before);
        expect(() => transaction.commit("Pencil")).toThrow(AllocationError);

        expect(memory.calls).toBe(successes + 1);
        expect(session).toStrictEqual(before);
        assertInvariants(session);
        expect(transaction.open).toBe(false);
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(0);
        expect(changes).toEqual([]);

        // The history works again once memory is available.
        memory.heal();
        paint(history.begin(TARGET), 0, 0, RED);
        expect(commit(history, "Pencil")).not.toBeNull();
        expect(history.undoCount).toBe(1);
    });

    it("in commit on a created cel removes the cel again", () => {
        const session = emptySession();
        const before = copyOf(session);
        // One allocation for the new image of `begin`; the one of `commit` fails.
        const memory = flakyAllocator(1);
        const { history, changes } = watched(session, memory.allocate);

        const transaction = history.begin(TARGET);
        paint(transaction, 1, 1, RED);
        expect(session.doc.cels.size).toBe(1);
        expect(() => transaction.commit("Pencil")).toThrow(AllocationError);

        expect(session).toStrictEqual(before);
        assertInvariants(session);
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(0);
        expect(changes).toEqual([]);
    });

    it("in the redo of a created cel leaves the session unchanged and the history in place", () => {
        const session = emptySession();
        // `begin` and `commit` allocate once each; the image of the redo is the third.
        const memory = flakyAllocator(2);
        const { history, changes } = watched(session, memory.allocate);
        paint(history.begin(TARGET), 1, 1, RED);
        commit(history, "Pencil");
        const painted = copyOf(session);
        undo(history);
        const before = copyOf(session);
        const position = history.position;

        expect(() => history.redo()).toThrow(AllocationError);

        expect(session).toStrictEqual(before);
        assertInvariants(session);
        expect(history.position).toBe(position);
        expect(history.undoCount).toBe(0);
        expect(history.redoCount).toBe(1);
        expect(changes.map((change) => change.kind)).toEqual(["do", "undo"]);

        memory.heal();
        redo(history);
        expect(session).toStrictEqual(painted);
    });

    it("while making a pixel patch command leaves the session unchanged", () => {
        const { session } = filledSession();
        const before = copyOf(session);
        const pixels = { width: 2, height: 1, data: new Uint8ClampedArray(8) };
        const patch = { label: "Fill", imageId: "image-a", x: 1, y: 1, pixels };

        const error = thrownBy(() => pixelPatchCommand(session.doc, patch, failingAllocator));

        expect(error).toBeInstanceOf(AllocationError);
        expect((error as AllocationError).bytes).toBe(8);
        expect(session).toStrictEqual(before);
    });

    it("inside an executed command leaves the session unchanged and the command unrecorded", () => {
        const session = emptySession();
        addLayer(session, "layer-b");
        const other = addCel(session, "layer-b", FRAME, "image-b", countingBytes(48));
        // `begin` and `commit` allocate once each; every later allocation fails.
        const memory = flakyAllocator(2);
        const { history, changes } = watched(session, memory.allocate);
        paint(history.begin(TARGET), 1, 1, RED);
        // The command of a stroke on an empty cel: its `do` allocates the cel's image.
        const createCel = commit(history, "Pencil");
        if (!createCel) throw new Error("the stroke made no command");
        undo(history);
        const before = copyOf(session);
        const position = history.position;
        const dot = pixelPatchCommand(session.doc, {
            label: "Dot",
            imageId: "image-b",
            x: 0,
            y: 0,
            pixels: { width: 1, height: 1, data: Uint8ClampedArray.from(RED) },
        });

        expect(() => history.execute(createCel)).toThrow(AllocationError);
        expect(session).toStrictEqual(before);
        // In a composite the dot is done first and reversed when the cel cannot be created.
        expect(() => history.execute(compositeCommand("Both", [dot, createCel]))).toThrow(
            AllocationError,
        );

        expect(session).toStrictEqual(before);
        assertInvariants(session);
        expect(history.position).toBe(position);
        expect(history.undoCount).toBe(0);
        expect(history.redoCount).toBe(1);
        expect(changes.map((change) => change.kind)).toEqual(["do", "undo"]);

        memory.heal();
        execute(history, compositeCommand("Both", [dot, createCel]));
        expect(pixel(other, 0, 0)).toEqual(RED);
        expect(session.doc.cels.size).toBe(2);
        expect(history.undoCount).toBe(1);
        expect(history.redoCount).toBe(0);
        undo(history);
        expect(session).toStrictEqual(before);
    });
});
