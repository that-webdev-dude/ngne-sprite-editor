import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its type.
import type * as CoreComposite from "../../src/core/composite";
import { collectErrors, settleTimers } from "./se-006-support";
import { menuItem, openMenu } from "./se-007-support";
import { expectImage, settle } from "./se-011-support";
import { activeCell, cell, documentState, grid, layerHeader, runCommands } from "./se-022-support";
import { openCels } from "./se-026-support";
import { addReference } from "./se-045-support";
import {
    VIEW,
    blendPopover,
    celPopover,
    exclusionOf,
    focusInside,
    layerBlend,
    multiplyOf,
    normalOver,
    openTwoLayers,
} from "./se-061-support";

// SE-061: the blend mode in the layer properties popover and the cel properties popover
// (DESIGN §7), each applied when its popover closes, in one undo step. The frame counts of the
// viewport are in se-061-viewport.spec.ts.

/** The blend modes the compositor has (SPEC §5.1 `BlendMode`), from the page's own module. */
function blendModes(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
        const path = "/src/core/composite/index.ts";
        const composite = (await import(/* @vite-ignore */ path)) as typeof CoreComposite;
        return Object.keys(composite.BLEND_FUNCTIONS);
    });
}

/** The open context menu of the timeline, by its name. */
const contextMenu = (page: Page, name: string) => page.getByRole("menu", { name, exact: true });

test("the layer properties popover offers every blend mode; Enter in the select picks one and the popover applies it when it closes, in one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, lower, upper } = await openTwoLayers(page);
    const steps = (await documentState(page)).undoCount;

    await openMenu(page, "Layer");
    await menuItem(page, "layer.properties").click();
    const popover = blendPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    const select = popover.getByRole("combobox", { name: "Blend mode" });
    await expect(select).toHaveText("Normal");

    // The keyboard: ↓ opens the list on the current mode, ↓ again moves to the next, Enter
    // picks it and closes the list only.
    await select.focus();
    await page.keyboard.press("ArrowDown");
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await focusInside(listbox);
    const options = listbox.getByRole("option");
    await expect(options).toHaveCount((await blendModes(page)).length);
    const names = await options.allTextContents();
    expect(new Set(names).size).toBe(names.length);
    await expect(listbox.getByRole("option", { name: "Normal", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(listbox.getByRole("option", { name: "Multiply", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(listbox).toBeHidden();
    await expect(select).toHaveText("Multiply");
    await expect(popover).toBeVisible();
    await expect(select).toBeFocused();
    // Nothing changes while the popover is open.
    expect(await layerBlend(page, 1)).toBe("normal");
    expect((await documentState(page)).undoCount).toBe(steps);

    // Escape closes it and applies it, as for name and opacity.
    await settleTimers(page);
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    expect(await layerBlend(page, 1)).toBe("multiply");
    let state = await documentState(page);
    expect(state.undoCount).toBe(steps + 1);
    expect(state.undoLabel).toBe("Blend Mode");
    await settle(page);
    await expectImage(page, document, VIEW, multiplyOf(lower, upper));

    // With a new name, Enter in the name field applies both in one step.
    await openMenu(page, "Layer");
    await menuItem(page, "layer.properties").click();
    await expect(popover).toBeVisible();
    const name = popover.getByRole("textbox", { name: "Name" });
    await expect(name).toBeFocused();
    await expect(select).toHaveText("Multiply");
    await select.click();
    await focusInside(listbox);
    await listbox.getByRole("option", { name: "Exclusion", exact: true }).click();
    await expect(listbox).toBeHidden();
    await focusInside(popover);
    await name.fill("Glow");
    await name.press("Enter");
    await expect(popover).toBeHidden();
    expect(await layerBlend(page, 1)).toBe("exclusion");
    state = await documentState(page);
    expect(state.layers[1]?.name).toBe("Glow");
    expect(state.undoCount).toBe(steps + 2);
    expect(state.undoLabel).toBe("Layer Properties");
    await settle(page);
    await expectImage(page, document, VIEW, exclusionOf(lower, upper));

    // Undo takes the step back whole.
    await runCommands(page, ["edit.undo"]);
    expect(await layerBlend(page, 1)).toBe("multiply");
    expect((await documentState(page)).layers[1]?.name).toBe("Layer 2");
    await settle(page);
    await expectImage(page, document, VIEW, multiplyOf(lower, upper));
    expect(errors).toEqual([]);
});

test("a reference layer's popover has no blend mode", async ({ page }) => {
    const errors = collectErrors(page);
    await openTwoLayers(page);
    const id = await addReference(page, {
        kind: "flat",
        width: 4,
        height: 4,
        rgba: [9, 9, 9, 255],
    });
    expect(id).not.toBeNull();
    // Its opacity in the Reference group opens its popover.
    await grid(page)
        .getByRole("rowgroup", { name: "Reference" })
        .getByRole("button", { name: /^Opacity/ })
        .click();
    const popover = blendPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    await expect(popover.getByRole("button", { name: "Reset to Fit" })).toBeVisible();
    await expect(popover.getByRole("combobox", { name: "Blend mode" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await settleTimers(page);

    // A pixel layer's has one.
    await layerHeader(page, "Layer 2").locator(".timeline__name").click();
    await runCommands(page, ["layer.properties"]);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    await expect(popover.getByRole("combobox", { name: "Blend mode" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    expect(errors).toEqual([]);
});

test("Frame → Cel Properties… sets the active cel's opacity when its popover closes, in one undo step; it is disabled on an empty cel", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, lower, upper } = await openTwoLayers(page);
    const steps = (await documentState(page)).undoCount;

    await openMenu(page, "Frame");
    await menuItem(page, "frame.celProperties").click();
    const popover = celPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    const field = popover.getByRole("spinbutton", { name: "Opacity" });
    await expect(field).toHaveValue("255");
    await expect(popover.getByRole("status")).toHaveText("Not linked");
    await expect(popover.getByRole("button", { name: "Unlink" })).toBeDisabled();

    await field.fill("128");
    // Nothing changes while the popover is open.
    expect((await documentState(page)).cels.map((entry) => entry[2])).toEqual([255, 255]);
    await field.press("Enter");
    await expect(popover).toBeHidden();
    let state = await documentState(page);
    expect(state.undoCount).toBe(steps + 1);
    expect(state.undoLabel).toBe("Cel Opacity");
    expect(state.cels.map((entry) => entry[2]).sort()).toEqual([128, 255]);
    // The menu item that opened it is gone: the focus goes to the active cell.
    await expect(activeCell(page)).toBeFocused();
    await settle(page);
    await expectImage(page, document, VIEW, normalOver(lower, upper, 128));

    // Escape applies too.
    await runCommands(page, ["frame.celProperties"]);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    await expect(field).toHaveValue("128");
    await field.fill("0");
    await field.press("Tab");
    await focusInside(popover);
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    state = await documentState(page);
    expect(state.undoCount).toBe(steps + 2);
    await settle(page);
    await expectImage(page, document, VIEW, lower);

    await runCommands(page, ["edit.undo", "edit.undo"]);
    await settle(page);
    await expectImage(page, document, VIEW, upper);

    // An empty cel has no properties.
    await runCommands(page, ["frame.newEmpty"]);
    const frameMenu = await openMenu(page, "Frame");
    await focusInside(frameMenu);
    await expect(menuItem(page, "frame.celProperties")).toHaveAttribute("data-disabled", "");
    await page.keyboard.press("Escape");
    await expect(frameMenu).toBeHidden();
    expect(errors).toEqual([]);
});

test("the cel context menu opens Cel Properties… for the cel right-clicked; Unlink acts at once, a locked layer's cel is read-only", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 2, 3, ["Layer 1/1"]);
    // The cel of frame 2 shares the image of frame 1: linked.
    await page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const { doc } = document.session;
        const layer = doc.layers.find((entry) => entry.name === "Layer 1")!;
        const first = doc.cels.get(`${layer.id}:${doc.frames[0]!.id}`)!;
        doc.cels.set(`${layer.id}:${doc.frames[1]!.id}`, { ...first });
        state.touch(document.id);
    });
    const steps = (await documentState(page)).undoCount;

    await cell(page, "Layer 1", 2).click({ button: "right" });
    const menu = contextMenu(page, "Cel");
    await expect(menu).toBeVisible();
    await focusInside(menu);
    await menu.locator('[data-command="frame.celProperties"]').click();
    const popover = celPopover(page);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    let state = await documentState(page);
    expect([state.activeLayer, state.activeFrame]).toEqual(["Layer 1", 2]);
    await expect(popover.getByRole("status")).toHaveText("Linked to 1 other cel");

    const field = popover.getByRole("spinbutton", { name: "Opacity" });
    await field.fill("100");
    await field.press("Tab");
    await focusInside(popover);
    const unlink = popover.getByRole("button", { name: "Unlink" });
    await unlink.click();
    await expect(popover.getByRole("status")).toHaveText("Not linked");
    await expect(unlink).toBeDisabled();
    await expect(popover).toBeVisible();
    await expect(field).toBeFocused();
    state = await documentState(page);
    expect(state.undoCount).toBe(steps + 1);
    const layerId = state.layers[0]!.id;
    const keys = [0, 1].map((frame) => `${layerId}:${state.frames[frame]!.id}`);
    const images = Object.fromEntries(state.cels.map((entry) => [entry[0], entry[1]]));
    expect(images[keys[0]!]).toBeDefined();
    expect(images[keys[1]!]).toBeDefined();
    expect(images[keys[1]!]).not.toBe(images[keys[0]!]);

    await page.keyboard.press("Enter");
    await expect(popover).toBeHidden();
    state = await documentState(page);
    expect(state.undoCount).toBe(steps + 2);
    const opacities = Object.fromEntries(state.cels.map((entry) => [entry[0], entry[2]]));
    expect(opacities[keys[1]!]).toBe(100);
    expect(opacities[keys[0]!]).toBe(255);

    // On a locked layer the popover shows the cel and changes nothing.
    await layerHeader(page, "Layer 1").getByRole("button", { name: "Locked" }).click();
    await expect.poll(async () => (await documentState(page)).layers[0]?.locked).toBe(true);
    const locked = (await documentState(page)).undoCount;
    await settleTimers(page);
    await runCommands(page, ["frame.celProperties"]);
    await expect(popover).toBeVisible();
    await focusInside(popover);
    await expect(popover.getByRole("status")).toHaveText("Not linked; layer locked");
    await expect(field).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    expect((await documentState(page)).undoCount).toBe(locked);
    await expect(grid(page)).toBeVisible();
    expect(errors).toEqual([]);
});
