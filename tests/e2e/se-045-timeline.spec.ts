import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { encode } from "fast-png";
// The page imports this module from the dev server; here it is needed for its type.
import type * as CoreFrames from "../../src/core/frames";
import { collectErrors } from "./se-006-support";
import { menuItem, openMenu } from "./se-007-support";
import { openDocument, openViewportEditor, settle } from "./se-011-support";
import {
    activeCell,
    frameHeader,
    grid,
    layerHeader,
    propertiesPopover,
    runCommands,
    scroller,
    timeline,
} from "./se-022-support";
import { errorToast } from "./se-041-support";
import { addReference, changeReference, historyState, referenceLayers } from "./se-045-support";

// SE-045: reference layers in the timeline (DESIGN §5.6) and the Layer menu: the Reference group
// under the pixel layers with each layer's visibility, lock and opacity; the layer properties
// popover with X, Y, scale and placement; New Reference Layer from File… and its limit of four.
// Every change is one undo step.

const RED = [200, 40, 40, 255];

/** The Reference group of the timeline. */
const referenceGroup = (page: Page) => grid(page).getByRole("rowgroup", { name: "Reference" });
/** The row of a reference layer, by its name. */
const referenceRow = (page: Page, name: string) =>
    referenceGroup(page)
        .getByRole("row")
        .filter({ has: page.getByRole("rowheader", { name, exact: true }) });

async function open(page: Page) {
    await openViewportEditor(page);
    const document = await openDocument(
        page,
        { width: 16, height: 16 },
        { scale: 4, originX: 8, originY: 8 },
    );
    await settle(page);
    return document;
}

/** A PNG file of `width` × `height` pixels of one colour, as bytes. */
function pngFile(width: number, height: number, rgba: readonly number[]): Buffer {
    const data = new Uint8Array(width * height * 4);
    for (let at = 0; at < data.length; at += 4) data.set(rgba, at);
    return Buffer.from(encode({ width, height, data, depth: 8, channels: 4 }));
}

/** Waits for the focus to settle inside a Radix surface that just opened. */
async function focusInside(surface: ReturnType<typeof propertiesPopover>) {
    await expect
        .poll(() => surface.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
}

test("the Reference group lists reference layers under the pixel layers, with visibility, lock and opacity, each one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    await addReference(page, { kind: "flat", width: 8, height: 8, rgba: RED }, { name: "Sketch" });
    const row = referenceRow(page, "Sketch");
    await expect(row).toBeVisible();
    // Under every pixel layer's row.
    const order = await grid(page).evaluate((element) =>
        [...element.querySelectorAll('[role="row"][data-layer]')].map((entry) =>
            entry.hasAttribute("data-reference-layer"),
        ),
    );
    expect(order.indexOf(true)).toBe(order.length - 1);
    expect(order.filter((reference) => !reference).length).toBeGreaterThan(0);
    await expect(row.getByRole("gridcell")).toHaveAccessibleName("Reference layer, behind");

    let steps = (await historyState(page)).undo;
    await row.getByRole("button", { name: "Visible" }).click();
    await expect.poll(async () => (await referenceLayers(page))[0]?.visible).toBe(false);
    expect((await historyState(page)).undo).toBe(++steps);
    await row.getByRole("button", { name: "Locked" }).click();
    await expect.poll(async () => (await referenceLayers(page))[0]?.locked).toBe(true);
    expect((await historyState(page)).undo).toBe(steps + 1);
    await expect(row.getByRole("button", { name: "Opacity 128" })).toBeVisible();
    expect(errors).toEqual([]);
});

test("the layer properties popover of a reference layer sets X, Y, scale and placement in one undo step, and Reset to Fit fits it again", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    await addReference(page, { kind: "flat", width: 8, height: 4, rgba: RED }, { name: "Sketch" });
    // 8 × 4 on 16 × 16: scale 2, centred at y = 4.
    expect(await referenceLayers(page)).toMatchObject([{ x: 0, y: 4, scale: 2 }]);
    const steps = (await historyState(page)).undo;

    await referenceRow(page, "Sketch").getByRole("button", { name: "Opacity 128" }).click();
    const popover = propertiesPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    const field = (name: string) => popover.getByRole("spinbutton", { name, exact: true });
    await expect(field("X")).toHaveValue("0");
    await expect(field("Scale")).toHaveValue("200");
    await field("X").fill("3");
    await field("X").press("Tab");
    await field("Y").fill("-2.5");
    await field("Y").press("Tab");
    await field("Scale").fill("50");
    await field("Scale").press("Tab");
    await popover.getByRole("radio", { name: "In front" }).click();
    await expect(popover.getByRole("radio", { name: "In front" })).toBeChecked();
    // Nothing changes while the popover is open.
    expect(await referenceLayers(page)).toMatchObject([{ x: 0, y: 4, scale: 2 }]);
    await field("X").focus();
    await page.keyboard.press("Enter");
    await expect(popover).toBeHidden();
    expect(await referenceLayers(page)).toMatchObject([
        { x: 3, y: -2.5, scale: 0.5, placement: "front" },
    ]);
    expect((await historyState(page)).undo).toBe(steps + 1);

    // Reset to Fit puts the fitted values in the fields; the popover applies them.
    await referenceRow(page, "Sketch").getByRole("button", { name: "Opacity 128" }).click();
    await expect(popover).toBeVisible();
    await focusInside(popover);
    await popover.getByRole("button", { name: "Reset to Fit" }).click();
    await expect(field("Scale")).toHaveValue("200");
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    expect(await referenceLayers(page)).toMatchObject([
        { x: 0, y: 4, scale: 2, placement: "front" },
    ]);
    expect((await historyState(page)).undo).toBe(steps + 2);

    // One undo returns the popover's first edit whole.
    await runCommands(page, ["edit.undo"]);
    expect(await referenceLayers(page)).toMatchObject([
        { x: 3, y: -2.5, scale: 0.5, placement: "front" },
    ]);
    expect(errors).toEqual([]);
});

test("reference commands of the Layer menu: placement, reset to fit, delete — each one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    const id = await addReference(page, { kind: "flat", width: 8, height: 8, rgba: RED });
    // A press on the row's cell makes the reference layer active; its cell is the tab stop.
    await grid(page).locator(`[data-layer="${id}"] [role="gridcell"]`).click();
    await expect(activeCell(page)).toHaveAccessibleName("Reference layer, behind");
    await expect(activeCell(page)).toBeFocused();
    let steps = (await historyState(page)).undo;

    await runCommands(page, ["layer.referencePlacement"]);
    expect((await referenceLayers(page))[0]?.placement).toBe("front");
    expect((await historyState(page)).undo).toBe(++steps);
    await expect(activeCell(page)).toHaveAccessibleName("Reference layer, in front");

    await changeReference(page, id!, { x: 5, y: 1 });
    expect((await historyState(page)).undo).toBe(++steps);
    await runCommands(page, ["layer.resetReferenceFit"]);
    expect(await referenceLayers(page)).toMatchObject([{ x: 0, y: 0, scale: 2 }]);
    expect((await historyState(page)).undo).toBe(++steps);

    const layers = (await historyState(page)).layers;
    await runCommands(page, ["layer.delete"]);
    expect(await referenceLayers(page)).toEqual([]);
    expect(await historyState(page)).toEqual({ undo: steps + 1, layers: layers - 1 });
    await expect(grid(page).getByRole("rowgroup", { name: "Reference" })).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("↓ from the bottom pixel layer moves into the Reference group, ↑ back", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    const id = await addReference(page, { kind: "flat", width: 8, height: 8, rgba: RED });
    await activeCell(page).click();
    await expect(activeCell(page)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(activeCell(page)).toHaveAccessibleName("Reference layer, behind");
    await expect(activeCell(page)).toBeFocused();
    expect(
        await page.evaluate(() => {
            const state = window.__ngneTest!.sessions.getState();
            return state.documents.find((entry) => entry.id === state.activeId)!.session
                .activeLayerId;
        }),
    ).toBe(id);
    await page.keyboard.press("ArrowUp");
    await expect(activeCell(page)).not.toHaveAccessibleName(/^Reference/);
    await expect(activeCell(page)).toBeFocused();
    expect(errors).toEqual([]);
});

test("Layer → New Reference Layer from File… adds the chosen PNG as a reference layer in one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    const before = await historyState(page);
    await openMenu(page, "Layer");
    const choosing = page.waitForEvent("filechooser");
    await menuItem(page, "layer.newReference").click();
    const chooser = await choosing;
    await chooser.setFiles({
        name: "Trace Me.png",
        mimeType: "image/png",
        buffer: pngFile(32, 16, RED),
    });
    await expect.poll(async () => (await referenceLayers(page)).length).toBe(1);
    expect(await referenceLayers(page)).toMatchObject([
        { name: "Trace Me", opacity: 128, placement: "behind", x: 0, y: 4, scale: 0.5 },
    ]);
    expect(await historyState(page)).toEqual({
        undo: before.undo + 1,
        layers: before.layers + 1,
    });
    await expect(referenceRow(page, "Trace Me")).toBeVisible();
    // The source bytes are the file's, in the document's store.
    const stored = await page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        return [...document.referenceSources.values()].map((bytes) => bytes.length);
    });
    expect(stored).toEqual([pngFile(32, 16, RED).length]);
    expect(errors).toEqual([]);
});

test("a fifth reference layer is refused with a toast and the document is unchanged", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    for (let index = 0; index < 4; index++) {
        expect(
            await addReference(page, { kind: "flat", width: 4, height: 4, rgba: RED }),
        ).not.toBeNull();
    }
    const before = await historyState(page);
    const references = await referenceLayers(page);
    let chooserOpened = false;
    page.on("filechooser", () => {
        chooserOpened = true;
    });
    await openMenu(page, "Layer");
    await menuItem(page, "layer.newReference").click();
    await expect(errorToast(page)).toHaveText(/A sprite can have at most four reference layers\./);
    expect(chooserOpened).toBe(false);
    // Through the function SE-044 calls as well.
    expect(await addReference(page, { kind: "flat", width: 4, height: 4, rgba: RED })).toBeNull();
    await expect(errorToast(page).first()).toHaveText(/at most four reference layers/);
    expect(await historyState(page)).toEqual(before);
    expect(await referenceLayers(page)).toEqual(references);
    await expect(timeline(page)).toBeVisible();
    expect(errors).toEqual([]);
});

test("Delete Layer removes every selected layer, reference rows selected with Ctrl and pixel rows with them, in one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    await addReference(page, { kind: "flat", width: 4, height: 4, rgba: RED }, { name: "One" });
    await addReference(page, { kind: "flat", width: 4, height: 4, rgba: RED }, { name: "Two" });
    await addReference(page, { kind: "flat", width: 4, height: 4, rgba: RED }, { name: "Three" });
    const storedSources = () =>
        page.evaluate(() => {
            const state = window.__ngneTest!.sessions.getState();
            return state.documents.find((entry) => entry.id === state.activeId)!.referenceSources
                .size;
        });
    expect(await storedSources()).toBe(3);
    let steps = (await historyState(page)).undo;

    // Two reference rows, the second with Ctrl.
    await referenceRow(page, "One").locator(".timeline__name").click();
    await referenceRow(page, "Two")
        .locator(".timeline__name")
        .click({ modifiers: ["Control"] });
    await runCommands(page, ["layer.delete"]);
    expect((await referenceLayers(page)).map((layer) => layer.name)).toEqual(["Three"]);
    expect((await historyState(page)).undo).toBe(++steps);
    expect(await storedSources()).toBe(1);

    // A pixel row and a reference row together; a second pixel layer stays.
    await runCommands(page, ["layer.new"]);
    steps++;
    const layers = (await historyState(page)).layers;
    await layerHeader(page, "Layer 1").locator(".timeline__name").click();
    await referenceRow(page, "Three")
        .locator(".timeline__name")
        .click({ modifiers: ["Control"] });
    await runCommands(page, ["layer.delete"]);
    expect(await referenceLayers(page)).toEqual([]);
    expect(await historyState(page)).toEqual({ undo: steps + 1, layers: layers - 2 });
    expect(await storedSources()).toBe(0);
    // One undo brings both back, the source too.
    await runCommands(page, ["edit.undo"]);
    expect((await referenceLayers(page)).map((layer) => layer.name)).toEqual(["Three"]);
    expect((await historyState(page)).layers).toBe(layers);
    expect(await storedSources()).toBe(1);
    expect(errors).toEqual([]);
});

test("the active frame's column of a reference row stays in view: after ↓ into the group and → along it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    // 60 frames, the 50th active.
    await page.evaluate(async () => {
        const framesPath = "/src/core/frames/index.ts";
        const frames = (await import(/* @vite-ignore */ framesPath)) as typeof CoreFrames;
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        for (let count = 1; count < 60; count++) {
            const { session } = document;
            document.history.execute(frames.addFrameCommand(session.doc, session.activeFrameId));
        }
        document.session.activeFrameId = document.session.doc.frames[49]!.id;
        state.touch(document.id);
    });
    await addReference(page, { kind: "flat", width: 4, height: 4, rgba: RED });
    await expect(frameHeader(page, 60)).toBeAttached();
    await expect(activeCell(page)).toHaveAttribute("data-frame", /./);
    await activeCell(page).click();
    await expect(activeCell(page)).toBeFocused();

    /** Whether the header of `frame` lies inside the scroller, right of the layer column. */
    const headerShown = (frame: number) =>
        frameHeader(page, frame).evaluate((header) => {
            const box = header.getBoundingClientRect();
            const panel = header.closest("[data-timeline]")!.getBoundingClientRect();
            const column = header
                .closest('[role="row"]')!
                .querySelector(".timeline__corner")!
                .getBoundingClientRect();
            return box.left >= column.right - 0.5 && box.right <= panel.right + 0.5;
        });
    expect(await headerShown(50)).toBe(true);

    await page.keyboard.press("ArrowDown");
    await expect(activeCell(page)).toHaveAccessibleName("Reference layer, behind");
    await expect(activeCell(page)).toBeFocused();
    await expect.poll(() => headerShown(50)).toBe(true);
    for (let frame = 51; frame <= 60; frame++) {
        await page.keyboard.press("ArrowRight");
        await expect(activeCell(page)).toHaveAttribute("data-frame-index", String(frame - 1));
        await expect.poll(() => headerShown(frame)).toBe(true);
    }
    await expect(scroller(page)).toBeVisible();
    expect(errors).toEqual([]);
});

test("a locked reference's popover shows X, Y, scale, placement and Reset to Fit read-only", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    await addReference(page, { kind: "flat", width: 8, height: 8, rgba: RED }, { name: "Sketch" });
    const row = referenceRow(page, "Sketch");
    await row.getByRole("button", { name: "Locked" }).click();
    await expect.poll(async () => (await referenceLayers(page))[0]?.locked).toBe(true);
    await row.getByRole("button", { name: "Opacity 128" }).click();
    const popover = propertiesPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    for (const name of ["X", "Y", "Scale"]) {
        await expect(popover.getByRole("spinbutton", { name, exact: true })).toBeDisabled();
    }
    await expect(popover.getByRole("radio", { name: "In front" })).toBeDisabled();
    await expect(popover.getByRole("button", { name: "Reset to Fit" })).toBeDisabled();
    // Name and opacity still apply.
    await popover.getByRole("textbox", { name: "Name" }).fill("Kept");
    await page.keyboard.press("Enter");
    await expect(popover).toBeHidden();
    expect(await referenceLayers(page)).toMatchObject([{ name: "Kept", x: 0, y: 0, scale: 2 }]);
    expect(errors).toEqual([]);
});
