import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as CoreCels from "../../src/core/cels";
import { boxOf, collectErrors, region, settleTimers } from "./se-006-support";
import { menuItem, openEditor, openMenu, openSession, statusBar } from "./se-007-support";
import { settle } from "./se-011-support";
import {
    activeCell,
    afterFrames,
    cell,
    cellsOf,
    documentState,
    durationField,
    expectFocusOn,
    frameHeader,
    grid,
    holdAnimationFrames,
    layerHeader,
    propertiesPopover,
    rowNames,
    runCommands,
    scroller,
    selectedCells,
    selectedFrames,
    selectedLayers,
    timeline,
    viewport,
} from "./se-022-support";
import { audit, startInTheme, THEMES } from "./se-008-support";
import { activeOption, openPalette, palette } from "./se-064-support";

// SE-022: the timeline panel (DESIGN §5.6) — layer column and frame grid, selection, the
// registry's layer and frame commands with the keys of SPEC §7.8, the duration field, the layer
// properties popover and rename in place.

/** Opens the editor with a document of `layers` layers and `frames` frames. */
async function openTimeline(page: Page, layers = 1, frames = 1): Promise<void> {
    await openEditor(page);
    await openSession(page, { name: "timeline", width: 8, height: 8 });
    await runCommands(page, [
        ...Array.from({ length: layers - 1 }, () => "layer.new"),
        ...Array.from({ length: frames - 1 }, () => "frame.newEmpty"),
    ]);
    await expect(grid(page).getByRole("rowheader")).toHaveCount(layers);
    await expect(frameHeader(page, frames)).toBeVisible();
}

test("the timeline is empty while no document is open and shows the layers, top first, once one is", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await expect(timeline(page).locator(".shell-timeline__content")).toBeEmpty();
    await openSession(page, { name: "timeline", width: 8, height: 8 });
    await runCommands(page, ["layer.new", "layer.new", "frame.newEmpty"]);
    const state = await documentState(page);
    // The rows are the layers of the model, top of the stack first.
    await expect
        .poll(() => rowNames(page))
        .toEqual(state.layers.map((layer) => layer.name).reverse());
    await expect(grid(page).locator(".timeline__frame")).toHaveText(
        state.frames.map((_, index) => String(index + 1)),
    );
    // The active cell is the active layer's cel at the active frame.
    await expect(activeCell(page)).toHaveCount(1);
    await expect(cell(page, state.activeLayer, state.activeFrame)).toHaveAttribute("tabindex", "0");
    expect(errors).toEqual([]);
});

test("layout matches DESIGN §5.6 metrics: 24 px cells, 28 px rows, a 200 px layer column", async ({
    page,
}) => {
    await openTimeline(page, 3, 4);
    const panel = await boxOf(timeline(page).locator("[data-timeline]"));
    const names = await rowNames(page);
    for (const [row, name] of names.entries()) {
        const header = await boxOf(layerHeader(page, name));
        expect(header, name).toEqual({
            x: panel.x,
            y: expect.any(Number),
            width: 200,
            height: 28,
        });
        // Rows follow each other at 28 px, under the bar and the frame header.
        expect(header.y, name).toBe(panel.y + 2 * 28 + row * 28);
        for (let frame = 1; frame <= 4; frame++) {
            expect(await boxOf(cell(page, name, frame)), `${name} ${frame}`).toEqual({
                x: panel.x + 200 + (frame - 1) * 24,
                y: header.y,
                width: 24,
                height: 28,
            });
        }
    }
    // The two header rows are 28 px with their hairline below; the frame numbers are 24 px
    // wide, over their columns.
    const bar = await boxOf(timeline(page).locator(".timeline__bar"));
    expect(bar).toMatchObject({ x: panel.x, y: panel.y, height: 28 });
    const headerRow = await boxOf(grid(page).getByRole("row").first());
    expect(headerRow).toMatchObject({ x: panel.x, y: panel.y + 28, height: 28 });
    for (let frame = 1; frame <= 4; frame++) {
        expect(await boxOf(frameHeader(page, frame))).toMatchObject({
            x: panel.x + 200 + (frame - 1) * 24,
            y: panel.y + 28,
            width: 24,
        });
    }
    // The layer column: the transport, the head of the column, the row headers.
    const transport = await boxOf(timeline(page).getByRole("group", { name: "Transport" }));
    expect(transport).toMatchObject({ x: panel.x, y: panel.y, width: 200 });
    const corner = await boxOf(grid(page).getByRole("columnheader", { name: "Layers" }));
    expect(corner).toMatchObject({ x: panel.x, y: panel.y + 28, width: 200 });
    // Pointer targets of the controls: at least 24 × 24 (DESIGN §8; cells are the exception).
    for (const control of await timeline(page).getByRole("button").all()) {
        const box = await boxOf(control);
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
    }
});

test("add 3 layers and 4 frames with keys and buttons, undo all, and the model returns to the start state", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page);
    const start = await documentState(page);

    // Layers: Shift+N, the New Layer button of the timeline, Shift+N.
    await viewport(page).focus();
    await page.keyboard.press("Shift+KeyN");
    await expect(grid(page).getByRole("rowheader")).toHaveCount(2);
    await timeline(page).getByRole("button", { name: "New Layer" }).click();
    await expect(grid(page).getByRole("rowheader")).toHaveCount(3);
    await page.keyboard.press("Shift+KeyN");
    await expect(grid(page).getByRole("rowheader")).toHaveCount(4);

    // Frames: Alt+N, Alt+B, and the two items of the Frame menu.
    await page.keyboard.press("Alt+KeyN");
    await expect(frameHeader(page, 2)).toBeVisible();
    await page.keyboard.press("Alt+KeyB");
    await expect(frameHeader(page, 3)).toBeVisible();
    for (const [id, frames] of [
        ["frame.new", 4],
        ["frame.newEmpty", 5],
    ] as const) {
        await openMenu(page, "Frame");
        await menuItem(page, id).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(frameHeader(page, frames)).toBeVisible();
    }
    const grown = await documentState(page);
    expect(grown.layers).toHaveLength(start.layers.length + 3);
    expect(grown.frames).toHaveLength(start.frames.length + 4);
    expect(grown.undoCount).toBe(start.undoCount + 7);

    // Undo all, from the keyboard.
    await settleTimers(page);
    await viewport(page).focus();
    for (let step = 0; step < 7; step++) await page.keyboard.press("Control+KeyZ");
    await expect.poll(() => documentState(page)).toEqual(start);
    await expect(grid(page).getByRole("rowheader")).toHaveCount(start.layers.length);
    await expect(grid(page).locator(".timeline__frame")).toHaveCount(start.frames.length);
    expect(errors).toEqual([]);
});

test("keyboard only: create a layer, rename it, move to frame 3, add a frame", async ({ page }) => {
    const errors = collectErrors(page);
    await openTimeline(page);
    // No pointer from here on: the focus starts on the viewport, as after opening a document.
    await viewport(page).focus();
    await page.keyboard.press("Alt+KeyB");
    await page.keyboard.press("Alt+KeyB");
    await expect.poll(async () => (await documentState(page)).frames.length).toBe(3);

    // Create a layer.
    await page.keyboard.press("Shift+KeyN");
    await expect.poll(async () => (await documentState(page)).activeLayer).toBe("Layer 2");

    // Rename it: Rename Layer from the command palette, then the field in its row.
    await openPalette(page);
    await page.keyboard.type("Rename Layer");
    await expect(activeOption(page)).toHaveAttribute("data-command", "layer.rename");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeHidden();
    const field = timeline(page).getByRole("textbox", { name: "Layer name" });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("Layer 2");
    await page.keyboard.type("Ink");
    await page.keyboard.press("Enter");
    await expect(layerHeader(page, "Ink")).toBeVisible();
    // The focus is on the grid's active cell, where the timeline's keys act.
    await expectFocusOn(page, "Ink", 3);

    // Move to frame 3: Home, then → twice, each key once the focus has followed.
    await page.keyboard.press("Home");
    await expectFocusOn(page, "Ink", 1);
    await page.keyboard.press("ArrowRight");
    await expectFocusOn(page, "Ink", 2);
    await page.keyboard.press("ArrowRight");
    await expectFocusOn(page, "Ink", 3);
    expect((await documentState(page)).activeFrame).toBe(3);

    // Add a frame: after frame 3, and it becomes the active one.
    const before = await documentState(page);
    await page.keyboard.press("Alt+KeyB");
    await expect.poll(async () => (await documentState(page)).frames.length).toBe(4);
    const after = await documentState(page);
    expect(after.activeFrame).toBe(4);
    expect(after.frames.slice(0, 3)).toEqual(before.frames);
    expect(after.layers.map((layer) => layer.name)).toEqual(["Layer 1", "Ink"]);
    expect(after.activeLayer).toBe("Ink");
    await expectFocusOn(page, "Ink", 4);
    expect((await statusBar(page)).frame).toBe("Frame 4/4");
    expect(errors).toEqual([]);
});

test("setting the duration with three frames selected changes exactly those three, in one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 1, 6);
    await frameHeader(page, 2).click();
    await frameHeader(page, 4).click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedFrames(page)).toEqual([2, 3, 4]);
    const before = await documentState(page);
    await expect(durationField(page)).toHaveValue("100");

    await durationField(page).fill("250");
    await page.keyboard.press("Enter");
    await expect
        .poll(async () => (await documentState(page)).frames.map((frame) => frame.durationMs))
        .toEqual([100, 250, 250, 250, 100, 100]);
    const after = await documentState(page);
    expect(after.undoCount).toBe(before.undoCount + 1);
    expect(after.undoLabel).toBe("Frame Duration");
    await expect(durationField(page)).toHaveValue("250");

    // Undo restores the three in one step.
    await viewport(page).focus();
    await page.keyboard.press("Control+KeyZ");
    await expect
        .poll(async () => (await documentState(page)).frames.map((frame) => frame.durationMs))
        .toEqual([100, 100, 100, 100, 100, 100]);
    // Undo ends the selection (DESIGN §5.6): the field shows the active frame's value.
    await expect.poll(() => selectedFrames(page)).toEqual([]);
    await expect(durationField(page)).toHaveValue("100");
    expect(errors).toEqual([]);
});

/** The durations of the active document's frames, in order. */
async function durations(page: Page): Promise<number[]> {
    return (await documentState(page)).frames.map((frame) => frame.durationMs);
}

test("a value typed in the duration field lands on the frames it showed: a click on another frame applies it first", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 1, 6);
    await frameHeader(page, 2).click();
    await frameHeader(page, 4).click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedFrames(page)).toEqual([2, 3, 4]);
    const before = await documentState(page);

    await durationField(page).fill("250");
    await frameHeader(page, 6).click();
    await expect.poll(() => durations(page)).toEqual([100, 250, 250, 250, 100, 100]);
    const after = await documentState(page);
    expect(after.undoCount).toBe(before.undoCount + 1);
    expect(after.undoLabel).toBe("Frame Duration");
    // The click selected frame 6 as well, once the value was applied.
    await expect.poll(() => selectedFrames(page)).toEqual([6]);
    await expect(durationField(page)).toHaveValue("100");
    expect(errors).toEqual([]);
});

test("a value typed in the duration field is applied before a press on the canvas begins a stroke", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 1, 6);
    await settle(page);
    await frameHeader(page, 2).click();
    await frameHeader(page, 4).click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedFrames(page)).toEqual([2, 3, 4]);
    const before = await documentState(page);

    await durationField(page).fill("250");
    // The pencil, the default tool, paints where the press is.
    const canvas = await boxOf(viewport(page));
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await expect.poll(() => durations(page)).toEqual([100, 250, 250, 250, 100, 100]);
    await expect.poll(async () => (await documentState(page)).undoCount).toBe(before.undoCount + 2);
    const after = await documentState(page);
    expect(after.undoLabel).toBe("Pencil");
    // The stroke painted the active cel, frame 4.
    expect(after.activeFrame).toBe(4);
    expect(after.cels).toHaveLength(before.cels.length + 1);
    await expect(cell(page, "Layer 1", 4)).toHaveAttribute("data-cel", "filled");
    // Undo takes the stroke, then the duration.
    await page.keyboard.press("Control+KeyZ");
    await expect.poll(async () => (await documentState(page)).cels).toEqual(before.cels);
    expect(await durations(page)).toEqual([100, 250, 250, 250, 100, 100]);
    await page.keyboard.press("Control+KeyZ");
    await expect.poll(() => durations(page)).toEqual([100, 100, 100, 100, 100, 100]);
    expect(errors).toEqual([]);
});

test("with frames of 100, 200 and 300 ms selected the field shows no number, and a typed 100 sets all three", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 1, 3);
    for (const [frame, value] of [
        [2, "200"],
        [3, "300"],
    ] as const) {
        await frameHeader(page, frame).click();
        await durationField(page).fill(value);
        await page.keyboard.press("Enter");
    }
    await expect.poll(() => durations(page)).toEqual([100, 200, 300]);
    await frameHeader(page, 1).click();
    await frameHeader(page, 3).click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedFrames(page)).toEqual([1, 2, 3]);
    await expect(durationField(page)).toHaveValue("");
    await expect(durationField(page)).toHaveAttribute("placeholder", "—");
    await expect(durationField(page)).toHaveAttribute("aria-valuetext", "Mixed");
    const steps = (await documentState(page)).undoCount;

    // 100 is the duration of the first frame, and still applies to all three.
    await durationField(page).fill("100");
    await page.keyboard.press("Enter");
    await expect.poll(() => durations(page)).toEqual([100, 100, 100]);
    expect((await documentState(page)).undoCount).toBe(steps + 1);
    await expect(durationField(page)).toHaveValue("100");
    expect(errors).toEqual([]);
});

test("two ArrowUp presses in the duration field with no wait between step it twice", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 1, 2);
    const steps = (await documentState(page)).undoCount;
    await durationField(page).focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => durations(page)).toEqual([100, 102]);
    expect((await documentState(page)).undoCount).toBe(steps + 2);
    await expect(durationField(page)).toHaveValue("102");
    expect(errors).toEqual([]);
});

test("click, Shift and Ctrl select cels, frames and layers", async ({ page }) => {
    const errors = collectErrors(page);
    await openTimeline(page, 3, 5);

    // Cels: one, the rectangle from the anchor, one removed.
    await cell(page, "Layer 1", 2).click();
    await expect.poll(() => selectedCells(page)).toEqual(["Layer 1/2"]);
    await expectFocusOn(page, "Layer 1", 2);
    await cell(page, "Layer 2", 4).click({ modifiers: ["Shift"] });
    await expect
        .poll(() => selectedCells(page))
        .toEqual(cellsOf(["Layer 1", "Layer 2"], [2, 3, 4]));
    await cell(page, "Layer 2", 3).click({ modifiers: ["Control"] });
    await expect
        .poll(() => selectedCells(page))
        .toEqual(
            cellsOf(["Layer 1", "Layer 2"], [2, 3, 4]).filter((entry) => entry !== "Layer 2/3"),
        );
    // The active cell is the one clicked last.
    expect((await documentState(page)).activeLayer).toBe("Layer 2");
    expect((await documentState(page)).activeFrame).toBe(3);

    // Frames: the whole column of each selected frame.
    await frameHeader(page, 1).click();
    await frameHeader(page, 3).click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedFrames(page)).toEqual([1, 2, 3]);
    await frameHeader(page, 2).click({ modifiers: ["Control"] });
    await expect.poll(() => selectedFrames(page)).toEqual([1, 3]);
    const names = await rowNames(page);
    await expect.poll(() => selectedCells(page)).toEqual(cellsOf(names, [1, 3]));
    // A press on the header leaves the focus in the grid.
    await expect(activeCell(page)).toBeFocused();

    // Layers: the whole row of each selected layer.
    await layerHeader(page, "Layer 3").click();
    await layerHeader(page, "Layer 1").click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedLayers(page)).toEqual(["Layer 3", "Layer 2", "Layer 1"]);
    await layerHeader(page, "Layer 2").click({ modifiers: ["Control"] });
    await expect.poll(() => selectedLayers(page)).toEqual(["Layer 3", "Layer 1"]);
    await expect
        .poll(() => selectedCells(page))
        .toEqual(cellsOf(["Layer 1", "Layer 3"], [1, 2, 3, 4, 5]));
    await expect.poll(() => selectedFrames(page)).toEqual([]);

    // The arrow keys move the active cell and end the selection.
    await expect(activeCell(page)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => selectedCells(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test("the visibility and lock toggles act on their row; the opacity opens the layer properties, applied as one step when they close", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 2, 1);
    const bottom = layerHeader(page, "Layer 1");

    await bottom.getByRole("button", { name: "Visible" }).click();
    await expect(bottom.getByRole("button", { name: "Visible" })).toHaveAttribute(
        "aria-pressed",
        "false",
    );
    await bottom.getByRole("button", { name: "Locked" }).click();
    await expect(bottom.getByRole("button", { name: "Locked" })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    let state = await documentState(page);
    expect(state.layers[0]).toMatchObject({ name: "Layer 1", visible: false, locked: true });
    // The row's layer did not become the active one.
    expect(state.activeLayer).toBe("Layer 2");
    expect(state.undoLabel).toBe("Lock Layer");

    // The opacity: shown on hover, it opens the popover beside the row.
    const opacity = bottom.getByRole("button", { name: "Opacity 255" });
    await bottom.hover();
    await expect(opacity).toHaveCSS("opacity", "1");
    await opacity.click();
    await expect(propertiesPopover(page)).toBeVisible();
    const name = propertiesPopover(page).getByRole("textbox", { name: "Name" });
    await expect(name).toBeFocused();
    await name.fill("Shade");
    const amount = propertiesPopover(page).getByRole("spinbutton", { name: "Opacity" });
    await amount.fill("128");
    const steps = (await documentState(page)).undoCount;
    // Nothing changes while the popover is open.
    expect((await documentState(page)).layers[0]?.name).toBe("Layer 1");
    // Enter takes the number and closes the popover; the focus goes back to the opacity.
    await page.keyboard.press("Enter");
    await expect(propertiesPopover(page)).toBeHidden();
    await expect(
        layerHeader(page, "Shade").getByRole("button", { name: "Opacity 128" }),
    ).toBeFocused();
    state = await documentState(page);
    expect(state.layers[0]).toMatchObject({ name: "Shade", opacity: 128 });
    expect(state.undoCount).toBe(steps + 1);
    expect(state.undoLabel).toBe("Layer Properties");
    // Below 255 the value stays on show.
    await page.mouse.move(0, 0);
    await expect(layerHeader(page, "Shade").getByRole("button", { name: "Opacity 128" })).toHaveCSS(
        "opacity",
        "1",
    );

    // Layer → Layer Properties… opens it for the active layer; Escape closes it, and with
    // nothing changed nothing is recorded.
    await openMenu(page, "Layer");
    await menuItem(page, "layer.properties").click();
    await expect(propertiesPopover(page)).toBeVisible();
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Layer 2");
    await page.keyboard.press("Escape");
    await expect(propertiesPopover(page)).toBeHidden();
    // The menu item that opened it is gone: the focus goes to the active cell.
    await expect(activeCell(page)).toBeFocused();
    expect((await documentState(page)).undoCount).toBe(steps + 1);

    // A press outside closes it too, and applies what it shows. The popover is modal: the press
    // reaches nothing under it, so a press on the canvas would paint nothing.
    await layerHeader(page, "Layer 2").getByRole("button", { name: "Opacity 255" }).focus();
    await page.keyboard.press("Enter");
    await expect(name).toBeFocused();
    await name.fill("Ink");
    await settleTimers(page);
    const canvas = await boxOf(viewport(page));
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await expect(propertiesPopover(page)).toBeHidden();
    state = await documentState(page);
    expect(state.layers[1]?.name).toBe("Ink");
    expect(state.undoLabel).toBe("Rename Layer");
    expect(state.cels).toEqual([]);
    expect(errors).toEqual([]);
});

test("a double-click renames a layer in place: Enter or leaving the field applies, Escape keeps the name", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 2, 2);
    const field = timeline(page).getByRole("textbox", { name: "Layer name" });

    await layerHeader(page, "Layer 1").locator(".timeline__name").dblclick();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("Layer 1");
    const steps = (await documentState(page)).undoCount;
    await page.keyboard.type("Body");
    await page.keyboard.press("Enter");
    await expect(layerHeader(page, "Body")).toBeVisible();
    await expect(field).toHaveCount(0);
    expect((await documentState(page)).undoLabel).toBe("Rename Layer");
    expect((await documentState(page)).undoCount).toBe(steps + 1);
    await expect(activeCell(page)).toBeFocused();

    await layerHeader(page, "Body").locator(".timeline__name").dblclick();
    await expect(field).toBeFocused();
    await page.keyboard.type("Lost");
    await page.keyboard.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(layerHeader(page, "Body")).toBeVisible();
    expect((await documentState(page)).undoCount).toBe(steps + 1);

    await layerHeader(page, "Body").locator(".timeline__name").dblclick();
    await expect(field).toBeFocused();
    await page.keyboard.type("Arms");
    await frameHeader(page, 2).click();
    await expect(layerHeader(page, "Arms")).toBeVisible();
    expect((await documentState(page)).undoCount).toBe(steps + 2);
    expect(errors).toEqual([]);
});

test("the in-place field takes at most 255 characters, as a name may have", async ({ page }) => {
    const errors = collectErrors(page);
    await openTimeline(page, 1, 1);
    const field = timeline(page).getByRole("textbox", { name: "Layer name" });
    await layerHeader(page, "Layer 1").locator(".timeline__name").dblclick();
    await expect(field).toBeFocused();
    await page.keyboard.insertText("n".repeat(256));
    await expect(field).toHaveValue("n".repeat(255));
    await page.keyboard.press("Enter");
    await expect(field).toHaveCount(0);
    const state = await documentState(page);
    expect(state.layers[0]?.name).toBe("n".repeat(255));
    expect(state.undoLabel).toBe("Rename Layer");
    expect(errors).toEqual([]);
});

test("Tab with the viewport focused hides and shows the timeline; elsewhere it moves the focus", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 1, 2);
    const viewportHeight = async () => (await boxOf(region(page, "viewport"))).height;
    const shown = await viewportHeight();
    const panelHeight = (await boxOf(timeline(page))).height;

    await viewport(page).focus();
    await page.keyboard.press("Tab");
    await expect(timeline(page)).toBeHidden();
    await expect(viewport(page)).toBeFocused();
    await expect.poll(viewportHeight).toBe(shown + panelHeight);
    await page.keyboard.press("Tab");
    await expect(timeline(page)).toBeVisible();
    await expect.poll(viewportHeight).toBe(shown);

    // The View menu item says what it will do.
    await openMenu(page, "View");
    await expect(menuItem(page, "view.timeline")).toHaveText(/^Hide Timeline/);
    await menuItem(page, "view.timeline").click();
    await expect(timeline(page)).toBeHidden();
    await openMenu(page, "View");
    await expect(menuItem(page, "view.timeline")).toHaveText(/^Show Timeline/);
    await menuItem(page, "view.timeline").click();
    await expect(timeline(page)).toBeVisible();

    // In the timeline Tab moves the focus and the panel stays. The grid is one tab stop: from
    // the cell just clicked the focus goes to what follows the panel, the status bar's Fit,
    // and stays there. The tab stop moves with the click, not when the panel next draws: the
    // page's animation frames are held from before the click until after the Tab.
    const release = await holdAnimationFrames(page);
    await cell(page, "Layer 1", 1).click();
    await expect(cell(page, "Layer 1", 1)).toBeFocused();
    await page.keyboard.press("Tab");
    const fit = region(page, "status-bar").locator('[data-status-action="fit"]');
    await expect(fit).toBeFocused();
    await release();
    await afterFrames(page, 3);
    await settleTimers(page);
    await expect(fit).toBeFocused();
    await expect(timeline(page)).toBeVisible();
    // Shift+Tab comes back to the cell, the active one.
    await page.keyboard.press("Shift+Tab");
    await expectFocusOn(page, "Layer 1", 1);
    expect(errors).toEqual([]);
});

test("F6 enters the timeline at its active cell; the arrows, Home and End move it and the focus follows", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 3, 4);
    await viewport(page).focus();
    for (let presses = 0; presses < 10; presses++) {
        await page.keyboard.press("F6");
        const inTimeline = await timeline(page).evaluate((element) =>
            element.contains(document.activeElement),
        );
        if (inTimeline) break;
    }
    await expectFocusOn(page, "Layer 3", 4);
    await page.keyboard.press("ArrowDown");
    await expectFocusOn(page, "Layer 2", 4);
    await page.keyboard.press("ArrowLeft");
    await expectFocusOn(page, "Layer 2", 3);
    await page.keyboard.press("Home");
    await expectFocusOn(page, "Layer 2", 1);
    await page.keyboard.press("ArrowDown");
    await expectFocusOn(page, "Layer 1", 1);
    // At an edge the key does nothing (no wrap): ↓ at the bottom row, then ↑ reaches the row
    // above it; ← at the first frame, then → reaches the second.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expectFocusOn(page, "Layer 2", 1);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await expectFocusOn(page, "Layer 2", 2);
    await page.keyboard.press("ArrowDown");
    await expectFocusOn(page, "Layer 1", 2);
    await page.keyboard.press("End");
    await expectFocusOn(page, "Layer 1", 4);
    await page.keyboard.press("ArrowUp");
    await expectFocusOn(page, "Layer 2", 4);
    const state = await documentState(page);
    expect([state.activeLayer, state.activeFrame]).toEqual(["Layer 2", 4]);
    // Navigation is no step of the history.
    expect(state.undoCount).toBe(2 + 3);

    // On the canvas ← and → change the frame (no selection).
    await viewport(page).focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await documentState(page)).activeFrame).toBe(3);
    await expect(cell(page, "Layer 2", 3)).toHaveAttribute("tabindex", "0");
    await expect(viewport(page)).toBeFocused();
    expect(errors).toEqual([]);
});

/**
 * Records, until `stop`, the cells of the grid that take the focus ("layer/frame") and every
 * scroll position of the panel.
 */
async function watchFocusAndScroll(page: Page): Promise<
    () => Promise<{
        focused: string[];
        scrolls: { left: number; top: number }[];
    }>
> {
    await scroller(page).evaluate((element) => {
        const log = { focused: [] as string[], scrolls: [] as { left: number; top: number }[] };
        (window as unknown as { __se022Watch: typeof log }).__se022Watch = log;
        element.addEventListener("focusin", (event) => {
            const target = event.target as HTMLElement;
            const row = target.closest('[role="row"]');
            const name = row?.querySelector('[role="rowheader"]')?.getAttribute("aria-label");
            // By its column: the grid renders only the cells in view (SE-026).
            log.focused.push(`${name}/${Number(target.getAttribute("aria-colindex")) - 1}`);
        });
        element.addEventListener("scroll", () =>
            log.scrolls.push({ left: element.scrollLeft, top: element.scrollTop }),
        );
    });
    return () =>
        page.evaluate(
            () =>
                (
                    window as unknown as {
                        __se022Watch: {
                            focused: string[];
                            scrolls: { left: number; top: number }[];
                        };
                    }
                ).__se022Watch,
        );
}

test("a press on a frame number or a layer name focuses its cell at once: the old active cell neither takes the focus nor scrolls into view", async ({
    page,
}) => {
    // 12 rows and 120 frames: more than the panel shows either way.
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await openTimeline(page, 12, 120);
    await runCommands(page, ["frame.first"]);
    await cell(page, "Layer 12", 1).click();
    await expectFocusOn(page, "Layer 12", 1);

    // Frame 1 scrolled out of view, frame 40 on screen.
    await scroller(page).evaluate((element) => {
        element.scrollLeft = 30 * 24;
    });
    await afterFrames(page, 2);
    const header = await boxOf(frameHeader(page, 40));
    const stop = await watchFocusAndScroll(page);
    // The mouse itself: a locator's click scrolls its target first.
    await page.mouse.click(header.x + header.width / 2, header.y + header.height / 2);
    await expectFocusOn(page, "Layer 12", 40);
    await afterFrames(page, 3);
    let seen = await stop();
    expect(seen.focused).toEqual(["Layer 12/40"]);
    expect(seen.scrolls.every((scroll) => scroll.left === 30 * 24)).toBe(true);
    expect(await boxOf(frameHeader(page, 40))).toEqual(header);

    // The active row scrolled out of view, the row of Layer 2 on screen.
    const bottom = await scroller(page).evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop;
    });
    await afterFrames(page, 2);
    const row = await boxOf(layerHeader(page, "Layer 2"));
    const name = await boxOf(layerHeader(page, "Layer 2").locator(".timeline__name"));
    // The layer column lies above the cels scrolled under it: the press reaches the name.
    const hit = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.className ?? "",
        { x: name.x + name.width / 2, y: name.y + name.height / 2 },
    );
    expect(hit).toBe("timeline__name");
    await watchFocusAndScroll(page);
    await page.mouse.click(name.x + name.width / 2, name.y + name.height / 2);
    await expectFocusOn(page, "Layer 2", 40);
    await afterFrames(page, 3);
    seen = await stop();
    expect(seen.focused).toEqual(["Layer 2/40"]);
    expect(seen.scrolls.every((scroll) => scroll.top === bottom)).toBe(true);
    expect(await boxOf(layerHeader(page, "Layer 2"))).toEqual(row);
    expect(errors).toEqual([]);
});

/** How many presses of `key` from the active cell take the focus out of the grid. */
async function stopsOut(page: Page, key: string): Promise<number> {
    await activeCell(page).focus();
    for (let presses = 1; presses <= 200; presses++) {
        await page.keyboard.press(key);
        const inGrid = await grid(page).evaluate((element) =>
            element.contains(document.activeElement),
        );
        if (!inGrid) return presses;
    }
    return Infinity;
}

test("the grid is one tab stop: Tab and Shift+Tab leave it in a number of stops that does not grow with the layers", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 3, 2);
    // Tab: straight out. Shift+Tab: the active row's visibility, lock and opacity, the
    // duration field and New Layer, then out.
    const few = { tab: await stopsOut(page, "Tab"), back: await stopsOut(page, "Shift+Tab") };
    expect(few).toEqual({ tab: 1, back: 6 });

    await runCommands(
        page,
        Array.from({ length: 27 }, () => "layer.new"),
    );
    await expect(grid(page).getByRole("rowheader")).toHaveCount(30);
    expect({ tab: await stopsOut(page, "Tab"), back: await stopsOut(page, "Shift+Tab") }).toEqual(
        few,
    );
    // With a row in the middle active as well.
    await layerHeader(page, "Layer 15").locator(".timeline__name").click();
    await expectFocusOn(page, "Layer 15", 2);
    expect({ tab: await stopsOut(page, "Tab"), back: await stopsOut(page, "Shift+Tab") }).toEqual(
        few,
    );
    expect(errors).toEqual([]);
});

test("the active cell is kept fully in view below a taller header and beside a wider layer column", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 12, 80);
    // A test-only style: the header grows (as with SE-023's tag bar), the column widens.
    await page.addStyleTag({
        content: `
            .timeline__bar { height: 76px; }
            .timeline__row--header { top: 76px; }
            .timeline__transport, .timeline__corner, .timeline__layer { width: 260px; }
        `,
    });
    await afterFrames(page, 2);
    /** Where the active cell lies against the parts that stick and the scroller's edges. */
    const placement = () =>
        activeCell(page).evaluate((cellElement) => {
            const panel = cellElement.closest<HTMLElement>("[data-timeline]")!;
            const box = panel.getBoundingClientRect();
            const target = cellElement.getBoundingClientRect();
            const header = panel.querySelector(".timeline__row--header")!.getBoundingClientRect();
            const column = cellElement
                .closest('[role="row"]')!
                .querySelector('[role="rowheader"]')!
                .getBoundingClientRect();
            return {
                left: target.left >= column.right,
                top: target.top >= header.bottom,
                right: target.right <= box.left + panel.clientWidth,
                bottom: target.bottom <= box.top + panel.clientHeight,
            };
        });
    const inView = { left: true, top: true, right: true, bottom: true };

    await activeCell(page).focus();
    for (const key of ["Home", "End", "Home"]) {
        await page.keyboard.press(key);
        await expect.poll(placement, key).toEqual(inView);
    }
    for (let row = 0; row < 11; row++) {
        await page.keyboard.press("ArrowDown");
        await expect.poll(placement, `down ${row + 1}`).toEqual(inView);
    }
    for (let row = 0; row < 11; row++) {
        await page.keyboard.press("ArrowUp");
        await expect.poll(placement, `up ${row + 1}`).toEqual(inView);
    }
    await expectFocusOn(page, "Layer 12", 1);
    expect(errors).toEqual([]);
});

test("cel states: empty, filled and linked cels, joined when they are neighbours", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 1, 3);
    // Paint frame 1, then link frames 1 and 2 through the cel command of SE-021.
    await page.evaluate(async () => {
        const path = "/src/core/cels/index.ts";
        const cels = (await import(/* @vite-ignore */ path)) as typeof CoreCels;
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const { session, history } = document;
        const [first, second] = session.doc.frames;
        const transaction = history.begin({ layerId: session.activeLayerId, frameId: first!.id });
        transaction.image.data.fill(200);
        transaction.markDirty({ x: 0, y: 0, width: 8, height: 8 });
        transaction.commit("Paint");
        const link = cels.linkCelsCommand(session.doc, {
            layerIds: [session.activeLayerId],
            frameIds: [first!.id, second!.id],
        });
        if (link) history.execute(link);
    });
    await expect(cell(page, "Layer 1", 1)).toHaveAttribute("data-cel", "linked");
    await expect(cell(page, "Layer 1", 2)).toHaveAttribute("data-cel", "linked");
    await expect(cell(page, "Layer 1", 3)).toHaveAttribute("data-cel", "empty");
    await expect(cell(page, "Layer 1", 1)).toHaveAttribute("data-link-next", "true");
    await expect(cell(page, "Layer 1", 2)).not.toHaveAttribute("data-link-next");

    // Unlinked, the painted cel is filled and the other keeps a copy.
    await page.evaluate(async () => {
        const path = "/src/core/cels/index.ts";
        const cels = (await import(/* @vite-ignore */ path)) as typeof CoreCels;
        const state = window.__ngneTest!.sessions.getState();
        const { session, history } = state.documents.find((entry) => entry.id === state.activeId)!;
        const [first, second] = session.doc.frames;
        const unlink = cels.unlinkCelsCommand(session.doc, {
            layerIds: [session.activeLayerId],
            frameIds: [first!.id, second!.id],
        });
        if (unlink) history.execute(unlink);
    });
    await expect(cell(page, "Layer 1", 1)).toHaveAttribute("data-cel", "filled");
    await expect(cell(page, "Layer 1", 2)).toHaveAttribute("data-cel", "filled");
    await expect(cell(page, "Layer 1", 1)).not.toHaveAttribute("data-link-next");
    // A filled cel is a solid dot, an empty one a hollow one.
    const dot = (frame: number) =>
        cell(page, "Layer 1", frame)
            .locator(".timeline__dot")
            .evaluate((element) => {
                const style = getComputedStyle(element);
                return { fill: style.backgroundColor, ring: style.borderTopWidth };
            });
    expect((await dot(1)).fill).not.toBe("rgba(0, 0, 0, 0)");
    expect(await dot(3)).toEqual({ fill: "rgba(0, 0, 0, 0)", ring: "1px" });
    expect(errors).toEqual([]);
});

test("the active cell, its row and its column are highlighted", async ({ page }) => {
    await openTimeline(page, 2, 3);
    await cell(page, "Layer 1", 2).click();
    // The cel the click selected is tinted as selected; a second plain click keeps it.
    await expect(cell(page, "Layer 1", 2)).toHaveAttribute("aria-selected", "true");
    const background = (target: ReturnType<typeof cell>) =>
        target.evaluate((element) => getComputedStyle(element).backgroundColor);
    const raised = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(
            "--bg-raised",
        );
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
    });
    // The active row and the active column are tinted; other cells are not.
    expect(await background(cell(page, "Layer 1", 3))).toBe(raised);
    expect(await background(cell(page, "Layer 2", 2))).toBe(raised);
    expect(await background(frameHeader(page, 2))).toBe(raised);
    expect(await background(cell(page, "Layer 2", 3))).toBe("rgba(0, 0, 0, 0)");
    // The active cell has the accent outline.
    const outline = await cell(page, "Layer 1", 2).evaluate(
        (element) => getComputedStyle(element, "::before").borderTopColor,
    );
    const accent = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--accent");
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
    });
    expect(outline).toBe(accent);
    await expect(cell(page, "Layer 1", 2)).toHaveAttribute("data-active-cel", "true");
    await expect(grid(page).locator("[data-active-cel]")).toHaveCount(1);
});

test("delete frame and layer act on the selection; New Layer from the timeline and Duplicate Layer from the menu", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openTimeline(page, 3, 4);
    await frameHeader(page, 2).click();
    await frameHeader(page, 3).click({ modifiers: ["Shift"] });
    await openMenu(page, "Frame");
    await menuItem(page, "frame.delete").click();
    await expect(grid(page).locator(".timeline__frame")).toHaveCount(2);

    await layerHeader(page, "Layer 1").click();
    await layerHeader(page, "Layer 2").click({ modifiers: ["Shift"] });
    await openMenu(page, "Layer");
    await menuItem(page, "layer.delete").click();
    await expect.poll(() => rowNames(page)).toEqual(["Layer 3"]);
    // The last pixel layer stays.
    await openMenu(page, "Layer");
    await expect(menuItem(page, "layer.delete")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await openMenu(page, "Layer");
    await menuItem(page, "layer.duplicate").click();
    await expect.poll(() => rowNames(page)).toEqual(["Layer 3 Copy", "Layer 3"]);
    expect(errors).toEqual([]);
});

for (const theme of THEMES) {
    test(`axe reports no AA violations in the timeline and the layer properties in the ${theme} theme`, async ({
        page,
    }) => {
        // Two audits: about 10 s alone, longer while other workers are busy.
        test.setTimeout(90_000);
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await startInTheme(page, theme);
        await openTimeline(page, 3, 4);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        // Selected frames, a hidden and a locked layer, an opacity below 255 on show.
        await frameHeader(page, 2).click();
        await frameHeader(page, 3).click({ modifiers: ["Shift"] });
        await layerHeader(page, "Layer 1").getByRole("button", { name: "Visible" }).click();
        await layerHeader(page, "Layer 2").getByRole("button", { name: "Locked" }).click();
        await page.evaluate(() => {
            const state = window.__ngneTest!.sessions.getState();
            const { session } = state.documents.find((entry) => entry.id === state.activeId)!;
            session.doc.layers[0]!.opacity = 128;
            state.touch(state.activeId!);
        });
        // The panel shows all of it before the audit.
        await expect.poll(() => selectedFrames(page)).toEqual([2, 3]);
        await expect(
            layerHeader(page, "Layer 1").getByRole("button", { name: "Opacity 128" }),
        ).toHaveCSS("opacity", "1");
        await expect(
            layerHeader(page, "Layer 2").getByRole("button", { name: "Locked" }),
        ).toHaveAttribute("aria-pressed", "true");
        const panel = await audit(page, '[data-region="timeline"]');
        expect(panel.violations).toEqual([]);
        expect(panel.contrastUndecided).toEqual([]);
        expect(panel.contrastChecked).toBeGreaterThan(0);

        await layerHeader(page, "Layer 3").getByRole("button", { name: "Opacity 255" }).click();
        await expect(propertiesPopover(page)).toBeVisible();
        const popover = await audit(page, '[role="dialog"][aria-label="Layer properties"]');
        expect(popover.violations).toEqual([]);
        expect(popover.contrastUndecided).toEqual([]);
        expect(errors).toEqual([]);
    });
}
