import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { FloatingApplyError } from "../../src/app/selection/floating";
import { isDirty } from "../../src/app/state/sessions";
import { bundle } from "../../src/core/export";
import { framePngFile, pngSequenceFiles, spriteSheetFile } from "../../src/core/imageExports";
import type { Tag } from "../../src/core/model";
import { active, errors, openNew, openSession, paint } from "./se-041-support";
import { MemoryStorage, exportHarness, fakeFolder, infos, waitForDialog } from "./se-052-support";
import type { ExportHarness, FakeFolder } from "./se-052-support";

// SE-052: Export…, Export Again, exportOnSave and the other exports (SPEC §9.6), driven
// through the workflows over a store, folders in memory, a storage that stands for IndexedDB
// and dialogs answered by the test.

/** The bundle `bundle()` makes of the active document now, by file name. */
function expectedFiles(test: ExportHarness): Map<string, Uint8Array> {
    return new Map(bundle(active(test).session.doc).files.map((file) => [file.name, file.bytes]));
}

function expectFolderHolds(folder: FakeFolder, expected: Map<string, Uint8Array>): void {
    expect([...folder.files.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [name, bytes] of expected) {
        expect(Buffer.from(folder.files.get(name)!).equals(Buffer.from(bytes)), name).toBe(true);
    }
}

/** Runs Export… and answers its dialog with Export; the folder picker returns `folder`. */
async function exportVia(test: ExportHarness, folder: FakeFolder | null): Promise<boolean> {
    if (folder) test.exportPlatform.toChoose.push(folder);
    const running = test.exports.exportWithDialog();
    (await waitForDialog(test, "export")).answer(true);
    return running;
}

/** A dirty document "hero" of 4 × 3 with pixels on its frame. */
function drawnHero(test: ExportHarness) {
    const document = openNew(test);
    paint(document, 1);
    return active(test);
}

describe("Export… (the dialog)", () => {
    it("writes exactly the enabled files, with the bytes of bundle(), into the folder chosen", async () => {
        const test = exportHarness();
        drawnHero(test);
        const folder = fakeFolder("sprites");
        expect(await exportVia(test, folder)).toBe(true);
        expect(test.exportPlatform.folderPickers).toBe(1);
        expectFolderHolds(folder, expectedFiles(test));
        expect(folder.writes).toEqual([
            "hero.png",
            "hero.atlas.json",
            "hero.sprites.ts",
            "hero.preview.config.mjs",
        ]);
        expect(infos(test)).toEqual(["Exported 4 files to “sprites”"]);
        expect(errors(test)).toEqual([]);
        // The folder is the document's, kept for a reload, its files ours to replace.
        expect(test.exports.folderOf(active(test).id)).toBe("sprites");
        expect(test.storage.records.get(active(test).id)).toEqual({
            folder,
            confirmed: true,
        });
    });

    it("applies the floating selection first, before the dialog opens", async () => {
        const test = exportHarness();
        drawnHero(test);
        const running = test.exports.exportWithDialog();
        await waitForDialog(test, "export");
        expect(test.events).toEqual(["apply floating"]);
        test.exportDialogs.store.getState().request!.answer(null);
        expect(await running).toBe(false);
    });

    it("does nothing more when the float cannot be applied: its own toast is the one", async () => {
        const test = exportHarness({
            applyFloating: () => {
                throw new FloatingApplyError("The floating selection could not be applied.");
            },
        });
        drawnHero(test);
        expect(await test.exports.exportWithDialog()).toBe(false);
        expect(test.shown).toEqual([]);
        expect(test.notices).toEqual([]);
    });

    it("edits the settings without an undo step and the pivot with one, while it is open", async () => {
        const test = exportHarness();
        drawnHero(test);
        test.sessions.getState().markSaved(active(test).id);
        const running = test.exports.exportWithDialog();
        const request = await waitForDialog(test, "export");
        const undo = active(test).history.undoCount;

        request.setSettings((settings) => {
            settings.files.asepriteJson = "array";
            settings.trim = true;
        });
        expect(active(test).session.doc.exportSettings).toMatchObject({
            trim: true,
            files: { asepriteJson: "array" },
        });
        expect(active(test).history.undoCount).toBe(undo);
        // Saved with the document: it is dirty until saved (SPEC §5.2).
        expect(isDirty(active(test))).toBe(true);

        request.setPivot({ x: 0.5, y: 1 });
        expect(active(test).session.doc.pivot).toEqual({ x: 0.5, y: 1 });
        expect(active(test).history.undoCount).toBe(undo + 1);
        // The same command as Sprite properties: undo restores the pivot.
        active(test).history.undo();
        expect(active(test).session.doc.pivot).toEqual({ x: 0.5, y: 0.5 });
        // A pivot equal to the document's is no step.
        request.setPivot({ x: 0.5, y: 0.5 });
        expect(active(test).history.undoCount).toBe(undo);

        request.answer(null);
        expect(await running).toBe(false);
        expect(test.exportPlatform.folderPickers).toBe(0);
    });

    it("chooses the folder from the dialog and shows it; the export then asks no picker", async () => {
        const test = exportHarness();
        drawnHero(test);
        const folder = fakeFolder("art");
        test.exportPlatform.toChoose.push(folder);
        const running = test.exports.exportWithDialog();
        const request = await waitForDialog(test, "export");
        expect(request.destination.getState()).toEqual({
            mode: "folder",
            folder: null,
            choosing: false,
        });
        request.chooseFolder();
        expect(request.destination.getState().choosing).toBe(true);
        await expect
            .poll(() => request.destination.getState())
            .toEqual({
                mode: "folder",
                folder: "art",
                choosing: false,
            });
        request.answer(true);
        expect(await running).toBe(true);
        expect(test.exportPlatform.folderPickers).toBe(1);
        expectFolderHolds(folder, expectedFiles(test));
    });

    it("asks before replacing files the folder holds, once per folder, naming them", async () => {
        const test = exportHarness();
        drawnHero(test);
        // Another document with the same export name wrote there ("Hero" and "hero").
        const folder = fakeFolder("shared", {
            "hero.png": new Uint8Array([1]),
            "hero.atlas.json": new Uint8Array([2]),
            "other.png": new Uint8Array([3]),
        });

        // Cancel writes nothing.
        let running = exportVia(test, folder);
        let question = await waitForDialog(test, "export-overwrite");
        expect(question).toMatchObject({
            document: "hero",
            folder: "shared",
            files: ["hero.png", "hero.atlas.json"],
        });
        question.answer(null);
        expect(await running).toBe(false);
        expect(folder.writes).toEqual([]);
        expect(test.notices).toEqual([]);

        // Asked again, Replace writes.
        running = test.exports.exportAgain();
        question = await waitForDialog(test, "export-overwrite");
        question.answer(true);
        expect(await running).toBe(true);
        expect(folder.files.get("other.png")).toEqual(new Uint8Array([3]));
        expect(folder.files.get("hero.png")).toEqual(expectedFiles(test).get("hero.png"));

        // Once replaced, never asked again for this folder.
        paint(active(test), 2);
        expect(await test.exports.exportAgain()).toBe(true);
        expect(test.shown.map((request) => request.kind)).toEqual([
            "export",
            "export-overwrite",
            "export-overwrite",
        ]);
        expectFolderHolds(
            folder,
            new Map([...expectedFiles(test), ["other.png", new Uint8Array([3])]]),
        );
    });

    it("keeps the confirmation when the same folder is picked again, not for another one", async () => {
        const test = exportHarness();
        drawnHero(test);
        const folder = fakeFolder("shared", { "hero.png": new Uint8Array([1]) });
        const running = exportVia(test, folder);
        (await waitForDialog(test, "export-overwrite")).answer(true);
        expect(await running).toBe(true);

        const pick = async (chosen: FakeFolder) => {
            test.exportPlatform.toChoose.push(chosen);
            const exporting = test.exports.exportWithDialog();
            const request = await waitForDialog(test, "export");
            request.chooseFolder();
            await expect.poll(() => request.destination.getState().folder).toBe(chosen.name);
            request.answer(true);
            return exporting;
        };
        expect(await pick(folder)).toBe(true);
        expect(test.shown.filter((request) => request.kind === "export-overwrite")).toHaveLength(1);

        const other = fakeFolder("other", { "hero.sprites.ts": new Uint8Array([1]) });
        const exporting = pick(other);
        const question = await waitForDialog(test, "export-overwrite");
        expect(question.files).toEqual(["hero.sprites.ts"]);
        question.answer(true);
        expect(await exporting).toBe(true);
    });

    it("shows the error of a document it cannot export, and writes nothing", async () => {
        const test = exportHarness();
        const document = drawnHero(test);
        const folder = fakeFolder("sprites");
        expect(await exportVia(test, folder)).toBe(true);
        const before = new Map(folder.files);
        folder.writes.length = 0;

        // 258 tags of the frame, each written out 255 times: past the entry limit.
        const { doc } = document.session;
        for (let index = 0; index < 258; index++) {
            const tag: Tag = {
                id: `t${index}`,
                name: `t${index}`,
                color: 0xff0000ff,
                fromFrameId: doc.frames[0].id,
                toFrameId: doc.frames[0].id,
                direction: "forward",
                repeat: 255,
            };
            doc.tags.push(tag);
        }
        test.sessions.getState().touch(document.id);
        expect(await test.exports.exportAgain()).toBe(false);
        expect(errors(test)).toEqual([
            "Could not export “hero”. The animations of the export have 65790 entries when " +
                "every repeat is written out; an atlas holds at most 65536. Lower a repeat " +
                "count, shorten a tag, or export one tag at a time.",
        ]);
        expect(folder.writes).toEqual([]);
        expect(folder.files).toEqual(before);
    });

    it("reports a failed write once, with the reason", async () => {
        const test = exportHarness();
        drawnHero(test);
        const folder = fakeFolder("sprites");
        folder.failWrite = new DOMException("The disk is full.", "QuotaExceededError");
        expect(await exportVia(test, folder)).toBe(false);
        expect(errors(test)).toEqual(["Could not export “hero”. The disk is full."]);
        expect(infos(test)).toEqual([]);
    });

    it("downloads <name>.zip with the same files without File System Access", async () => {
        const test = exportHarness();
        drawnHero(test);
        test.exportPlatform.access = false;
        const running = test.exports.exportWithDialog();
        const request = await waitForDialog(test, "export");
        expect(request.destination.getState()).toEqual({
            mode: "download",
            folder: null,
            choosing: false,
        });
        request.answer(true);
        expect(await running).toBe(true);
        const [download] = test.exportPlatform.downloads;
        expect(download).toMatchObject({ name: "hero.zip", kind: "zip" });
        const entries = unzipSync(download!.bytes);
        const expected = expectedFiles(test);
        expect(Object.keys(entries)).toEqual([...expected.keys()]);
        for (const [name, bytes] of expected) {
            expect(Buffer.from(entries[name]).equals(Buffer.from(bytes)), name).toBe(true);
        }
        expect(infos(test)).toEqual(["Exported 4 files to “hero.zip”"]);
        expect(test.exportPlatform.folderPickers).toBe(0);
    });

    it("is one file operation: not while another runs, nor during a stroke", async () => {
        const test = exportHarness();
        const document = drawnHero(test);
        expect(test.exports.canExport()).toBe(true);
        const running = test.exports.exportWithDialog();
        await waitForDialog(test, "export");
        expect(test.workflows.busy).toBe(true);
        expect(test.exports.canExport()).toBe(false);
        expect(await test.exports.exportAgain()).toBe(false);
        expect(await test.workflows.save()).toBe(false);
        test.exportDialogs.store.getState().request!.answer(null);
        expect(await running).toBe(false);
        expect(test.exports.canExport()).toBe(true);

        const stroke = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        expect(test.exports.canExport()).toBe(false);
        stroke.abort();
        expect(test.exports.canExport()).toBe(true);
    });
});

describe("Export Again", () => {
    it("rewrites the bundle without the dialog after an edit: the PNG differs, the IDs do not", async () => {
        const test = exportHarness();
        drawnHero(test);
        const folder = fakeFolder("sprites");
        expect(await exportVia(test, folder)).toBe(true);
        const first = new Map(folder.files);

        paint(active(test), 7);
        expect(await test.exports.exportAgain()).toBe(true);
        expect(test.shown.map((request) => request.kind)).toEqual(["export"]);
        expectFolderHolds(folder, expectedFiles(test));
        expect(folder.files.get("hero.png")).not.toEqual(first.get("hero.png"));
        const ids = (bytes: Uint8Array | undefined) => {
            const atlas = JSON.parse(new TextDecoder().decode(bytes)) as {
                frames: object;
                animations: object;
            };
            return [Object.keys(atlas.frames), Object.keys(atlas.animations)];
        };
        expect(ids(folder.files.get("hero.atlas.json"))).toEqual(ids(first.get("hero.atlas.json")));
        expect(infos(test)).toEqual([
            "Exported 4 files to “sprites”",
            "Exported 4 files to “sprites”",
        ]);
    });

    it("shows the dialog when the document has no folder yet", async () => {
        const test = exportHarness();
        drawnHero(test);
        const running = test.exports.exportAgain();
        const request = await waitForDialog(test, "export");
        expect(request.destination.getState().folder).toBeNull();
        request.answer(null);
        expect(await running).toBe(false);
        expect(test.exportPlatform.folderPickers).toBe(0);
    });

    it("asks once for a revoked permission, then falls back to the dialog", async () => {
        const test = exportHarness();
        drawnHero(test);
        const folder = fakeFolder("sprites");
        expect(await exportVia(test, folder)).toBe(true);
        folder.writes.length = 0;
        folder.granted = false;
        folder.grants = false;

        const running = test.exports.exportAgain();
        const request = await waitForDialog(test, "export");
        expect(folder.requests).toBe(1);
        expect(request.destination.getState().folder).toBe("sprites");
        expect(folder.writes).toEqual([]);
        request.answer(null);
        expect(await running).toBe(false);
        expect(errors(test)).toEqual([]);

        // Granted at the prompt, it writes.
        folder.grants = true;
        expect(await test.exports.exportAgain()).toBe(true);
        expect(folder.requests).toBe(2);
        expect(folder.writes).toHaveLength(4);
    });

    it("finds the folder of a document after a reload (IndexedDB) and writes without asking", async () => {
        const storage = new MemoryStorage();
        const before = exportHarness({ storage });
        drawnHero(before);
        const session = active(before).session;
        const folder = fakeFolder("kept");
        expect(await exportVia(before, folder)).toBe(true);
        folder.writes.length = 0;

        const after = exportHarness({ storage });
        openSession(after, session);
        expect(await after.exports.exportAgain()).toBe(true);
        expect(after.shown).toEqual([]);
        expect(after.exportPlatform.folderPickers).toBe(0);
        expect(folder.writes).toHaveLength(4);
    });

    it("downloads the zip again without File System Access, without the dialog", async () => {
        const test = exportHarness();
        drawnHero(test);
        test.exportPlatform.access = false;
        expect(await test.exports.exportAgain()).toBe(true);
        expect(test.shown).toEqual([]);
        expect(test.exportPlatform.downloads.map((download) => download.name)).toEqual([
            "hero.zip",
        ]);
    });
});

describe("exportOnSave", () => {
    /** A document saved once to `hero.ngsprite`, exported once to `folder`, with the option on. */
    async function savedAndExported(test: ExportHarness, folder: FakeFolder) {
        drawnHero(test);
        active(test).session.doc.exportSettings.exportOnSave = true;
        expect(await exportVia(test, folder)).toBe(true);
        test.platform.toSave.push(test.disk.handle("hero.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        folder.writes.length = 0;
        test.notices.length = 0;
    }

    it("rewrites the bundle after a save, with the document as it was saved", async () => {
        const test = exportHarness();
        const folder = fakeFolder("sprites");
        await savedAndExported(test, folder);
        paint(active(test), 3);
        expect(await test.workflows.save()).toBe(true);
        expect(isDirty(active(test))).toBe(false);
        expect(test.events.slice(-1)).toEqual(["write hero.ngsprite"]);
        expectFolderHolds(folder, expectedFiles(test));
        expect(folder.writes).toHaveLength(4);
        expect(infos(test)).toEqual(["Saved hero.ngsprite", "Exported 4 files to “sprites”"]);
        expect(test.shown.map((request) => request.kind)).toEqual(["export"]);
    });

    it("does not block the save when the export fails: the file is written, one error toast", async () => {
        const test = exportHarness();
        const folder = fakeFolder("sprites");
        await savedAndExported(test, folder);
        paint(active(test), 3);
        folder.granted = false;
        folder.grants = false;
        expect(await test.workflows.save()).toBe(true);
        expect(isDirty(active(test))).toBe(false);
        expect(test.events.slice(-1)).toEqual(["write hero.ngsprite"]);
        expect(folder.writes).toEqual([]);
        expect(infos(test)).toEqual(["Saved hero.ngsprite"]);
        expect(errors(test)).toEqual([
            "Could not export “hero”. No permission to write to the folder “sprites”.",
        ]);
        // It never shows the Export dialog.
        expect(test.shown.map((request) => request.kind)).toEqual(["export"]);

        test.notices.length = 0;
        folder.granted = true;
        folder.failWrite = new DOMException("The disk is full.", "QuotaExceededError");
        paint(active(test), 4);
        expect(await test.workflows.save()).toBe(true);
        expect(isDirty(active(test))).toBe(false);
        expect(errors(test)).toEqual(["Could not export “hero”. The disk is full."]);
    });

    it("without a folder says to use Export…; with the option off it does nothing", async () => {
        const test = exportHarness();
        drawnHero(test);
        test.platform.toSave.push(test.disk.handle("hero.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        expect(test.notices).toEqual([{ kind: "info", message: "Saved hero.ngsprite" }]);

        active(test).session.doc.exportSettings.exportOnSave = true;
        expect(await test.workflows.save()).toBe(true);
        expect(errors(test)).toEqual([
            "Could not export “hero”. No export folder is chosen yet. Use Export….",
        ]);
        expect(test.shown).toEqual([]);
    });

    it("a step after the save that throws is reported once, and the save stands", async () => {
        const test = exportHarness();
        drawnHero(test);
        test.workflows.onSaved(async () => {
            throw new Error("The step failed.");
        });
        test.platform.toSave.push(test.disk.handle("hero.ngsprite"));
        expect(await test.workflows.save()).toBe(true);
        expect(isDirty(active(test))).toBe(false);
        expect(test.notices).toEqual([
            { kind: "info", message: "Saved hero.ngsprite" },
            { kind: "error", message: "The step failed." },
        ]);
        expect(test.workflows.busy).toBe(false);
    });

    it("downloads the zip after a save without File System Access", async () => {
        const test = exportHarness();
        drawnHero(test);
        test.exportPlatform.access = false;
        test.platform.access = false;
        active(test).session.doc.exportSettings.exportOnSave = true;
        expect(await test.workflows.save()).toBe(true);
        expect(test.platform.downloads.map((download) => download.name)).toEqual(["hero.ngsprite"]);
        expect(test.exportPlatform.downloads.map((download) => download.name)).toEqual([
            "hero.zip",
        ]);
    });
});

describe("the other exports", () => {
    it("saves the active frame as a PNG at the scale chosen, through the save picker", async () => {
        const test = exportHarness();
        const document = drawnHero(test);
        test.exportPlatform.toSave.push("chosen.png");
        const running = test.exports.exportFramePng();
        const request = await waitForDialog(test, "export-frame-png");
        expect(request).toMatchObject({
            name: "hero",
            frameIndex: 0,
            width: 4,
            height: 3,
            initialScale: 1,
            maxScale: 16,
        });
        request.answer(4);
        expect(await running).toBe(true);
        const expected = framePngFile(
            document.session.doc,
            "hero",
            document.session.activeFrameId,
            4,
        );
        expect(test.exportPlatform.suggested).toEqual(["hero-0@4x.png"]);
        expect(test.exportPlatform.saved).toEqual([{ name: "chosen.png", bytes: expected.bytes }]);
        expect(infos(test)).toEqual(["Exported 1 file to “chosen.png”"]);

        // The dialog opens with the scale last chosen.
        const again = test.exports.exportFramePng();
        expect((await waitForDialog(test, "export-frame-png")).initialScale).toBe(4);
        test.exportDialogs.store.getState().request!.answer(null);
        expect(await again).toBe(false);
    });

    it("downloads the sprite sheet PNG and the PNG sequence zip without File System Access", async () => {
        const test = exportHarness();
        const document = drawnHero(test);
        test.exportPlatform.access = false;
        expect(await test.exports.exportSpriteSheet()).toBe(true);
        expect(await test.exports.exportPngSequence()).toBe(true);
        const [sheet, sequence] = test.exportPlatform.downloads;
        expect(sheet).toEqual({
            name: "hero.png",
            bytes: spriteSheetFile(document.session.doc).bytes,
            kind: "png",
        });
        expect(sequence).toMatchObject({ name: "hero-frames.zip", kind: "zip" });
        const entries = unzipSync(sequence!.bytes);
        const frames = pngSequenceFiles(document.session.doc);
        expect(Object.keys(entries)).toEqual(["hero-0.png"]);
        expect(entries["hero-0.png"]).toEqual(frames[0]!.bytes);
        expect(infos(test)).toEqual([
            "Exported 1 file to “hero.png”",
            "Exported 1 file to “hero-frames.zip”",
        ]);
    });

    it("a cancelled save picker is not reported; a document it cannot export is", async () => {
        const test = exportHarness();
        const document = drawnHero(test);
        test.exportPlatform.toSave.push(null);
        expect(await test.exports.exportSpriteSheet()).toBe(false);
        expect(test.notices).toEqual([]);
        document.session.doc.exportSettings.frames = { tagId: "gone" };
        expect(await test.exports.exportPngSequence()).toBe(false);
        expect(errors(test)).toEqual([
            "Could not export “hero”. The export is limited to a tag the document does not " +
                'have ("gone").',
        ]);
    });
});
