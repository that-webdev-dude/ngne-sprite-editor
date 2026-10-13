import { describe, expect, it } from "vitest";
import type { Command } from "../../src/core/history";
import {
    addLayerCommand,
    deleteLayerCommand,
    duplicateLayerCommand,
    flattenCommand,
    mergeDownCommand,
    renameLayerCommand,
    reorderLayerCommand,
    setLayerBlendModeCommand,
    setLayerLockedCommand,
    setLayerOpacityCommand,
    setLayerVisibleCommand,
} from "../../src/core/layers";
import { assertInvariants, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import {
    A,
    B,
    C,
    execute,
    fixture,
    history,
    IMAGE_BYTES,
    made,
    redo,
    stateOf,
    undo,
} from "./se-020-support";

// SE-020 acceptance: do/undo/redo symmetry for every command on the 3-layer, 4-frame fixture
// with linked cels, including `activeLayerId`; invariants after each command and each undo.
// Whole sessions are compared, pixels and map order included (`stateOf`).

interface Case {
    name: string;
    make(session: DocSession): Command | null;
    /** The active layer after the command; the fixture starts with `layer-b`. */
    active: string;
    /** Pixel memory the command keeps for undo. */
    bytes: number;
}

const newId = () => sequentialIds("new-");

const cases: Case[] = [
    {
        name: "add",
        make: (session) => addLayerCommand(session, { newId: newId() }),
        active: "new-1",
        bytes: 0,
    },
    {
        name: "delete, the active layer",
        make: (session) => deleteLayerCommand(session, B),
        active: A,
        bytes: 3 * IMAGE_BYTES,
    },
    {
        name: "delete, another layer",
        make: (session) => deleteLayerCommand(session, C),
        active: B,
        bytes: IMAGE_BYTES,
    },
    {
        name: "duplicate",
        make: (session) => duplicateLayerCommand(session, B, { newId: newId() }),
        active: "new-1",
        bytes: 0,
    },
    {
        name: "rename",
        make: (session) => renameLayerCommand(session, B, "Outline"),
        active: B,
        bytes: 0,
    },
    {
        name: "reorder, to the bottom",
        make: (session) => reorderLayerCommand(session, B, 0),
        active: B,
        bytes: 0,
    },
    {
        name: "reorder, to the top",
        make: (session) => reorderLayerCommand(session, A, 2),
        active: B,
        bytes: 0,
    },
    {
        name: "set visible",
        make: (session) => setLayerVisibleCommand(session, B, false),
        active: B,
        bytes: 0,
    },
    {
        name: "set locked",
        make: (session) => setLayerLockedCommand(session, B, true),
        active: B,
        bytes: 0,
    },
    {
        name: "set opacity",
        make: (session) => setLayerOpacityCommand(session, B, 64),
        active: B,
        bytes: 0,
    },
    {
        name: "set blend mode",
        make: (session) => setLayerBlendModeCommand(session, B, "multiply"),
        active: B,
        bytes: 0,
    },
    {
        name: "merge down, the active layer",
        make: (session) => mergeDownCommand(session, B, { newId: newId() }),
        active: A,
        // a1, a3, b1, b2 and b4 are replaced.
        bytes: 5 * IMAGE_BYTES,
    },
    {
        name: "merge down, another layer",
        make: (session) => mergeDownCommand(session, C, { newId: newId() }),
        active: B,
        // b1, b2, b4 and c1 are replaced.
        bytes: 4 * IMAGE_BYTES,
    },
    {
        name: "flatten",
        make: (session) => flattenCommand(session, { newId: newId() }),
        active: A,
        bytes: 6 * IMAGE_BYTES,
    },
];

describe("layer commands, do/undo/redo symmetry on the 3-layer, 4-frame fixture", () => {
    it("covers every command of the ticket", () => {
        const covered = new Set(cases.map((entry) => entry.name.split(",")[0]));
        expect([...covered]).toEqual([
            "add",
            "delete",
            "duplicate",
            "rename",
            "reorder",
            "set visible",
            "set locked",
            "set opacity",
            "set blend mode",
            "merge down",
            "flatten",
        ]);
    });

    it.each(cases)("$name: making the command changes nothing", ({ make }) => {
        const session = fixture();
        const start = stateOf(session);

        make(session);

        expect(stateOf(session)).toStrictEqual(start);
    });

    it.each(cases)(
        "$name: undo restores the session exactly and redo repeats the command exactly",
        ({ make, active }) => {
            const session = fixture();
            const start = stateOf(session);
            const target = history(session);

            execute(target, make(session));
            const done = stateOf(session);
            expect(done).not.toStrictEqual(start);
            expect(session.activeLayerId).toBe(active);

            // Any number of times.
            for (let round = 0; round < 3; round++) {
                undo(target);
                expect(stateOf(session)).toStrictEqual(start);
                expect(session.activeLayerId).toBe(B);
                redo(target);
                expect(stateOf(session)).toStrictEqual(done);
                expect(session.activeLayerId).toBe(active);
            }
            expect(target.undoCount).toBe(1);
            expect(target.redoCount).toBe(0);
        },
    );

    it.each(cases)("$name: the history retains the bytes the command states", (entry) => {
        const session = fixture();
        const target = history(session);
        const command = made(entry.make(session));

        expect(command.bytes).toBe(entry.bytes);
        execute(target, command);
        expect(target.bytes).toBe(entry.bytes);
    });

    it.each(cases)("$name: undo puts back the very buffers the document had", ({ make }) => {
        const session = fixture();
        const buffers = new Map(session.doc.images);
        const target = history(session);

        execute(target, make(session));
        undo(target);

        expect(session.doc.images.size).toBe(buffers.size);
        for (const [imageId, image] of buffers) {
            expect(session.doc.images.get(imageId), imageId).toBe(image);
        }
    });

    it("holds the invariants after every do, undo and redo, counted by a subscriber", () => {
        const checked: string[] = [];
        for (const { make } of cases) {
            const session = fixture();
            const target = history(session);
            target.subscribe((change) => {
                assertInvariants(session);
                checked.push(`${change.kind} ${change.label}`);
            });
            target.execute(made(make(session)));
            target.undo();
            target.redo();
            target.undo();
        }
        expect(checked).toHaveLength(cases.length * 4);
        expect(checked.slice(0, 4)).toEqual([
            "do New Layer",
            "undo New Layer",
            "redo New Layer",
            "undo New Layer",
        ]);
    });

    it("undoes every command in one history, one after the other, back to the start", () => {
        const session = fixture();
        const target = history(session);
        const ids = sequentialIds("new-");
        const states = [stateOf(session)];
        const steps: ((session: DocSession) => Command | null)[] = [
            (s) => addLayerCommand(s, { newId: ids }),
            (s) => renameLayerCommand(s, s.activeLayerId, "Shadow"),
            (s) => setLayerOpacityCommand(s, C, 200),
            (s) => setLayerBlendModeCommand(s, C, "screen"),
            (s) => duplicateLayerCommand(s, B, { newId: ids }),
            (s) => setLayerLockedCommand(s, A, true),
            (s) => reorderLayerCommand(s, C, 0),
            (s) => setLayerVisibleCommand(s, A, false),
            (s) => mergeDownCommand(s, s.activeLayerId, { newId: ids }),
            (s) => deleteLayerCommand(s, C),
            (s) => flattenCommand(s, { newId: ids }),
        ];

        for (const step of steps) {
            execute(target, step(session));
            states.push(stateOf(session));
        }
        expect(target.undoCount).toBe(steps.length);

        for (let index = steps.length - 1; index >= 0; index--) {
            undo(target);
            expect(stateOf(session), `after undo ${index}`).toStrictEqual(states[index]);
        }
        expect(target.undo()).toBe(false);
        for (let index = 1; index <= steps.length; index++) {
            redo(target);
            expect(stateOf(session), `after redo ${index}`).toStrictEqual(states[index]);
        }
        expect(target.redo()).toBe(false);
    });
});
