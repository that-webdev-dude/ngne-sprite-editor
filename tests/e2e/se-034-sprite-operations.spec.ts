import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as SelectionModule from "../../src/core/selection";
import { region } from "./se-006-support";
import { closeMenu, menuItem, openEditor, openMenu, openSession } from "./se-007-support";
import { dialogButton, field, group, openProperties, setNumber } from "./se-008-support";

// SE-034: the sprite operations of SPEC §7.7 from the Sprite menu, the Canvas size and Sprite
// size dialogs (DESIGN §7), and the pivot fields that keep four decimals.

const canvasSizeDialog = (page: Page) => page.getByRole("dialog", { name: "Canvas size" });
const spriteSizeDialog = (page: Page) => page.getByRole("dialog", { name: "Sprite size" });
const anchor = (dialog: Locator, name: string) =>
    dialog.getByRole("radiogroup", { name: "Anchor" }).getByRole("radio", { name, exact: true });

/** What a spec reads of the active document. */
function documentState(page: Page) {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) throw new Error("No document is open");
        const { doc, selection } = document.session;
        window.__ngneTest!.assertInvariants();
        return {
            width: doc.width,
            height: doc.height,
            pivot: { ...doc.pivot },
            selection: selection && { ...selection.bounds },
            undoCount: document.history.undoCount,
            undoLabel: document.history.undoLabel,
        };
    });
}

/** Puts an opaque pixel at (x, y) of the active cel, outside the history. */
function paintPixel(page: Page, x: number, y: number) {
    return page.evaluate(
        ({ x, y }) => {
            const hooks = window.__ngneTest!;
            const state = hooks.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId);
            if (!document) throw new Error("No document is open");
            const transaction = document.history.begin({
                layerId: document.session.activeLayerId,
                frameId: document.session.activeFrameId,
            });
            transaction.image.data.set([255, 0, 0, 255], (y * transaction.image.width + x) * 4);
            transaction.markDirty({ x, y, width: 1, height: 1 });
            transaction.commit("Paint");
        },
        { x, y },
    );
}

/** The opaque pixels of the active cel, as "x,y". */
function opaquePixels(page: Page) {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) throw new Error("No document is open");
        const { doc, activeLayerId, activeFrameId } = document.session;
        const cel = doc.cels.get(`${activeLayerId}:${activeFrameId}`);
        const image = cel && doc.images.get(cel.imageId);
        if (!image) return [];
        const found: string[] = [];
        for (let i = 3; i < image.data.length; i += 4) {
            if (image.data[i] !== 0) {
                const pixel = (i - 3) / 4;
                found.push(`${pixel % image.width},${Math.floor(pixel / image.width)}`);
            }
        }
        return found;
    });
}

async function runFromSpriteMenu(page: Page, commandId: string): Promise<void> {
    await openMenu(page, "Sprite");
    await menuItem(page, commandId).click();
}

function uncaughtErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
}

test("Canvas Size: 32→48 anchored centre moves content by (8, 8); undo restores the canvas", async ({
    page,
}) => {
    const uncaught = uncaughtErrors(page);
    await openEditor(page);
    await openSession(page, { name: "hero", width: 32, height: 32 });
    await paintPixel(page, 0, 0);

    await runFromSpriteMenu(page, "sprite.canvasSize");
    const dialog = canvasSizeDialog(page);
    await expect(dialog).toBeVisible();
    await expect(field(dialog, "Width")).toHaveValue("32");
    await expect(field(dialog, "Height")).toHaveValue("32");
    await expect(anchor(dialog, "Centre")).toBeChecked();

    await setNumber(field(dialog, "Width"), 48);
    await setNumber(field(dialog, "Height"), 48);
    await dialogButton(dialog, "OK").click();
    await expect(dialog).toBeHidden();
    expect(await documentState(page)).toMatchObject({
        width: 48,
        height: 48,
        undoLabel: "Canvas Size",
    });
    expect(await opaquePixels(page)).toEqual(["8,8"]);

    await region(page, "viewport").getByRole("application", { name: "Canvas" }).focus();
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await documentState(page)).width).toBe(32);
    expect(await opaquePixels(page)).toEqual(["0,0"]);
    expect(uncaught).toEqual([]);
});

test("Canvas Size: the anchor places the old canvas; a side outside 1..1024 is refused with a message", async ({
    page,
}) => {
    await openEditor(page);
    await openSession(page, { name: "hero", width: 32, height: 32 });
    await paintPixel(page, 0, 0);

    await runFromSpriteMenu(page, "sprite.canvasSize");
    const dialog = canvasSizeDialog(page);
    await expect(dialog).toBeVisible();
    await setNumber(field(dialog, "Width"), 0);
    await expect(dialog.getByRole("alert")).toHaveText("Width must be from 1 to 1024 px.");
    await expect(dialogButton(dialog, "OK")).toBeDisabled();
    await setNumber(field(dialog, "Width"), 40);
    await setNumber(field(dialog, "Height"), 36);
    await expect(dialog.getByRole("alert")).toHaveText("");
    await anchor(dialog, "Bottom right").click();
    await expect(anchor(dialog, "Bottom right")).toBeChecked();
    await dialogButton(dialog, "OK").click();
    await expect(dialog).toBeHidden();
    expect(await documentState(page)).toMatchObject({ width: 40, height: 36 });
    expect(await opaquePixels(page)).toEqual(["8,4"]);

    // Cancel changes nothing.
    await runFromSpriteMenu(page, "sprite.canvasSize");
    await expect(dialog).toBeVisible();
    await dialogButton(dialog, "Cancel").click();
    await expect(dialog).toBeHidden();
    expect(await documentState(page)).toMatchObject({ width: 40, height: 36, undoCount: 2 });
});

test("Sprite Size: the aspect lock follows the other side; resampling and size are applied as one step", async ({
    page,
}) => {
    await openEditor(page);
    await openSession(page, { name: "hero", width: 32, height: 16 });
    await paintPixel(page, 1, 1);

    await runFromSpriteMenu(page, "sprite.spriteSize");
    const dialog = spriteSizeDialog(page);
    await expect(dialog).toBeVisible();
    const lock = dialog.getByRole("button", { name: "Keep aspect ratio" });
    await expect(lock).toHaveAttribute("aria-pressed", "true");
    await expect(
        dialog
            .getByRole("radiogroup", { name: "Resampling" })
            .getByRole("radio", { checked: true }),
    ).toHaveText("Nearest");

    await setNumber(field(dialog, "Width"), 64);
    await expect(field(dialog, "Height")).toHaveValue("32");
    await lock.click();
    await expect(lock).toHaveAttribute("aria-pressed", "false");
    await setNumber(field(dialog, "Height"), 48);
    await expect(field(dialog, "Width")).toHaveValue("64");
    await dialogButton(dialog, "OK").click();
    await expect(dialog).toBeHidden();
    expect(await documentState(page)).toMatchObject({
        width: 64,
        height: 48,
        undoLabel: "Sprite Size",
    });
    // Pixel (1, 1) of 32 × 16 covers x 2..3 and y 3..5 of 64 × 48.
    expect(await opaquePixels(page)).toEqual(["2,3", "3,3", "2,4", "3,4", "2,5", "3,5"]);
});

test("Crop to Selection needs a selection; crop, trim, rotate and flip are single steps that clear the selection", async ({
    page,
}) => {
    const uncaught = uncaughtErrors(page);
    await openEditor(page);
    await openSession(page, { name: "hero", width: 32, height: 32 });
    await paintPixel(page, 10, 12);
    await paintPixel(page, 13, 20);

    await openMenu(page, "Sprite");
    await expect(menuItem(page, "sprite.crop")).toHaveAttribute("aria-disabled", "true");
    await closeMenu(page);

    // A selection of (8, 10, 12, 16), made through the history.
    await page.evaluate(async () => {
        const path = "/src/core/selection/index.ts";
        const selection = (await import(/* @vite-ignore */ path)) as typeof SelectionModule;
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) throw new Error("No document is open");
        const mask = selection.rectMask(32, 32, { x: 8, y: 10, width: 12, height: 16 });
        const command = selection.setSelectionCommand(
            document.session,
            selection.selectionOf(mask),
            "Select",
        );
        if (command) document.history.execute(command);
    });
    await runFromSpriteMenu(page, "sprite.crop");
    await expect.poll(async () => (await documentState(page)).width).toBe(12);
    expect(await documentState(page)).toMatchObject({
        width: 12,
        height: 16,
        selection: null,
        undoLabel: "Crop to Selection",
    });
    expect(await opaquePixels(page)).toEqual(["2,2", "5,10"]);

    await runFromSpriteMenu(page, "sprite.trim");
    await expect.poll(async () => (await documentState(page)).width).toBe(4);
    expect(await documentState(page)).toMatchObject({ width: 4, height: 9, undoLabel: "Trim" });

    await runFromSpriteMenu(page, "sprite.rotate90");
    await expect.poll(async () => (await documentState(page)).width).toBe(9);
    await runFromSpriteMenu(page, "sprite.flipHorizontal");
    await expect
        .poll(async () => (await documentState(page)).undoLabel)
        .toBe("Flip Canvas Horizontal");
    await runFromSpriteMenu(page, "sprite.rotate180");
    await runFromSpriteMenu(page, "sprite.flipVertical");
    await expect
        .poll(async () => (await documentState(page)).undoLabel)
        .toBe("Flip Canvas Vertical");
    // Trim left (0, 0) and (3, 8) on 4 × 9; turned, mirrored, turned and mirrored on 9 × 4.
    expect(await opaquePixels(page)).toEqual(["8,0", "0,3"]);

    // Undo goes back step by step to the selection the crop cleared.
    await region(page, "viewport").getByRole("application", { name: "Canvas" }).focus();
    for (let step = 0; step < 6; step++) await page.keyboard.press("Control+z");
    await expect
        .poll(async () => (await documentState(page)).selection)
        .toEqual({ x: 8, y: 10, width: 12, height: 16 });
    expect(await documentState(page)).toMatchObject({ width: 32, height: 32 });
    expect(uncaught).toEqual([]);
});

test("typing 0.9688 into a pivot field stores 0.9688; arrow keys still step by 0.01", async ({
    page,
}) => {
    await openEditor(page);
    await openSession(page, { name: "hero", width: 32, height: 32 });
    const dialog = await openProperties(page);
    const pivotX = field(group(dialog, "Pivot"), "X");
    const pivotY = field(group(dialog, "Pivot"), "Y");
    await expect(pivotX).toHaveValue("0.50");

    await setNumber(pivotX, "0.9688");
    await expect(pivotX).toHaveValue("0.9688");
    await setNumber(pivotY, "0.12346");
    await expect(pivotY).toHaveValue("0.1235");
    await pivotY.focus();
    await page.keyboard.press("ArrowUp");
    await expect(pivotY).toHaveValue("0.1335");
    await dialogButton(dialog, "OK").click();
    await expect(dialog).toBeHidden();
    expect((await documentState(page)).pivot).toEqual({ x: 0.9688, y: 0.1335 });

    // The dialog opens with the four decimals.
    const again = await openProperties(page);
    await expect(field(group(again, "Pivot"), "X")).toHaveValue("0.9688");
    await dialogButton(again, "Cancel").click();
    await expect(again).toBeHidden();
});

test("a document whose pixel memory passes 512 MB shows the warning once", async ({ page }) => {
    await openEditor(page);
    const id = await openSession(page, { name: "huge", width: 1024, height: 1024 });
    // 129 hidden layers with a cel each: 129 × 4 MiB = 516 MiB. Hidden, so no composite
    // reads them; the buffers are zeros the system need not back until they are written.
    await page.evaluate((id) => {
        const hooks = window.__ngneTest!;
        const document = hooks.sessions.getState().documents.find((entry) => entry.id === id);
        if (!document) throw new Error("No document is open");
        const { doc, activeFrameId } = document.session;
        const base = doc.layers[0];
        for (let index = 0; index < 129; index++) {
            const layerId = `big-${index}`;
            doc.layers.push({ ...base, id: layerId, name: `Big ${index}`, visible: false });
            doc.images.set(`image-${index}`, {
                width: 1024,
                height: 1024,
                data: new Uint8ClampedArray(1024 * 1024 * 4),
            });
            doc.cels.set(`${layerId}:${activeFrameId}`, {
                imageId: `image-${index}`,
                opacity: 255,
            });
        }
        hooks.sessions.getState().touch(id);
    }, id);
    const message =
        "“huge” uses 516 MB of pixel memory. Operations that would pass 1024 MB are refused.";
    const toasts = page.getByRole("region", { name: "Notifications" }).getByRole("status");
    await expect(toasts).toHaveText([message]);

    // Gone after its 4 s, it does not come back with the next change.
    await expect(toasts).toHaveCount(0, { timeout: 10_000 });
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().touch(id), id);
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(toasts).toHaveCount(0);
});
