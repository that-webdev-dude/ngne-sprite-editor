import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { boxOf, collectErrors } from "./se-006-support";
import {
    closeMenu,
    menuItem,
    menuTrigger,
    openEditor,
    openMenu,
    openSession,
} from "./se-007-support";
import {
    activeDocument,
    dialogButton,
    documentName,
    field,
    group,
    nameField,
    newSpriteButton,
    newSpriteDialog,
    openProperties,
    pivotPreset,
    propertiesDialog,
    setNumber,
    storeSnapshot,
} from "./se-008-support";

// SE-008: the Sprite properties dialog (SPEC §7.7, DESIGN §7) — name and pivot through undoable
// commands, grid size and offset as view preferences without a history entry (SPEC §5.2).

const ok = (dialog: Locator) => dialogButton(dialog, "OK");
const pivotX = (dialog: Locator) => field(group(dialog, "Pivot"), "X");
const pivotY = (dialog: Locator) => field(group(dialog, "Pivot"), "Y");
const gridWidth = (dialog: Locator) => field(group(dialog, "Grid size"), "Width");
const gridHeight = (dialog: Locator) => field(group(dialog, "Grid size"), "Height");
const offsetX = (dialog: Locator) => field(group(dialog, "Grid offset"), "X");
const offsetY = (dialog: Locator) => field(group(dialog, "Grid offset"), "Y");
const checkedPreset = (dialog: Locator) =>
    dialog.getByRole("radiogroup", { name: "Pivot presets" }).getByRole("radio", { checked: true });

/** Opens the app with a 32×32 document named "hero". */
async function openHero(page: Page): Promise<string> {
    await openEditor(page);
    return openSession(page, { name: "hero", width: 32, height: 32 });
}

/** Closes the dialog with OK and waits until it is gone. */
async function confirm(dialog: Locator): Promise<void> {
    await ok(dialog).click();
    await expect(dialog).toBeHidden();
}

/** The titles of Undo and Redo in the Edit menu, with whether Undo is enabled. */
async function editMenu(page: Page) {
    await openMenu(page, "Edit");
    const undo = menuItem(page, "edit.undo");
    const result = {
        undo: await undo.textContent(),
        redo: await menuItem(page, "edit.redo").textContent(),
        undoEnabled: (await undo.getAttribute("aria-disabled")) !== "true",
    };
    await closeMenu(page);
    return result;
}

test("the dialog shows the name, pivot and grid of the active document", async ({ page }) => {
    const id = await openHero(page);
    await page.evaluate((id) => {
        const sessions = window.__ngneTest!.sessions.getState();
        sessions.updateDocSettings(id, (settings) => {
            Object.assign(settings.grid, { width: 8, height: 4, offsetX: 2, offsetY: -1 });
        });
    }, id);

    const dialog = await openProperties(page);
    await expect(dialog.getByRole("heading", { name: "Sprite properties" })).toBeVisible();
    await expect(nameField(dialog)).toHaveValue("hero");
    await expect(nameField(dialog)).toBeFocused();
    // The pivot is normalized (SPEC §5.1): the centre of a new document.
    await expect(pivotX(dialog)).toHaveValue("0.50");
    await expect(pivotY(dialog)).toHaveValue("0.50");
    await expect(checkedPreset(dialog)).toHaveAccessibleName("Centre");
    await expect(gridWidth(dialog)).toHaveValue("8");
    await expect(gridHeight(dialog)).toHaveValue("4");
    await expect(offsetX(dialog)).toHaveValue("2");
    await expect(offsetY(dialog)).toHaveValue("-1");
    await expect(ok(dialog)).toBeEnabled();
    expect((await boxOf(dialog)).width).toBe(560);
});

test("Properties is disabled while no document is open", async ({ page }) => {
    await openEditor(page);
    await openMenu(page, "Sprite");
    await expect(menuItem(page, "sprite.properties")).toHaveText("Properties…");
    await expect(menuItem(page, "sprite.properties")).toHaveAttribute("aria-disabled", "true");
    await menuItem(page, "sprite.properties").click({ force: true });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await closeMenu(page);

    // It follows the store: enabled once a document is open.
    await openSession(page, { name: "hero", width: 8, height: 8 });
    await openMenu(page, "Sprite");
    await expect(menuItem(page, "sprite.properties")).not.toHaveAttribute("aria-disabled", "true");
});

test("setting pivot to bottom-centre stores { x: 0.5, y: 1 }; undo restores the previous value", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openHero(page);

    let dialog = await openProperties(page);
    await pivotPreset(dialog, "Bottom centre").click();
    await expect(pivotPreset(dialog, "Bottom centre")).toBeChecked();
    await expect(pivotX(dialog)).toHaveValue("0.50");
    await expect(pivotY(dialog)).toHaveValue("1.00");
    // Nothing is stored before OK.
    expect((await activeDocument(page)).pivot).toEqual({ x: 0.5, y: 0.5 });
    await confirm(dialog);

    expect(await activeDocument(page)).toMatchObject({
        pivot: { x: 0.5, y: 1 },
        undoCount: 1,
        undoLabel: "Set Pivot",
    });
    expect(await editMenu(page)).toMatchObject({ undo: "Undo Set PivotCtrl+Z" });

    // Undo restores the previous value; redo sets bottom-centre again.
    await page.keyboard.press("Control+KeyZ");
    expect(await activeDocument(page)).toMatchObject({ pivot: { x: 0.5, y: 0.5 }, undoCount: 0 });
    await page.keyboard.press("Control+KeyY");
    expect((await activeDocument(page)).pivot).toEqual({ x: 0.5, y: 1 });

    // The previous value is whatever it was, not the default: bottom-centre → top-right → undo.
    dialog = await openProperties(page);
    await expect(checkedPreset(dialog)).toHaveAccessibleName("Bottom centre");
    await pivotPreset(dialog, "Top right").click();
    await confirm(dialog);
    expect((await activeDocument(page)).pivot).toEqual({ x: 1, y: 0 });
    await page.keyboard.press("Control+KeyZ");
    expect((await activeDocument(page)).pivot).toEqual({ x: 0.5, y: 1 });
    await page.keyboard.press("Control+KeyZ");
    expect((await activeDocument(page)).pivot).toEqual({ x: 0.5, y: 0.5 });

    await page.evaluate(() => window.__ngneTest!.assertInvariants());
    expect(errors).toEqual([]);
});

test("the nine pivot presets store their corner, edge or centre", async ({ page }) => {
    await openHero(page);
    const presets: [name: string, x: number, y: number][] = [
        ["Top left", 0, 0],
        ["Top centre", 0.5, 0],
        ["Top right", 1, 0],
        ["Centre left", 0, 0.5],
        ["Centre right", 1, 0.5],
        ["Bottom left", 0, 1],
        ["Bottom centre", 0.5, 1],
        ["Bottom right", 1, 1],
        ["Centre", 0.5, 0.5],
    ];
    for (const [name, x, y] of presets) {
        const dialog = await openProperties(page);
        await pivotPreset(dialog, name).click();
        await confirm(dialog);
        expect((await activeDocument(page)).pivot, name).toEqual({ x, y });
    }

    // Laid out like the canvas, three by three, each a pointer target of 24×24 px.
    const dialog = await openProperties(page);
    const cells = dialog.getByRole("radiogroup", { name: "Pivot presets" }).getByRole("radio");
    await expect(cells).toHaveCount(9);
    const boxes = [];
    for (const cell of await cells.all()) boxes.push(await boxOf(cell));
    for (const box of boxes) expect(box).toMatchObject({ width: 24, height: 24 });
    const [topLeft, topCentre, , centreLeft] = boxes;
    expect(topCentre?.x).toBeGreaterThan(topLeft?.x ?? Infinity);
    expect(topCentre?.y).toBe(topLeft?.y);
    expect(centreLeft?.x).toBe(topLeft?.x);
    expect(centreLeft?.y).toBeGreaterThan(topLeft?.y ?? Infinity);
});

test("the pivot can be typed: numeric X and Y from 0 to 1", async ({ page }) => {
    await openHero(page);
    let dialog = await openProperties(page);
    await setNumber(pivotX(dialog), "0.25");
    await setNumber(pivotY(dialog), "0.8");
    await expect(pivotX(dialog)).toHaveValue("0.25");
    await expect(pivotY(dialog)).toHaveValue("0.80");
    // Not one of the nine: no preset is checked.
    await expect(checkedPreset(dialog)).toHaveCount(0);
    await confirm(dialog);
    expect(await activeDocument(page)).toMatchObject({
        pivot: { x: 0.25, y: 0.8 },
        undoLabel: "Set Pivot",
    });

    // The fields keep the pivot inside 0..1 and step by hundredths, with Shift by tenths.
    dialog = await openProperties(page);
    await expect(pivotX(dialog)).toHaveValue("0.25");
    await setNumber(pivotX(dialog), "3");
    await expect(pivotX(dialog)).toHaveValue("1.00");
    await setNumber(pivotY(dialog), "-2");
    await expect(pivotY(dialog)).toHaveValue("0.00");
    // Typed values that land on a preset check it.
    await expect(checkedPreset(dialog)).toHaveAccessibleName("Top right");
    await pivotY(dialog).focus();
    await page.keyboard.press("ArrowUp");
    await expect(pivotY(dialog)).toHaveValue("0.01");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(pivotY(dialog)).toHaveValue("0.11");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    expect((await activeDocument(page)).pivot).toEqual({ x: 1, y: 0.11 });

    await page.keyboard.press("Control+KeyZ");
    expect((await activeDocument(page)).pivot).toEqual({ x: 0.25, y: 0.8 });
});

test("the pivot presets are one tab stop; arrow keys move the choice by one cell", async ({
    page,
}) => {
    await openHero(page);
    const dialog = await openProperties(page);
    // From the name field, Tab reaches the checked preset: the group is one stop.
    await page.keyboard.press("Tab");
    await expect(pivotPreset(dialog, "Centre")).toBeFocused();
    expect(
        await pivotPreset(dialog, "Centre").evaluate(
            (element) => getComputedStyle(element).outlineStyle,
        ),
    ).toBe("solid");

    await page.keyboard.press("ArrowDown");
    await expect(pivotPreset(dialog, "Bottom centre")).toBeFocused();
    await expect(pivotPreset(dialog, "Bottom centre")).toBeChecked();
    await expect(pivotY(dialog)).toHaveValue("1.00");
    // The edge of the grid: the choice stays.
    await page.keyboard.press("ArrowDown");
    await expect(pivotPreset(dialog, "Bottom centre")).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await expect(pivotPreset(dialog, "Bottom left")).toBeChecked();
    await expect(pivotX(dialog)).toHaveValue("0.00");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(pivotPreset(dialog, "Top left")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(pivotPreset(dialog, "Top right")).toBeChecked();
    await expect(checkedPreset(dialog)).toHaveCount(1);

    // One stop: the next Tab is the X field, and Shift+Tab comes back to the checked cell.
    await page.keyboard.press("Tab");
    await expect(pivotX(dialog)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(pivotPreset(dialog, "Top right")).toBeFocused();
    // Space and Enter choose the focused cell without closing the dialog.
    await pivotPreset(dialog, "Bottom centre").focus();
    await page.keyboard.press("Space");
    await expect(pivotPreset(dialog, "Bottom centre")).toBeChecked();
    await pivotPreset(dialog, "Centre").focus();
    await page.keyboard.press("Enter");
    await expect(pivotPreset(dialog, "Centre")).toBeChecked();
    await expect(dialog).toBeVisible();

    await pivotPreset(dialog, "Bottom centre").focus();
    await page.keyboard.press("Space");
    await confirm(dialog);
    expect((await activeDocument(page)).pivot).toEqual({ x: 0.5, y: 1 });
});

test("renaming the sprite updates the menu bar and is undoable", async ({ page }) => {
    const errors = collectErrors(page);
    await openHero(page);
    await expect(documentName(page)).toHaveText("hero");

    const dialog = await openProperties(page);
    await nameField(dialog).fill("villain");
    // Nothing changes before OK.
    await expect(documentName(page)).toHaveText("hero");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    await expect(documentName(page)).toHaveText("villain");
    expect(await activeDocument(page)).toMatchObject({
        name: "villain",
        undoCount: 1,
        undoLabel: "Rename Sprite",
        dirty: true,
    });
    expect(await editMenu(page)).toMatchObject({ undo: "Undo Rename SpriteCtrl+Z" });

    await page.keyboard.press("Control+KeyZ");
    await expect(documentName(page)).toHaveText("hero");
    expect(await activeDocument(page)).toMatchObject({ name: "hero", undoCount: 0, dirty: false });
    expect(await editMenu(page)).toMatchObject({ redo: "Redo Rename SpriteCtrl+Y" });
    await page.keyboard.press("Control+KeyY");
    await expect(documentName(page)).toHaveText("villain");
    expect((await activeDocument(page)).name).toBe("villain");

    // Undo from the Edit menu as well.
    await openMenu(page, "Edit");
    await menuItem(page, "edit.undo").click();
    await expect(documentName(page)).toHaveText("hero");
    await page.evaluate(() => window.__ngneTest!.assertInvariants());
    expect(errors).toEqual([]);
});

test("an empty name disables OK and shows an inline message", async ({ page }) => {
    await openHero(page);
    const dialog = await openProperties(page);
    await nameField(dialog).fill("  ");
    await expect(ok(dialog)).toBeDisabled();
    await expect(dialog.getByRole("alert")).toHaveText("Enter a name.");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await nameField(dialog).fill("villain");
    await expect(ok(dialog)).toBeEnabled();
    await expect(dialog.getByRole("alert")).toHaveText("");
    await dialogButton(dialog, "Cancel").click();
    expect(await activeDocument(page)).toMatchObject({ name: "hero", undoCount: 0 });
});

test("changing the grid size adds no history entry and does not set the dirty flag; changing the pivot does both", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openHero(page);
    expect(await activeDocument(page)).toMatchObject({
        grid: { width: 16, height: 16 },
        undoCount: 0,
        dirty: false,
    });

    // Grid size: stored, but no history entry and not dirty.
    let dialog = await openProperties(page);
    await setNumber(gridWidth(dialog), 8);
    await setNumber(gridHeight(dialog), 12);
    await confirm(dialog);
    expect(await activeDocument(page)).toMatchObject({
        grid: { width: 8, height: 12, offsetX: 0, offsetY: 0, visible: false },
        undoCount: 0,
        redoCount: 0,
        dirty: false,
    });
    expect(await editMenu(page)).toMatchObject({ undo: "UndoCtrl+Z", undoEnabled: false });
    // Ctrl+Z has nothing to take back: the grid stays.
    await page.keyboard.press("Control+KeyZ");
    expect((await activeDocument(page)).grid).toMatchObject({ width: 8, height: 12 });

    // Pivot: a history entry, and the document is dirty.
    dialog = await openProperties(page);
    await expect(gridWidth(dialog)).toHaveValue("8");
    await pivotPreset(dialog, "Bottom centre").click();
    await confirm(dialog);
    expect(await activeDocument(page)).toMatchObject({
        pivot: { x: 0.5, y: 1 },
        undoCount: 1,
        undoLabel: "Set Pivot",
        dirty: true,
    });
    expect(await editMenu(page)).toMatchObject({ undo: "Undo Set PivotCtrl+Z", undoEnabled: true });

    // Both in one OK: the pivot is the history entry; undo leaves the grid alone.
    await page.keyboard.press("Control+KeyZ");
    expect(await activeDocument(page)).toMatchObject({ undoCount: 0, dirty: false });
    dialog = await openProperties(page);
    await setNumber(gridWidth(dialog), 4);
    await pivotPreset(dialog, "Top left").click();
    await confirm(dialog);
    expect(await activeDocument(page)).toMatchObject({
        pivot: { x: 0, y: 0 },
        grid: { width: 4, height: 12 },
        undoCount: 1,
        dirty: true,
    });
    await page.keyboard.press("Control+KeyZ");
    expect(await activeDocument(page)).toMatchObject({
        pivot: { x: 0.5, y: 0.5 },
        grid: { width: 4, height: 12 },
        undoCount: 0,
        dirty: false,
    });
    await page.evaluate(() => window.__ngneTest!.assertInvariants());
    expect(errors).toEqual([]);
});

test("changing the grid offset adds no history entry and does not set the dirty flag", async ({
    page,
}) => {
    await openHero(page);
    const dialog = await openProperties(page);
    await setNumber(offsetX(dialog), 3);
    await setNumber(offsetY(dialog), -2);
    // The fields keep size and offset inside their ranges.
    await setNumber(gridWidth(dialog), 0);
    await expect(gridWidth(dialog)).toHaveValue("1");
    await setNumber(gridHeight(dialog), 5000);
    await expect(gridHeight(dialog)).toHaveValue("1024");
    await confirm(dialog);
    expect(await activeDocument(page)).toMatchObject({
        grid: { width: 1, height: 1024, offsetX: 3, offsetY: -2 },
        undoCount: 0,
        dirty: false,
    });
});

test("name and pivot changed together are one undo step", async ({ page }) => {
    await openHero(page);
    const dialog = await openProperties(page);
    await nameField(dialog).fill("villain");
    await pivotPreset(dialog, "Bottom centre").click();
    await confirm(dialog);
    expect(await activeDocument(page)).toMatchObject({
        name: "villain",
        pivot: { x: 0.5, y: 1 },
        undoCount: 1,
        undoLabel: "Sprite Properties",
    });
    await page.keyboard.press("Control+KeyZ");
    expect(await activeDocument(page)).toMatchObject({
        name: "hero",
        pivot: { x: 0.5, y: 0.5 },
        undoCount: 0,
    });
    await expect(documentName(page)).toHaveText("hero");
});

test("Cancel, Escape and OK without a change leave the document as it is", async ({ page }) => {
    await openHero(page);
    const before = await activeDocument(page);
    const edit = async () => {
        const dialog = await openProperties(page);
        await nameField(dialog).fill("villain");
        await pivotPreset(dialog, "Top left").click();
        await setNumber(gridWidth(dialog), 4);
        await setNumber(offsetY(dialog), 9);
        return dialog;
    };

    let dialog = await edit();
    await dialogButton(dialog, "Cancel").click();
    await expect(dialog).toBeHidden();
    expect(await activeDocument(page)).toEqual(before);

    dialog = await edit();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await activeDocument(page)).toEqual(before);

    // The dialog opens with the document's values again, not with the cancelled ones.
    dialog = await openProperties(page);
    await expect(nameField(dialog)).toHaveValue("hero");
    await expect(checkedPreset(dialog)).toHaveAccessibleName("Centre");
    await expect(gridWidth(dialog)).toHaveValue("16");
    await confirm(dialog);
    expect(await activeDocument(page)).toEqual(before);
    await expect(documentName(page)).toHaveText("hero");
});

test("the dialog works from the keyboard and returns focus to the Sprite menu", async ({
    page,
}) => {
    await openHero(page);
    const dialog = propertiesDialog(page);
    await menuTrigger(page, "Sprite").focus();
    await page.keyboard.press("Enter");
    await expect(menuItem(page, "sprite.properties")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(nameField(dialog)).toBeFocused();

    // Tab walks the dialog and never leaves it: name, presets, pivot X and Y, grid width and
    // height, offset X and Y, Cancel, OK.
    const inside = () => dialog.evaluate((element) => element.contains(document.activeElement));
    const stops = new Set<string>();
    for (let presses = 0; presses < 20; presses++) {
        await page.keyboard.press("Tab");
        expect(await inside()).toBe(true);
        stops.add(
            await page.evaluate(() => {
                const active = document.activeElement;
                if (active?.getAttribute("role") === "radio") return "presets";
                return active?.id || active?.textContent || "";
            }),
        );
    }
    expect(stops.size).toBe(10);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "Sprite")).toBeFocused();
    expect(
        await menuTrigger(page, "Sprite").evaluate(
            (element) => getComputedStyle(element).outlineStyle,
        ),
    ).toBe("solid");

    // And after OK.
    await page.keyboard.press("Enter");
    await expect(menuItem(page, "sprite.properties")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.type("villain");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "Sprite")).toBeFocused();
    await expect(documentName(page)).toHaveText("villain");
});

test("a sprite created in the New sprite dialog is renamed and gets its pivot in Sprite properties", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await newSpriteButton(page).click();
    const created = newSpriteDialog(page);
    await nameField(created).fill("hero");
    await dialogButton(created, "Create").click();
    await expect(documentName(page)).toHaveText("hero");

    const dialog = await openProperties(page);
    await nameField(dialog).fill("hero walk");
    await pivotPreset(dialog, "Bottom centre").click();
    await setNumber(gridWidth(dialog), 8);
    await confirm(dialog);
    await expect(documentName(page)).toHaveText("hero walk");
    expect(await storeSnapshot(page)).toMatchObject({
        count: 1,
        active: {
            name: "hero walk",
            width: 32,
            height: 32,
            pivot: { x: 0.5, y: 1 },
            grid: { width: 8, height: 16 },
            undoCount: 1,
            dirty: true,
        },
    });
    await page.evaluate(() => window.__ngneTest!.assertInvariants());
    expect(errors).toEqual([]);
});
