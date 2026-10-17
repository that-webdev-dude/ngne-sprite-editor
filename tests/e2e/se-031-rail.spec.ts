import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as ToolRegistryModule from "../../src/app/tools/toolRegistry";
import { collectErrors, region, settleTimers } from "./se-006-support";
import { openDocument, openViewportEditor, settle } from "./se-011-support";
import { viewportArea } from "./se-012-support";
import { toolsState } from "./se-014-support";

// SE-031: rail variants (DESIGN §5.1). A slot with variants shows the one selected last, with a
// corner mark; a click selects it; holding it, a right click or the Menu key opens the menu of
// its variants, where a choice selects one; a tool's key pressed again switches the variant.

/** The rail slots of the registry with more than one tool: slot id → tool ids. */
function variantSlots(page: Page): Promise<Record<string, string[]>> {
    return page.evaluate(async () => {
        const path = "/src/app/tools/toolRegistry.ts";
        const module = (await import(/* @vite-ignore */ path)) as typeof ToolRegistryModule;
        const slots: Record<string, string[]> = {};
        for (const slot of module.toolRegistry.railSlots()) {
            if (slot.variants.length > 1) slots[slot.id] = slot.variants.map((tool) => tool.id);
        }
        return slots;
    });
}

const slotButton = (page: Page, slot: string): Locator =>
    region(page, "tool-rail").locator(`[data-tool="${slot}"]`);

const variantsMenu = (page: Page, slot: string): Locator =>
    page.locator(`[role="menu"][data-tool-variants="${slot}"]`);

const variantItem = (page: Page, slot: string, tool: string): Locator =>
    variantsMenu(page, slot).locator(`[data-variant="${tool}"]`);

async function setUp(page: Page): Promise<void> {
    await openViewportEditor(page);
    await openDocument(page, { width: 16, height: 12 }, { scale: 8, originX: 40, originY: 24 });
    await settle(page);
}

test("a slot with variants shows a corner mark and the variant selected last; a key pressed again switches it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await setUp(page);
    const slots = await variantSlots(page);
    expect(slots.marquee?.slice(0, 2)).toEqual(["marquee", "ellipse-marquee"]);
    expect(slots.lasso?.slice(0, 2)).toEqual(["lasso", "polygon-lasso"]);
    // The corner mark exactly on the slots with variants.
    for (const id of await region(page, "tool-rail")
        .locator("[data-tool]")
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-tool")!))) {
        await expect(slotButton(page, id).locator(".tool-rail__corner"), id).toHaveCount(
            id in slots ? 1 : 0,
        );
    }

    const marquee = slotButton(page, "marquee");
    await expect(marquee).toHaveAttribute("data-tool-variant", "marquee");
    await expect(marquee).toHaveAccessibleName("Rectangular marquee");
    await viewportArea(page).focus();
    await page.keyboard.press("KeyM");
    await expect(marquee).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("KeyM");
    await expect(marquee).toHaveAttribute("data-tool-variant", "ellipse-marquee");
    await expect(marquee).toHaveAccessibleName("Elliptical marquee");
    await expect(marquee).toHaveAttribute("aria-pressed", "true");
    expect((await toolsState(page)).selected).toBe("ellipse-marquee");
    await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText(
        "Elliptical marquee",
    );

    // Another tool: the slot keeps showing the ellipse, and a click selects it.
    await page.keyboard.press("KeyB");
    await expect(marquee).toHaveAttribute("aria-pressed", "false");
    await expect(marquee).toHaveAttribute("data-tool-variant", "ellipse-marquee");
    await marquee.click();
    await expect(marquee).toHaveAttribute("aria-pressed", "true");
    expect((await toolsState(page)).selected).toBe("ellipse-marquee");
    await expect(viewportArea(page)).toBeFocused();
    // Shift+Q from the canvas: the polygon lasso; Q twice: the lasso, then its next variant.
    await page.keyboard.press("Shift+KeyQ");
    await expect(slotButton(page, "lasso")).toHaveAttribute("data-tool-variant", "polygon-lasso");
    await page.keyboard.press("KeyQ");
    await expect(slotButton(page, "lasso")).toHaveAttribute("data-tool-variant", "lasso");
    await page.keyboard.press("KeyQ");
    await expect(slotButton(page, "lasso")).toHaveAttribute("data-tool-variant", "polygon-lasso");
    expect(errors).toEqual([]);
});

test("holding the button opens the menu of its variants; a choice selects one and the focus goes to the viewport", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await setUp(page);
    const lasso = slotButton(page, "lasso");
    // The clicks the button gets.
    await lasso.evaluate((button) => {
        const clicks: number[] = [];
        (window as unknown as { __se031Clicks: number[] }).__se031Clicks = clicks;
        button.addEventListener("click", (event) => void clicks.push((event as MouseEvent).detail));
    });
    const box = (await lasso.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(variantsMenu(page, "lasso")).toBeVisible();
    await page.mouse.up();
    // The release over the button is a click on it, which selects nothing after the held press.
    await expect
        .poll(() =>
            page.evaluate(() => (window as unknown as { __se031Clicks: number[] }).__se031Clicks),
        )
        .toEqual([1]);
    await settleTimers(page);
    expect((await toolsState(page)).selected).toBe("pencil");
    await expect(variantsMenu(page, "lasso")).toBeVisible();
    await expect(variantItem(page, "lasso", "lasso")).toHaveAttribute("role", "menuitemradio");
    await expect(variantItem(page, "lasso", "lasso")).toHaveAttribute("aria-checked", "true");
    await expect(variantItem(page, "lasso", "polygon-lasso")).toHaveText(
        /Polygon lasso\s*Shift\+Q/,
    );
    await settleTimers(page);
    await variantItem(page, "lasso", "polygon-lasso").click();
    await expect(variantsMenu(page, "lasso")).toHaveCount(0);
    expect((await toolsState(page)).selected).toBe("polygon-lasso");
    await expect(lasso).toHaveAttribute("data-tool-variant", "polygon-lasso");
    await expect(lasso).toHaveAttribute("aria-pressed", "true");
    await expect(viewportArea(page)).toBeFocused();

    // Pressed, held, and released over an item: that item is chosen.
    const marquee = slotButton(page, "marquee");
    const marqueeBox = (await marquee.boundingBox())!;
    await page.mouse.move(
        marqueeBox.x + marqueeBox.width / 2,
        marqueeBox.y + marqueeBox.height / 2,
    );
    await page.mouse.down();
    const item = variantItem(page, "marquee", "ellipse-marquee");
    await expect(item).toBeVisible();
    const itemBox = (await item.boundingBox())!;
    await page.mouse.move(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2, {
        steps: 4,
    });
    await page.mouse.up();
    await expect(variantsMenu(page, "marquee")).toHaveCount(0);
    expect((await toolsState(page)).selected).toBe("ellipse-marquee");
    await expect(viewportArea(page)).toBeFocused();
    expect(errors).toEqual([]);
});

test("after a held press released off the button and Escape, Space on the button selects its variant", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await setUp(page);
    const marquee = slotButton(page, "marquee");
    const box = (await marquee.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(variantsMenu(page, "marquee")).toBeVisible();
    // Released over the viewport, where no press began: no click reaches the button.
    const viewport = (await viewportArea(page).boundingBox())!;
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2, {
        steps: 3,
    });
    await page.mouse.up();
    await expect(variantsMenu(page, "marquee")).toBeVisible();
    await expect
        .poll(() =>
            variantsMenu(page, "marquee").evaluate((menu) =>
                menu.contains(menu.ownerDocument.activeElement),
            ),
        )
        .toBe(true);
    await page.keyboard.press("Escape");
    await expect(variantsMenu(page, "marquee")).toHaveCount(0);
    await expect(marquee).toBeFocused();
    await settleTimers(page);
    await expect(marquee).toBeFocused();
    expect((await toolsState(page)).selected).toBe("pencil");
    await page.keyboard.press("Space");
    await expect.poll(async () => (await toolsState(page)).selected).toBe("marquee");
    // A keyboard activation keeps the focus on the button.
    await expect(marquee).toBeFocused();
    expect(errors).toEqual([]);
});

test("a right click and the Menu key open the menu too; from the keyboard the focus comes back to the button", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await setUp(page);
    const marquee = slotButton(page, "marquee");
    await marquee.click({ button: "right" });
    await expect(variantsMenu(page, "marquee")).toBeVisible();
    expect((await toolsState(page)).selected).toBe("pencil");
    await expect
        .poll(() =>
            variantsMenu(page, "marquee").evaluate((menu) =>
                menu.contains(menu.ownerDocument.activeElement),
            ),
        )
        .toBe(true);
    await page.keyboard.press("Escape");
    await expect(variantsMenu(page, "marquee")).toHaveCount(0);
    expect((await toolsState(page)).selected).toBe("pencil");

    await marquee.focus();
    await expect(marquee).toBeFocused();
    await page.keyboard.press("Shift+F10");
    await expect(variantItem(page, "marquee", "marquee")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(variantItem(page, "marquee", "ellipse-marquee")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(variantsMenu(page, "marquee")).toHaveCount(0);
    expect((await toolsState(page)).selected).toBe("ellipse-marquee");
    await expect(marquee).toBeFocused();
    await settleTimers(page);
    await expect(marquee).toBeFocused();

    // The Menu key the same.
    await page.keyboard.press("ContextMenu");
    await expect(variantItem(page, "marquee", "marquee")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(variantsMenu(page, "marquee")).toHaveCount(0);
    expect((await toolsState(page)).selected).toBe("marquee");
    await expect(marquee).toBeFocused();
    expect(errors).toEqual([]);
});
