import { describe, expect, it } from "vitest";
import { MAX_PROJECT_FILE_BYTES, sessionOf } from "../../src/app/file/workflows";
import { isDirty } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { addFrameCommand } from "../../src/core/frames";
import { MAX_PROJECT_CONTENT_BYTES, serialize } from "../../src/core/project";
import { renameSpriteCommand } from "../../src/core/sprite";
import { fixtureSession, fixtureSources, SOURCE_ID } from "./se-040-support";
import {
    active,
    answerDiscard,
    chosen,
    composites,
    errors,
    harness,
    openNew,
    openSession,
    paint,
    waitForQuestion,
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

/** The bytes `serialize` makes of the active document now. */
function bytesNow(test: Harness): Uint8Array {
    return serialize(active(test).session.doc, active(test).referenceSources);
}

/** Opens a transaction on the active cel and writes one pixel in it: a stroke, or a float. */
function beginStroke(document: OpenDocument) {
    const transaction = document.history.begin({
        layerId: document.session.activeLayerId,
        frameId: document.session.activeFrameId,
    });
    transaction.image.data.set([9, 8, 7, 255], 0);
    transaction.markDirty({ x: 0, y: 0, width: 1, height: 1 });
    return transaction;
}

/** What a failure leaves: one error notice, the document dirty, no operation running. */
function expectFailedSave(test: Harness, message: string | RegExp): void {
    expect(errors(test)).toEqual([
        typeof message === "string" ? message : expect.stringMatching(message),
    ]);
    expect(test.notices.filter((notice) => notice.kind === "info")).toEqual([]);
    expect(isDirty(active(test))).toBe(true);
    expect(test.workflows.busy).toBe(false);
}

describe("Save and Save As", () => {
    it("asks where to save a document without a file, writes the project and clears the dirty flag", async () => {
        const test = harness();
        drawn(test);
        expect(isDirty(active(test))).toBe(true);
        const expected = bytesNow(test);

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
        // Two steps that move the history and leave the content as it was: dirty again.
        const document = active(test);
        document.history.execute(renameSpriteCommand("villain"));
        document.history.execute(renameSpriteCommand("hero"));
        expect(isDirty(active(test))).toBe(true);
        expect(await test.workflows.save()).toBe(true);
        expect(isDirty(active(test))).toBe(false);
        expect(test.platform.suggested).toHaveLength(1);
        expect(handle.writes).toHaveLength(2);
        expect(handle.writes[1]).toEqual(handle.writes[0]);
        // And once more, with nothing changed at all.
        expect(await test.workflows.save()).toBe(true);
        expect(isDirty(active(test))).toBe(false);
        expect(handle.writes[2]).toEqual(handle.writes[0]);
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

    it("applies the floating selection before it saves, and saves what applying it made", async () => {
        // Applying the float is a step of the history that changes a pixel, as SE-032's will.
        const test = harness({
            applyFloating: (self) => {
                const document = active(self);
                beginStroke(document).commit("Apply floating");
            },
        });
        drawn(test);
        const steps = active(test).history.undoCount;
        const handle = await saveTo(test, "hero.ngsprite");
        expect(test.events).toEqual(["apply floating", "write hero.ngsprite"]);
        expect(active(test).history.undoCount).toBe(steps + 1);
        expect(handle.writes).toEqual([bytesNow(test)]);
        expect(isDirty(active(test))).toBe(false);

        expect(await test.workflows.saveAs()).toBe(false);
        expect(test.floatingApplied).toBe(2);
    });

    it("Save and Save As act while a selection floats: the float is applied first, then the document is saved", async () => {
        let floating = false;
        let float: ReturnType<typeof beginStroke> | null = null;
        const test = harness({
            isFloating: () => floating,
            applyFloating: () => {
                float?.commit("Apply floating");
                float = null;
                floating = false;
            },
        });
        const document = openNew(test);
        paint(document, 1);
        // A transaction that is no float: a stroke. Save waits for it.
        const stroke = beginStroke(document);
        expect(test.workflows.canSave()).toBe(false);
        stroke.abort();
        expect(test.workflows.canSave()).toBe(true);

        float = beginStroke(document);
        floating = true;
        expect(test.workflows.canSave()).toBe(true);
        const handle = await saveTo(test, "hero.ngsprite");
        expect(test.events).toEqual(["apply floating", "write hero.ngsprite"]);
        expect(active(test).history.transaction).toBeNull();
        expect(active(test).history.undoLabel).toBe("Apply floating");
        expect(handle.writes).toEqual([bytesNow(test)]);
        expect(isDirty(active(test))).toBe(false);
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
        expect(test.platform.suggested).toHaveLength(2);
        expect(handle.writes).toHaveLength(2);
        expect(isDirty(active(test))).toBe(true);
        const other = test.disk.handle("elsewhere.ngsprite");
        test.platform.toSave.push(other);
        expect(await test.workflows.save()).toBe(true);
        expect(other.writes).toHaveLength(1);
        expect(isDirty(active(test))).toBe(false);
    });

    it("refused permission without the user's gesture any more: no picker, a message naming Save As", async () => {
        const test = harness();
        drawn(test);
        const handle = await saveTo(test, "hero.ngsprite");
        paint(active(test), 6);
        handle.grants = false;
        test.platform.active = false;
        test.notices.length = 0;
        expect(await test.workflows.save()).toBe(false);
        expect(test.platform.suggested).toHaveLength(1);
        expectFailedSave(test, /^No permission to write “hero\.ngsprite”\. Use Save As…$/);
        expect(test.workflows.fileOf(active(test).id)?.handle).toBe(handle);
    });

    it("the document's file is gone: Save asks where to save while the gesture lasts, otherwise names Save As", async () => {
        const test = harness();
        drawn(test);
        const handle = await saveTo(test, "hero.ngsprite");
        handle.failWrite = new DOMException("The file was not found.", "NotFoundError");
        paint(active(test), 6);
        test.notices.length = 0;

        test.platform.active = false;
        expect(await test.workflows.save()).toBe(false);
        expect(test.platform.suggested).toHaveLength(1);
        expectFailedSave(
            test,
            /^Could not save “hero\.ngsprite”\. The file no longer exists\. Use Save As…$/,
        );
        expect(test.workflows.fileOf(active(test).id)?.handle).toBe(handle);

        test.notices.length = 0;
        test.platform.active = true;
        const moved = test.disk.handle("moved.ngsprite");
        test.platform.toSave.push(moved);
        expect(await test.workflows.save()).toBe(true);
        expect(test.platform.suggested).toEqual(["hero.ngsprite", "hero.ngsprite"]);
        expect(moved.writes).toEqual([bytesNow(test)]);
        expect(isDirty(active(test))).toBe(false);
        expect(test.workflows.fileOf(active(test).id)?.handle).toBe(moved);
        expect(test.notices).toEqual([{ kind: "info", message: "Saved moved.ngsprite" }]);
    });

    it("a write that fails leaves the document dirty, keeps its file and reports it once", async () => {
        const test = harness();
        drawn(test);
        const first = await saveTo(test, "hero.ngsprite");
        paint(active(test), 6);
        for (const failure of [
            new DOMException("The quota has been exceeded.", "QuotaExceededError"),
            new DOMException("The file was not found.", "NotFoundError"),
        ]) {
            test.notices.length = 0;
            // Save As to a new file whose write fails.
            const copy = test.disk.handle("copy.ngsprite");
            copy.failWrite = failure;
            test.platform.toSave.push(copy);
            expect(await test.workflows.saveAs()).toBe(false);
            expectFailedSave(test, `Could not save “copy.ngsprite”. ${failure.message}`);
            expect(test.workflows.fileOf(active(test).id)?.handle).toBe(first);
            expect(test.disk.files.has("copy.ngsprite")).toBe(false);
        }
        // Save still writes to the document's file.
        expect(await test.workflows.save()).toBe(true);
        expect(first.writes).toHaveLength(2);
    });

    it("a save picker or a permission request that fails is reported once and changes nothing", async () => {
        const test = harness();
        drawn(test);
        test.platform.failSave = new DOMException(
            "Must be handling a user gesture.",
            "SecurityError",
        );
        expect(await test.workflows.save()).toBe(false);
        expectFailedSave(test, "Could not save “hero.ngsprite”. Must be handling a user gesture.");
        expect(test.workflows.fileOf(active(test).id)).toBeNull();

        test.platform.failSave = null;
        const handle = await saveTo(test, "hero.ngsprite");
        paint(active(test), 3);
        test.notices.length = 0;
        handle.failRequest = new DOMException("The request is not allowed.", "NotAllowedError");
        expect(await test.workflows.save()).toBe(false);
        expectFailedSave(test, "Could not save “hero.ngsprite”. The request is not allowed.");
        expect(handle.writes).toHaveLength(1);
        expect(test.workflows.fileOf(active(test).id)?.handle).toBe(handle);
    });

    it("without File System Access, Save downloads <name>.ngsprite", async () => {
        const test = harness();
        test.platform.access = false;
        drawn(test);
        const expected = bytesNow(test);
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
        expect(test.workflows.canSave()).toBe(false);
        expect(await test.workflows.save()).toBe(false);
        expect(test.notices).toEqual([]);
        const document = openNew(test);
        const transaction = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        expect(test.workflows.canSave()).toBe(false);
        expect(await test.workflows.save()).toBe(false);
        expect(test.platform.suggested).toEqual([]);
        expect(errors(test)).toEqual(["Could not save “hero.ngsprite”. A stroke is in progress."]);
        transaction.abort();
    });

    it("gives up with a notice when a stroke begins while the permission is asked for", async () => {
        const test = harness();
        drawn(test);
        const handle = await saveTo(test, "hero.ngsprite");
        paint(active(test), 3);
        test.notices.length = 0;
        const strokes: ReturnType<typeof beginStroke>[] = [];
        handle.requestWrite = async () => {
            strokes.push(beginStroke(active(test)));
            return true;
        };
        expect(await test.workflows.save()).toBe(false);
        expect(handle.writes).toHaveLength(1);
        expect(errors(test)).toEqual(["Could not save “hero.ngsprite”. A stroke is in progress."]);
        strokes[0]!.abort();
        expect(isDirty(active(test))).toBe(true);
    });

    it("reports a floating selection that cannot be applied", async () => {
        const test = harness({
            applyFloating: () => {
                throw new Error("The floating selection could not be applied.");
            },
        });
        drawn(test);
        expect(await test.workflows.save()).toBe(false);
        expect(test.platform.suggested).toEqual([]);
        expectFailedSave(
            test,
            "Could not save “hero.ngsprite”. The floating selection could not be applied.",
        );
    });
});

describe("Open", () => {
    it("opens a saved project in a tab of its own, the active one: same pixels, sources restored, empty history; the open document stays (SE-047)", async () => {
        const test = harness();
        openSession(test, fixtureSession(), fixtureSources());
        paint(active(test), 3);
        const before = composites(test);
        const handle = await saveTo(test, "hero.ngsprite");
        const saved = handle.writes[0]!;

        // Reopened from a fresh store, beside a document of its own.
        const other = harness();
        const scratch = openNew(other, "scratch");
        paint(scratch, 1);
        other.platform.toOpen.push(chosen("hero.ngsprite", saved, handle));
        expect(await other.workflows.open()).toBe(true);
        // Nothing was asked: the open document loses nothing, and stays as it was.
        expect(other.questions).toEqual([]);
        const { documents } = other.sessions.getState();
        expect(documents.map((entry) => entry.session.doc.name)).toEqual([
            "scratch",
            "Hero ✦ idle",
        ]);
        expect(documents[0]!.session).toBe(scratch.session);
        expect(documents[0]!.history.undoCount).toBe(1);
        expect(isDirty(documents[0]!)).toBe(true);
        const opened = active(other);
        expect(opened).toBe(documents[1]);
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

    it("refuses a file larger than any project before reading it", async () => {
        expect(MAX_PROJECT_FILE_BYTES).toBeGreaterThan(MAX_PROJECT_CONTENT_BYTES);
        const test = harness();
        const document = openNew(test);
        let read = 0;
        const huge = chosen("huge.ngsprite", new Uint8Array(0), null, MAX_PROJECT_FILE_BYTES + 1);
        huge.read = async () => {
            read++;
            return new Uint8Array(0);
        };
        test.platform.toOpen.push(huge);
        expect(await test.workflows.open()).toBe(false);
        expect(read).toBe(0);
        expect(errors(test)).toEqual([
            `Could not open “huge.ngsprite”. The file is too large to be a sprite project: ` +
                `${MAX_PROJECT_FILE_BYTES + 1} bytes; the limit is ${MAX_PROJECT_FILE_BYTES} bytes.`,
        ]);
        expect(active(test).session).toBe(document.session);
        expect(test.workflows.busy).toBe(false);
    });

    it("opens beside a dirty document without asking; the dirty document keeps its changes (SE-047)", async () => {
        const test = harness();
        const saved = serialize(openNew(test, "first").session.doc, new Map());
        test.sessions.getState().close(active(test).id);
        const document = openNew(test, "second");
        paint(document, 1);

        test.platform.toOpen.push(chosen("first.ngsprite", saved, null));
        expect(await test.workflows.open()).toBe(true);
        // No question: nothing of "second" is lost.
        expect(test.questions).toEqual([]);
        expect(active(test).session.doc.name).toBe("first");
        expect(test.notices).toEqual([{ kind: "info", message: "Opened first.ngsprite" }]);
        const { documents } = test.sessions.getState();
        expect(documents).toHaveLength(2);
        const kept = documents.find((entry) => entry.id === document.id)!;
        expect(kept.session).toBe(document.session);
        expect(kept.history.undoCount).toBe(1);
        expect(isDirty(kept)).toBe(true);
        expect(test.floatingApplied).toBe(1);
    });

    it("gives up with a notice when a stroke began while the file was read", async () => {
        const test = harness();
        const saved = serialize(openNew(test, "first").session.doc, new Map());
        test.sessions.getState().close(active(test).id);
        const document = openNew(test, "second");
        const file = chosen("first.ngsprite", saved, null);
        const strokes: ReturnType<typeof beginStroke>[] = [];
        file.read = async () => {
            strokes.push(beginStroke(document));
            return saved.slice();
        };
        test.platform.toOpen.push(file);
        expect(await test.workflows.open()).toBe(false);
        expect(errors(test)).toEqual(["Could not open “first.ngsprite”. A stroke is in progress."]);
        expect(test.questions).toEqual([]);
        expect(active(test).session).toBe(document.session);
        strokes[0]!.abort();
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
        const notes = chosen("notes.txt", new TextEncoder().encode("notes"), null);

        expect(await test.workflows.openFiles([notes])).toBe(false);
        expect(test.sessions.getState().documents).toEqual([]);
        expect(test.notices).toEqual([
            { kind: "error", message: "“notes.txt” is not a sprite project (.ngsprite)." },
        ]);

        const project = chosen("Dropped.NGSPRITE", saved, null);
        expect(await test.workflows.openFiles([notes, project])).toBe(true);
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

    it("gives up with a notice when a stroke began during the question", async () => {
        const test = harness();
        const document = openNew(test);
        paint(document, 1);
        const closing = test.workflows.close();
        await waitForQuestion(test);
        const stroke = beginStroke(document);
        await answerDiscard(test, true);
        expect(await closing).toBe(false);
        expect(errors(test)).toEqual(["Could not close “hero”. A stroke is in progress."]);
        expect(active(test).session).toBe(document.session);
        stroke.abort();
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

    it("asks for read permission again before it reads the file; refused, the document stays", async () => {
        const test = harness();
        const document = openNew(test);
        paint(document, 1);
        const handle = await saveTo(test, "hero.ngsprite");
        const saved = composites(test);
        paint(active(test), 2);
        const edited = composites(test);

        // The permission lapsed and the user refuses it.
        handle.readable = false;
        handle.grantsRead = false;
        test.notices.length = 0;
        const refused = test.workflows.revert();
        await answerDiscard(test, true);
        expect(await refused).toBe(false);
        expect(handle.readRequests).toBe(1);
        expect(errors(test)).toEqual(["No permission to read “hero.ngsprite”."]);
        expect(active(test).session).toBe(document.session);
        expect(composites(test)).toEqual(edited);
        expect(isDirty(active(test))).toBe(true);
        expect(test.workflows.busy).toBe(false);

        // Granted when asked: read again.
        handle.grantsRead = true;
        const granted = test.workflows.revert();
        await answerDiscard(test, true);
        expect(await granted).toBe(true);
        expect(handle.readRequests).toBe(2);
        expect(composites(test)).toEqual(saved);
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
        expect(test.workflows.canSave()).toBe(false);
        expect(await test.workflows.save()).toBe(false);
        expect(await test.workflows.open()).toBe(false);
        expect(test.platform.opened).toBe(0);
        await answerDiscard(test, null);
        expect(await closing).toBe(false);
        expect(test.workflows.busy).toBe(false);
        expect(changes).toEqual([true, false]);
    });
});
