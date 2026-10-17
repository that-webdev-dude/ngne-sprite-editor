import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { zipSync } from "fflate";
import { collectErrors } from "./se-006-support";
import { menuItem, openMenu } from "./se-007-support";
import { dialogButton } from "./se-008-support";
import {
    activeState,
    addEmptyFrame,
    arrangeFiles,
    discardDialog,
    documentName,
    drawStroke,
    emptyState,
    errorToast,
    fileSystem,
    frameComposites,
    infoToast,
    openHero,
    removeFileSystemAccess,
    stubFileSystemAccess,
    unsavedMarker,
} from "./se-041-support";

// SE-041: Open, Save, Save As, Close and Revert as the user works with them (SPEC §10): a
// document drawn with the pencil goes to a file and comes back the same; the unsaved marker,
// the close question, the fallback without File System Access, a corrupt file, a drop and the
// unload guard.

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

const viewportFocus = (page: Page) => page.locator("[data-viewport-focus]");
const openButton = (page: Page) =>
    emptyState(page).getByRole("button", { name: "Open", exact: true });

/** Draws a stroke on each of three frames; the third is active afterwards. */
async function drawThreeFrames(page: Page): Promise<void> {
    for (const [index, stroke] of STROKES.entries()) {
        if (index > 0) await addEmptyFrame(page);
        await drawStroke(page, stroke);
    }
}

test("draw with the pencil, save, close, reopen: every frame's composite is byte-identical and the history is empty", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openHero(page);
    await drawThreeFrames(page);
    const before = await frameComposites(page);
    expect(before).toHaveLength(3);
    // Each frame holds its stroke.
    for (const composite of before) expect(composite.some((value) => value !== 0)).toBe(true);
    await expect(unsavedMarker(page)).toBeVisible();

    // Ctrl+S on a document without a file asks where to save it.
    await arrangeFiles(page, { nextSave: ["hero.ngsprite"] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved hero.ngsprite")).toBeVisible();
    await expect(unsavedMarker(page)).toHaveCount(0);
    expect(await fileSystem(page)).toMatchObject({
        saveSuggestions: ["hero.ngsprite"],
        writes: ["hero.ngsprite"],
    });

    // Alt+W closes it: saved, so without a question.
    await page.keyboard.press("Alt+KeyW");
    await expect(emptyState(page)).toBeVisible();
    await expect(documentName(page)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await activeState(page)).toBeNull();

    // Open on the empty state.
    await arrangeFiles(page, { nextOpen: ["hero.ngsprite"] });
    await openButton(page).click();
    await expect(documentName(page)).toHaveText("hero");
    await expect(infoToast(page, "Opened hero.ngsprite")).toBeVisible();
    expect(await activeState(page)).toMatchObject({
        name: "hero",
        frames: 3,
        undo: 0,
        redo: 0,
        dirty: false,
    });
    expect(await frameComposites(page)).toEqual(before);
    await expect(unsavedMarker(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("saving twice without changes writes identical bytes and clears the dirty marker each time", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await expect(unsavedMarker(page)).toBeVisible();
    await expect(unsavedMarker(page)).toHaveAttribute("title", "Unsaved changes");

    await arrangeFiles(page, { nextSave: ["hero.ngsprite"] });
    await page.keyboard.press("Control+KeyS");
    await expect.poll(async () => (await fileSystem(page)).writes).toEqual(["hero.ngsprite"]);
    await expect(unsavedMarker(page)).toHaveCount(0);
    const first = (await fileSystem(page)).files["hero.ngsprite"];
    expect(first?.length).toBeGreaterThan(0);

    // The second save, from the File menu, writes to the same file without asking.
    await openMenu(page, "File");
    await menuItem(page, "file.save").click();
    await expect
        .poll(async () => (await fileSystem(page)).writes)
        .toEqual(["hero.ngsprite", "hero.ngsprite"]);
    await expect(unsavedMarker(page)).toHaveCount(0);
    const files = await fileSystem(page);
    expect(files.files["hero.ngsprite"]).toEqual(first);
    expect(files.saveSuggestions).toEqual(["hero.ngsprite"]);
    expect((await activeState(page))?.dirty).toBe(false);

    // The marker follows the saved position: undo shows it, redo back to the save clears it.
    await page.evaluate(() => window.__ngneTest!.commands.get("edit.undo")!.run());
    await expect(unsavedMarker(page)).toBeVisible();
    await page.evaluate(() => window.__ngneTest!.commands.get("edit.redo")!.run());
    await expect(unsavedMarker(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("with the File System Access API stubbed away, Save downloads a file and Open uses a file input", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await removeFileSystemAccess(page);
    await openHero(page);
    expect(
        await page.evaluate(() => "showSaveFilePicker" in window || "showOpenFilePicker" in window),
    ).toBe(false);
    await drawThreeFrames(page);
    const before = await frameComposites(page);

    const downloading = page.waitForEvent("download");
    await page.keyboard.press("Control+KeyS");
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("hero.ngsprite");
    const bytes = readFileSync(await download.path());
    await expect(infoToast(page, "Saved hero.ngsprite")).toBeVisible();
    await expect(unsavedMarker(page)).toHaveCount(0);

    await page.keyboard.press("Alt+KeyW");
    await expect(emptyState(page)).toBeVisible();

    // Ctrl+O: a file input that takes one project file.
    const choosing = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+KeyO");
    const chooser = await choosing;
    expect(chooser.isMultiple()).toBe(false);
    expect(await chooser.element().getAttribute("accept")).toBe(".ngsprite");
    await chooser.setFiles({ name: "hero.ngsprite", mimeType: "application/zip", buffer: bytes });
    await expect(documentName(page)).toHaveText("hero");
    expect(await activeState(page)).toMatchObject({ frames: 3, undo: 0, redo: 0, dirty: false });
    expect(await frameComposites(page)).toEqual(before);
    // The input was only there for the choice.
    await expect(page.locator("[data-project-file-input]")).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("closing a dirty document asks once; cancelling keeps the document", async ({ page }) => {
    const errors = collectErrors(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    const before = await activeState(page);
    const composites = await frameComposites(page);
    expect(before?.dirty).toBe(true);
    await expect(viewportFocus(page)).toBeFocused();

    // Cancel.
    await page.keyboard.press("Alt+KeyW");
    const dialog = discardDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("“hero” has unsaved changes. Closing it loses them.");
    await expect(dialogButton(dialog, "Cancel")).toBeFocused();
    await dialogButton(dialog, "Cancel").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Asked once: no second question follows.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await activeState(page)).toMatchObject({
        id: before?.id,
        undo: before?.undo,
        dirty: true,
    });
    expect(await frameComposites(page)).toEqual(composites);
    await expect(unsavedMarker(page)).toBeVisible();

    // Escape, once the question has the focus, is a cancel too.
    await expect(viewportFocus(page)).toBeFocused();
    await page.keyboard.press("Alt+KeyW");
    await expect(dialogButton(dialog, "Cancel")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await activeState(page))?.id).toBe(before?.id);

    // Discard, from the File menu, closes it.
    await openMenu(page, "File");
    await menuItem(page, "file.close").click();
    await expect(dialog).toBeVisible();
    await dialogButton(dialog, "Discard").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(emptyState(page)).toBeVisible();
    expect(await activeState(page)).toBeNull();
    expect(errors).toEqual([]);
});

test("opening a corrupt file shows an error toast naming the problem and leaves the current document untouched", async ({
    page,
}) => {
    await stubFileSystemAccess(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    const before = await activeState(page);
    const composites = await frameComposites(page);
    // Not a zip; a zip that is not a project.
    const notProject = zipSync({ "readme.txt": new TextEncoder().encode("hello") });
    await arrangeFiles(page, {
        nextOpen: ["broken.ngsprite"],
        files: { "broken.ngsprite": [1, 2, 3, 4, 5, 6, 7, 8] },
    });

    await page.keyboard.press("Control+KeyO");
    await expect(errorToast(page)).toHaveCount(1);
    await expect(errorToast(page)).toContainText(
        /^Could not open “broken\.ngsprite”\. The file is not a zip archive/,
    );
    // Nothing was asked, though the document has unsaved changes; nothing changed.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await activeState(page)).toEqual(before);
    expect(await frameComposites(page)).toEqual(composites);
    await expect(unsavedMarker(page)).toBeVisible();

    await errorToast(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(errorToast(page)).toHaveCount(0);
    await arrangeFiles(page, {
        nextOpen: ["other.ngsprite"],
        files: { "other.ngsprite": Array.from(notProject) },
    });
    await page.keyboard.press("Control+KeyO");
    await expect(errorToast(page)).toContainText(
        'Could not open “other.ngsprite”. The file has no entry "manifest.json": it is not a sprite project.',
    );
    expect(await activeState(page)).toEqual(before);
    expect(await frameComposites(page)).toEqual(composites);
});

test("Revert reads the saved file again in place of the document, after one question", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openHero(page);
    // Revert needs a file.
    expect(
        await page.evaluate(() => window.__ngneTest!.commands.get("file.revert")!.enabled()),
    ).toBe(false);
    await drawStroke(page, STROKES[0]!);
    await arrangeFiles(page, { nextSave: ["hero.ngsprite"] });
    await page.keyboard.press("Control+KeyS");
    await expect(unsavedMarker(page)).toHaveCount(0);
    const saved = await frameComposites(page);
    await drawStroke(page, STROKES[1]!);
    expect(await frameComposites(page)).not.toEqual(saved);

    await openMenu(page, "File");
    await menuItem(page, "file.revert").click();
    const dialog = discardDialog(page);
    await expect(dialog).toContainText(
        "“hero” has unsaved changes. Revert reads “hero.ngsprite” again, and the changes are lost.",
    );
    await dialogButton(dialog, "Discard").click();
    await expect(infoToast(page, "Reverted to hero.ngsprite")).toBeVisible();
    expect(await frameComposites(page)).toEqual(saved);
    expect(await activeState(page)).toMatchObject({ undo: 0, dirty: false });
    await expect(unsavedMarker(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("a project file dropped on the window opens; another file is reported", async ({ page }) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await arrangeFiles(page, { nextSave: ["hero.ngsprite"] });
    await page.keyboard.press("Control+KeyS");
    await expect(unsavedMarker(page)).toHaveCount(0);
    const saved = await frameComposites(page);
    const bytes = (await fileSystem(page)).files["hero.ngsprite"]!;
    await page.keyboard.press("Alt+KeyW");
    await expect(emptyState(page)).toBeVisible();

    /** Drops files of these names and bytes on the viewport; returns whether it was taken. */
    const drop = (files: { name: string; bytes: number[] }[]) =>
        page.evaluate((files) => {
            const transfer = new DataTransfer();
            for (const file of files) {
                transfer.items.add(new File([Uint8Array.from(file.bytes)], file.name));
            }
            const target = document.querySelector('[data-region="viewport"]')!;
            const init = { dataTransfer: transfer, bubbles: true, cancelable: true };
            const over = new DragEvent("dragover", init);
            target.dispatchEvent(over);
            const dropped = new DragEvent("drop", init);
            target.dispatchEvent(dropped);
            return over.defaultPrevented && dropped.defaultPrevented;
        }, files);

    expect(await drop([{ name: "sketch.png", bytes: [137, 80, 78, 71] }])).toBe(true);
    await expect(errorToast(page)).toContainText(
        "“sketch.png” is not a sprite project (.ngsprite).",
    );
    await expect(emptyState(page)).toBeVisible();

    expect(await drop([{ name: "hero.ngsprite", bytes }])).toBe(true);
    await expect(documentName(page)).toHaveText("hero");
    expect(await frameComposites(page)).toEqual(saved);
    expect(await activeState(page)).toMatchObject({ undo: 0, dirty: false });
    // Only the toast of the PNG reported an error.
    expect(errors).toEqual([]);
});

test("leaving the page asks first while a document is dirty, and not once it is saved", async ({
    page,
}) => {
    await stubFileSystemAccess(page);
    await openHero(page);
    // Clean: no guard.
    const guarded = () =>
        page.evaluate(() => {
            const event = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        });
    expect(await guarded()).toBe(false);
    // A view toggle does not make the document dirty.
    await page.evaluate(() => window.__ngneTest!.commands.get("view.grid")!.run());
    expect(await guarded()).toBe(false);

    await drawStroke(page, STROKES[0]!);
    expect(await guarded()).toBe(true);
    // The browser asks; staying keeps the page and the document.
    const asked = page.waitForEvent("dialog");
    await page.close({ runBeforeUnload: true });
    const dialog = await asked;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    expect(page.isClosed()).toBe(false);
    expect((await activeState(page))?.dirty).toBe(true);

    await arrangeFiles(page, { nextSave: ["hero.ngsprite"] });
    await page.keyboard.press("Control+KeyS");
    await expect(unsavedMarker(page)).toHaveCount(0);
    expect(await guarded()).toBe(false);
    const dialogs: string[] = [];
    page.on("dialog", (shown) => {
        dialogs.push(shown.type());
        void shown.dismiss();
    });
    const closing = page.waitForEvent("close");
    await page.close({ runBeforeUnload: true });
    await closing;
    expect(dialogs).toEqual([]);
});
