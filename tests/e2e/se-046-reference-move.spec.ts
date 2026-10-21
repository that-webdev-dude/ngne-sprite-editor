import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as SpriteCore from "../../src/core/sprite";
import { collectErrors } from "./se-006-support";
import {
    checkerAt,
    DARK_CHECKER,
    documentRect,
    openDocument,
    openViewportEditor,
    readback,
    settle,
} from "./se-011-support";
import type { Crop, Rgba, TestDocument } from "./se-011-support";
import { overlayPixels, overlaySettled, setGrids } from "./se-013-support";
import { expectFeedback, historyOf, setLayerFlag } from "./se-014-support";
import { docClient, pressToolKey, undo, undoLabel, VIEW } from "./se-033-support";
import { addReference, over, referenceLayers } from "./se-045-support";
import type { Point } from "./se-012-support";

// SE-046: a reference layer moved and scaled on the canvas with the Move tool (SPEC §7.6).
// A drag moves the active reference layer by whole document pixels, shown while it lasts and
// recorded at the release as one undo step; a drag of a corner handle scales it about the
// opposite corner; a locked one does not move and the status bar says so.

const WIDTH = 16;
const HEIGHT = 12;
/** 32 × 16, fitted to the 16 × 12 canvas at 0.5: from (0, 2) to (16, 10). */
const SOURCE = { width: 32, height: 16 };
const RED: Rgba = [200, 40, 40, 255];

async function setUp(page: Page): Promise<{ document: TestDocument; id: string }> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    const id = await addReference(page, { kind: "flat", ...SOURCE, rgba: RED });
    if (!id) throw new Error("se-046: the reference was not added");
    // The reference layer becomes the active one, as a click on its row makes it.
    await page.evaluate((id) => {
        const state = window.__ngneTest!.sessions.getState();
        const active = state.documents.find((entry) => entry.id === state.activeId)!;
        active.session.activeLayerId = id;
        state.touch(active.id);
    }, id);
    await pressToolKey(page, "KeyV", "move");
    await settle(page);
    return { document, id };
}

async function reference(page: Page) {
    const [layer] = await referenceLayers(page);
    if (!layer) throw new Error("se-046: no reference layer");
    return layer;
}

test("a resize during a reference drag keeps the resize geometry after release (F75)", async ({
    page,
}) => {
    for (const operation of ["canvas", "sprite"] as const) {
        const { document } = await setUp(page);
        await pressAndMove(page, { x: 3.5, y: 5.5 }, [{ x: 7.5, y: 7.5 }]);
        await page.evaluate(async (operation) => {
            const path = "/src/core/sprite/index.ts";
            const core = (await import(/* @vite-ignore */ path)) as typeof SpriteCore;
            const state = window.__ngneTest!.sessions.getState();
            const active = state.documents.find((entry) => entry.id === state.activeId)!;
            const command =
                operation === "canvas"
                    ? core.canvasSizeCommand(active.session, {
                          width: 32,
                          height: 24,
                          anchor: { x: 1, y: 1 },
                      })
                    : core.spriteSizeCommand(active.session, {
                          width: 32,
                          height: 24,
                          method: "nearest",
                      });
            active.history.execute(command!);
        }, operation);
        const resized = await reference(page);
        const steps = await historyOf(page, document.id);
        await page.mouse.up();
        await settle(page);
        expect(await reference(page)).toEqual(resized);
        expect(await historyOf(page, document.id)).toEqual(steps);
    }
});

/** Presses at document position `from` and moves through `through`, the button still held. */
async function pressAndMove(page: Page, from: Point, through: readonly Point[]): Promise<void> {
    const start = await docClient(page, from);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const point of through) {
        const client = await docClient(page, point);
        await page.mouse.move(client.x, client.y, { steps: 3 });
    }
}

/** The colour of the device pixel at the centre of texel `tx, ty` of a crop at VIEW's scale. */
function texel(crop: Crop, tx: number, ty: number): number[] {
    const x = tx * VIEW.scale + VIEW.scale / 2;
    const y = ty * VIEW.scale + VIEW.scale / 2;
    const from = (y * crop.width + x) * 4;
    return crop.data.slice(from, from + 3);
}

function near(got: readonly number[], want: readonly number[], tolerance = 2): boolean {
    return want.every((value, channel) => Math.abs((got[channel] ?? -99) - value) <= tolerance);
}

const covered = (tx: number, ty: number) => over(RED, 128 / 255, checkerAt(DARK_CHECKER, tx, ty));

test("a drag by (10, 4) document pixels moves the reference by exactly that, shown while it lasts; one step, undo restores", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document } = await setUp(page);
    const start = await reference(page);
    expect(start).toMatchObject({ x: 0, y: 2, scale: 0.5 });
    const steps = (await historyOf(page, document.id)).undo;
    const rect = documentRect(document, VIEW);

    // Before: texel (2, 3) is covered, (14, 11) is not.
    const before = (await readback(page, rect)).crop;
    expect(near(texel(before, 2, 3), covered(2, 3))).toBe(true);
    expect(near(texel(before, 14, 11), checkerAt(DARK_CHECKER, 14, 11))).toBe(true);

    await pressAndMove(page, { x: 3.5, y: 5.5 }, [
        { x: 8.5, y: 7.5 },
        { x: 13.5, y: 9.5 },
    ]);
    // During the drag the viewport shows the layer at (10, 6) to (26, 14); the document is
    // unchanged until the release.
    await settle(page);
    const during = (await readback(page, rect)).crop;
    expect(near(texel(during, 2, 3), checkerAt(DARK_CHECKER, 2, 3))).toBe(true);
    expect(near(texel(during, 14, 11), covered(14, 11))).toBe(true);
    expect(await reference(page)).toMatchObject({ x: 0, y: 2 });
    await page.mouse.up();

    await expect.poll(async () => (await reference(page)).x).toBe(10);
    expect(await reference(page)).toMatchObject({ x: start.x + 10, y: start.y + 4, scale: 0.5 });
    expect(await historyOf(page, document.id)).toEqual({ undo: steps + 1, open: false });
    expect(await undoLabel(page, document.id)).toBe("Move Reference");
    await settle(page);
    const after = (await readback(page, rect)).crop;
    expect(near(texel(after, 14, 11), covered(14, 11))).toBe(true);

    await undo(page);
    await expect.poll(async () => (await reference(page)).x).toBe(start.x);
    expect(await reference(page)).toMatchObject({ x: start.x, y: start.y, scale: start.scale });
    expect(await historyOf(page, document.id)).toEqual({ undo: steps, open: false });
    expect(errors).toEqual([]);
});

test("a corner drag scales the reference and keeps the opposite corner within 0.01 document pixels; the box shows its corner handles", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document } = await setUp(page);
    const start = await reference(page);
    const steps = (await historyOf(page, document.id)).undo;

    // The south-east handle: a light square about the box's corner (16, 10).
    await overlaySettled(page);
    const se = { x: VIEW.originX + 16 * VIEW.scale + 2, y: VIEW.originY + 10 * VIEW.scale + 2 };
    expect(await overlayPixels(page, [se])).toEqual([[255, 255, 255, 255]]);

    // The north-west corner (0, 2), dragged out to (-3, 0.5); the south-east one stays.
    await pressAndMove(page, { x: 0, y: 2 }, [
        { x: -1.5, y: 1.25 },
        { x: -3, y: 0.5 },
    ]);
    await page.mouse.up();
    await expect.poll(async () => (await reference(page)).scale).not.toBe(start.scale);
    const after = await reference(page);
    expect(after.scale).toBeGreaterThan(start.scale);
    expect(Math.abs(after.x + SOURCE.width * after.scale - 16)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(after.y + SOURCE.height * after.scale - 10)).toBeLessThanOrEqual(0.01);
    // 3 px on 16 and 1.5 on 8: the factor is 19 / 16.
    expect(after.scale).toBeCloseTo((0.5 * 19) / 16, 6);
    expect(await historyOf(page, document.id)).toEqual({ undo: steps + 1, open: false });
    expect(await undoLabel(page, document.id)).toBe("Scale Reference");

    await undo(page);
    await expect.poll(async () => (await reference(page)).scale).toBe(start.scale);
    expect(await reference(page)).toMatchObject({ x: start.x, y: start.y });
    expect(errors).toEqual([]);
});

test("a locked reference layer does not move, the status bar says so, and its box has no handles", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document } = await setUp(page);
    await setLayerFlag(page, document.id, "locked", true);
    const start = await reference(page);
    expect(start.locked).toBe(true);
    const steps = (await historyOf(page, document.id)).undo;

    await overlaySettled(page);
    const se = { x: VIEW.originX + 16 * VIEW.scale + 2, y: VIEW.originY + 10 * VIEW.scale + 2 };
    expect(await overlayPixels(page, [se])).not.toEqual([[255, 255, 255, 255]]);

    for (const from of [
        { x: 3.5, y: 5.5 },
        { x: 16, y: 10 },
    ]) {
        await pressAndMove(page, from, [{ x: from.x + 4, y: from.y + 2 }]);
        await page.mouse.up();
        await expectFeedback(page, "Layer is locked");
        expect(await reference(page)).toEqual(start);
        expect(await historyOf(page, document.id)).toEqual({ undo: steps, open: false });
    }
    expect(errors).toEqual([]);
});

test("Escape during a drag shows the reference where it was and records nothing", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document } = await setUp(page);
    const start = await reference(page);
    const steps = (await historyOf(page, document.id)).undo;
    const rect = documentRect(document, VIEW);

    await pressAndMove(page, { x: 3.5, y: 5.5 }, [{ x: 13.5, y: 9.5 }]);
    await settle(page);
    expect(near(texel((await readback(page, rect)).crop, 14, 11), covered(14, 11))).toBe(true);
    await page.keyboard.press("Escape");
    await expect
        .poll(async () =>
            near(texel((await readback(page, rect)).crop, 14, 11), checkerAt(DARK_CHECKER, 14, 11)),
        )
        .toBe(true);
    await page.mouse.up();
    expect(await reference(page)).toEqual(start);
    expect(await historyOf(page, document.id)).toEqual({ undo: steps, open: false });
    expect(errors).toEqual([]);
});
