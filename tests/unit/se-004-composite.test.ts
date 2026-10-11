import { describe, expect, it } from "vitest";
import { History, compositeCommand, pixelPatchCommand } from "../../src/core/history";
import type { Command, HistoryChange } from "../../src/core/history";
import type { DocSession, Touched } from "../../src/core/model";
import {
    FRAME,
    LAYER,
    addCel,
    copyOf,
    countingBytes,
    execute,
    newSession,
    pixel,
    redo,
    undo,
} from "./se-004-support";

/**
 * A command that appends `letter` to the document name; undo removes the last letter, so the
 * name is right only when the commands are undone in reverse order. `log` records the calls.
 */
function append(letter: string, log: string[], extra: Partial<Command> = {}): Command {
    return {
        label: `Append ${letter}`,
        bytes: 0,
        touched: { frameIds: [], layerIds: [], structure: false },
        do(session) {
            session.doc.name += letter;
            log.push(`do ${letter}`);
        },
        undo(session) {
            session.doc.name = session.doc.name.slice(0, -1);
            log.push(`undo ${letter}`);
        },
        ...extra,
    };
}

function setup(): { session: DocSession; history: History; log: string[] } {
    const session = newSession(4, 3);
    session.doc.name = "";
    return { session, history: new History(session), log: [] };
}

describe("compositeCommand", () => {
    it("is one undo step that does its commands in order and undoes them in reverse", () => {
        const { session, history, log } = setup();
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        execute(
            history,
            compositeCommand("Append abc", [append("a", log), append("b", log), append("c", log)]),
        );

        expect(session.doc.name).toBe("abc");
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Append abc");

        undo(history);
        expect(session.doc.name).toBe("");
        expect(history.canUndo).toBe(false);
        redo(history);
        expect(session.doc.name).toBe("abc");

        expect(log).toEqual([
            "do a",
            "do b",
            "do c",
            "undo c",
            "undo b",
            "undo a",
            "do a",
            "do b",
            "do c",
        ]);
        expect(changes.map(({ kind, label }) => `${kind} ${label}`)).toEqual([
            "do Append abc",
            "undo Append abc",
            "redo Append abc",
        ]);
    });

    it("retains the bytes of all its commands and touches what any of them touches", () => {
        const { log } = setup();
        const touched = (frameIds: string[], layerIds: string[], structure: boolean): Touched => ({
            frameIds,
            layerIds,
            structure,
        });

        const command = compositeCommand("Three", [
            append("a", log, { bytes: 10, touched: touched(["f1", "f2"], ["l1"], false) }),
            append("b", log, { bytes: 5, touched: touched(["f2", "f3"], ["l2", "l1"], true) }),
            append("c", log, { bytes: 1, touched: touched([], [], false) }),
        ]);

        expect(command.bytes).toBe(16);
        expect(command.touched).toEqual({
            frameIds: ["f1", "f2", "f3"],
            layerIds: ["l1", "l2"],
            structure: true,
        });
        expect(compositeCommand("None", []).touched).toEqual(touched([], [], false));
        expect(compositeCommand("None", []).bytes).toBe(0);
    });

    it("combines pixel patches of several images into one step", () => {
        const session = newSession(4, 3);
        session.doc.frames.push({ id: "frame-b", durationMs: 100 });
        const first = addCel(session, LAYER, FRAME, "image-a", countingBytes(48));
        const second = addCel(session, LAYER, "frame-b", "image-b", countingBytes(48, 101));
        const history = new History(session);
        const before = copyOf(session);
        const white = { width: 1, height: 1, data: new Uint8ClampedArray(4).fill(255) };
        const patch = (imageId: string, x: number): Command =>
            pixelPatchCommand(session.doc, { label: "Dot", imageId, x, y: 0, pixels: white });

        const command = compositeCommand("Replace colour", [
            patch("image-a", 0),
            patch("image-b", 3),
        ]);
        execute(history, command);

        expect(pixel(first, 0, 0)).toEqual([255, 255, 255, 255]);
        expect(pixel(second, 3, 0)).toEqual([255, 255, 255, 255]);
        expect(command.bytes).toBe(16);
        expect(command.touched).toEqual({
            frameIds: [FRAME, "frame-b"],
            layerIds: [LAYER],
            structure: false,
        });
        expect(history.undoCount).toBe(1);
        undo(history);
        expect(session).toStrictEqual(before);
    });

    it("when a command throws in do, reverses those already done and rethrows", () => {
        const { session, history, log } = setup();
        const failing = append("x", log, {
            do() {
                throw new Error("do failed");
            },
        });
        const command = compositeCommand("Append", [
            append("a", log),
            append("b", log),
            failing,
            append("c", log),
        ]);

        expect(() => history.execute(command)).toThrow("do failed");

        expect(session.doc.name).toBe("");
        expect(log).toEqual(["do a", "do b", "undo b", "undo a"]);
        expect(history.undoCount).toBe(0);
    });

    it("when a command throws in undo, repeats those already undone and rethrows", () => {
        const { session, history, log } = setup();
        let broken = true;
        const fragile = append("b", log, {
            undo(target) {
                if (broken) throw new Error("undo failed");
                target.doc.name = target.doc.name.slice(0, -1);
                log.push("undo b");
            },
        });
        execute(
            history,
            compositeCommand("Append", [
                append("a", log),
                fragile,
                append("c", log),
                append("d", log),
            ]),
        );
        log.length = 0;

        expect(() => history.undo()).toThrow("undo failed");

        expect(session.doc.name).toBe("abcd");
        expect(log).toEqual(["undo d", "undo c", "do c", "do d"]);
        expect(history.undoCount).toBe(1);
        expect(history.redoCount).toBe(0);

        broken = false;
        undo(history);
        expect(session.doc.name).toBe("");
    });
});
