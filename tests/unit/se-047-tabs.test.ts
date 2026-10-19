import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { appCommands } from "../../src/app/commands/appCommands";
import type { Command } from "../../src/app/commands/types";
import { keepOrderBeforeSort, originalOrderOf } from "../../src/app/palette/paletteOrder";
import type { PaletteState } from "../../src/app/palette/paletteState";
import { editorPlayback, playbackTime } from "../../src/app/playback/playback";
import { isFloating } from "../../src/app/selection/floating";
import { floatingState } from "../../src/app/selection/floatingState";
import { createActiveComposites } from "../../src/app/state/composites";
import {
    activeDocument,
    createSessionsStore,
    isDirty,
    sessionsStore,
} from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import {
    activateDocument,
    followPaletteSwatch,
    followReferenceImages,
    moveDocument,
    neighbourOf,
    tabsAvailable,
} from "../../src/app/tabs/tabs";
import { addFrameCommand } from "../../src/core/frames";
import { createDocument } from "../../src/core/model";
import { rectMask, selectCommand } from "../../src/core/selection";
import { renameSpriteCommand } from "../../src/core/sprite";
import { deserialize } from "../../src/core/project";
import type { StoredExportFolder } from "../../src/app/export/exportFolders";
import {
    active as activeOf,
    answerDiscard,
    chosen,
    errors,
    harness,
    openNew,
    paint,
    waitForQuestion,
} from "./se-041-support";
import type { FakeHandle, Harness } from "./se-041-support";

// SE-047: document tabs on the stores. Each tab has its own session, history, view and
// reference sources; only the active document keeps composites; leaving a document applies
// its floating selection and stops playback; the palette's current swatch follows the tab;
// the tab order, the Next and Previous Document commands; closing a tab that is not active.

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document is open");
    return document;
}

/** The app's record of the document `id`. */
function record(id: string): OpenDocument {
    const found = sessionsStore.getState().documents.find((entry) => entry.id === id);
    if (!found) throw new Error(`document ${id} is not open`);
    return found;
}

/** Opens a document of `width` × 4 on the app's store, painted once, without activating it. */
function background(name: string, width = 4): OpenDocument {
    const document = sessionsStore
        .getState()
        .open(createDocument({ name, width, height: 4 }), { activate: false });
    paint(document, name.length);
    return record(document.id);
}

afterEach(() => {
    editorPlayback.stop();
    floatingState.cancel();
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    playbackTime.now = () => performance.now();
    vi.unstubAllGlobals();
});

describe("the order of the tabs", () => {
    it("moves a document to another place; the others keep their order, the active one stays", () => {
        const store = createSessionsStore();
        const ids = ["a", "b", "c", "d"].map(
            (name) => store.getState().open(createDocument({ name, width: 2, height: 2 })).id,
        );
        const [a, b, c, d] = ids as [string, string, string, string];
        const order = () => store.getState().documents.map((entry) => entry.id);
        expect(store.getState().activeId).toBe(d);

        store.getState().move(a, 2);
        expect(order()).toEqual([b, c, a, d]);
        store.getState().move(d, 0);
        expect(order()).toEqual([d, b, c, a]);
        // Clamped to the list.
        store.getState().move(d, 99);
        expect(order()).toEqual([b, c, a, d]);
        store.getState().move(a, -3);
        expect(order()).toEqual([a, b, c, d]);
        expect(store.getState().activeId).toBe(d);
        expect(() => store.getState().move("nope", 0)).toThrow(/No open document/);
    });

    it("Next and Previous Document follow the order of the tabs, wrapping around; disabled with one document", () => {
        const first = sessionsStore
            .getState()
            .open(createDocument({ name: "a", width: 2, height: 2 }));
        expect(command("document.next").enabled()).toBe(false);
        expect(command("document.previous").enabled()).toBe(false);
        expect(command("document.next").menuPath).toEqual(["View"]);
        const second = background("b");
        const third = background("c");
        moveDocument(third.id, 1);
        // a, c, b; a is active.
        expect(neighbourOf(sessionsStore.getState(), 1)).toBe(third.id);
        expect(command("document.next").enabled()).toBe(true);
        void command("document.next").run();
        expect(active().id).toBe(third.id);
        void command("document.next").run();
        expect(active().id).toBe(second.id);
        void command("document.next").run();
        expect(active().id).toBe(first.id);
        void command("document.previous").run();
        expect(active().id).toBe(second.id);
    });
});

describe("each tab has a document of its own", () => {
    it("switching tabs switches session, history, view and reference sources; undo acts on the active tab only", () => {
        const store = sessionsStore.getState();
        const one = store.open(createDocument({ name: "one", width: 4, height: 4 }), {
            view: { scale: 8, originX: 3, originY: 5 },
            referenceSources: [["ref-1", Uint8Array.of(1, 2, 3)]],
        });
        paint(one, 1);
        one.history.execute(addFrameCommand(one.session.doc, one.session.activeFrameId));
        const select = selectCommand(
            one.session,
            rectMask(4, 4, { x: 1, y: 1, width: 2, height: 2 }),
            "replace",
            "Select",
        );
        if (!select) throw new Error("no selection command");
        one.history.execute(select);
        const oneFrame = one.session.activeFrameId;

        const two = sessionsStore
            .getState()
            .open(createDocument({ name: "two", width: 6, height: 2 }));
        expect(active().id).toBe(two.id);
        two.history.execute(renameSpriteCommand("two renamed"));
        expect(active().session.selection).toBeNull();
        expect(active().referenceSources.size).toBe(0);

        // Undo acts on the active tab: "two" goes back, "one" keeps its steps.
        const steps = one.history.undoCount;
        void command("edit.undo").run();
        expect(record(two.id).session.doc.name).toBe("two");
        expect(record(one.id).history.undoCount).toBe(steps);

        expect(activateDocument(one.id)).toBe(true);
        const shown = active();
        expect(shown.session).toBe(one.session);
        expect(shown.history).toBe(one.history);
        expect(shown.history.undoCount).toBe(steps);
        expect(shown.view).toEqual({ scale: 8, originX: 3, originY: 5 });
        expect([...shown.referenceSources]).toEqual([["ref-1", Uint8Array.of(1, 2, 3)]]);
        expect(shown.session.activeFrameId).toBe(oneFrame);
        expect(shown.session.selection?.bounds).toEqual({ x: 1, y: 1, width: 2, height: 2 });

        void command("edit.undo").run();
        expect(record(one.id).session.selection).toBeNull();
        expect(record(two.id).history.redoCount).toBe(1);
    });

    it("only the active document keeps composites: every other document's cache reports 0 bytes", () => {
        const store = createSessionsStore();
        const composites = createActiveComposites(store);
        const documents = ["a", "b", "c"].map((name) => {
            const opened = store.getState().open(createDocument({ name, width: 8, height: 8 }));
            paint(opened, name.charCodeAt(0));
            return opened;
        });
        const bytes = () => documents.map((document) => composites.bytesOf(document.session));
        const fill = () => {
            const { session } = activeDocument(store.getState())!;
            composites.cache!.get(session.activeFrameId);
        };
        const frame = 8 * 8 * 4;

        for (const [index, document] of documents.entries()) {
            store.getState().activate(document.id);
            fill();
            expect(bytes()).toEqual(documents.map((_, at) => (at === index ? frame : 0)));
        }
        // Back to the first: it composites again; the one left keeps nothing.
        store.getState().activate(documents[0]!.id);
        expect(bytes()).toEqual([0, 0, 0]);
        fill();
        expect(bytes()).toEqual([frame, 0, 0]);
        // A closed document has no cache.
        store.getState().close(documents[0]!.id);
        expect(composites.bytesOf(documents[0]!.session)).toBe(0);
        fill();
        expect(bytes()).toEqual([0, frame, 0]);
        composites.dispose();
    });

    it("leaving a document applies its floating selection there, as one step of its own history", () => {
        vi.stubGlobal("requestAnimationFrame", () => 1);
        vi.stubGlobal("cancelAnimationFrame", () => {});
        const one = sessionsStore
            .getState()
            .open(createDocument({ name: "one", width: 4, height: 4 }));
        paint(one, 3);
        const other = background("two");
        floatingState.lift(record(one.id), { whole: true });
        floatingState.moveBy(1, 0);
        expect(isFloating()).toBe(true);
        expect(record(one.id).history.transaction).not.toBeNull();

        expect(activateDocument(other.id)).toBe(true);
        expect(active().id).toBe(other.id);
        expect(isFloating()).toBe(false);
        const left = record(one.id);
        expect(left.history.transaction).toBeNull();
        expect(left.history.undoLabel).toBe("Move");
        expect(isDirty(left)).toBe(true);
        // The other document gained nothing.
        expect(record(other.id).history.undoCount).toBe(1);
    });

    it("does not switch during a stroke; switching stops playback", () => {
        vi.stubGlobal("requestAnimationFrame", () => 1);
        vi.stubGlobal("cancelAnimationFrame", () => {});
        const one = sessionsStore
            .getState()
            .open(createDocument({ name: "one", width: 4, height: 4 }));
        one.history.execute(addFrameCommand(one.session.doc, one.session.activeFrameId));
        const other = background("two");

        const stroke = one.history.begin({
            layerId: one.session.activeLayerId,
            frameId: one.session.activeFrameId,
        });
        expect(tabsAvailable()).toBe(false);
        expect(command("document.next").enabled()).toBe(false);
        expect(activateDocument(other.id)).toBe(false);
        expect(active().id).toBe(one.id);
        stroke.abort();
        expect(tabsAvailable()).toBe(true);

        expect(editorPlayback.start()).toBe(true);
        expect(editorPlayback.playing).toBe(true);
        expect(activateDocument(other.id)).toBe(true);
        expect(editorPlayback.playing).toBe(false);
    });
});

describe("editor state kept per tab", () => {
    it("the palette's current swatch comes back with its tab; a Move Colour target is dropped", () => {
        const store = createSessionsStore();
        const palette = createStore<PaletteState>(() => ({ current: 0, target: null, edit: null }));
        const stop = followPaletteSwatch(store, palette);
        const a = store.getState().open(createDocument({ name: "a", width: 2, height: 2 }));
        palette.setState({ current: 5, target: 3 });
        const b = store.getState().open(createDocument({ name: "b", width: 2, height: 2 }));
        expect(palette.getState()).toMatchObject({ current: 0, target: null });
        palette.setState({ current: 2 });

        store.getState().activate(a.id);
        expect(palette.getState().current).toBe(5);
        store.getState().activate(b.id);
        expect(palette.getState().current).toBe(2);
        // The active tab closed: the neighbour's swatch.
        store.getState().close(b.id);
        expect(palette.getState().current).toBe(5);
        stop();
    });

    it("the palette's Original Order is the active tab's own", () => {
        const a = sessionsStore.getState().open(createDocument({ name: "a", width: 2, height: 2 }));
        keepOrderBeforeSort(record(a.id).session);
        const b = sessionsStore.getState().open(createDocument({ name: "b", width: 2, height: 2 }));
        expect(originalOrderOf(record(b.id).session)).toBeNull();
        expect(originalOrderOf(record(a.id).session)).toEqual(a.session.doc.palette.colors);
        // Each switch shows the order of the tab that became active.
        expect(activateDocument(a.id)).toBe(true);
        expect(originalOrderOf(active().session)).toEqual(a.session.doc.palette.colors);
        expect(activateDocument(b.id)).toBe(true);
        expect(originalOrderOf(active().session)).toBeNull();
        expect(activateDocument(a.id)).toBe(true);
        expect(originalOrderOf(active().session)).toEqual(a.session.doc.palette.colors);
    });
});

describe("closing a tab that is not the active one", () => {
    it("asks once when it has unsaved changes; the active document stays", async () => {
        const test = harness();
        const dirty = openNew(test, "dirty");
        paint(dirty, 1);
        const clean = openNew(test, "clean");
        const shown = openNew(test, "shown");
        expect(test.sessions.getState().activeId).toBe(shown.id);

        // Cancelled: kept.
        const kept = test.workflows.close(dirty.id);
        expect((await waitForQuestion(test)).document).toBe("dirty");
        await answerDiscard(test, null);
        expect(await kept).toBe(false);
        expect(test.sessions.getState().documents.map((entry) => entry.id)).toContain(dirty.id);

        // Discarded: closed, and the active document is the same.
        const closing = test.workflows.close(dirty.id);
        await answerDiscard(test, true);
        expect(await closing).toBe(true);
        expect(test.questions.map((question) => question.document)).toEqual(["dirty", "dirty"]);
        expect(test.questions.every((question) => question.action === "close")).toBe(true);

        // A clean one closes without a question; no float of the active one is applied.
        expect(await test.workflows.close(clean.id)).toBe(true);
        expect(test.questions).toHaveLength(2);
        expect(test.floatingApplied).toBe(0);
        expect(test.sessions.getState().documents.map((entry) => entry.id)).toEqual([shown.id]);
        expect(test.sessions.getState().activeId).toBe(shown.id);
        expect(test.notices).toEqual([]);
    });

    it("does nothing during a stroke of the active document", async () => {
        const test = harness();
        const other = openNew(test, "other");
        const shown = openNew(test, "shown");
        const stroke = shown.history.begin({
            layerId: shown.session.activeLayerId,
            frameId: shown.session.activeFrameId,
        });
        expect(await test.workflows.close(other.id)).toBe(false);
        expect(test.sessions.getState().documents).toHaveLength(2);
        stroke.abort();
    });
});

describe("opening a file that is open already", () => {
    it("selects the tab of the same file; another file of the same document opens under a new id", async () => {
        const test = harness();
        const saved = openNew(test, "hero");
        paint(saved, 2);
        const handle = test.disk.handle("hero.ngsprite");
        handle.isSame = async (other) => other.name === handle.name;
        test.platform.toSave.push(handle);
        expect(await test.workflows.save()).toBe(true);
        openNew(test, "scratch");

        // The same file: its tab becomes the active one, nothing else opens.
        const bytes = handle.writes[0]!;
        const again = test.disk.handle("hero.ngsprite");
        test.platform.toOpen.push(chosen("hero.ngsprite", bytes, again));
        expect(await test.workflows.open()).toBe(true);
        expect(test.sessions.getState().documents).toHaveLength(2);
        expect(test.sessions.getState().activeId).toBe(saved.id);
        expect(test.notices.at(-1)).toEqual({
            kind: "info",
            message: "hero.ngsprite is open already",
        });

        // A copy of it in another file: a tab of its own, under a new id.
        test.disk.files.set("copy.ngsprite", bytes);
        const copy = test.disk.handle("copy.ngsprite");
        test.platform.toOpen.push(chosen("copy.ngsprite", bytes, copy));
        expect(await test.workflows.open()).toBe(true);
        const { documents, activeId } = test.sessions.getState();
        expect(documents).toHaveLength(3);
        expect(new Set(documents.map((entry) => entry.id)).size).toBe(3);
        expect(activeId).not.toBe(saved.id);
        expect(test.workflows.fileOf(activeId!)).toMatchObject({ name: "copy.ngsprite" });
        expect(test.workflows.fileOf(saved.id)).toMatchObject({ name: "hero.ngsprite" });
    });

    const sameByName = sameByNameHandle;

    /** "hero" saved to hero.ngsprite, a copy of the file as copy.ngsprite (same id), opened. */
    async function heroAndCopy(test: Harness) {
        const hero = openNew(test, "hero");
        paint(hero, 2);
        test.platform.toSave.push(sameByName(test, "hero.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        const bytes = test.disk.files.get("hero.ngsprite")!;
        test.disk.files.set("copy.ngsprite", bytes.slice());
        test.platform.toOpen.push(
            chosen("copy.ngsprite", bytes, sameByName(test, "copy.ngsprite")),
        );
        expect(await test.workflows.open()).toBe(true);
        const copy = activeOf(test);
        expect(copy.id).not.toBe(hero.id);
        return { hero, copy, bytes };
    }

    it("finds the file among every open tab, whatever the id of its document", async () => {
        const test = harness();
        const { hero, copy, bytes } = await heroAndCopy(test);
        test.sessions.getState().activate(hero.id);

        // The copy again: the id in the file is the original's, the tab is the copy's.
        test.platform.toOpen.push(
            chosen("copy.ngsprite", bytes, sameByName(test, "copy.ngsprite")),
        );
        expect(await test.workflows.open()).toBe(true);
        expect(test.sessions.getState().documents).toHaveLength(2);
        expect(test.sessions.getState().activeId).toBe(copy.id);
        expect(test.notices.at(-1)).toEqual({
            kind: "info",
            message: "copy.ngsprite is open already",
        });
    });

    it("reopening the active tab's own file changes nothing and applies no floating selection", async () => {
        const test = harness();
        const hero = openNew(test, "hero");
        test.platform.toSave.push(sameByName(test, "hero.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        const applied = test.floatingApplied;
        const bytes = test.disk.files.get("hero.ngsprite")!;
        test.platform.toOpen.push(
            chosen("hero.ngsprite", bytes, sameByName(test, "hero.ngsprite")),
        );
        expect(await test.workflows.open()).toBe(true);
        expect(test.floatingApplied).toBe(applied);
        expect(test.sessions.getState().documents).toHaveLength(1);
        expect(activeOf(test).session).toBe(hero.session);
        expect(test.notices.at(-1)?.message).toBe("hero.ngsprite is open already");
    });

    it("Revert in a tab opened under a new id reads its file again and keeps the tab's id", async () => {
        const test = harness();
        const { hero, copy } = await heroAndCopy(test);
        paint(activeOf(test), 7);
        const reverting = test.workflows.revert();
        await answerDiscard(test, true);
        expect(await reverting).toBe(true);
        const { documents } = test.sessions.getState();
        expect(documents.map((entry) => entry.id)).toEqual([hero.id, copy.id]);
        expect(activeOf(test).id).toBe(copy.id);
        expect(activeOf(test).session).not.toBe(copy.session);
        expect(isDirty(activeOf(test))).toBe(false);
        expect(errors(test)).toEqual([]);
    });
});

describe("Save As to another file", () => {
    it("gives the document a new id, written into the new file; the original keeps its export folder", async () => {
        const test = harness();
        const hero = openNew(test, "hero");
        paint(hero, 3);
        test.platform.toSave.push(sameByNameHandle(test, "hero.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        // The export folder kept for the document (SE-052), by its id.
        const folders = new Map<string, StoredExportFolder>();
        folders.set(hero.id, { folder: "hero-folder", confirmed: true });

        test.platform.toSave.push(sameByNameHandle(test, "copy.ngsprite"));
        expect(await test.workflows.saveAs()).toBe(true);
        const copy = activeOf(test);
        expect(copy.session).toBe(hero.session);
        expect(copy.id).not.toBe(hero.id);
        expect(copy.session.doc.id).toBe(copy.id);
        expect(test.sessions.getState().documents).toHaveLength(1);
        expect(isDirty(copy)).toBe(false);
        expect(test.workflows.fileOf(copy.id)).toMatchObject({ name: "copy.ngsprite" });
        // Each file holds its own id; the copy finds no export folder of the original.
        const copied = await deserialize(test.disk.files.get("copy.ngsprite")!);
        const original = await deserialize(test.disk.files.get("hero.ngsprite")!);
        expect(copied.doc.id).toBe(copy.id);
        expect(original.doc.id).toBe(hero.id);
        expect(folders.get(copy.id)).toBeUndefined();
        expect(folders.get(original.doc.id)).toMatchObject({ folder: "hero-folder" });

        // Save As onto the document's own file keeps the id.
        test.platform.toSave.push(sameByNameHandle(test, "copy.ngsprite"));
        expect(await test.workflows.saveAs()).toBe(true);
        expect(activeOf(test).id).toBe(copy.id);
    });
});

/** A disk handle that is the same file as every handle of its name, as Chrome's are. */
function sameByNameHandle(test: Harness, name: string): FakeHandle {
    const handle = test.disk.handle(name);
    handle.isSame = async (other) => other.name === name;
    return handle;
}

describe("decoded reference images", () => {
    it("are let go when their document stops being the active one", () => {
        const store = createSessionsStore();
        const forgotten: Uint8Array[] = [];
        const stop = followReferenceImages(store, { forget: (bytes) => forgotten.push(bytes) });
        const source = Uint8Array.of(1, 2, 3);
        const a = store.getState().open(createDocument({ name: "a", width: 2, height: 2 }), {
            referenceSources: [["ref-a", source]],
        });
        expect(forgotten).toEqual([]);
        const b = store.getState().open(createDocument({ name: "b", width: 2, height: 2 }));
        expect(forgotten).toHaveLength(1);
        expect(forgotten[0]).toBe(store.getState().documents[0]!.referenceSources.get("ref-a"));
        // A change of the active document's own record lets nothing go.
        store.getState().touch(b.id);
        expect(forgotten).toHaveLength(1);
        store.getState().activate(a.id);
        expect(forgotten).toHaveLength(1);
        store.getState().activate(b.id);
        expect(forgotten).toHaveLength(2);
        stop();
    });
});
