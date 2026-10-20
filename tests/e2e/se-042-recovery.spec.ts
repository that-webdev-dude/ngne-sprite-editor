import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openEditor } from "./se-007-support";
import { settle } from "./se-011-support";
import { viewportArea } from "./se-012-support";
import { setColours } from "./se-015-support";
import {
    activeState,
    addEmptyFrame,
    arrangeFiles,
    discardDialog,
    documentName,
    drawStroke,
    errorToast,
    frameComposites,
    infoToast,
    openHero,
    stubFileSystemAccess,
    unsavedMarker,
} from "./se-041-support";
import {
    acceptUnload,
    autosaveContents,
    clearImagePuts,
    dialogFocused,
    expectNoSnapshot,
    imagePuts,
    openFramesDocument,
    recoveryDialog,
    recoveryEntry,
    recoveryOffered,
    reloadEditor,
    spyOnImageWrites,
    waitForLockReleased,
    waitForSnapshot,
} from "./se-042-support";

// SE-042: autosave and crash recovery as the user meets them (SPEC §10, DESIGN §7 Recovery):
// a document drawn and left unsaved comes back after a reload, byte for byte; a saved one
// leaves nothing to recover; a one-cel edit writes one image record; Discard removes a
// snapshot for good; a snapshot of a page open in another tab is not offered.

const BLACK = 0x000000ff;
const WHITE = 0xffffffff;

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
];

/** Draws a stroke on each of two frames; the second is active afterwards. */
async function drawTwoFrames(page: Page): Promise<void> {
    await drawStroke(page, STROKES[0]!);
    await addEmptyFrame(page);
    await drawStroke(page, STROKES[1]!);
}

test("draw, wait 3 s, reload without saving: the recovery prompt brings the document back with every frame's composite byte-identical", async ({
    page,
}) => {
    const errors = collectErrors(page);
    acceptUnload(page);
    await openHero(page);
    expect(await recoveryOffered(page)).toBe(0);
    await drawTwoFrames(page);
    const before = await frameComposites(page);
    for (const composite of before) expect(composite.some((value) => value !== 0)).toBe(true);
    await page.waitForTimeout(3000);
    const snapshot = await waitForSnapshot(page);
    expect(snapshot).toMatchObject({ name: "hero" });
    expect(snapshot.imageIds).toHaveLength(2);

    expect(await reloadEditor(page)).toBe(1);
    const dialog = recoveryDialog(page);
    await expect(dialog).toBeVisible();
    await dialogFocused(dialog);
    // Name, time and thumbnail (the first frame's composite, 16 × 12).
    const entry = recoveryEntry(page, "hero");
    await expect(entry).toContainText("hero");
    await expect(entry.locator("time")).toHaveAttribute(
        "datetime",
        new Date(snapshot.savedAt).toISOString(),
    );
    const thumbnail = entry.locator("[data-recovery-thumbnail]");
    await expect(thumbnail).toHaveAttribute("width", "16");
    await expect(thumbnail).toHaveAttribute("height", "12");
    expect(
        await thumbnail.evaluate((canvas: HTMLCanvasElement) =>
            Array.from(canvas.getContext("2d")!.getImageData(0, 0, 16, 12).data),
        ),
    ).toEqual(before[0]);

    await entry.getByRole("button", { name: "Recover" }).click();
    await expect(dialog).toBeHidden();
    await expect(documentName(page)).toHaveText("hero");
    await expect(infoToast(page, "Recovered hero")).toBeVisible();
    expect(await frameComposites(page)).toEqual(before);
    // An empty history, and unsaved until it is saved: its file does not hold these changes.
    expect(await activeState(page)).toMatchObject({ frames: 2, undo: 0, redo: 0, dirty: true });
    await expect(unsavedMarker(page)).toBeVisible();
    // The snapshot is this page's now: it is kept, under the same key.
    const kept = await waitForSnapshot(page, (each) => each.key === snapshot.key);
    expect(kept.owner).not.toBe(snapshot.owner);
    expect(errors).toEqual([]);
});

test("after a normal save and reload, no recovery prompt appears", async ({ page }) => {
    const errors = collectErrors(page);
    acceptUnload(page);
    await stubFileSystemAccess(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await waitForSnapshot(page);

    await arrangeFiles(page, { nextSave: ["hero.ngsprite"] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved hero.ngsprite")).toBeVisible();
    await expect(unsavedMarker(page)).toHaveCount(0);
    // The save removed the snapshot, its images with it.
    await expectNoSnapshot(page);

    expect(await reloadEditor(page)).toBe(0);
    await expect(recoveryDialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("editing one cel of a 16-frame, 256×256 document writes exactly one image record", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await spyOnImageWrites(page);
    await openEditor(page);
    const { imageIds } = await openFramesDocument(page, 256, 16);
    await setColours(page, BLACK, WHITE);

    // The first change makes the document dirty: its first snapshot holds all 16 images.
    await drawStroke(page, STROKES[0]!);
    const first = await waitForSnapshot(page);
    expect([...first.imageIds].sort()).toEqual([...imageIds].sort());
    expect([...(await imagePuts(page))].sort()).toEqual([...imageIds].sort());

    // One cel of another frame edited: that frame's image record written, and no other.
    for (let step = 0; step < 5; step++) {
        await page.evaluate(() => window.__ngneTest!.commands.get("frame.next")!.run());
    }
    await expect
        .poll(() =>
            page.evaluate(() => {
                const state = window.__ngneTest!.sessions.getState();
                return state.documents.find((entry) => entry.id === state.activeId)!.session
                    .activeFrameId;
            }),
        )
        .toBe("big-frame-5");
    await settle(page);
    await clearImagePuts(page);
    await drawStroke(page, STROKES[1]!);
    await waitForSnapshot(page, (snapshot) => snapshot.savedAt > first.savedAt);
    expect(await imagePuts(page)).toEqual([imageIds[5]]);
    expect((await autosaveContents(page)).images).toBe(16);
    expect(errors).toEqual([]);
});

test("Discard asks once in its row and removes the snapshot permanently", async ({ page }) => {
    const errors = collectErrors(page);
    acceptUnload(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await waitForSnapshot(page);

    expect(await reloadEditor(page)).toBe(1);
    const dialog = recoveryDialog(page);
    await expect(dialog).toBeVisible();
    await dialogFocused(dialog);
    const entry = recoveryEntry(page, "hero");
    await entry.getByRole("button", { name: "Discard" }).click();
    // Asked in the row, its Cancel focused: Cancel keeps it, Recover focused again.
    await expect(entry).toContainText("Discard permanently?");
    await expect(entry.getByRole("button", { name: "Cancel" })).toBeFocused();
    await entry.getByRole("button", { name: "Cancel" }).click();
    await expect(entry.getByRole("button", { name: "Recover" })).toBeFocused();
    expect((await autosaveContents(page)).snapshots).toHaveLength(1);

    await entry.getByRole("button", { name: "Discard" }).click();
    await expect(entry).toContainText("Discard permanently?");
    await entry.getByRole("button", { name: "Discard" }).click();
    // The last entry gone, the dialog closes; nothing of the snapshot is left.
    await expect(dialog).toBeHidden();
    await expectNoSnapshot(page);
    await expect(documentName(page)).toHaveCount(0);

    expect(await reloadEditor(page)).toBe(0);
    await expect(recoveryDialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("closing a dirty document without saving removes its snapshot", async ({ page }) => {
    const errors = collectErrors(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    await waitForSnapshot(page);
    await page.keyboard.press("Alt+KeyW");
    const question = discardDialog(page);
    await expect(question).toBeVisible();
    await question.getByRole("button", { name: "Discard" }).click();
    await expect(documentName(page)).toHaveCount(0);
    await expectNoSnapshot(page);
    expect(errors).toEqual([]);
});

test("a snapshot of a page still open in another tab is not offered; once that page is gone, it is", async ({
    context,
    page,
}) => {
    const errors = collectErrors(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    const snapshot = await waitForSnapshot(page);

    const other = await context.newPage();
    acceptUnload(other);
    await openEditor(other);
    expect(await recoveryOffered(other)).toBe(0);
    await expect(recoveryDialog(other)).toHaveCount(0);

    await page.close({ runBeforeUnload: false });
    await waitForLockReleased(other, snapshot.owner);
    expect(await reloadEditor(other)).toBe(1);
    await expect(recoveryEntry(other, "hero")).toBeVisible();
    expect(errors).toEqual([]);
});

test("two tabs offering one snapshot: the second to Recover is told it is open in another tab and opens nothing", async ({
    context,
    page,
}) => {
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    const snapshot = await waitForSnapshot(page);
    // The page goes as in a crash; the browser restores two tabs of the editor.
    await page.close({ runBeforeUnload: false });
    const first = await context.newPage();
    const second = await context.newPage();
    const errors = [collectErrors(first), collectErrors(second)];
    for (const tab of [first, second]) acceptUnload(tab);
    // Web Locks are asked from a page of the editor's origin that runs no editor.
    await first.goto("/tests/e2e/harness/smoke.html");
    await waitForLockReleased(first, snapshot.owner);
    await openEditor(first);
    await openEditor(second);
    expect(await recoveryOffered(first)).toBe(1);
    expect(await recoveryOffered(second)).toBe(1);

    await recoveryEntry(first, "hero").getByRole("button", { name: "Recover" }).click();
    await expect(recoveryDialog(first)).toBeHidden();
    await expect(documentName(first)).toHaveText("hero");

    await recoveryEntry(second, "hero").getByRole("button", { name: "Recover" }).click();
    await expect(errorToast(second)).toHaveText(/“hero” is open in another tab\./);
    // Its row went, and with it the dialog; nothing opened.
    await expect(recoveryDialog(second)).toBeHidden();
    await expect(documentName(second)).toHaveCount(0);
    // The snapshot is the first tab's, whole.
    const contents = await autosaveContents(second);
    expect(contents.snapshots).toHaveLength(1);
    expect(contents.snapshots[0]!.key).toBe(snapshot.key);
    expect(contents.snapshots[0]!.owner).not.toBe(snapshot.owner);
    expect(contents.images).toBe(1);
    expect(errors).toEqual([[], []]);
});

test("a selection left floating is kept where it floats, on a saved document too: a reload recovers it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    acceptUnload(page);
    await stubFileSystemAccess(page);
    await openHero(page);
    await drawStroke(page, STROKES[0]!);
    // Everything selected (a step of its own), then saved: clean, with a selection.
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Control+KeyA");
    await expect.poll(async () => (await activeState(page))?.undo).toBe(2);
    await arrangeFiles(page, { nextSave: ["hero.ngsprite"] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved hero.ngsprite")).toBeVisible();
    await expectNoSnapshot(page);
    const saved = await frameComposites(page);

    // Lifted and nudged two pixels right: it floats, the history is idle and the document clean.
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect
        .poll(() => page.evaluate(() => window.__ngneTest!.keyContexts.getState().floating))
        .toBe(true);
    const floated = await frameComposites(page);
    expect(floated).not.toEqual(saved);
    expect(await activeState(page)).toMatchObject({ undo: 2, dirty: false });
    await page.waitForTimeout(3000);
    await waitForSnapshot(page);

    expect(await reloadEditor(page)).toBe(1);
    const dialog = recoveryDialog(page);
    await expect(dialog).toBeVisible();
    await dialogFocused(dialog);
    await recoveryEntry(page, "hero").getByRole("button", { name: "Recover" }).click();
    await expect(dialog).toBeHidden();
    expect(await frameComposites(page)).toEqual(floated);
    expect(errors).toEqual([]);
});
