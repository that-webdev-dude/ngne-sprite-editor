import { expect, test } from "@playwright/test";
import { boxOf, collectErrors } from "./se-006-support";
import {
    cell,
    documentState,
    expectFocusOn,
    frameHeader,
    layerHeader,
    rowNames,
    scroller,
    selectedCells,
} from "./se-022-support";
import { celGrid, centreOf, dragFrom, dropIndicator, openCels } from "./se-026-support";

// SE-026: drags in the timeline (DESIGN §5.6) — a layer or a frame dragged reorders, a cel
// dragged moves and a Ctrl-drag copies; each drop is one undo step, and a drop onto a locked
// layer changes nothing.

test("reorder a layer and a frame by drag: one undo step each, the model in the expected order", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 3, 4);
    const start = await documentState(page);

    // Layer 1, the bottom row, dragged above Layer 3, the top one.
    const top = await boxOf(layerHeader(page, "Layer 3"));
    await dragFrom(page, layerHeader(page, "Layer 1").locator(".timeline__name"), {
        x: top.x + 60,
        y: top.y + 4,
    });
    await expect(dropIndicator(page)).toHaveAttribute("data-drop", "layers");
    const line = await boxOf(dropIndicator(page));
    expect(Math.abs(line.y + line.height / 2 - top.y)).toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect(dropIndicator(page)).toHaveCount(0);
    await expect.poll(() => rowNames(page)).toEqual(["Layer 1", "Layer 3", "Layer 2"]);
    let state = await documentState(page);
    expect(state.layers.map((layer) => layer.name)).toEqual(["Layer 2", "Layer 3", "Layer 1"]);
    expect(state.undoCount).toBe(start.undoCount + 1);
    expect(state.undoLabel).toBe("Move Layer");

    // Frame 1 dragged between frames 3 and 4.
    const fourth = await boxOf(frameHeader(page, 4));
    await dragFrom(page, frameHeader(page, 1), { x: fourth.x + 3, y: fourth.y + 10 });
    await expect(dropIndicator(page)).toHaveAttribute("data-drop", "frames");
    expect(Math.round((await boxOf(dropIndicator(page))).x + 1)).toBe(Math.round(fourth.x));
    await page.mouse.up();
    const ids = start.frames.map((frame) => frame.id);
    await expect
        .poll(async () => (await documentState(page)).frames.map((frame) => frame.id))
        .toEqual([ids[1], ids[2], ids[0], ids[3]]);
    state = await documentState(page);
    expect(state.undoCount).toBe(start.undoCount + 2);
    expect(state.undoLabel).toBe("Move Frame");

    // Each undo takes back one drag.
    await page.keyboard.press("Control+KeyZ");
    await expect
        .poll(async () => (await documentState(page)).frames.map((frame) => frame.id))
        .toEqual(ids);
    expect((await documentState(page)).layers.map((layer) => layer.name)).toEqual([
        "Layer 2",
        "Layer 3",
        "Layer 1",
    ]);
    await page.keyboard.press("Control+KeyZ");
    await expect
        .poll(async () => (await documentState(page)).layers.map((layer) => layer.name))
        .toEqual(start.layers.map((layer) => layer.name));
    expect(errors).toEqual([]);
});

test("move and Ctrl-copy a cel by drag: one undo step each, the model as expected", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 3, 4, ["Layer 1/1", "Layer 2/2"]);
    expect(await celGrid(page)).toEqual([". . . .", ". 2/2 . .", "1/1 . . ."]);
    const start = await documentState(page);

    // Layer 1, frame 1 → Layer 2, frame 3.
    await dragFrom(page, cell(page, "Layer 1", 1), await centreOf(cell(page, "Layer 2", 3)));
    await expect(dropIndicator(page)).toHaveAttribute("data-drop", "cels");
    expect(await boxOf(dropIndicator(page))).toEqual(await boxOf(cell(page, "Layer 2", 3)));
    await page.mouse.up();
    await expect.poll(() => celGrid(page)).toEqual([". . . .", ". 2/2 1/1 .", ". . . ."]);
    let state = await documentState(page);
    expect(state.undoCount).toBe(start.undoCount + 1);
    expect(state.undoLabel).toBe("Move Cel");
    // The cel is selected where it landed, and active there.
    expect([state.activeLayer, state.activeFrame]).toEqual(["Layer 2", 3]);
    await expect.poll(() => selectedCells(page)).toEqual(["Layer 2/3"]);
    await expectFocusOn(page, "Layer 2", 3);

    // Ctrl held during the drag: Layer 2, frame 3 copied to Layer 3, frame 4.
    const target = await centreOf(cell(page, "Layer 3", 4));
    await dragFrom(page, cell(page, "Layer 2", 3), { x: target.x - 12, y: target.y });
    await page.keyboard.down("Control");
    await page.mouse.move(target.x, target.y, { steps: 2 });
    await expect(dropIndicator(page)).toHaveAttribute("data-copy", "true");
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect.poll(() => celGrid(page)).toEqual([". . . +", ". 2/2 1/1 .", ". . . ."]);
    state = await documentState(page);
    expect(state.undoCount).toBe(start.undoCount + 2);
    expect(state.undoLabel).toBe("Copy Cel");
    // The copy has the pixels of its original in an image of its own.
    const same = await page.evaluate(() => {
        const sessions = window.__ngneTest!.sessions.getState();
        const { doc } = sessions.documents.find((entry) => entry.id === sessions.activeId)!.session;
        const [, l2, l3] = doc.layers;
        const image = (layerId: string, frame: number) =>
            doc.cels.get(`${layerId}:${doc.frames[frame]!.id}`)?.imageId ?? "";
        const original = doc.images.get(image(l2!.id, 2))!.data;
        const copy = doc.images.get(image(l3!.id, 3))!.data;
        return original.every((byte, at) => byte === copy[at]);
    });
    expect(same).toBe(true);

    // Each undo takes back one drag.
    await page.keyboard.press("Control+KeyZ");
    await expect.poll(() => celGrid(page)).toEqual([". . . .", ". 2/2 1/1 .", ". . . ."]);
    await page.keyboard.press("Control+KeyZ");
    await expect.poll(() => celGrid(page)).toEqual([". . . .", ". 2/2 . .", "1/1 . . ."]);
    expect(errors).toEqual([]);
});

test("a selection of cels is dragged as a whole; a press on a selected cel without a drag selects it alone", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 2, 5, ["Layer 1/1", "Layer 1/2", "Layer 2/1"]);
    await cell(page, "Layer 1", 1).click();
    await cell(page, "Layer 2", 2).click({ modifiers: ["Shift"] });
    await expect
        .poll(() => selectedCells(page))
        .toEqual(["Layer 1/1", "Layer 1/2", "Layer 2/1", "Layer 2/2"]);

    // Pressed on a selected cel, the selection holds and moves two frames on.
    await dragFrom(page, cell(page, "Layer 1", 2), await centreOf(cell(page, "Layer 1", 4)));
    const box = await boxOf(dropIndicator(page));
    const from = await boxOf(cell(page, "Layer 2", 3));
    const to = await boxOf(cell(page, "Layer 1", 4));
    expect(box).toEqual({
        x: from.x,
        y: from.y,
        width: to.x + to.width - from.x,
        height: to.y + to.height - from.y,
    });
    await page.mouse.up();
    await expect.poll(() => celGrid(page)).toEqual([". . 2/1 . .", ". . 1/1 1/2 ."]);
    await expect
        .poll(() => selectedCells(page))
        .toEqual(["Layer 1/3", "Layer 1/4", "Layer 2/3", "Layer 2/4"]);

    // A press and release on one of them, with no drag, selects that one alone.
    await cell(page, "Layer 2", 3).click();
    await expect.poll(() => selectedCells(page)).toEqual(["Layer 2/3"]);
    expect(errors).toEqual([]);
});

test("a cel dragged onto a locked layer changes nothing and adds no undo step; Escape cancels a drag", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 2, 3, ["Layer 1/1"]);
    await layerHeader(page, "Layer 2").getByRole("button", { name: "Locked" }).click();
    await expect.poll(async () => (await documentState(page)).layers[1]?.locked).toBe(true);
    const start = await documentState(page);
    const before = await celGrid(page);

    await dragFrom(page, cell(page, "Layer 1", 1), await centreOf(cell(page, "Layer 2", 2)));
    await expect(dropIndicator(page)).toHaveAttribute("data-refused", "true");
    await page.mouse.up();
    // A copy is refused too.
    const above = await centreOf(cell(page, "Layer 2", 1));
    await dragFrom(page, cell(page, "Layer 1", 1), { x: above.x + 6, y: above.y });
    await page.keyboard.down("Control");
    await page.mouse.move(above.x, above.y);
    await expect(dropIndicator(page)).toHaveAttribute("data-refused", "true");
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect(dropIndicator(page)).toHaveCount(0);
    expect(await celGrid(page)).toEqual(before);
    expect((await documentState(page)).undoCount).toBe(start.undoCount);

    // On its own layer the cel still moves.
    await dragFrom(page, cell(page, "Layer 1", 1), await centreOf(cell(page, "Layer 1", 3)));
    // Escape cancels: nothing moves at the release.
    await expect(dropIndicator(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dropIndicator(page)).toHaveCount(0);
    await page.mouse.up();
    expect(await celGrid(page)).toEqual(before);
    expect((await documentState(page)).undoCount).toBe(start.undoCount);
    expect(errors).toEqual([]);
});

test("a drag held at the edge of the grid scrolls it: a frame dragged past the frames in view lands there", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 1, 80);
    const start = await documentState(page);
    const panel = await boxOf(scroller(page));
    const inView = await scroller(page).evaluate((element) => {
        const right = element.getBoundingClientRect().left + element.clientWidth;
        return [...element.querySelectorAll(".timeline__frame")].filter(
            (header) => header.getBoundingClientRect().right <= right,
        ).length;
    });
    expect(inView).toBeLessThan(70);
    const header = await boxOf(frameHeader(page, 1));
    await dragFrom(page, frameHeader(page, 1), {
        x: panel.x + panel.width - 4,
        y: header.y + header.height / 2,
    });
    await expect
        .poll(() => scroller(page).evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(10 * 24);
    await page.mouse.up();
    const moved = start.frames[0]!.id;
    await expect
        .poll(async () =>
            (await documentState(page)).frames.findIndex((frame) => frame.id === moved),
        )
        .toBeGreaterThan(inView);
    expect((await documentState(page)).undoCount).toBe(start.undoCount + 1);
    expect(errors).toEqual([]);
});

test("after a drag that drops nothing (refused, or cancelled with Escape) the focus goes back to the active cell", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 2, 4, ["Layer 1/1", "Layer 1/2"]);
    await layerHeader(page, "Layer 2").getByRole("button", { name: "Locked" }).click();
    await expect.poll(async () => (await documentState(page)).layers[1]?.locked).toBe(true);
    await cell(page, "Layer 1", 1).click();
    await cell(page, "Layer 1", 2).click({ modifiers: ["Shift"] });
    await expectFocusOn(page, "Layer 1", 2);

    // Pressed on Layer 1/1 (selected, not active: the press focuses it), dropped onto the
    // locked layer: refused.
    await dragFrom(page, cell(page, "Layer 1", 1), await centreOf(cell(page, "Layer 2", 1)));
    await expect(dropIndicator(page)).toHaveAttribute("data-refused", "true");
    await page.mouse.up();
    await expectFocusOn(page, "Layer 1", 2);

    // The same, cancelled with Escape.
    await dragFrom(page, cell(page, "Layer 1", 1), await centreOf(cell(page, "Layer 1", 3)));
    await expect(dropIndicator(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dropIndicator(page)).toHaveCount(0);
    await expectFocusOn(page, "Layer 1", 2);
    await page.mouse.up();
    expect(await celGrid(page)).toEqual([". . . .", "1/1 1/2 . ."]);
    expect(errors).toEqual([]);
});
