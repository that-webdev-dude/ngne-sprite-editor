import { describe, expect, it } from "vitest";
import { createSessionsStore } from "../../src/app/state/sessions";
import type { Command } from "../../src/core/history";
import { createDocument, InvariantError, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";

// SPEC §5.1: invariants are asserted after every command in development builds. Vitest runs
// the store with `import.meta.env.DEV` set, as the dev server does.

function sprite(name: string): DocSession {
    return createDocument({ name, width: 8, height: 8 }, sequentialIds(`${name}-`));
}

function command(label: string, run: (session: DocSession) => void): Command {
    let previous = "";
    return {
        label,
        do(session) {
            previous = session.activeLayerId;
            run(session);
        },
        undo(session) {
            session.activeLayerId = previous;
        },
        bytes: 0,
        touched: { frameIds: [], layerIds: [], structure: false },
    };
}

describe("invariants after every command in a development build", () => {
    it("is a development build under Vitest", () => {
        expect(import.meta.env.DEV).toBe(true);
    });

    it("lets a command that keeps the invariants through, with undo and redo", () => {
        const store = createSessionsStore();
        const { history } = store.getState().open(sprite("valid"));
        const valid = command("Keep", () => undefined);

        expect(() => history.execute(valid)).not.toThrow();
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
    });

    it("makes a command that breaks an invariant throw where it was run", () => {
        const store = createSessionsStore();
        const opened = store.getState().open(sprite("broken"));
        const breaking = command("Break", (session) => {
            session.activeLayerId = "no-such-layer";
        });

        let error: unknown;
        try {
            opened.history.execute(breaking);
        } catch (thrown) {
            error = thrown;
        }
        expect(error).toBeInstanceOf(InvariantError);
        expect((error as InvariantError).invariant).toBe("active-layer-exists");
        // The store was brought up to date before the assertion ran.
        const current = store.getState().documents.find((entry) => entry.id === opened.id);
        expect(current?.revision).toBe(opened.revision + 1);
    });

    it("also checks after undo and redo", () => {
        const store = createSessionsStore();
        const { history, session } = store.getState().open(sprite("undo"));
        history.execute(command("Keep", () => undefined));
        // Broken behind the history's back: the next step of any kind reports it.
        session.activeFrameId = "no-such-frame";

        expect(() => history.undo()).toThrow(InvariantError);
    });
});
