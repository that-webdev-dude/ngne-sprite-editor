import { describe, expect, it } from "vitest";
import { sessionOf } from "../../src/app/file/workflows";
import { isDirty } from "../../src/app/state/sessions";
import { addFrameCommand } from "../../src/core/frames";
import { serialize } from "../../src/core/project";
import { fixtureSession, fixtureSources, SOURCE_ID } from "./se-040-support";
import {
    active,
    answerDiscard,
    chosen,
    composites,
    harness,
    openNew,
    openSession,
    paint,
} from "./se-041-support";
import type { FakeHandle, Harness } from "./se-041-support";

// SE-041: Open, Save, Save As, Close and Revert of the active document (SPEC §10), driven
// through the workflows over a store, a disk and pickers of the test's own.

/** Saves the active document to a new file `name` of the disk, through the save picker. */
async function saveTo(test: Harness, name: string): Promise<FakeHandle> {
    const handle = test.disk.handle(name);
    test.platform.toSave.push(handle);
    expect(await test.workflows.save()).toBe(true);
    return handle;
}

/** A dirty document with pixels on two frames, saved nowhere yet. */
function drawn(test: Harness): void {
    const document = openNew(test);
    paint(document, 1);
    document.history.execute(addFrameCommand(document.session.doc, document.session.activeFrameId));
    paint(active(test), 2);
}

describe("Save and Save As", () => {
    it("asks where to save a document without a file, writes the project and clears the dirty flag", async () => {
        const test = harness();
        drawn(test);
        expect(isDirty(active(test))).toBe(true);
        const expected = serialize(active(test).session.doc, active(test).referenceSources);

        const handle = await saveTo(test, "hero.ngsprite");
        expect(test.platform.suggested).toEqual(["hero.ngsprite"]);
        expect(handle.writes).toEqual([expected]);
        expect(isDirty(active(test))).toBe(false);
        expect(test.workflows.fileOf(active(test).id)).toMatchObject({
            name: "hero.ngsprite",
            handle,
        });
        expect(test.notices).toEqual([{ kind: "info", message: "Saved hero.ngsprite" }]);
    });

    it("saving twice without changes writes identical bytes to the same file, without asking again", async () => {
        const test = harness();
        drawn(test);
        const handle = await saveTo(test, "hero.ngsprite");
        expect(isDirty(active(test))).toBe(false);
        expect(await test.workflows.save()).toBe(true);
        expect(isDirty(active(test))).toBe(false);
        expect(test.platform.suggested).toHaveLength(1);
        expect(handle.writes).toHaveLength(2);
        expect(handle.writes[1]).toEqual(handle.writes[0]);
    });

    it("writes the state the bytes were made from: a change during the write keeps the document dirty", async () => {
        const test = harness();
        drawn(test);
        const handle = await saveTo(test, "hero.ngsprite");
        paint(active(test), 3);
        let release = () => {};
        handle.hold = new Promise((resolve) => (release = resolve));
        const saving = test.workflows.save();
        await Promise.resolve();
        // Drawn while the file is being written: not in the file.
        await new Promise((resolve) => setTimeout(resolve, 0));
        paint(active(test), 4);
        release();
        expect(await saving).toBe(true);
        expect(isDirty(active(test))).toBe(true);
        active(test).history.undo();
        expect(isDirty(active(test))).toBe(false);
    });

    it("applies the floating selection before it saves", async () => {
        const test = harness();
        drawn(test);
        await saveTo(test, "hero.ngsprite");
        expect(test.floatingApplied).toBe(1);
        await test.workflows.saveAs();
        expect(test.floatingApplied).toBe(2);
    });

    it("Save As always asks; the chosen file becomes the document's file", async () => {
        const test = harness();
        drawn(test);
        const first = await saveTo(test, "hero.ngsprite");
        const second = test.disk.handle("copy.ngsprite");
        test.platform.toSave.push(second);
        expect(await test.workflows.saveAs()).toBe(true);
        expect(test.platform.suggested).toEqual(["hero.ngsprite", "hero.ngsprite"]);
        expect(second.writes).toEqual(first.writes);
        expect(test.workflows.fileOf(active(test).id)?.handle).toBe(second);
        // Cancelled: nothing written, the file stays.
        paint(active(test), 5);
        expect(await test.workflows.saveAs()).toBe(false);
        expect(isDirty(active(test))).toBe(true);
        expect(test.workflows.fileOf(active(test).id)?.handle).toBe(second);
        expect(second.writes).toHaveLength(1);
    });

    it("asks for write permission on a kept file; refused, it asks where to save instead", async () => {
        const test = harness();
        drawn(test);
        const handle = await saveTo(test, "hero.ngsprite");
        expect(handle.permissionRequests).toBe(0);
        paint(active(test), 6);
        expect(await test.workflows.save()).toBe(true);
        expect(handle.permissionRequests).toBe(1);

        handle.grants = false;
        paint(active(test), 7);
        // Refused, then the picker is cancelled: nothing is written, the document stays dirty.
        expect(await test.workflows.save()).toBe(false);
        expect(handle.writes).toHaveLength(2);
        expect(isDirty(active(test))).toBe(true);
        const other = test.disk.handle("elsewhere.ngsprite");
        test.platform.toSave.push(other);
        expect(await test.workflows.save()).toBe(true);
        expect(other.writes).toHaveLength(1);
        expect(isDirty(active(test))).toBe(false);
    });

    it("without File System Access, Save downloads <name>.ngsprite", async () => {
        const test = harness();
        test.platform.access = false;
        drawn(test);
        const expected = serialize(active(test).session.doc, active(test).referenceSources);
        expect(await test.workflows.save()).toBe(true);
        expect(test.platform.downloads).toEqual([{ name: "hero.ngsprite", bytes: expected }]);
        expect(isDirty(active(test))).toBe(false);
        expect(await test.workflows.saveAs()).toBe(true);
        expect(test.platform.downloads).toHaveLength(2);
        expect(test.platform.downloads[1]?.bytes).toEqual(expected);
    });

    it("reports a document that cannot be saved and leaves it dirty", async () => {
        const test = harness();
        // A reference layer whose source bytes the store does not have.
        openSession(test, fixtureSession());
        paint(active(test), 1);
        const handle = test.disk.handle("broken.ngsprite");
        test.platform.toSave.push(handle);
        expect(await test.workflows.save()).toBe(false);
        expect(handle.writes).toEqual([]);
        expect(isDirty(active(test))).toBe(true);
        expect(test.notices).toHaveLength(1);
        expect(test.notices[0]?.kind).toBe("error");
        expect(test.notices[0]?.message).toMatch(/^Could not save “broken\.ngsprite”\. /);
        expect(test.notices[0]?.message).toContain(SOURCE_ID);
    });

    it("does nothing during a stroke, and nothing without a document", async () => {
        const test = harness();
        expect(await test.workflows.save()).toBe(false);
        const document = openNew(test);
        const transaction = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        expect(await test.workflows.save()).toBe(false);
        expect(test.platform.suggested).toEqual([]);
        transaction.abort();
    });
});

describe("Open", () => {
    it("opens a saved project in place of the active document: same pixels, sources restored, empty history", async () => {
        const test = harness();
        openSession(test, fixtureSession(), fixtureSources());
        paint(active(test), 3);
        const before = composites(test);
        const handle = await saveTo(test, "hero.ngsprite");
        const saved = handle.writes[0]!;

        // Reopened from a fresh store.
        const other = harness();
        openNew(other, "scratch");
        other.platform.toOpen.push(chosen("hero.ngsprite", saved, handle));
        expect(await other.workflows.open()).toBe(true);
        const opened = active(other);
        expect(opened.session.doc.name).toBe("Hero ✦ idle");
        expect(composites(other)).toEqual(before);
        expect(opened.history.undoCount).toBe(0);
        expect(opened.history.redoCount).toBe(0);
        expect(isDirty(opened)).toBe(false);
        // The bytes of the reference source, as the store gave them to `serialize`.
        expect([...opened.referenceSources.keys()]).toEqual([SOURCE_ID]);
        expect(opened.referenceSources.get(SOURCE_ID)).toEqual(
            new Uint8Array(fixtureSources().get(SOURCE_ID)!),
        );
        // The file stays the document's: saving it again writes the same bytes, unasked.
        expect(other.workflows.fileOf(opened.id)).toMatchObject({ name: "hero.ngsprite", handle });
        expect(await other.workflows.save()).toBe(true);
        expect(handle.writes[1]).toEqual(saved);
        expect(other.platform.suggested).toEqual([]);
        expect(other.notices.map((notice) => notice.message)).toEqual([
            "Opened hero.ngsprite",
            "Saved hero.ngsprite",
        ]);
    });

    it("opens with no selection, on the first frame and the top pixel layer", () => {
        const { doc } = fixtureSession();
        expect(sessionOf(doc)).toEqual({
            doc,
            selection: null,
            activeLayerId: "layer-fx",
            activeFrameId: "frame-1",
        });
    });

    it("reports a corrupt file by its problem and leaves the current document untouched", async () => {
        const test = harness();
        const document = openNew(test);
        paint(document, 1);
        const revision = active(test).revision;
        test.platform.toOpen.push(chosen("broken.ngsprite", Uint8Array.of(1, 2, 3, 4), null));
        expect(await test.workflows.open()).toBe(false);
        // Nothing was asked, though the document is dirty.
        expect(test.questions).toEqual([]);
        expect(active(test).session).toBe(document.session);
        expect(active(test).revision).toBe(revision);
        expect(isDirty(active(test))).toBe(true);
        expect(test.notices).toEqual([
            {
                kind: "error",
                message: expect.stringMatching(
                    /^Could not open “broken\.ngsprite”\. The file is not a zip archive/,
                ),
            },
        ]);
    });

    it("asks once before it replaces a dirty document; cancelling keeps it", async () => {
        const test = harness();
        const saved = serialize(openNew(test, "first").session.doc, new Map());
        test.sessions.getState().close(active(test).id);
        const document = openNew(test, "second");
        paint(document, 1);

        test.platform.toOpen.push(chosen("first.ngsprite", saved, null));
        const kept = test.workflows.open();
        await answerDiscard(test, null);
        expect(await kept).toBe(false);
        expect(test.questions).toHaveLength(1);
        expect(test.questions[0]).toMatchObject({
            document: "second",
            action: "open",
            file: "first.ngsprite",
        });
        expect(active(test).session).toBe(document.session);

        test.platform.toOpen.push(chosen("first.ngsprite", saved, null));
        const replaced = test.workflows.open();
        await answerDiscard(test, true);
        expect(await replaced).toBe(true);
        expect(test.questions).toHaveLength(2);
        expect(active(test).session.doc.name).toBe("first");
        expect(test.sessions.getState().documents).toHaveLength(1);
    });

    it("a cancelled picker changes nothing; a picker that fails is reported", async () => {
        const test = harness();
        const document = openNew(test);
        expect(await test.workflows.open()).toBe(false);
        expect(test.platform.opened).toBe(1);
        expect(active(test).session).toBe(document.session);
        expect(test.notices).toEqual([]);

        test.platform.chooseFileToOpen = async () => {
            throw new DOMException("Must be handling a user gesture.", "SecurityError");
        };
        expect(await test.workflows.open()).toBe(false);
        expect(active(test).session).toBe(document.session);
        expect(test.notices).toEqual([
            { kind: "error", message: "Could not open a file. Must be handling a user gesture." },
        ]);
        expect(test.workflows.busy).toBe(false);
    });

    it("a drop opens the first project file among the files; other files are reported", async () => {
        const test = harness();
        const saved = serialize(openNew(test, "dropped").session.doc, new Map());
        test.sessions.getState().close(active(test).id);
        const png = chosen("sketch.png", Uint8Array.of(137, 80, 78, 71), null);

        expect(await test.workflows.openFiles([png])).toBe(false);
        expect(test.sessions.getState().documents).toEqual([]);
        expect(test.notices).toEqual([
            { kind: "error", message: "“sketch.png” is not a sprite project (.ngsprite)." },
        ]);

        const project = chosen("Dropped.NGSPRITE", saved, null);
        expect(await test.workflows.openFiles([png, project])).toBe(true);
        expect(active(test).session.doc.name).toBe("dropped");
        expect(test.workflows.fileOf(active(test).id)).toEqual({
            name: "Dropped.NGSPRITE",
            handle: null,
            bytes: saved,
        });
    });
});

describe("Close", () => {
    it("closes a clean document without asking", async () => {
        const test = harness();
        openNew(test);
        expect(await test.workflows.close()).toBe(true);
        expect(test.questions).toEqual([]);
        expect(test.sessions.getState().documents).toEqual([]);
    });

    it("asks once before it closes a dirty document; cancelling keeps it", async () => {
        const test = harness();
        const document = openNew(test);
        paint(document, 1);
        await saveTo(test, "hero.ngsprite");
        paint(active(test), 2);

        const kept = test.workflows.close();
        await answerDiscard(test, null);
        expect(await kept).toBe(false);
        expect(test.questions).toHaveLength(1);
        expect(test.questions[0]).toMatchObject({ document: "hero", action: "close", file: null });
        expect(active(test).session).toBe(document.session);
        expect(isDirty(active(test))).toBe(true);

        const closed = test.workflows.close();
        await answerDiscard(test, true);
        expect(await closed).toBe(true);
        expect(test.questions).toHaveLength(2);
        expect(test.sessions.getState().documents).toEqual([]);
        // A closed document has no file.
        expect(test.workflows.fileOf(document.id)).toBeNull();
    });
});

describe("Revert", () => {
    it("needs a file; reads it again in place of the document, keeping the view", async () => {
        const test = harness();
        const document = openNew(test);
        expect(await test.workflows.revert()).toBe(false);
        paint(document, 1);
        await saveTo(test, "hero.ngsprite");
        const saved = composites(test);
        test.sessions.getState().setView(document.id, { scale: 4, originX: 10, originY: 20 });
        paint(active(test), 2);
        expect(composites(test)).not.toEqual(saved);

        const reverting = test.workflows.revert();
        await answerDiscard(test, true);
        expect(await reverting).toBe(true);
        expect(test.questions).toMatchObject([
            { document: "hero", action: "revert", file: "hero.ngsprite" },
        ]);
        expect(composites(test)).toEqual(saved);
        expect(active(test).session).not.toBe(document.session);
        expect(active(test).history.undoCount).toBe(0);
        expect(isDirty(active(test))).toBe(false);
        expect(active(test).view).toEqual({ scale: 4, originX: 10, originY: 20 });
        expect(test.notices.at(-1)).toEqual({ kind: "info", message: "Reverted to hero.ngsprite" });
        // A clean document is read again without a question.
        expect(await test.workflows.revert()).toBe(true);
        expect(test.questions).toHaveLength(1);
    });

    it("without File System Access, reads the bytes it last downloaded", async () => {
        const test = harness();
        test.platform.access = false;
        const document = openNew(test);
        paint(document, 1);
        expect(await test.workflows.save()).toBe(true);
        const saved = composites(test);
        paint(active(test), 2);
        const reverting = test.workflows.revert();
        await answerDiscard(test, true);
        expect(await reverting).toBe(true);
        expect(composites(test)).toEqual(saved);
    });

    it("cancelled, it keeps the document", async () => {
        const test = harness();
        const document = openNew(test);
        paint(document, 1);
        await saveTo(test, "hero.ngsprite");
        paint(active(test), 2);
        const reverting = test.workflows.revert();
        await answerDiscard(test, null);
        expect(await reverting).toBe(false);
        expect(active(test).session).toBe(document.session);
        expect(isDirty(active(test))).toBe(true);
    });
});

describe("one operation at a time", () => {
    it("is busy while an operation waits, and the others do nothing meanwhile", async () => {
        const test = harness();
        const document = openNew(test);
        paint(document, 1);
        const changes: boolean[] = [];
        test.workflows.subscribe(() => changes.push(test.workflows.busy));

        const closing = test.workflows.close();
        expect(test.workflows.busy).toBe(true);
        expect(await test.workflows.save()).toBe(false);
        expect(await test.workflows.open()).toBe(false);
        expect(test.platform.opened).toBe(0);
        await answerDiscard(test, null);
        expect(await closing).toBe(false);
        expect(test.workflows.busy).toBe(false);
        expect(changes).toEqual([true, false]);
    });
});
