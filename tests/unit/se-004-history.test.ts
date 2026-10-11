import { describe, expect, it } from "vitest";
import { DEFAULT_HISTORY_BUDGET_BYTES, History } from "../../src/core/history";
import type { Command, HistoryChange } from "../../src/core/history";
import type { Touched } from "../../src/core/model";
import { FRAME, LAYER, copyOf, execute, newSession, redo, undo } from "./se-004-support";

const MB = 1024 * 1024;
const NOTHING: Touched = { frameIds: [], layerIds: [], structure: false };

/** A command that renames the document. `bytes` is the memory it claims to retain. */
function rename(to: string, bytes = 0, touched: Touched = NOTHING): Command {
    let from = "";
    return {
        label: `Rename to ${to}`,
        bytes,
        touched,
        do(session) {
            from = session.doc.name;
            session.doc.name = to;
        },
        undo(session) {
            session.doc.name = from;
        },
    };
}

function setup(budgetBytes?: number): History {
    return new History(newSession(4, 3), { budgetBytes });
}

describe("History", () => {
    it("executes a command on its session and offers it for undo", () => {
        const history = setup();
        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(false);
        expect(history.undoLabel).toBeNull();
        expect(history.redoLabel).toBeNull();

        execute(history, rename("a"));

        expect(history.session.doc.name).toBe("a");
        expect(history.undoCount).toBe(1);
        expect(history.redoCount).toBe(0);
        expect(history.canUndo).toBe(true);
        expect(history.canRedo).toBe(false);
        expect(history.undoLabel).toBe("Rename to a");
        expect(history.redoLabel).toBeNull();
    });

    it("undoes and redoes the commands in order, with the labels for menu text", () => {
        const history = setup();
        for (const name of ["a", "b", "c"]) execute(history, rename(name));

        undo(history);
        expect(history.session.doc.name).toBe("b");
        expect(history.undoLabel).toBe("Rename to b");
        expect(history.redoLabel).toBe("Rename to c");
        undo(history);
        expect(history.session.doc.name).toBe("a");
        undo(history);
        expect(history.session.doc.name).toBe("fixture");
        expect(history.undoLabel).toBeNull();
        expect(history.redoLabel).toBe("Rename to a");
        expect(history.undoCount).toBe(0);
        expect(history.redoCount).toBe(3);

        redo(history);
        expect(history.session.doc.name).toBe("a");
        redo(history);
        expect(history.session.doc.name).toBe("b");
        redo(history);
        expect(history.session.doc.name).toBe("c");
        expect(history.undoLabel).toBe("Rename to c");
        expect(history.redoLabel).toBeNull();
    });

    it("returns false and changes nothing when there is nothing to undo or redo", () => {
        const history = setup();
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));
        const before = copyOf(history.session);

        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(false);

        expect(history.session).toStrictEqual(before);
        expect(changes).toEqual([]);
    });

    it("a new command after undo clears redo", () => {
        const history = setup();
        for (const name of ["a", "b", "c"]) execute(history, rename(name, 10));
        undo(history);
        undo(history);
        expect(history.redoCount).toBe(2);
        expect(history.canRedo).toBe(true);
        expect(history.bytes).toBe(30);

        execute(history, rename("d", 10));

        expect(history.redoCount).toBe(0);
        expect(history.canRedo).toBe(false);
        expect(history.redoLabel).toBeNull();
        expect(history.redo()).toBe(false);
        expect(history.session.doc.name).toBe("d");
        expect(history.undoCount).toBe(2);
        expect(history.bytes).toBe(20);
        undo(history);
        expect(history.session.doc.name).toBe("a");
        redo(history);
        expect(history.session.doc.name).toBe("d");
    });

    it("reports kind, label and touched of every step to subscribers, after the change", () => {
        const history = setup();
        const touched: Touched = { frameIds: [FRAME], layerIds: [LAYER], structure: true };
        const seen: Array<HistoryChange & { name: string }> = [];
        history.subscribe((change) => seen.push({ ...change, name: history.session.doc.name }));

        execute(history, rename("a", 0, touched));
        execute(history, rename("b"));
        undo(history);
        undo(history);
        redo(history);

        expect(seen).toEqual([
            { kind: "do", label: "Rename to a", touched, name: "a" },
            { kind: "do", label: "Rename to b", touched: NOTHING, name: "b" },
            { kind: "undo", label: "Rename to b", touched: NOTHING, name: "a" },
            { kind: "undo", label: "Rename to a", touched, name: "fixture" },
            { kind: "redo", label: "Rename to a", touched, name: "a" },
        ]);
    });

    it("stops calling a listener once it has unsubscribed", () => {
        const history = setup();
        const first: string[] = [];
        const second: string[] = [];
        const unsubscribe = history.subscribe((change) => first.push(change.kind));
        history.subscribe((change) => second.push(change.kind));

        execute(history, rename("a"));
        unsubscribe();
        undo(history);

        expect(first).toEqual(["do"]);
        expect(second).toEqual(["do", "undo"]);
    });

    it("does not record a command whose do throws, and keeps redo", () => {
        const history = setup();
        execute(history, rename("a"));
        execute(history, rename("b"));
        undo(history);
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));
        const position = history.position;
        const failing: Command = {
            ...rename("x"),
            do() {
                throw new Error("no");
            },
        };

        expect(() => history.execute(failing)).toThrow("no");

        expect(history.undoCount).toBe(1);
        expect(history.redoCount).toBe(1);
        expect(history.position).toBe(position);
        expect(changes).toEqual([]);
        redo(history);
        expect(history.session.doc.name).toBe("b");
    });

    it("keeps its place when undo or redo throws", () => {
        const history = setup();
        let broken = false;
        const base = rename("a");
        const fragile: Command = {
            ...base,
            do(session) {
                if (broken) throw new Error("redo failed");
                base.do(session);
            },
            undo(session) {
                if (broken) throw new Error("undo failed");
                base.undo(session);
            },
        };
        execute(history, fragile);
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        broken = true;
        expect(() => history.undo()).toThrow("undo failed");
        expect(history.undoCount).toBe(1);
        expect(history.redoCount).toBe(0);
        broken = false;
        undo(history);

        broken = true;
        expect(() => history.redo()).toThrow("redo failed");
        expect(history.undoCount).toBe(0);
        expect(history.redoCount).toBe(1);
        broken = false;
        redo(history);

        expect(changes.map((change) => change.kind)).toEqual(["undo", "redo"]);
    });

    it("position identifies the document state for the dirty rule", () => {
        const history = setup();
        const start = history.position;
        execute(history, rename("a"));
        const afterA = history.position;
        execute(history, rename("b"));
        const afterB = history.position;
        expect(new Set([start, afterA, afterB]).size).toBe(3);

        undo(history);
        expect(history.position).toBe(afterA);
        redo(history);
        expect(history.position).toBe(afterB);
        undo(history);
        undo(history);
        expect(history.position).toBe(start);

        // A different command at the same depth is a different state: a document saved at
        // `afterA` stays dirty from here on.
        execute(history, rename("c"));
        expect([start, afterA, afterB]).not.toContain(history.position);
        undo(history);
        expect(history.position).toBe(start);
    });
});

describe("History memory budget", () => {
    it("is 256 MB unless another budget is given", () => {
        expect(DEFAULT_HISTORY_BUDGET_BYTES).toBe(256 * MB);
        expect(setup().budgetBytes).toBe(268_435_456);
        expect(setup(1000).budgetBytes).toBe(1000);
    });

    it("keeps every command while the total is within the budget", () => {
        const history = setup();
        execute(history, rename("a", 128 * MB));
        execute(history, rename("b", 128 * MB));

        expect(history.bytes).toBe(256 * MB);
        expect(history.undoCount).toBe(2);
    });

    it("exceeding the budget drops oldest commands only", () => {
        const history = setup();
        execute(history, rename("a", 100 * MB));
        execute(history, rename("b", 100 * MB));
        expect(history.undoCount).toBe(2);

        execute(history, rename("c", 100 * MB));

        expect(history.undoCount).toBe(2);
        expect(history.bytes).toBe(200 * MB);
        expect(history.session.doc.name).toBe("c");
        expect(history.undoLabel).toBe("Rename to c");
        undo(history);
        expect(history.undoLabel).toBe("Rename to b");

        // Three more: each one pushes out exactly the oldest.
        redo(history);
        for (const name of ["d", "e", "f"]) {
            execute(history, rename(name, 100 * MB));
            expect(history.undoCount).toBe(2);
            expect(history.bytes).toBe(200 * MB);
        }
        undo(history);
        undo(history);
        expect(history.session.doc.name).toBe("d");
    });

    it("drops as many of the oldest commands as the newest one needs", () => {
        const history = setup(100);
        for (const name of ["a", "b", "c", "d"]) execute(history, rename(name, 25));
        expect(history.undoCount).toBe(4);

        execute(history, rename("e", 60));

        // 25 + 25 + 25 + 25 + 60 = 160: "a", "b" and "c" go, "d" and "e" (85) stay.
        expect(history.undoCount).toBe(2);
        expect(history.bytes).toBe(85);
        undo(history);
        undo(history);
        expect(history.session.doc.name).toBe("c");
        expect(history.canUndo).toBe(false);
    });

    it("undo stops at the oldest retained command", () => {
        const history = setup();
        const start = history.position;
        for (const name of ["a", "b", "c"]) execute(history, rename(name, 100 * MB));

        undo(history);
        undo(history);

        // "Rename to a" was dropped: the document keeps its result and cannot go further back.
        expect(history.session.doc.name).toBe("a");
        expect(history.canUndo).toBe(false);
        expect(history.undoLabel).toBeNull();
        expect(history.undo()).toBe(false);
        expect(history.session.doc.name).toBe("a");
        expect(history.position).not.toBe(start);

        redo(history);
        redo(history);
        expect(history.session.doc.name).toBe("c");
    });

    it("a single command larger than the budget is retained and remains undoable", () => {
        const history = setup();
        execute(history, rename("a", 10 * MB));
        execute(history, rename("b", 300 * MB));

        expect(history.undoCount).toBe(1);
        expect(history.bytes).toBe(300 * MB);
        expect(history.undoLabel).toBe("Rename to b");
        undo(history);
        expect(history.session.doc.name).toBe("a");
        expect(history.undo()).toBe(false);
        redo(history);
        expect(history.session.doc.name).toBe("b");

        // The next command pushes the oversized one out like any other.
        execute(history, rename("c", MB));
        expect(history.undoCount).toBe(1);
        expect(history.bytes).toBe(MB);
        expect(history.undoLabel).toBe("Rename to c");
    });

    it("retains a first command that alone exceeds the budget", () => {
        const history = setup(100);
        execute(history, rename("a", 101));

        expect(history.undoCount).toBe(1);
        undo(history);
        expect(history.session.doc.name).toBe("fixture");
        redo(history);
        expect(history.session.doc.name).toBe("a");
    });
});
