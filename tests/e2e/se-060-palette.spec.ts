import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { boxOf, collectErrors, region, settleTimers } from "./se-006-support";
import { openEditor, openSession } from "./se-007-support";
import { audit, startInTheme, THEMES } from "./se-008-support";
import { openDocument, openViewportEditor, settle } from "./se-011-support";
import { viewportArea } from "./se-012-support";
import { setColours } from "./se-015-support";
import {
    colourState,
    contextMenus,
    hex8,
    hexField,
    recordContextMenus,
    swatches,
} from "./se-016-support";
import {
    COLOURS,
    addButton,
    focusInside,
    focused,
    grid,
    history,
    menuItem,
    openPalettePanel,
    overflowButton,
    palette,
    palettePanel,
    presetsButton,
    setPalette,
    shownColours,
    swatchEditor,
} from "./se-060-support";
import { runFromPalette } from "./se-064-support";

// SE-060: the palette panel (DESIGN §5.4) — the grid of the document palette with the
// foreground's swatch marked, the preset menu, the add button and the overflow menu in the
// header, a swatch dragged to its new place or moved with Ctrl+arrow keys, a swatch edited in
// the picker popover — and every change of the palette one undo step.

test("Add current colour appends the foreground in one undo step, and is disabled while the palette holds it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    // The foreground is black, which the palette holds; its swatch is marked.
    await expect(addButton(page)).toBeDisabled();
    await expect(swatches(page).nth(0)).toHaveAttribute("aria-selected", "true");

    await setColours(page, 0x12345680, 0xffffffff);
    await expect(addButton(page)).toBeEnabled();
    await addButton(page).click();
    expect((await palette(page)).colors).toEqual([...COLOURS, 0x12345680]);
    await expect(swatches(page)).toHaveCount(COLOURS.length + 1);
    await expect(swatches(page).last()).toHaveAttribute("data-colour", hex8(0x12345680));
    await expect(swatches(page).last()).toHaveAttribute("aria-selected", "true");
    expect(await history(page)).toEqual({ undo: 1, label: "Add Current Colour" });
    await expect(addButton(page)).toBeDisabled();

    // A pointer press hands the focus to the viewport (SPEC §7.8): Ctrl+Z undoes the step.
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Control+z");
    expect((await palette(page)).colors).toEqual(COLOURS);
    await expect(swatches(page)).toHaveCount(COLOURS.length);
    await expect(addButton(page)).toBeEnabled();
    expect(errors).toEqual([]);
});

test("Remove Colour in the overflow menu takes out the current swatch in one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    await swatches(page).nth(2).click();
    await expect(swatches(page).nth(2)).toHaveAttribute("data-current", "");

    await overflowButton(page).click();
    const menu = page.getByRole("menu", { name: "Swatch actions" });
    await expect(menu).toBeVisible();
    await focusInside(menu);
    await expect(menuItem(menu, "Remove Colour")).toBeEnabled();
    await expect(menuItem(menu, "Edit Colour…")).toBeEnabled();
    await expect(menuItem(menu, "Palette from Sprite")).toBeEnabled();
    await menuItem(menu, "Remove Colour").click();
    await expect(menu).toBeHidden();
    expect((await palette(page)).colors).toEqual(COLOURS.filter((_, index) => index !== 2));
    expect(await shownColours(page)).toEqual(COLOURS.filter((_, index) => index !== 2).map(hex8));
    expect(await history(page)).toEqual({ undo: 1, label: "Remove Colour" });

    await settleTimers(page);
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Control+z");
    expect((await palette(page)).colors).toEqual(COLOURS);
    expect(errors).toEqual([]);
});

test("dragging a swatch moves it in one undo step; Escape or a release outside the grid leaves the order", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    const centre = async (index: number) => {
        const box = await boxOf(swatches(page).nth(index));
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const from = await centre(1);
    const to = await centre(4);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    // The grid shows the order the drop makes, the palette is unchanged until the release.
    const moved = [COLOURS[0], COLOURS[2], COLOURS[3], COLOURS[4], COLOURS[1], COLOURS[5]];
    expect(await shownColours(page)).toEqual(moved.map(hex8));
    expect((await palette(page)).colors).toEqual(COLOURS);
    await page.mouse.up();
    expect((await palette(page)).colors).toEqual(moved);
    expect(await shownColours(page)).toEqual(moved.map(hex8));
    expect(await history(page)).toEqual({ undo: 1, label: "Move Colour" });
    // The swatch dragged is the foreground's and the current one, at its new place.
    await expect(swatches(page).nth(4)).toHaveAttribute("aria-selected", "true");
    await expect(swatches(page).nth(4)).toHaveAttribute("data-current", "");

    await page.keyboard.press("Control+z");
    expect((await palette(page)).colors).toEqual(COLOURS);

    // Escape during the drag: nothing moves.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    expect(await shownColours(page)).toEqual(moved.map(hex8));
    await page.keyboard.press("Escape");
    expect(await shownColours(page)).toEqual(COLOURS.map(hex8));
    await page.mouse.move(to.x + 1, to.y, { steps: 2 });
    await page.mouse.up();
    expect((await palette(page)).colors).toEqual(COLOURS);

    // A release outside the grid: nothing moves.
    const outside = await boxOf(viewportArea(page));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    expect(await shownColours(page)).toEqual(moved.map(hex8));
    await page.mouse.move(outside.x + outside.width / 2, outside.y + 40, { steps: 6 });
    expect(await shownColours(page)).toEqual(COLOURS.map(hex8));
    await page.mouse.up();
    expect((await palette(page)).colors).toEqual(COLOURS);
    // Only the first drag was recorded, and it was undone.
    expect((await history(page)).undo).toBe(0);
    expect(errors).toEqual([]);
});

test("Ctrl+arrow keys move the focused swatch, one undo step each, and the focus goes with it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    const tops = await swatches(page).evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().top),
    );
    const columns = tops.filter((top) => top === tops[0]).length;
    // Enough columns that every swatch shares the first row.
    expect(columns).toBe(COLOURS.length);

    await swatches(page).nth(1).focus();
    await focused(page, 1);
    await page.keyboard.press("Control+ArrowRight");
    await focused(page, 2);
    expect((await palette(page)).colors).toEqual([
        COLOURS[0],
        COLOURS[2],
        COLOURS[1],
        COLOURS[3],
        COLOURS[4],
        COLOURS[5],
    ]);
    expect(await history(page)).toEqual({ undo: 1, label: "Move Colour" });
    await page.keyboard.press("Control+ArrowLeft");
    await focused(page, 1);
    await page.keyboard.press("Control+ArrowLeft");
    await focused(page, 0);
    expect((await palette(page)).colors).toEqual([
        COLOURS[1],
        COLOURS[0],
        COLOURS[2],
        COLOURS[3],
        COLOURS[4],
        COLOURS[5],
    ]);
    expect((await history(page)).undo).toBe(3);
    // At the edge, and up or down out of the grid: nothing moves, nothing is recorded.
    await page.keyboard.press("Control+ArrowLeft");
    await page.keyboard.press("Control+ArrowUp");
    await page.keyboard.press("Control+ArrowDown");
    await focused(page, 0);
    expect((await history(page)).undo).toBe(3);

    // Ctrl+Z from the swatch undoes the moves one by one.
    await page.keyboard.press("Control+z");
    expect((await palette(page)).colors).toEqual([
        COLOURS[0],
        COLOURS[1],
        COLOURS[2],
        COLOURS[3],
        COLOURS[4],
        COLOURS[5],
    ]);
    expect((await history(page)).undo).toBe(2);
    expect(errors).toEqual([]);
});

test("Ctrl+Up and Ctrl+Down move a swatch by a row", async ({ page }) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    const many = Array.from({ length: 40 }, (_, index) => ((index * 0x050301) << 8) | 0xff).map(
        (colour) => colour >>> 0,
    );
    await setPalette(page, many);
    await expect(swatches(page)).toHaveCount(40);
    const tops = await swatches(page).evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().top),
    );
    const columns = tops.filter((top) => top === tops[0]).length;
    expect(columns).toBeLessThan(40);

    await swatches(page).nth(2).focus();
    await focused(page, 2);
    await page.keyboard.press("Control+ArrowDown");
    await focused(page, 2 + columns);
    const colors = (await palette(page)).colors;
    expect(colors[2 + columns]).toBe(many[2]);
    expect(colors.length).toBe(40);
    await page.keyboard.press("Control+ArrowUp");
    await focused(page, 2);
    expect((await palette(page)).colors).toEqual(many);
    expect((await history(page)).undo).toBe(2);
    expect(errors).toEqual([]);
});

test("Edit Colour… opens the picker beside the swatch; the palette takes its colour in one undo step when it closes", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    // From the keyboard: the Menu key on a swatch opens the overflow menu.
    await swatches(page).nth(3).focus();
    await focused(page, 3);
    await page.keyboard.press("ContextMenu");
    const menu = page.getByRole("menu", { name: "Swatch actions" });
    await expect(menu).toBeVisible();
    await focusInside(menu);
    await expect(menuItem(menu, "Remove Colour")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menuItem(menu, "Edit Colour…")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();

    const editor = swatchEditor(page);
    await expect(editor).toBeVisible();
    await focusInside(editor);
    // Beside the grid, hiding no swatch.
    const editorBox = await boxOf(editor);
    const gridBox = await boxOf(grid(page));
    expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(gridBox.x);
    // The picker edits the swatch's colour, and the swatch shows it before the palette has it.
    const hex = editor.getByRole("textbox", { name: "Hex", exact: true });
    await expect(hex).toHaveValue("#0000FF");
    await hex.fill("#336699");
    await page.keyboard.press("Enter");
    await expect(swatches(page).nth(3).locator(".palette-grid__fill")).toHaveCSS(
        "background-color",
        "rgb(51, 102, 153)",
    );
    expect((await palette(page)).colors).toEqual(COLOURS);
    expect((await history(page)).undo).toBe(0);
    // The dock's colour panel is not the one edited.
    await expect(hexField(page)).toHaveValue("#000000");

    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    const edited = [...COLOURS];
    edited[3] = 0x336699ff;
    expect((await palette(page)).colors).toEqual(edited);
    expect(await history(page)).toEqual({ undo: 1, label: "Edit Colour" });
    await focused(page, 3);
    // The foreground keeps its colour.
    expect((await colourState(page)).foreground).toBe(0x000000ff);

    await page.keyboard.press("Control+z");
    expect((await palette(page)).colors).toEqual(COLOURS);
    expect(errors).toEqual([]);
});

test("a press on the canvas ends a swatch edit before it paints; a double click opens the editor", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openViewportEditor(page);
    await openDocument(page, { width: 16, height: 16 });
    await settle(page);
    await setPalette(page, COLOURS);
    await expect(swatches(page)).toHaveCount(COLOURS.length);

    await swatches(page).nth(1).dblclick();
    const editor = swatchEditor(page);
    await expect(editor).toBeVisible();
    await focusInside(editor);
    // A double click is a press too: the foreground is the swatch's colour.
    expect((await colourState(page)).foreground).toBe(COLOURS[1]);
    const hex = editor.getByRole("textbox", { name: "Hex", exact: true });
    await expect(hex).toHaveValue("#FF0000");
    // Typed and not applied yet: the press outside applies it, as leaving the field would.
    await hex.fill("#00FFFF80");
    await settleTimers(page);

    const viewport = await boxOf(viewportArea(page));
    await page.mouse.click(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    await expect(editor).toBeHidden();
    const edited = [...COLOURS];
    edited[1] = 0x00ffff80;
    expect((await palette(page)).colors).toEqual(edited);
    // The edit came first, then the stroke the press began.
    const after = await history(page);
    expect(after.undo).toBe(2);
    expect(after.label).not.toBe("Edit Colour");
    await page.keyboard.press("Control+z");
    expect(await history(page)).toEqual({ undo: 1, label: "Edit Colour" });
    await page.keyboard.press("Control+z");
    expect((await palette(page)).colors).toEqual(COLOURS);

    // A press on the swatch being edited ends the edit first, and picks the colour it gave.
    await swatches(page).nth(2).dblclick();
    await expect(editor).toBeVisible();
    await focusInside(editor);
    await editor.getByRole("textbox", { name: "Hex", exact: true }).fill("#123456");
    await settleTimers(page);
    await swatches(page).nth(2).click();
    await expect(editor).toBeHidden();
    expect((await palette(page)).colors[2]).toBe(0x123456ff);
    expect((await colourState(page)).foreground).toBe(0x123456ff);
    await expect(swatches(page).nth(2)).toHaveAttribute("aria-selected", "true");
    expect(await history(page)).toEqual({ undo: 1, label: "Edit Colour" });
    expect(errors).toEqual([]);
});

test("Edit Colour… from the command palette opens the editor beside the header while the section is collapsed", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    const toggle = region(page, "dock").getByRole("button", { name: "Palette", exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(swatches(page)).toHaveCount(0);
    await expect(viewportArea(page)).toBeFocused();

    await runFromPalette(page, "palette.editColour");
    const editor = swatchEditor(page);
    await expect(editor).toBeVisible();
    await focusInside(editor);
    const editorBox = await boxOf(editor);
    expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(
        (await boxOf(overflowButton(page))).x,
    );
    // The current swatch: the first, black.
    const hex = editor.getByRole("textbox", { name: "Hex", exact: true });
    await expect(hex).toHaveValue("#000000");
    await hex.fill("#445566");
    await page.keyboard.press("Enter");
    await expect(hex).toHaveValue("#445566");
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    expect((await palette(page)).colors).toEqual([0x445566ff, ...COLOURS.slice(1)]);
    expect(await history(page)).toEqual({ undo: 1, label: "Edit Colour" });
    // No swatch on the page: the focus goes to the overflow menu's button.
    await expect(overflowButton(page)).toBeFocused();
    expect(errors).toEqual([]);
});

test("loading a preset from the palette name replaces the palette in one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    await expect(presetsButton(page)).toHaveAccessibleName("Presets (Test)");
    await presetsButton(page).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await focusInside(menu);
    const names = await menu.getByRole("menuitem").allTextContents();
    // The presets of core/palettes, by name (SE-043).
    expect(names).toContain("PICO-8");
    expect(names).toContain("DawnBringer 32");
    await menuItem(menu, "PICO-8").click();
    await expect(menu).toBeHidden();

    const loaded = await palette(page);
    expect(loaded.name).toBe("PICO-8");
    expect(loaded.colors).toHaveLength(16);
    expect(loaded.colors[0]).toBe(0x000000ff);
    await expect(swatches(page)).toHaveCount(16);
    await expect(presetsButton(page)).toHaveAccessibleName("Presets (PICO-8)");
    expect(await history(page)).toEqual({ undo: 1, label: "Load PICO-8 Palette" });

    await settleTimers(page);
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Control+z");
    expect(await palette(page)).toEqual({ name: "Test", colors: COLOURS });
    await expect(swatches(page)).toHaveCount(COLOURS.length);
    expect(errors).toEqual([]);
});

test("Palette from Sprite replaces the palette with the sprite's colours in one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    // Two colours painted as test hooks into the active cel.
    await page.evaluate(() => {
        const sessions = window.__ngneTest!.sessions.getState();
        const document = sessions.documents.find((entry) => entry.id === sessions.activeId)!;
        const { doc, activeLayerId, activeFrameId } = document.session;
        const data = new Uint8ClampedArray(doc.width * doc.height * 4);
        data.set([0x20, 0x40, 0x60, 0xff], 0);
        data.set([0xc0, 0x80, 0x40, 0xff], 4);
        doc.images.set("se060-image", { width: doc.width, height: doc.height, data });
        doc.cels.set(`${activeLayerId}:${activeFrameId}`, { imageId: "se060-image", opacity: 255 });
        sessions.touch(document.id);
    });
    await overflowButton(page).click();
    const menu = page.getByRole("menu", { name: "Swatch actions" });
    await expect(menu).toBeVisible();
    await focusInside(menu);
    await menuItem(menu, "Palette from Sprite").click();
    await expect(menu).toBeHidden();
    expect(await palette(page)).toEqual({ name: "palette", colors: [0x204060ff, 0xc08040ff] });
    expect(await history(page)).toEqual({ undo: 1, label: "Palette from Sprite" });
    await expect(swatches(page)).toHaveCount(2);
    expect(errors).toEqual([]);
});

test("arrow keys move swatch focus; Enter sets the foreground; Shift+Enter the background; the Menu key and Shift+F10 open the overflow menu", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    await recordContextMenus(page);
    await swatches(page).nth(0).focus();
    await focused(page, 0);
    await page.keyboard.press("ArrowRight");
    await focused(page, 1);
    await expect(swatches(page).nth(1)).toHaveAttribute("tabindex", "0");
    await page.keyboard.press("Enter");
    expect((await colourState(page)).foreground).toBe(COLOURS[1]);
    await expect(swatches(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await focused(page, COLOURS.length - 1);
    await page.keyboard.press("ArrowLeft");
    await focused(page, COLOURS.length - 2);
    await page.keyboard.press("Shift+Enter");
    expect(await colourState(page)).toMatchObject({
        foreground: COLOURS[1],
        background: COLOURS[COLOURS.length - 2],
    });
    await page.keyboard.press("Home");
    await focused(page, 0);
    // The canvas keys still act from a focused swatch (SPEC §7.8): X swaps the colours.
    await page.keyboard.press("x");
    expect(await colourState(page)).toMatchObject({
        foreground: COLOURS[COLOURS.length - 2],
        background: COLOURS[1],
    });
    await focused(page, 0);

    // The Menu key: the overflow menu, then Escape gives the swatch the focus back.
    await page.keyboard.press("ArrowRight");
    await focused(page, 1);
    await page.keyboard.press("ContextMenu");
    const menu = page.getByRole("menu", { name: "Swatch actions" });
    await expect(menu).toBeVisible();
    await focusInside(menu);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await focused(page, 1);
    // Shift+F10 the same.
    await page.keyboard.press("Shift+F10");
    await expect(menu).toBeVisible();
    await focusInside(menu);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await focused(page, 1);
    // No browser menu came up for any of it.
    expect((await contextMenus(page)).every((entry) => entry.prevented)).toBe(true);
    expect((await history(page)).undo).toBe(0);
    expect(errors).toEqual([]);
});

test("a right click on a swatch sets the background and opens no menu", async ({ page }) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    await recordContextMenus(page);
    await swatches(page).nth(2).click({ button: "right" });
    expect((await colourState(page)).background).toBe(COLOURS[2]);
    await expect(page.getByRole("menu")).toHaveCount(0);
    const menus = await contextMenus(page);
    expect(menus.length).toBeGreaterThan(0);
    expect(menus.every((entry) => entry.prevented)).toBe(true);
    // A right press that ends over the canvas (Windows sends the menu at the release).
    const from = await boxOf(swatches(page).nth(4));
    const canvas = await boxOf(viewportArea(page));
    await page.mouse.move(from.x + 8, from.y + 8);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, {
        steps: 5,
    });
    await page.mouse.up({ button: "right" });
    expect((await colourState(page)).background).toBe(COLOURS[4]);
    expect((await contextMenus(page)).every((entry) => entry.prevented)).toBe(true);
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect((await palette(page)).colors).toEqual(COLOURS);
    expect(errors).toEqual([]);
});

/** The colours of the current swatch's mark and of the tokens it is drawn in, as CSS rgb(). */
function currentMark(page: Page, index: number) {
    return swatches(page)
        .nth(index)
        .evaluate((element) => {
            const resolve = (value: string) => {
                const probe = document.createElement("span");
                probe.style.color = value;
                document.body.append(probe);
                const rgb = getComputedStyle(probe).color;
                probe.remove();
                return rgb;
            };
            const style = getComputedStyle(element, "::after");
            return {
                content: style.content,
                size: [style.width, style.height],
                fill: style.backgroundColor,
                ring: style.borderTopColor,
                text: resolve("var(--text)"),
                workspace: resolve("var(--bg-workspace)"),
            };
        });
}

/** The WCAG contrast ratio of two CSS rgb() colours. */
function contrast(a: string, b: string): number {
    const luminance = (rgb: string) => {
        const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const linear = (channel: number) => {
            const c = channel / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

test("the current swatch has a mark of its own, which follows a right press; Remove takes out the marked swatch", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    const marked = palettePanel(page).locator("[data-current]");
    await expect(marked).toHaveCount(1);
    await expect(swatches(page).nth(0)).toHaveAttribute("data-current", "");
    // A dot of --text in a ring of --bg-workspace, beside the foreground's accent outline.
    const mark = await currentMark(page, 0);
    expect(mark.content).not.toBe("none");
    expect(mark.size).toEqual(["6px", "6px"]);
    expect(mark.fill).toBe(mark.text);
    expect(mark.ring).toBe(mark.workspace);
    expect(await currentMark(page, 1)).toMatchObject({ content: "none" });

    // A right press sets the background and makes the swatch the current one.
    await swatches(page).nth(3).click({ button: "right" });
    expect((await colourState(page)).background).toBe(COLOURS[3]);
    await expect(marked).toHaveCount(1);
    await expect(swatches(page).nth(3)).toHaveAttribute("data-current", "");
    // The foreground's outline stays on its own swatch.
    await expect(swatches(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(swatches(page).nth(3)).toHaveAttribute("aria-selected", "false");

    await overflowButton(page).click();
    const menu = page.getByRole("menu", { name: "Swatch actions" });
    await expect(menu).toBeVisible();
    await focusInside(menu);
    await menuItem(menu, "Remove Colour").click();
    await expect(menu).toBeHidden();
    expect((await palette(page)).colors).toEqual(COLOURS.filter((_, index) => index !== 3));
    expect(await history(page)).toEqual({ undo: 1, label: "Remove Colour" });
    // The mark stays at the same place, now on the colour after the one removed.
    await expect(swatches(page).nth(3)).toHaveAttribute("data-current", "");
    await expect(swatches(page).nth(3)).toHaveAttribute("data-colour", hex8(COLOURS[4]));
    expect(errors).toEqual([]);
});

test("an undo during a drag ends the move: the release moves nothing", async ({ page }) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    await setColours(page, 0x12345680, 0xffffffff);
    await addButton(page).click();
    const added = [...COLOURS, 0x12345680];
    expect((await palette(page)).colors).toEqual(added);
    const centre = async (index: number) => {
        const box = await boxOf(swatches(page).nth(index));
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const from = await centre(1);
    const to = await centre(4);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    const moved = [added[0], added[2], added[3], added[4], added[1], added[5], added[6]];
    expect(await shownColours(page)).toEqual(moved.map(hex8));
    // The pressed swatch has the focus: Ctrl+Z reaches the history.
    await page.keyboard.press("Control+z");
    expect((await palette(page)).colors).toEqual(COLOURS);
    await expect.poll(() => shownColours(page)).toEqual(COLOURS.map(hex8));
    await page.mouse.move(to.x + 1, to.y, { steps: 2 });
    expect(await shownColours(page)).toEqual(COLOURS.map(hex8));
    await page.mouse.up();
    expect((await palette(page)).colors).toEqual(COLOURS);
    // The add was undone and nothing was recorded since.
    expect((await history(page)).undo).toBe(0);
    expect(errors).toEqual([]);
});

test("an edit open when another document becomes active goes to its own document, and its popover does not come back", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    const first = await page.evaluate(() => window.__ngneTest!.sessions.getState().activeId!);
    const second = await openSession(page, { name: "other", width: 8, height: 8 });
    const activate = (id: string) =>
        page.evaluate((id) => window.__ngneTest!.sessions.getState().activate(id), id);
    await activate(first);
    await expect(swatches(page)).toHaveCount(COLOURS.length);

    await swatches(page).nth(2).dblclick();
    const editor = swatchEditor(page);
    await expect(editor).toBeVisible();
    await focusInside(editor);
    const hex = editor.getByRole("textbox", { name: "Hex", exact: true });
    await hex.fill("#ABCDEF");
    await page.keyboard.press("Enter");
    await expect(hex).toHaveValue("#ABCDEF");

    await activate(second);
    await expect(editor).toBeHidden();
    const histories = await page.evaluate(
        (ids) =>
            ids.map((id) => {
                const document = window
                    .__ngneTest!.sessions.getState()
                    .documents.find((entry) => entry.id === id)!;
                return {
                    colors: [...document.session.doc.palette.colors],
                    undo: document.history.undoCount,
                    label: document.history.undoLabel,
                };
            }),
        [first, second],
    );
    const edited = [...COLOURS];
    edited[2] = 0xabcdefff;
    expect(histories[0]).toEqual({ colors: edited, undo: 1, label: "Edit Colour" });
    expect(histories[1].undo).toBe(0);
    expect(histories[1].colors).not.toContain(0xabcdefff);

    // Back on the first document, no editor comes back.
    await activate(first);
    await expect(swatches(page).nth(2)).toHaveAttribute("data-colour", hex8(0xabcdefff));
    await settleTimers(page);
    await expect(editor).toHaveCount(0);
    expect(errors).toEqual([]);
});

for (const theme of THEMES) {
    test(`axe reports no AA violations on the palette panel, its menus and the swatch editor in the ${theme} theme`, async ({
        page,
    }) => {
        // Several audits in one test: about 10 s alone, longer while other workers are busy.
        test.setTimeout(90_000);
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width: 1440, height: 900 });
        await startInTheme(page, theme);
        await openEditor(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await openSession(page, { name: "colours", width: 16, height: 16 });
        await expect(swatches(page).first()).toBeVisible();
        await setColours(page, 0x12ab9f80, 0xffffffff);

        // The audit covers the current swatch's mark as well.
        await expect(palettePanel(page).locator("[data-current]")).toHaveCount(1);
        const panel = await audit(page, '[data-dock-panel="palette"]');
        expect(panel.violations).toEqual([]);
        expect(panel.contrastUndecided).toEqual([]);
        expect(panel.contrastChecked).toBeGreaterThan(0);
        // axe judges no mark that is not text: the mark's two tokens are checked here, the dot
        // against its ring, so one of them stands out on any swatch colour.
        const mark = await currentMark(page, 0);
        expect(mark.fill).toBe(mark.text);
        expect(mark.ring).toBe(mark.workspace);
        expect(contrast(mark.fill, mark.ring)).toBeGreaterThanOrEqual(4.5);

        await overflowButton(page).click();
        const menu = page.getByRole("menu", { name: "Swatch actions" });
        await expect(menu).toBeVisible();
        await focusInside(menu);
        const overflow = await audit(page, '[role="menu"]');
        expect(overflow.violations).toEqual([]);
        expect(overflow.contrastUndecided).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();

        await presetsButton(page).click();
        const presets = page.getByRole("menu");
        await expect(presets).toBeVisible();
        await focusInside(presets);
        const presetAudit = await audit(page, '[role="menu"]');
        expect(presetAudit.violations).toEqual([]);
        expect(presetAudit.contrastUndecided).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(presets).toBeHidden();

        await swatches(page).nth(4).dblclick();
        const editor = swatchEditor(page);
        await expect(editor).toBeVisible();
        await focusInside(editor);
        const editing = await audit(page, "[data-swatch-editor]");
        expect(editing.violations).toEqual([]);
        expect(editing.contrastUndecided).toEqual([]);
        expect(editing.contrastChecked).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });
}
