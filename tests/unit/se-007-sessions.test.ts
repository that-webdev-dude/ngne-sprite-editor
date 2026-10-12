import { afterEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import {
    createEditorStore,
    DEFAULT_BACKGROUND,
    DEFAULT_FOREGROUND,
    DEFAULT_TOOL,
} from "../../src/app/state/editor";
import {
    activeDocument,
    createSessionsStore,
    DEFAULT_VIEW,
    isDirty,
    sessionsStore,
} from "../../src/app/state/sessions";
import type { OpenDocument, SessionsState } from "../../src/app/state/sessions";
import { createStatusStore } from "../../src/app/state/status";
import { installTestHooks } from "../../src/app/testing/testHooks";
import { TransactionError } from "../../src/core/history";
import { assertInvariants, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { statusFields } from "../../src/ui/status/statusFields";
import { renameCommand } from "./se-007-support";

// SE-007: stores — open sessions with their histories and dirty flag, per-document view state
// and reference sources, global editor state — and the undo/redo commands bound to them.

function sprite(name: string, width = 8, height = 8): DocSession {
    return createDocument({ name, width, height }, sequentialIds(`${name}-`));
}

function addFrame(session: DocSession, id: string, durationMs: number): void {
    session.doc.frames.push({ id, durationMs });
}

const NO_STATUS = { cursor: null, hint: null, feedback: null };

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
});

describe("sessions store", () => {
    it("starts with no document", () => {
        const store = createSessionsStore();
        expect(store.getState().documents).toEqual([]);
        expect(store.getState().activeId).toBeNull();
        expect(activeDocument(store.getState())).toBeNull();
    });

    it("opens a session with its own history, view and reference sources", () => {
        const store = createSessionsStore();
        const session = sprite("hero");
        const document = store.getState().open(session);
        expect(document.id).toBe(session.doc.id);
        expect(document.session).toBe(session);
        expect(document.history.session).toBe(session);
        expect(document.view).toEqual(DEFAULT_VIEW);
        expect(document.view).toEqual({ scale: 1, originX: 0, originY: 0 });
        expect(document.referenceSources.size).toBe(0);
        expect(store.getState().activeId).toBe(document.id);
        expect(activeDocument(store.getState())).toBe(document);
        assertInvariants(document.session);
    });

    it("takes view, reference sources and history options when opening", () => {
        const store = createSessionsStore();
        const bytes = new Uint8Array([1, 2, 3]);
        const document = store.getState().open(sprite("hero"), {
            view: { scale: 8 },
            referenceSources: [["ref-1", bytes]],
            history: { budgetBytes: 1024 },
        });
        expect(document.view).toEqual({ scale: 8, originX: 0, originY: 0 });
        expect(document.referenceSources.get("ref-1")).toBe(bytes);
        expect(document.history.budgetBytes).toBe(1024);
    });

    it("keeps the active document when a session is opened in the background", () => {
        const store = createSessionsStore();
        const first = store.getState().open(sprite("a"));
        store.getState().open(sprite("b"), { activate: false });
        expect(store.getState().activeId).toBe(first.id);
        expect(store.getState().documents.map((document) => document.session.doc.name)).toEqual([
            "a",
            "b",
        ]);
    });

    it("refuses to open a document that is already open", () => {
        const store = createSessionsStore();
        const session = sprite("a");
        store.getState().open(session);
        expect(() => store.getState().open(session)).toThrow(/already open/);
        expect(store.getState().documents).toHaveLength(1);
    });

    it("activates another document and rejects an unknown id", () => {
        const store = createSessionsStore();
        const a = store.getState().open(sprite("a"));
        const b = store.getState().open(sprite("b"));
        expect(store.getState().activeId).toBe(b.id);
        store.getState().activate(a.id);
        expect(activeDocument(store.getState())?.id).toBe(a.id);
        expect(() => store.getState().activate("missing")).toThrow('No open document "missing".');
    });

    it("closes a document and activates its neighbour", () => {
        const store = createSessionsStore();
        const [a, b, c] = ["a", "b", "c"].map((name) => store.getState().open(sprite(name)));
        if (!a || !b || !c) throw new Error("fixture");
        store.getState().activate(b.id);
        store.getState().close(b.id);
        expect(store.getState().activeId).toBe(c.id);
        store.getState().close(c.id);
        expect(store.getState().activeId).toBe(a.id);
        // Closing a background document leaves the active one alone.
        const d = store.getState().open(sprite("d"), { activate: false });
        store.getState().close(d.id);
        expect(store.getState().activeId).toBe(a.id);
        store.getState().close(a.id);
        expect(store.getState().activeId).toBeNull();
        expect(store.getState().documents).toEqual([]);
        store.getState().close("missing");
    });

    it("replaces the active document in place", () => {
        const store = createSessionsStore();
        const a = store.getState().open(sprite("a"));
        const b = store.getState().open(sprite("b"));
        store.getState().activate(a.id);
        const next = store.getState().replaceActive(sprite("next"));
        expect(store.getState().documents.map((document) => document.id)).toEqual([next.id, b.id]);
        expect(store.getState().activeId).toBe(next.id);
        // Reopening the active document itself gives it a fresh history.
        next.history.execute(renameCommand("changed"));
        const again = store.getState().replaceActive(next.session);
        expect(again.history).not.toBe(next.history);
        expect(again.history.canUndo).toBe(false);
        // A document open in the background cannot take the active one's place as well.
        expect(() => store.getState().replaceActive(b.session)).toThrow(/already open/);
        expect(store.getState().documents).toHaveLength(2);
    });

    it("opens the session when there is nothing to replace", () => {
        const store = createSessionsStore();
        const document = store.getState().replaceActive(sprite("a"), { activate: false });
        expect(store.getState().activeId).toBe(document.id);
    });

    it("replaces the document record on every history step, and stops after close", () => {
        const store = createSessionsStore();
        const opened = store.getState().open(sprite("a"));
        const seen: number[] = [];
        store.subscribe((state) => seen.push(state.documents[0]?.revision ?? -1));
        opened.history.execute(renameCommand("b"));
        opened.history.undo();
        opened.history.redo();
        expect(seen).toEqual([1, 2, 3]);
        const current = activeDocument(store.getState());
        expect(current).not.toBe(opened);
        expect(current?.history).toBe(opened.history);
        expect(current?.session).toBe(opened.session);

        store.getState().close(opened.id);
        seen.length = 0;
        opened.history.undo();
        expect(seen).toEqual([]);
    });

    it("lets a history step finish when a subscriber of the store throws", () => {
        const store = createSessionsStore();
        const { history, session } = store.getState().open(sprite("a"));
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        store.subscribe(() => {
            throw new Error("subscriber failed");
        });
        expect(() => history.execute(renameCommand("b"))).not.toThrow();
        expect(session.doc.name).toBe("b");
        expect(history.canUndo).toBe(true);
        expect(error).toHaveBeenCalledOnce();
        error.mockRestore();
    });

    it("changes the view per document", () => {
        const store = createSessionsStore();
        const a = store.getState().open(sprite("a"));
        const b = store.getState().open(sprite("b"));
        store.getState().setView(a.id, { scale: 12, originX: 40 });
        store.getState().setView(a.id, { originY: -8 });
        const state = store.getState();
        expect(state.documents[0]?.view).toEqual({ scale: 12, originX: 40, originY: -8 });
        expect(state.documents[1]?.view).toEqual(DEFAULT_VIEW);
        expect(state.documents[1]).toBe(b);
    });

    it("keeps reference source bytes per document", () => {
        const store = createSessionsStore();
        const a = store.getState().open(sprite("a"));
        const b = store.getState().open(sprite("b"));
        const bytes = new Uint8Array([137, 80, 78, 71]);
        store.getState().setReferenceSource(a.id, "ref-1", bytes);
        const sources = (id: string) =>
            store.getState().documents.find((document) => document.id === id)?.referenceSources;
        expect(sources(a.id)?.get("ref-1")).toBe(bytes);
        expect(sources(b.id)?.size).toBe(0);
        // The map of a record is never changed in place.
        expect(a.referenceSources.size).toBe(0);
        store.getState().deleteReferenceSource(a.id, "ref-1");
        expect(sources(a.id)?.size).toBe(0);
        const before = store.getState().documents[0];
        store.getState().deleteReferenceSource(a.id, "missing");
        expect(store.getState().documents[0]).toBe(before);
    });

    it("notifies of a change made outside the history", () => {
        const store = createSessionsStore();
        const opened = store.getState().open(sprite("a"));
        const layer = opened.session.doc.layers[0];
        if (!layer) throw new Error("fixture");
        layer.locked = true;
        store.getState().touch(opened.id);
        expect(activeDocument(store.getState())?.revision).toBe(1);
        expect(() => store.getState().touch("missing")).toThrow(/No open document/);
    });
});

describe("dirty flag (SPEC §5.2)", () => {
    const dirty = (state: SessionsState, id: string) => {
        const document = state.documents.find((entry) => entry.id === id);
        if (!document) throw new Error("fixture");
        return isDirty(document);
    };

    it("follows the history position against the saved position", () => {
        const store = createSessionsStore();
        const { id, history } = store.getState().open(sprite("a"));
        expect(dirty(store.getState(), id)).toBe(false);

        history.execute(renameCommand("b"));
        expect(dirty(store.getState(), id)).toBe(true);
        history.undo();
        expect(dirty(store.getState(), id)).toBe(false);
        history.redo();
        expect(dirty(store.getState(), id)).toBe(true);

        store.getState().markSaved(id);
        expect(dirty(store.getState(), id)).toBe(false);
        expect(activeDocument(store.getState())?.savedPosition).toBe(history.position);
        // Undoing past the saved state is a change too.
        history.undo();
        expect(dirty(store.getState(), id)).toBe(true);
        history.redo();
        expect(dirty(store.getState(), id)).toBe(false);
    });

    it("is not cleared by a different command that follows an undo", () => {
        const store = createSessionsStore();
        const { id, history } = store.getState().open(sprite("a"));
        history.execute(renameCommand("b"));
        store.getState().markSaved(id);
        history.undo();
        history.execute(renameCommand("c"));
        expect(dirty(store.getState(), id)).toBe(true);
    });

    it("is set by a change of the export settings and cleared by saving or changing back", () => {
        const store = createSessionsStore();
        const { id, history } = store.getState().open(sprite("a"));
        store.getState().updateExportSettings(id, (settings) => {
            settings.padding = 4;
        });
        expect(dirty(store.getState(), id)).toBe(true);
        expect(history.canUndo).toBe(false);
        store.getState().updateExportSettings(id, (settings) => {
            settings.padding = 1;
        });
        expect(dirty(store.getState(), id)).toBe(false);

        store.getState().updateExportSettings(id, (settings) => {
            settings.files.asepriteJson = "hash";
        });
        expect(dirty(store.getState(), id)).toBe(true);
        store.getState().markSaved(id);
        expect(dirty(store.getState(), id)).toBe(false);
    });

    it("is not set by a change of the document settings", () => {
        const store = createSessionsStore();
        const { id, history, session } = store.getState().open(sprite("a"));
        let notified = 0;
        store.subscribe(() => notified++);
        store.getState().updateDocSettings(id, (settings) => {
            settings.grid.visible = true;
            settings.grid.width = 8;
            settings.onion.enabled = true;
        });
        expect(session.doc.settings.grid).toMatchObject({ visible: true, width: 8 });
        expect(notified).toBe(1);
        expect(dirty(store.getState(), id)).toBe(false);
        expect(history.canUndo).toBe(false);
        expect(history.position).toBe(0);
    });

    it("is kept per document", () => {
        const store = createSessionsStore();
        const a = store.getState().open(sprite("a"));
        const b = store.getState().open(sprite("b"));
        a.history.execute(renameCommand("changed"));
        expect(dirty(store.getState(), a.id)).toBe(true);
        expect(dirty(store.getState(), b.id)).toBe(false);
    });
});

describe("global editor state", () => {
    it("starts with the pencil, black on white, and no tool options", () => {
        const state = createEditorStore().getState();
        expect(state.tool).toBe(DEFAULT_TOOL);
        expect(state.tool).toBe("pencil");
        expect(state.foreground).toBe(DEFAULT_FOREGROUND);
        expect(state.foreground).toBe(0x000000ff);
        expect(state.background).toBe(DEFAULT_BACKGROUND);
        expect(state.background).toBe(0xffffffff);
        expect(state.toolOptions).toEqual({});
    });

    it("sets the tool, the colours and the options of a tool", () => {
        const store = createEditorStore();
        const seen: string[] = [];
        store.subscribe((state) => seen.push(state.tool));
        store.getState().setTool("eraser");
        store.getState().setForeground(0xff0000ff);
        store.getState().setBackground(0x00ff0080);
        store.getState().setToolOptions("pencil", { size: 4, pixelPerfect: true });
        store.getState().setToolOptions("pencil", { size: 8 });
        store.getState().setToolOptions("bucket", { tolerance: 32 });
        expect(store.getState()).toMatchObject({
            tool: "eraser",
            foreground: 0xff0000ff,
            background: 0x00ff0080,
            toolOptions: {
                pencil: { size: 8, pixelPerfect: true },
                bucket: { tolerance: 32 },
            },
        });
        expect(seen).toHaveLength(6);
    });

    it("stores colours as unsigned 32-bit values", () => {
        const store = createEditorStore();
        // Bitwise arithmetic in JavaScript yields a signed result for colours above 0x7fffffff.
        store.getState().setForeground((0xff << 24) | 0x0000ff);
        expect(store.getState().foreground).toBe(0xff0000ff);
    });

    it("is independent of the documents", () => {
        const sessions = createSessionsStore();
        const editor = createEditorStore();
        editor.getState().setTool("line");
        const a = sessions.getState().open(sprite("a"));
        sessions.getState().open(sprite("b"));
        sessions.getState().activate(a.id);
        expect(editor.getState().tool).toBe("line");
    });
});

describe("status bar texts (DESIGN §5.7)", () => {
    it("is blank without a document", () => {
        expect(statusFields(null, NO_STATUS)).toEqual({
            cursor: "",
            size: "",
            zoom: "",
            frame: "",
            duration: "",
            selection: "",
            message: "",
            messageKind: "hint",
        });
        // No cursor without a document, whatever the pointer does.
        expect(statusFields(null, { ...NO_STATUS, cursor: { x: 1, y: 2 } }).cursor).toBe("");
    });

    it("shows what the document and its view hold, and leaves the rest blank", () => {
        const store = createSessionsStore();
        const session = sprite("hero", 32, 24);
        addFrame(session, "frame-2", 250);
        const { id } = store.getState().open(session, { view: { scale: 12 } });
        const fields = (status = NO_STATUS as Parameters<typeof statusFields>[1]) =>
            statusFields(activeDocument(store.getState()), status);

        expect(fields()).toEqual({
            cursor: "",
            size: "32 × 24",
            zoom: "12×",
            frame: "Frame 1/2",
            duration: "100 ms",
            selection: "",
            message: "",
            messageKind: "hint",
        });

        session.activeFrameId = "frame-2";
        store.getState().touch(id);
        expect(fields()).toMatchObject({ frame: "Frame 2/2", duration: "250 ms" });

        store.getState().setView(id, { scale: 0.5 });
        expect(fields().zoom).toBe("0.5×");
        store.getState().setView(id, { scale: 0.125 });
        expect(fields().zoom).toBe("0.125×");

        expect(fields({ ...NO_STATUS, cursor: { x: 14, y: 9 } }).cursor).toBe("14, 9");
        session.selection = {
            mask: { width: 32, height: 24, data: new Uint8Array(96) },
            bounds: { x: 2, y: 3, width: 11, height: 8 },
        };
        expect(fields().selection).toBe("Selection 11 × 8");
    });

    it("shows the hint, and feedback in its place", () => {
        const status = createStatusStore();
        status.getState().setHint("Shift: constrain line");
        expect(statusFields(null, status.getState())).toMatchObject({
            message: "Shift: constrain line",
            messageKind: "hint",
        });
        status.getState().setFeedback("Layer is locked");
        expect(statusFields(null, status.getState())).toMatchObject({
            message: "Layer is locked",
            messageKind: "feedback",
        });
        status.getState().setFeedback(null);
        status.getState().setCursor({ x: 3, y: 4 });
        expect(status.getState()).toMatchObject({
            cursor: { x: 3, y: 4 },
            hint: "Shift: constrain line",
            feedback: null,
        });
    });
});

// --- The app's stores and commands -----------------------------------------------------------

const undo = () => appCommands.get("edit.undo");
const redo = () => appCommands.get("edit.redo");

function open(name: string, width = 8, height = 8): OpenDocument {
    return sessionsStore.getState().open(sprite(name, width, height));
}

describe("undo and redo commands", () => {
    it("are disabled without a document and name no step", () => {
        expect(undo()?.enabled()).toBe(false);
        expect(redo()?.enabled()).toBe(false);
        expect(undo()?.title()).toBe("Undo");
        expect(redo()?.title()).toBe("Redo");
        // Running them anyway does nothing.
        expect(() => undo()?.run()).not.toThrow();
        expect(() => redo()?.run()).not.toThrow();
    });

    it("act on the active history and carry the label of the step", () => {
        const { history, session } = open("start");
        expect(undo()?.enabled()).toBe(false);
        history.execute(renameCommand("first", "Pencil"));
        history.execute(renameCommand("second", "Eraser"));
        expect(undo()?.enabled()).toBe(true);
        expect(undo()?.title()).toBe("Undo Eraser");
        expect(redo()?.enabled()).toBe(false);
        expect(redo()?.title()).toBe("Redo");

        void undo()?.run();
        expect(session.doc.name).toBe("first");
        expect(undo()?.title()).toBe("Undo Pencil");
        expect(redo()?.title()).toBe("Redo Eraser");
        expect(redo()?.enabled()).toBe(true);

        void undo()?.run();
        expect(session.doc.name).toBe("start");
        expect(undo()?.enabled()).toBe(false);
        expect(undo()?.title()).toBe("Undo");
        expect(redo()?.title()).toBe("Redo Pencil");

        void redo()?.run();
        void redo()?.run();
        expect(session.doc.name).toBe("second");
        expect(redo()?.enabled()).toBe(false);
        assertInvariants(session);
    });

    it("show their titles in the Edit menu", () => {
        const { history } = open("start");
        history.execute(renameCommand("first", "Pencil"));
        const titles = () =>
            menuCommands(buildMenu(appCommands.list(), ["Edit"]))
                .slice(0, 2)
                .map((command) => command.title());
        expect(titles()).toEqual(["Undo Pencil", "Redo"]);
        void undo()?.run();
        expect(titles()).toEqual(["Undo", "Redo Pencil"]);
    });

    it("are disabled while a transaction is open, and do not throw", () => {
        const { history, session } = open("start");
        history.execute(renameCommand("first", "Pencil"));
        history.undo();
        history.execute(renameCommand("first", "Pencil"));
        const layerId = session.activeLayerId;
        const frameId = session.activeFrameId;

        const transaction = history.begin({ layerId, frameId });
        // The history itself still reports an undoable step and would throw.
        expect(history.canUndo).toBe(true);
        expect(() => history.undo()).toThrow(TransactionError);
        expect(undo()?.enabled()).toBe(false);
        expect(redo()?.enabled()).toBe(false);
        expect(() => undo()?.run()).not.toThrow();
        expect(session.doc.name).toBe("first");
        expect(undo()?.title()).toBe("Undo Pencil");

        transaction.abort();
        expect(undo()?.enabled()).toBe(true);
    });

    it("tell the registry's subscribers when the state they read changes", () => {
        let notified = 0;
        const stop = appCommands.subscribe(() => notified++);
        const { history } = open("start");
        const afterOpen = notified;
        expect(afterOpen).toBeGreaterThan(0);
        history.execute(renameCommand("first"));
        expect(notified).toBeGreaterThan(afterOpen);
        stop();
    });
});

describe("switching the active session", () => {
    it("switches history, state and status bar", () => {
        const store = sessionsStore.getState();
        const hero = open("hero", 32, 32);
        addFrame(hero.session, "hero-frame-2", 80);
        hero.session.activeFrameId = "hero-frame-2";
        store.setView(hero.id, { scale: 12, originX: 100 });
        store.setReferenceSource(hero.id, "ref", new Uint8Array([1]));
        hero.history.execute(renameCommand("hero-2", "Pencil"));

        const tiles = open("tiles", 16, 48);
        tiles.history.execute(renameCommand("tiles-2", "Bucket"));
        tiles.history.execute(renameCommand("tiles-3", "Line"));
        tiles.history.undo();
        store.markSaved(tiles.id);

        const active = () => {
            const document = activeDocument(sessionsStore.getState());
            if (!document) throw new Error("no active document");
            return document;
        };
        const status = () => statusFields(active(), NO_STATUS);

        // The second document is active after opening.
        expect(active().id).toBe(tiles.id);
        expect(active().history).toBe(tiles.history);
        expect(undo()?.title()).toBe("Undo Bucket");
        expect(redo()?.title()).toBe("Redo Line");
        expect(isDirty(active())).toBe(false);
        expect(active().view).toEqual(DEFAULT_VIEW);
        expect(active().referenceSources.size).toBe(0);
        expect(status()).toMatchObject({
            size: "16 × 48",
            zoom: "1×",
            frame: "Frame 1/1",
            duration: "100 ms",
        });

        store.activate(hero.id);
        expect(active().history).toBe(hero.history);
        expect(active().session).toBe(hero.session);
        expect(undo()?.title()).toBe("Undo Pencil");
        expect(redo()?.enabled()).toBe(false);
        expect(isDirty(active())).toBe(true);
        expect(active().view).toEqual({ scale: 12, originX: 100, originY: 0 });
        expect(active().referenceSources.size).toBe(1);
        expect(status()).toMatchObject({
            size: "32 × 32",
            zoom: "12×",
            frame: "Frame 2/2",
            duration: "80 ms",
        });

        // Undo acts on the active document only.
        void undo()?.run();
        expect(hero.session.doc.name).toBe("hero");
        expect(tiles.session.doc.name).toBe("tiles-2");
        expect(undo()?.enabled()).toBe(false);

        store.activate(tiles.id);
        expect(undo()?.enabled()).toBe(true);
        expect(undo()?.title()).toBe("Undo Bucket");
        void redo()?.run();
        expect(tiles.session.doc.name).toBe("tiles-3");
        expect(hero.session.doc.name).toBe("hero");
        expect(status().size).toBe("16 × 48");

        // With the last document closed everything is blank again.
        store.close(tiles.id);
        store.close(hero.id);
        expect(activeDocument(sessionsStore.getState())).toBeNull();
        expect(undo()?.enabled()).toBe(false);
        expect(statusFields(null, NO_STATUS).size).toBe("");
    });
});

describe("test hook", () => {
    it("opens a session programmatically on the app's store", () => {
        const target = {} as Window;
        const hooks = installTestHooks(target);
        expect(target.__ngneTest).toBe(hooks);
        expect(hooks.sessions).toBe(sessionsStore);
        expect(hooks.commands).toBe(appCommands);

        const id = hooks.openSession({ name: "hero", width: 32, height: 32 });
        const document = activeDocument(sessionsStore.getState());
        expect(document?.id).toBe(id);
        expect(document?.session.doc).toMatchObject({ name: "hero", width: 32, height: 32 });
        expect(() => hooks.assertInvariants()).not.toThrow();

        if (!document) throw new Error("fixture");
        document.session.activeFrameId = "missing";
        expect(() => hooks.assertInvariants()).toThrow(/active-frame-exists/);
    });
});
