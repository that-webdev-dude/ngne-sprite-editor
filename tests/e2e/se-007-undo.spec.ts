import { expect, test } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { addTextField, openEditor, openSession, rename, snapshot } from "./se-007-support";

// SE-007: undo and redo from the keyboard in the real app, on a test command executed through
// the active session's history.

test("Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z undo and redo a test command", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const id = await openSession(page, { name: "start", width: 8, height: 8 });
    await rename(page, id, "first", "Pencil");
    await rename(page, id, "second", "Eraser");
    expect(await snapshot(page, id)).toMatchObject({ name: "second", undoLabel: "Eraser" });

    await page.keyboard.press("Control+KeyZ");
    expect(await snapshot(page, id)).toMatchObject({
        name: "first",
        undoLabel: "Pencil",
        redoLabel: "Eraser",
    });
    await page.keyboard.press("Control+KeyZ");
    expect(await snapshot(page, id)).toMatchObject({ name: "start", canUndo: false });
    // Nothing left to undo: the key does nothing and nothing fails.
    await page.keyboard.press("Control+KeyZ");
    expect(await snapshot(page, id)).toMatchObject({ name: "start", canUndo: false });

    await page.keyboard.press("Control+KeyY");
    expect(await snapshot(page, id)).toMatchObject({ name: "first", redoLabel: "Eraser" });
    await page.keyboard.press("Control+Shift+KeyZ");
    expect(await snapshot(page, id)).toMatchObject({ name: "second", canRedo: false });
    await page.keyboard.press("Control+KeyY");
    await page.keyboard.press("Control+Shift+KeyZ");
    expect(await snapshot(page, id)).toMatchObject({ name: "second", canRedo: false });

    // Both redo chords after one undo each.
    await page.keyboard.press("Control+KeyZ");
    await page.keyboard.press("Control+Shift+KeyZ");
    expect((await snapshot(page, id)).name).toBe("second");
    await page.keyboard.press("Control+KeyZ");
    await page.keyboard.press("Control+KeyY");
    expect((await snapshot(page, id)).name).toBe("second");

    await page.evaluate(() => window.__ngneTest!.assertInvariants());
    expect(errors).toEqual([]);
});

test('typing "z" in a text field does not undo, and neither does Ctrl+Z there', async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const id = await openSession(page, { name: "start", width: 8, height: 8 });
    await rename(page, id, "first", "Pencil");
    const before = await snapshot(page, id);

    const field = await addTextField(page, "context-bar");
    await field.click();
    await page.keyboard.press("KeyZ");
    await page.keyboard.press("Shift+KeyZ");
    await expect(field).toHaveValue("zZ");
    expect(await snapshot(page, id)).toEqual(before);

    // Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z belong to the field: they undo and redo its typing.
    await page.keyboard.press("Control+KeyZ");
    await expect(field).not.toHaveValue("zZ");
    expect(await snapshot(page, id)).toEqual(before);
    await page.keyboard.press("Control+KeyY");
    await expect(field).toHaveValue("zZ");
    await page.keyboard.press("Control+KeyZ");
    await page.keyboard.press("Control+Shift+KeyZ");
    await expect(field).toHaveValue("zZ");
    expect(await snapshot(page, id)).toEqual(before);

    // Outside the field the same keys act on the document again.
    await field.blur();
    await page.keyboard.press("KeyZ");
    await expect(field).toHaveValue("zZ");
    expect(await snapshot(page, id)).toEqual(before);
    await page.keyboard.press("Control+KeyZ");
    expect(await snapshot(page, id)).toMatchObject({ name: "start", canUndo: false });
    await expect(field).toHaveValue("zZ");
    await page.keyboard.press("Control+KeyY");
    expect((await snapshot(page, id)).name).toBe("first");
    expect(errors).toEqual([]);
});

test("undo keys do nothing without a document or while a stroke is open", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await page.keyboard.press("Control+KeyZ");
    await page.keyboard.press("Control+KeyY");

    const id = await openSession(page, { name: "start", width: 8, height: 8 });
    await rename(page, id, "first", "Pencil");
    // An open transaction: the history would throw on undo.
    await page.evaluate(() => {
        const [document] = window.__ngneTest!.sessions.getState().documents;
        if (!document) throw new Error("no document");
        const { activeLayerId: layerId, activeFrameId: frameId } = document.session;
        document.history.begin({ layerId, frameId });
    });
    await page.keyboard.press("Control+KeyZ");
    expect((await snapshot(page, id)).name).toBe("first");

    await page.evaluate(() => {
        window.__ngneTest!.sessions.getState().documents[0]?.history.transaction?.abort();
    });
    await page.keyboard.press("Control+KeyZ");
    expect((await snapshot(page, id)).name).toBe("start");
    // No error toast and nothing on the console.
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
});
