import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { geometry } from "./se-012-support";
import { historyOf, texelClient } from "./se-014-support";
import { cell, documentState, runCommands } from "./se-022-support";
import { VIEW, blendPopover, celPopover, focusInside, openTwoLayers } from "./se-061-support";

// SE-061 review A: a popover that closes gives the app the next key and the next press at once
// (DESIGN §5.6, "what the next key acts on follows at once"). Enter in the popover and the key
// right after it, or a press on the canvas right after it, act on the app.

/**
 * A second, empty frame; then the active cel's cell (Layer 2 at frame 1) takes the focus by a
 * click, so the popover gives the focus back to it.
 */
async function openOnCell(page: Page) {
    const { document } = await openTwoLayers(page);
    await runCommands(page, ["frame.newEmpty", "frame.first"]);
    await cell(page, "Layer 2", 1).click();
    await expect(cell(page, "Layer 2", 1)).toBeFocused();
    return document;
}

/**
 * In one evaluation: Enter on the focused element of the popover, then, in the next task (as a
 * key the user presses next would come), → on whatever has the focus then.
 */
function enterThenArrowRight(page: Page): Promise<void> {
    return page.evaluate(async () => {
        const press = (key: string) =>
            (document.activeElement ?? document.body).dispatchEvent(
                new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
            );
        press("Enter");
        await new Promise((resolve) => setTimeout(resolve, 0));
        press("ArrowRight");
    });
}

/** Enter in `field`, then at once a click on the canvas over texel (2, 1). */
async function enterThenPress(page: Page, field: Locator): Promise<void> {
    const client = texelClient(await geometry(page), VIEW, { x: 2, y: 1 });
    await page.mouse.move(client.x, client.y);
    await field.press("Enter");
    await page.mouse.down();
    await page.mouse.up();
}

test("Enter in the cel properties popover, then → at once: the opacity is applied, the active frame moves and its cell has the focus", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openOnCell(page);
    await runCommands(page, ["frame.celProperties"]);
    const popover = celPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    const field = popover.getByRole("spinbutton", { name: "Opacity" });
    await field.fill("128");
    await expect(field).toBeFocused();

    await enterThenArrowRight(page);

    await expect(popover).toBeHidden();
    const state = await documentState(page);
    expect(state.undoLabel).toBe("Cel Opacity");
    expect(state.activeFrame).toBe(2);
    await expect(cell(page, "Layer 2", 2)).toBeFocused();
    expect(errors).toEqual([]);
});

test("Enter in the layer properties popover, then → at once: the name is applied, the active frame moves and its cell has the focus", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openOnCell(page);
    await runCommands(page, ["layer.properties"]);
    const popover = blendPopover(page);
    await expect(popover).toBeVisible();
    const name = popover.getByRole("textbox", { name: "Name" });
    await expect(name).toBeFocused();
    await name.fill("Glow");

    await enterThenArrowRight(page);

    await expect(popover).toBeHidden();
    const state = await documentState(page);
    expect(state.layers[1]?.name).toBe("Glow");
    expect(state.activeFrame).toBe(2);
    // The row is named by the name the popover applied.
    await expect(cell(page, "Glow", 2)).toBeFocused();
    expect(errors).toEqual([]);
});

test("Enter in the cel properties popover, then a press on the canvas at once: the press paints", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await openOnCell(page);
    await runCommands(page, ["frame.celProperties"]);
    const popover = celPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    const field = popover.getByRole("spinbutton", { name: "Opacity" });
    await field.fill("128");
    const before = await historyOf(page, document.id);

    await enterThenPress(page, field);

    await expect(popover).toBeHidden();
    // The opacity step, then the pencil's stroke.
    await expect
        .poll(() => historyOf(page, document.id))
        .toEqual({
            undo: before.undo + 2,
            open: false,
        });
    expect((await documentState(page)).undoLabel).not.toBe("Cel Opacity");
    expect(errors).toEqual([]);
});

test("Enter in the layer properties popover, then a press on the canvas at once: the press paints", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await openOnCell(page);
    await runCommands(page, ["layer.properties"]);
    const popover = blendPopover(page);
    await expect(popover).toBeVisible();
    const name = popover.getByRole("textbox", { name: "Name" });
    await expect(name).toBeFocused();
    await name.fill("Glow");
    const before = await historyOf(page, document.id);

    await enterThenPress(page, name);

    await expect(popover).toBeHidden();
    await expect
        .poll(() => historyOf(page, document.id))
        .toEqual({
            undo: before.undo + 2,
            open: false,
        });
    const state = await documentState(page);
    expect(state.layers[1]?.name).toBe("Glow");
    expect(state.undoLabel).not.toBe("Rename Layer");
    expect(errors).toEqual([]);
});
