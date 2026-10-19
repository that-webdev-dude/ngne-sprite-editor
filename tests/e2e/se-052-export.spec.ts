import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { unzipSync } from "fflate";
import type { PixelBuffer } from "../../src/core/model";
import { decodePng } from "../../src/core/png/decode";
import { collectErrors, settleTimers } from "./se-006-support";
import { menuItem, openEditor, openMenu } from "./se-007-support";
import { field } from "./se-008-support";
import {
    activeState,
    addEmptyFrame,
    arrangeFiles,
    drawStroke,
    errorToast,
    fileSystem,
    frameComposites,
    infoToast,
    openHero,
    stubFileSystemAccess,
    unsavedMarker,
} from "./se-041-support";
import {
    arrangeFolders,
    byName,
    expectFolderToHold,
    expectSameFiles,
    expectedBundle,
    exportDialog,
    exportSettings,
    folderFiles,
    folderStub,
    permissionAfterReload,
    framePngDialog,
    listedFiles,
    openExportDialog,
    openFixture,
    overwriteDialog,
    putFiles,
    removeExportPickers,
    removeFile,
    removeFolder,
    setExportSettings,
    runAfterGestureLapsed,
    stubExportFolders,
} from "./se-052-support";

// SE-052: Export…, Export Again, exportOnSave, the zip download and the other exports as the
// user works with them (SPEC §9.6, DESIGN §7). File System Access is a directory picker over
// the browser's private file system (se-052-support.ts); every byte expected of an export is
// what `bundle()` makes in the page.

const STROKES = [
    [
        { x: 1, y: 1 },
        { x: 6, y: 4 },
        { x: 10, y: 2 },
    ],
    [
        { x: 3, y: 9 },
        { x: 12, y: 9 },
    ],
    [
        { x: 14, y: 1 },
        { x: 2, y: 10 },
    ],
];

/** "512 B", "1.2 KB": the sizes the dialog lists, as DESIGN §7's file list shows them. */
function size(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

const button = (scope: Locator, name: string) => scope.getByRole("button", { name, exact: true });
const folderName = (dialog: Locator) => dialog.locator("[data-export-folder]");

/** Records the title of every dialog that opens from now on, on `window.__se052Dialogs`. */
async function recordDialogs(page: Page): Promise<void> {
    await page.evaluate(() => {
        const seen: string[] = [];
        (window as unknown as { __se052Dialogs: string[] }).__se052Dialogs = seen;
        const look = () => {
            for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
                if (dialog.dataset.se052Seen) continue;
                dialog.dataset.se052Seen = "";
                seen.push(dialog.querySelector("h2")?.textContent ?? "");
            }
        };
        new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
    });
}

function dialogsSeen(page: Page): Promise<string[]> {
    return page.evaluate(() => [
        ...(window as unknown as { __se052Dialogs: string[] }).__se052Dialogs,
    ]);
}

/** Waits until no dialog is open and Radix has returned the focus. */
async function dialogsClosed(page: Page): Promise<void> {
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await settleTimers(page);
}

/** Exports the active document from the dialog into `folder`, chosen in the dialog. */
async function exportInto(page: Page, folder: string, files = 4): Promise<void> {
    await arrangeFolders(page, { nextFolder: [folder] });
    const dialog = await openExportDialog(page);
    await button(dialog, "Choose folder…").click();
    await expect(folderName(dialog)).toHaveText(folder);
    await button(dialog, "Export").click();
    await expect(infoToast(page, `Exported ${files} files to “${folder}”`)).toBeVisible();
    await dialogsClosed(page);
}

/** The ID lists of an atlas file. */
function idsOf(bytes: Uint8Array | undefined): { frames: string[]; animations: string[] } {
    const atlas = JSON.parse(new TextDecoder().decode(bytes)) as {
        frames: object;
        animations: object;
    };
    return { frames: Object.keys(atlas.frames), animations: Object.keys(atlas.animations) };
}

/** A nearest-neighbour upscale written out pixel by pixel. */
function blocks(image: PixelBuffer, scale: number): Uint8Array {
    const width = image.width * scale;
    const out = new Uint8Array(width * image.height * scale * 4);
    for (let y = 0; y < image.height * scale; y++) {
        for (let x = 0; x < width; x++) {
            const from = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4;
            out.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
        }
    }
    return out;
}

test("Export… writes exactly the enabled bundle files into the chosen folder, with the bytes of bundle()", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await arrangeFolders(page, { nextFolder: ["sprites"] });

    const dialog = await openExportDialog(page);
    await expect(folderName(dialog)).toHaveText("No folder chosen");
    // Two file toggles: the preview config off, the Aseprite JSON in its hash form.
    await button(dialog, "hero.preview.config.mjs").click();
    await dialog
        .getByRole("radiogroup", { name: "Aseprite JSON" })
        .getByRole("radio", { name: "Hash" })
        .click();
    await expect
        .poll(() => exportSettings(page))
        .toMatchObject({
            files: { spritesTs: true, previewConfig: false, asepriteJson: "hash" },
        });
    await expect(button(dialog, "hero.preview.config.mjs")).toHaveAttribute(
        "aria-pressed",
        "false",
    );
    // A setting is saved with the document: it is dirty now, without an undo step.
    await expect(unsavedMarker(page)).toBeVisible();
    expect((await activeState(page))?.undo).toBe(1);

    const expected = await expectedBundle(page);
    expect(expected.map((file) => file.name)).toEqual([
        "hero.png",
        "hero.atlas.json",
        "hero.sprites.ts",
        "hero.aseprite.json",
    ]);
    // The dialog lists the files it writes, with their sizes, and the final IDs.
    await expect
        .poll(() => listedFiles(dialog))
        .toEqual(expected.map((file) => `${file.name} ${size(file.bytes.length)}`));
    await expect(dialog.getByRole("list", { name: /^Frame IDs/ })).toHaveText("hero-0");
    await expect(dialog.getByRole("img", { name: /^Atlas, / })).toBeVisible();

    await button(dialog, "Choose folder…").click();
    await expect(folderName(dialog)).toHaveText("sprites");
    await button(dialog, "Export").click();
    await expect(infoToast(page, "Exported 4 files to “sprites”")).toBeVisible();
    await expect(dialog).toBeHidden();
    expectSameFiles(await folderFiles(page, "sprites"), byName(expected));
    expect(await folderStub(page)).toMatchObject({ folderPickers: 1, permissionRequests: 0 });
    expect(errors).toEqual([]);
});

test("Export Again after an edit rewrites the files without a dialog: the PNG differs, the IDs do not", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await exportInto(page, "sprites");
    const first = await folderFiles(page, "sprites");
    await recordDialogs(page);

    await drawStroke(page, STROKES[1]!);
    const expected = byName(await expectedBundle(page));
    expect(expected.get("hero.png")).not.toEqual(first.get("hero.png"));
    await page.keyboard.press("Control+Shift+KeyE");
    await expectFolderToHold(page, "sprites", expected);
    const again = await folderFiles(page, "sprites");
    expect(idsOf(again.get("hero.atlas.json"))).toEqual(idsOf(first.get("hero.atlas.json")));
    expect(await dialogsSeen(page)).toEqual([]);
    expect(await folderStub(page)).toMatchObject({ folderPickers: 1, permissionRequests: 0 });
    expect(errors).toEqual([]);
});

test("with exportOnSave, Ctrl+S saves and rewrites the bundle; a failed export does not block the save and shows one error toast", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await stubExportFolders(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);

    // Export on save, switched on in the dialog, and a first export into the folder.
    await arrangeFolders(page, { nextFolder: ["sprites"] });
    const dialog = await openExportDialog(page);
    await button(dialog, "Export on save").click();
    await expect(button(dialog, "Export on save")).toHaveAttribute("aria-pressed", "true");
    await button(dialog, "Choose folder…").click();
    await expect(folderName(dialog)).toHaveText("sprites");
    await button(dialog, "Export").click();
    await expect(infoToast(page, "Exported 4 files to “sprites”")).toBeVisible();
    await dialogsClosed(page);

    // Ctrl+S: the project is saved, then the bundle is written again.
    await drawStroke(page, STROKES[1]!);
    await arrangeFiles(page, { nextSave: ["hero.ngsprite"] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved hero.ngsprite")).toBeVisible();
    const saved = byName(await expectedBundle(page));
    await expectFolderToHold(page, "sprites", saved);
    await expect(unsavedMarker(page)).toHaveCount(0);

    // The folder's permission is revoked: the save is written, the export fails once.
    await arrangeFolders(page, { permission: "revoked" });
    await drawStroke(page, STROKES[2]!);
    await expect(unsavedMarker(page)).toBeVisible();
    await page.keyboard.press("Control+KeyS");
    await expect(errorToast(page)).toHaveText(
        /Could not export “hero”\. No permission to write to the folder “sprites”\./,
    );
    await expect(errorToast(page)).toHaveCount(1);
    await expect(unsavedMarker(page)).toHaveCount(0);
    expect((await fileSystem(page)).writes).toEqual(["hero.ngsprite", "hero.ngsprite"]);
    expect((await activeState(page))?.dirty).toBe(false);
    expectSameFiles(await folderFiles(page, "sprites"), saved);
    expect((await folderStub(page)).permissionRequests).toBe(1);
    await expect(exportDialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("without File System Access, Export downloads a zip that holds the same files", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await removeExportPickers(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);

    const dialog = await openExportDialog(page);
    await expect(folderName(dialog)).toHaveText("Download hero.zip");
    await expect(button(dialog, "Choose folder…")).toHaveCount(0);
    const downloading = page.waitForEvent("download");
    await button(dialog, "Export").click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("hero.zip");
    const entries = unzipSync(readFileSync(await download.path()));
    const expected = await expectedBundle(page);
    expect(Object.keys(entries)).toEqual(expected.map((file) => file.name));
    expectSameFiles(new Map(Object.entries(entries)), byName(expected));
    await expect(infoToast(page, "Exported 4 files to “hero.zip”")).toBeVisible();
    expect(errors).toEqual([]);
});

test("a revoked folder permission is asked for once, then the Export dialog is shown", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await exportInto(page, "sprites");
    const before = await folderFiles(page, "sprites");

    await drawStroke(page, STROKES[1]!);
    await arrangeFolders(page, { permission: "revoked" });
    await page.keyboard.press("Control+Shift+KeyE");
    const dialog = exportDialog(page);
    await expect(dialog).toBeVisible();
    expect((await folderStub(page)).permissionRequests).toBe(1);
    await expect(folderName(dialog)).toHaveText("sprites");
    expectSameFiles(await folderFiles(page, "sprites"), before);
    await expect(errorToast(page)).toHaveCount(0);

    // Granted again, the dialog's Export writes.
    await arrangeFolders(page, { permission: "granted" });
    const expected = byName(await expectedBundle(page));
    expect(expected.get("hero.png")).not.toEqual(before.get("hero.png"));
    await button(dialog, "Export").click();
    await expectFolderToHold(page, "sprites", expected);
    expect(errors).toEqual([]);
});

test("the frame PNG at 4× is an exact nearest-neighbour upscale of the frame's composite", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await addEmptyFrame(page);
    await drawStroke(page, STROKES[1]!);
    await arrangeFiles(page, { nextSave: ["frame.png"] });

    await openMenu(page, "File");
    await menuItem(page, "file.exportFramePng").click();
    const dialog = framePngDialog(page);
    await expect(dialog).toBeVisible();
    const scale = field(dialog, "Scale");
    await expect(scale).toHaveValue("1");
    await scale.fill("4");
    await scale.blur();
    await expect(dialog.locator("[data-frame-png-result]")).toHaveText(
        "hero-1@4x.png · 64 × 48 px",
    );
    await button(dialog, "Export").click();
    await expect(infoToast(page, "Exported 1 file to “frame.png”")).toBeVisible();

    const stub = await fileSystem(page);
    expect(stub.saveSuggestions).toEqual(["hero-1@4x.png"]);
    const image = await decodePng(Uint8Array.from(stub.files["frame.png"] ?? []));
    const [, second] = await frameComposites(page);
    const composite = { width: 16, height: 12, data: Uint8ClampedArray.from(second ?? []) };
    expect([image.width, image.height]).toEqual([64, 48]);
    expect(Buffer.from(image.data).equals(Buffer.from(blocks(composite, 4)))).toBe(true);
    // The frame drawn on is not blank: the comparison saw its stroke.
    expect(composite.data.some((value) => value !== 0)).toBe(true);
    expect(errors).toEqual([]);
});

test("an export past the entry limit shows the error's message and writes no file", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await exportInto(page, "sprites");
    const before = await folderFiles(page, "sprites");

    // 258 tags over the frame, each repeated 255 times: 65 790 entries written out.
    await page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const { doc } = document.session;
        for (let index = 0; index < 258; index++) {
            doc.tags.push({
                id: `se052-${index}`,
                name: `t${index}`,
                color: 0x3cb371ff,
                fromFrameId: doc.frames[0]!.id,
                toFrameId: doc.frames[0]!.id,
                direction: "forward",
                repeat: 255,
            });
        }
        state.touch(document.id);
    });
    await drawStroke(page, STROKES[1]!);
    const message =
        "The animations of the export have 65790 entries when every repeat is written out; " +
        "an atlas holds at most 65536. Lower a repeat count, shorten a tag, or export one tag " +
        "at a time.";

    const dialog = await openExportDialog(page);
    await expect(dialog.getByRole("alert")).toHaveText(message);
    await expect(button(dialog, "Export")).toBeDisabled();
    await expect(dialog.locator("[data-export-files]")).toHaveCount(0);
    await button(dialog, "Close").click();
    await dialogsClosed(page);

    await page.keyboard.press("Control+Shift+KeyE");
    await expect(errorToast(page)).toHaveText(
        new RegExp(`Could not export “hero”\\. ${message.replace(/[.()]/g, "\\$&")}`),
    );
    await expect(errorToast(page)).toHaveCount(1);
    expectSameFiles(await folderFiles(page, "sprites"), before);
    expect(errors).toEqual([]);
});

test("the sprite sheet PNG alone is the bundle's <name>.png; the PNG sequence zip holds each frame's composite as <name>-<index>.png", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await removeExportPickers(page);
    await openEditor(page);
    await openFixture(page, "a");
    const expected = byName(await expectedBundle(page));

    await openMenu(page, "File");
    let downloading = page.waitForEvent("download");
    await menuItem(page, "file.exportSpriteSheet").click();
    let download = await downloading;
    expect(download.suggestedFilename()).toBe("walker.png");
    const sheet = readFileSync(await download.path());
    expect(Buffer.from(expected.get("walker.png")!).equals(sheet)).toBe(true);
    await expect(infoToast(page, "Exported 1 file to “walker.png”")).toBeVisible();
    await dialogsClosed(page);

    await openMenu(page, "File");
    downloading = page.waitForEvent("download");
    await menuItem(page, "file.exportPngSequence").click();
    download = await downloading;
    expect(download.suggestedFilename()).toBe("walker-frames.zip");
    const entries = unzipSync(readFileSync(await download.path()));
    expect(Object.keys(entries)).toEqual([
        "walker-0.png",
        "walker-1.png",
        "walker-2.png",
        "walker-3.png",
    ]);
    const composites = await frameComposites(page);
    for (const [index, composite] of composites.entries()) {
        const image = await decodePng(entries[`walker-${index}.png`]!);
        expect([image.width, image.height]).toEqual([32, 32]);
        expect(Array.from(image.data), `frame ${index}`).toEqual(composite);
    }
    await expect(infoToast(page, "Exported 4 files to “walker-frames.zip”")).toBeVisible();
    expect(errors).toEqual([]);
});

test("the overwrite question names the files a folder holds, once per folder", async ({ page }) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    // Another document with the export name "hero" wrote into the folder before.
    await putFiles(page, "shared", { "hero.png": [1, 2, 3], "notes.txt": [4] });
    await arrangeFolders(page, { nextFolder: ["shared"] });

    let dialog = await openExportDialog(page);
    await button(dialog, "Choose folder…").click();
    await expect(folderName(dialog)).toHaveText("shared");
    await button(dialog, "Export").click();
    let question = overwriteDialog(page);
    await expect(question).toBeVisible();
    await expect(question.locator("[data-overwrite-files] li")).toHaveText(["hero.png"]);
    await button(question, "Cancel").click();
    await dialogsClosed(page);
    expect(Array.from((await folderFiles(page, "shared")).get("hero.png") ?? [])).toEqual([
        1, 2, 3,
    ]);
    await expect(infoToast(page, "Exported")).toHaveCount(0);

    // Asked again until the files are replaced once.
    dialog = await openExportDialog(page);
    await expect(folderName(dialog)).toHaveText("shared");
    await button(dialog, "Export").click();
    question = overwriteDialog(page);
    await expect(question).toBeVisible();
    await button(question, "Replace").click();
    await expect(infoToast(page, "Exported 4 files to “shared”")).toBeVisible();
    await dialogsClosed(page);
    const files = await folderFiles(page, "shared");
    expect(Array.from(files.get("notes.txt") ?? [])).toEqual([4]);
    files.delete("notes.txt");
    expectSameFiles(files, byName(await expectedBundle(page)));

    // From now on the folder's files are this document's to replace.
    await recordDialogs(page);
    await drawStroke(page, STROKES[1]!);
    const notes = new Map([["notes.txt", Uint8Array.from([4])]]);
    await page.keyboard.press("Control+Shift+KeyE");
    await expectFolderToHold(
        page,
        "shared",
        new Map([...byName(await expectedBundle(page)), ...notes]),
    );
    expect(await dialogsSeen(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test("the export folder is kept in IndexedDB: after a reload, Export Again writes there without asking", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openEditor(page);
    await openFixture(page, "c");
    await exportInto(page, "kept");
    const expected = byName(await expectedBundle(page));
    expectSameFiles(await folderFiles(page, "kept"), expected);

    await page.reload();
    await openEditor(page);
    // The same document (its id is kept in its file) opened again.
    await openFixture(page, "c");
    await removeFile(page, "kept", "twice.png");
    await recordDialogs(page);
    await page.keyboard.press("Control+Shift+KeyE");
    await expect(infoToast(page, "Exported 4 files to “kept”")).toBeVisible();
    await expectFolderToHold(page, "kept", expected);
    expect(await dialogsSeen(page)).toEqual([]);
    expect(await folderStub(page)).toMatchObject({ folderPickers: 0, permissionRequests: 0 });
    expect(errors).toEqual([]);
});

test("after a reload Chrome may ask again for the kept folder: Export Again prompts once and writes", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openEditor(page);
    await openFixture(page, "c");
    await exportInto(page, "kept");
    const expected = byName(await expectedBundle(page));

    await permissionAfterReload(page, "prompt");
    await page.reload();
    await openEditor(page);
    await openFixture(page, "c");
    await removeFile(page, "kept", "twice.png");
    await recordDialogs(page);
    // The key is the gesture the prompt needs.
    await page.keyboard.press("Control+Shift+KeyE");
    await expect(infoToast(page, "Exported 4 files to “kept”")).toBeVisible();
    await expectFolderToHold(page, "kept", expected);
    expect(await dialogsSeen(page)).toEqual([]);
    expect(await folderStub(page)).toMatchObject({
        folderPickers: 0,
        permissionRequests: 1,
        permission: "granted",
    });
    expect(errors).toEqual([]);
});

test("a removed export folder: Export Again shows the Export dialog", async ({ page }) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await exportInto(page, "sprites");

    await removeFolder(page, "sprites");
    await page.keyboard.press("Control+Shift+KeyE");
    const dialog = exportDialog(page);
    await expect(dialog).toBeVisible();
    await expect(folderName(dialog)).toHaveText("sprites");
    await expect(errorToast(page)).toHaveCount(0);
    expect(await folderFiles(page, "sprites")).toEqual(new Map());

    // Its Export names the problem: choose another folder.
    await button(dialog, "Export").click();
    await expect(errorToast(page)).toHaveText(
        /Could not export “hero”\. The folder “sprites” no longer exists\. Use Export…\./,
    );
    await expect(errorToast(page)).toHaveCount(1);
    expect(errors).toEqual([]);
});

test("Export Again without the user's gesture shows the dialog; its Export prompts once and writes", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await exportInto(page, "sprites");
    await arrangeFolders(page, { permission: "prompt" });
    await drawStroke(page, STROKES[1]!);
    const expected = byName(await expectedBundle(page));

    await runAfterGestureLapsed(page, "file.exportAgain");
    const dialog = exportDialog(page);
    await expect(dialog).toBeVisible();
    expect((await folderStub(page)).permissionRequests).toBe(0);
    await expect(errorToast(page)).toHaveCount(0);

    await button(dialog, "Export").click();
    await expectFolderToHold(page, "sprites", expected);
    expect(await folderStub(page)).toMatchObject({ permissionRequests: 1, permission: "granted" });
    expect(errors).toEqual([]);
});

test("exportOnSave without the user's gesture: the save stands and one toast names Export Again", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await stubExportFolders(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await setExportSettings(page, { exportOnSave: true });
    await exportInto(page, "sprites");
    // A first save: the document has its file, written again without asking.
    await arrangeFiles(page, { nextSave: ["hero.ngsprite"] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved hero.ngsprite")).toBeVisible();
    const exported = await folderFiles(page, "sprites");

    await arrangeFolders(page, { permission: "prompt" });
    await drawStroke(page, STROKES[1]!);
    await runAfterGestureLapsed(page, "file.save");
    await expect
        .poll(async () => (await fileSystem(page)).writes)
        .toEqual(["hero.ngsprite", "hero.ngsprite"]);
    await expect(errorToast(page)).toHaveText(
        /^Could not export “hero”\. No permission to write to the folder “sprites”\. Use Export Again\./,
    );
    await expect(errorToast(page)).toHaveCount(1);
    await expect(unsavedMarker(page)).toHaveCount(0);
    expect((await folderStub(page)).permissionRequests).toBe(0);
    expectSameFiles(await folderFiles(page, "sprites"), exported);
    await expect(exportDialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});
