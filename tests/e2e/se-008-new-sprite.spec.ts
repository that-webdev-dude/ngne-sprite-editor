import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { boxOf, collectErrors, region, settleTimers } from "./se-006-support";
import {
    addTextField,
    menuItem,
    menuTrigger,
    openEditor,
    openMenu,
    openSession,
    rename,
    statusBar,
} from "./se-007-support";
import {
    activeDocument,
    dialogButton,
    discardDialog,
    documentName,
    emptyState,
    field,
    nameField,
    newSpriteButton,
    newSpriteDialog,
    openNewSpriteFromMenu,
    setNumber,
    storeSnapshot,
} from "./se-008-support";

// SE-008: the empty state of the workspace and the New sprite dialog (DESIGN §6, §7).

const create = (dialog: Locator) => dialogButton(dialog, "Create");
const message = (dialog: Locator) => dialog.getByRole("alert");
const presets = (dialog: Locator) => dialog.getByRole("radiogroup", { name: "Size presets" });
const preset = (dialog: Locator, size: number) =>
    presets(dialog).getByRole("radio", { name: String(size), exact: true });

/** Opens the dialog from the empty state. */
async function openFromEmptyState(page: Page): Promise<Locator> {
    await newSpriteButton(page).click();
    await expect(newSpriteDialog(page)).toBeVisible();
    return newSpriteDialog(page);
}

/** Nothing of a closed modal dialog is left on the page: the shell can be used again. */
async function expectShellUsable(page: Page): Promise<void> {
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const leftovers = await page.evaluate(() => ({
        hidden: document.querySelectorAll("[inert], [data-aria-hidden]").length,
        pointerEvents: document.body.style.pointerEvents,
    }));
    expect(leftovers).toEqual({ hidden: 0, pointerEvents: "" });
}

test('launch → empty state → New sprite 32×32 "hero" → the store holds a session that passes assertInvariants, and the menu bar shows "hero"', async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);

    // Launch: no document, the empty state in the workspace, no name in the menu bar.
    expect(await storeSnapshot(page)).toEqual({ count: 0, active: null });
    await expect(emptyState(page)).toBeVisible();
    await expect(newSpriteButton(page)).toBeVisible();
    await expect(documentName(page)).toHaveCount(0);

    const dialog = await openFromEmptyState(page);
    await nameField(dialog).fill("hero");
    await setNumber(field(dialog, "Width"), 32);
    await setNumber(field(dialog, "Height"), 32);
    await create(dialog).click();
    await expect(dialog).toBeHidden();

    // The store holds one session, the active one, and it passes the invariants of SPEC §5.1.
    const { count, active } = await storeSnapshot(page);
    expect(count).toBe(1);
    expect(active).toMatchObject({
        name: "hero",
        width: 32,
        height: 32,
        layers: 1,
        frames: 1,
        pivot: { x: 0.5, y: 0.5 },
        undoCount: 0,
        dirty: false,
    });
    await page.evaluate(() => {
        const hook = window.__ngneTest!;
        if (hook.sessions.getState().documents.length !== 1) throw new Error("no session");
        hook.assertInvariants();
    });

    // The menu bar shows the name; the empty state has made way for the document.
    await expect(documentName(page)).toHaveText("hero");
    await expect(documentName(page)).toBeVisible();
    await expect(emptyState(page)).toHaveCount(0);
    expect(await statusBar(page)).toMatchObject({ size: "32 × 32", frame: "Frame 1/1" });
    await expectShellUsable(page);
    expect(errors).toEqual([]);
});

test("the empty state shows New sprite, centred in the workspace, while no document is open", async ({
    page,
}) => {
    await openEditor(page);
    const viewport = region(page, "viewport");
    // New sprite and Open (SE-041), nothing else: Import PNG and recent files come with their
    // tickets.
    await expect(viewport.getByRole("button")).toHaveText(["New sprite", "Open"]);
    await expect(viewport).toHaveText("New spriteOpen");

    // Centred in the workspace: the column of plain text buttons, New sprite first, each of the
    // usual size.
    const area = await boxOf(viewport);
    const button = await boxOf(newSpriteButton(page));
    const buttons = await viewport
        .getByRole("button")
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()))
        .then((boxes) => ({
            left: Math.min(...boxes.map((box) => box.left)),
            right: Math.max(...boxes.map((box) => box.right)),
            top: Math.min(...boxes.map((box) => box.top)),
            bottom: Math.max(...boxes.map((box) => box.bottom)),
        }));
    expect(Math.abs(button.x + button.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(
        1,
    );
    expect(
        Math.abs((buttons.top + buttons.bottom) / 2 - (area.y + area.height / 2)),
    ).toBeLessThanOrEqual(1);
    expect(
        Math.abs((buttons.left + buttons.right) / 2 - (area.x + area.width / 2)),
    ).toBeLessThanOrEqual(1);
    expect(button.y).toBe(buttons.top);
    expect(button.height).toBe(24);
    expect(await viewport.locator("img, svg, canvas").count()).toBe(0);

    // It gives way to an open document and comes back when the last one is closed.
    const id = await openSession(page, { name: "hero", width: 16, height: 16 });
    await expect(emptyState(page)).toHaveCount(0);
    await expect(documentName(page)).toHaveText("hero");
    await page.evaluate((id) => window.__ngneTest!.sessions.getState().close(id), id);
    await expect(newSpriteButton(page)).toBeVisible();
    await expect(documentName(page)).toHaveCount(0);
});

test("the dialog opens with a name, 32×32 and the presets of DESIGN §7", async ({ page }) => {
    await openEditor(page);
    const dialog = await openFromEmptyState(page);
    await expect(dialog.getByRole("heading", { name: "New sprite" })).toBeVisible();
    await expect(nameField(dialog)).toHaveValue("Sprite");
    await expect(field(dialog, "Width")).toHaveValue("32");
    await expect(field(dialog, "Height")).toHaveValue("32");
    await expect(presets(dialog).getByRole("radio")).toHaveText(["16", "32", "48", "64", "128"]);
    await expect(preset(dialog, 32)).toBeChecked();
    await expect(create(dialog)).toBeEnabled();
    await expect(message(dialog)).toHaveText("");

    // Standard dialog (DESIGN §4): at most 560 px wide, centred, actions on the right, the
    // primary one accent-filled.
    const box = await boxOf(dialog);
    const window = page.viewportSize() ?? { width: 0, height: 0 };
    expect(box.width).toBe(560);
    expect(box.x).toBe((window.width - 560) / 2);
    expect(Math.abs(box.y + box.height / 2 - window.height / 2)).toBeLessThanOrEqual(1);
    const createBox = await boxOf(create(dialog));
    expect(box.x + box.width - (createBox.x + createBox.width)).toBeLessThanOrEqual(17);
    const colours = await create(dialog).evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--accent");
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        return { accent, shown: getComputedStyle(element).backgroundColor };
    });
    expect(colours.shown).toBe(colours.accent);
});

test("a preset sets width and height; a size that is not a preset checks none", async ({
    page,
}) => {
    await openEditor(page);
    const dialog = await openFromEmptyState(page);

    await preset(dialog, 64).click();
    await expect(field(dialog, "Width")).toHaveValue("64");
    await expect(field(dialog, "Height")).toHaveValue("64");
    await expect(preset(dialog, 64)).toBeChecked();
    await expect(preset(dialog, 32)).not.toBeChecked();

    // Arrow keys move the choice, as in every segmented control. The key is held the way a
    // person holds it: the radio group checks the item its focus arrives at only while the
    // arrow key is still down.
    const arrow = async (key: string, size: number) => {
        await page.keyboard.down(key);
        await expect(preset(dialog, size)).toBeChecked();
        await page.keyboard.up(key);
    };
    await arrow("ArrowRight", 128);
    await expect(field(dialog, "Width")).toHaveValue("128");
    await arrow("ArrowLeft", 64);
    await arrow("ArrowLeft", 48);
    await expect(field(dialog, "Width")).toHaveValue("48");
    await expect(field(dialog, "Height")).toHaveValue("48");

    await setNumber(field(dialog, "Width"), 20);
    await expect(presets(dialog).getByRole("radio", { checked: true })).toHaveCount(0);
    await setNumber(field(dialog, "Height"), 20);
    await expect(presets(dialog).getByRole("radio", { checked: true })).toHaveCount(0);
    await setNumber(field(dialog, "Width"), 16);
    await setNumber(field(dialog, "Height"), 16);
    await expect(preset(dialog, 16)).toBeChecked();

    await preset(dialog, 128).click();
    await create(dialog).click();
    expect(await activeDocument(page)).toMatchObject({ width: 128, height: 128 });
});

test("width or height outside 1..1024 disables Create and shows an inline message", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const dialog = await openFromEmptyState(page);
    const width = field(dialog, "Width");
    const height = field(dialog, "Height");

    const cases: [fieldName: "Width" | "Height", value: number, text: string][] = [
        ["Width", 0, "Width must be from 1 to 1024 px."],
        ["Width", 1025, "Width must be from 1 to 1024 px."],
        ["Width", -8, "Width must be from 1 to 1024 px."],
        ["Height", 0, "Height must be from 1 to 1024 px."],
        ["Height", 1025, "Height must be from 1 to 1024 px."],
        ["Height", 4096, "Height must be from 1 to 1024 px."],
    ];
    for (const [fieldName, value, text] of cases) {
        const target = field(dialog, fieldName);
        await setNumber(target, value);
        // The field shows what was typed: the value is not silently changed to a valid one.
        await expect(target, `${fieldName} ${value}`).toHaveValue(String(value));
        await expect(create(dialog), `${fieldName} ${value}`).toBeDisabled();
        await expect(message(dialog), `${fieldName} ${value}`).toHaveText(text);
        await expect(message(dialog)).toBeVisible();

        await setNumber(target, 32);
        await expect(create(dialog), `${fieldName} back to 32`).toBeEnabled();
        await expect(message(dialog), `${fieldName} back to 32`).toHaveText("");
    }

    // Both at once.
    await setNumber(width, 0);
    await setNumber(height, 2000);
    await expect(create(dialog)).toBeDisabled();
    await expect(message(dialog)).toHaveText("Width and height must each be from 1 to 1024 px.");
    await setNumber(width, 32);
    await expect(create(dialog)).toBeDisabled();
    await expect(message(dialog)).toHaveText("Height must be from 1 to 1024 px.");

    // The message is inline, in the dialog, in the error colour (DESIGN §3.1).
    const colours = await message(dialog).evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--danger");
        document.body.append(probe);
        const danger = getComputedStyle(probe).color;
        probe.remove();
        return { danger, shown: getComputedStyle(element).color };
    });
    expect(colours.shown).toBe(colours.danger);

    // Neither Enter nor the disabled button creates a document.
    await height.fill("5000");
    await page.keyboard.press("Enter");
    await expect(create(dialog)).toBeDisabled();
    await nameField(dialog).focus();
    await page.keyboard.press("Enter");
    await create(dialog).click({ force: true });
    await expect(dialog).toBeVisible();
    expect((await storeSnapshot(page)).count).toBe(0);

    // A value typed but not yet applied counts when Create is clicked: the click applies it.
    await setNumber(height, 32);
    await expect(create(dialog)).toBeEnabled();
    await width.fill("3000");
    await create(dialog).click();
    await expect(dialog).toBeVisible();
    await expect(create(dialog)).toBeDisabled();
    expect((await storeSnapshot(page)).count).toBe(0);

    // The limits themselves are accepted.
    await setNumber(width, 1);
    await setNumber(height, 1024);
    await expect(create(dialog)).toBeEnabled();
    await expect(message(dialog)).toHaveText("");
    await create(dialog).click();
    await expect(dialog).toBeHidden();
    expect(await activeDocument(page)).toMatchObject({ width: 1, height: 1024 });
    await page.evaluate(() => window.__ngneTest!.assertInvariants());
    expect(errors).toEqual([]);
});

test("an empty name disables Create and shows an inline message", async ({ page }) => {
    await openEditor(page);
    const dialog = await openFromEmptyState(page);
    for (const blank of ["", "   "]) {
        await nameField(dialog).fill(blank);
        await expect(create(dialog)).toBeDisabled();
        await expect(message(dialog)).toHaveText("Enter a name.");
        await page.keyboard.press("Enter");
        await expect(dialog).toBeVisible();
    }
    expect((await storeSnapshot(page)).count).toBe(0);

    // Surrounding white space is not part of the name.
    await nameField(dialog).fill("  walk cycle  ");
    await expect(message(dialog)).toHaveText("");
    await create(dialog).click();
    expect((await activeDocument(page)).name).toBe("walk cycle");
    await expect(documentName(page)).toHaveText("walk cycle");
});

test("Ctrl+Alt+N opens the dialog, also from a text field; the whole dialog works from the keyboard", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const dialog = newSpriteDialog(page);

    // † of SPEC §7.8: the chord also acts while a text field has focus, and types nothing.
    const text = await addTextField(page, "context-bar");
    await text.focus();
    await page.keyboard.press("Control+Alt+KeyN");
    await expect(dialog).toBeVisible();
    await expect(text).toHaveValue("");
    // Escape closes it and gives focus back to the field it was opened from.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(text).toBeFocused();
    expect((await storeSnapshot(page)).count).toBe(0);
    await text.evaluate((element) => element.remove());

    await page.keyboard.press("Control+Alt+KeyN");
    await expect(dialog).toBeVisible();
    // Focus starts in the name field with its text selected: typing replaces it.
    await expect(nameField(dialog)).toBeFocused();
    await page.keyboard.type("hero");
    await expect(nameField(dialog)).toHaveValue("hero");

    // Tab walks the dialog and never leaves it.
    const inside = () => dialog.evaluate((element) => element.contains(document.activeElement));
    const stops = new Set<string>();
    for (let presses = 0; presses < 12; presses++) {
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
    // Name, width, height, the preset group as one stop, Cancel and Create.
    expect(stops.size).toBe(6);
    await page.keyboard.press("Shift+Tab");
    expect(await inside()).toBe(true);

    // Width and height by typing; the arrow keys step by 1, with Shift by 10.
    await field(dialog, "Width").focus();
    await page.keyboard.press("Control+KeyA");
    await page.keyboard.type("48");
    await page.keyboard.press("Tab");
    await expect(field(dialog, "Height")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(field(dialog, "Height")).toHaveValue("23");
    await expect(field(dialog, "Width")).toHaveValue("48");

    // Enter in a field applies what was typed there and creates the document.
    await page.keyboard.press("Control+KeyA");
    await page.keyboard.type("24");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    expect(await activeDocument(page)).toMatchObject({ name: "hero", width: 48, height: 24 });
    await expect(documentName(page)).toHaveText("hero");
    await expectShellUsable(page);
    expect(errors).toEqual([]);
});

test("the dialog returns focus to what opened it: the empty-state button, the File menu", async ({
    page,
}) => {
    await openEditor(page);
    const dialog = newSpriteDialog(page);
    const ring = (target: Locator) =>
        target.evaluate((element) => getComputedStyle(element).outlineStyle);

    // Opened with the pointer from the empty state; closed by Cancel, Escape and a click outside.
    await newSpriteButton(page).click();
    await expect(dialog).toBeVisible();
    await dialogButton(dialog, "Cancel").click();
    await expect(dialog).toBeHidden();
    await expect(newSpriteButton(page)).toBeFocused();
    expect(await ring(newSpriteButton(page))).toBe("none");

    await newSpriteButton(page).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(newSpriteButton(page)).toBeFocused();

    await newSpriteButton(page).click();
    await expect(dialog).toBeVisible();
    await settleTimers(page);
    await page.mouse.click(8, 400);
    await expect(dialog).toBeHidden();
    await expect(newSpriteButton(page)).toBeFocused();
    expect((await storeSnapshot(page)).count).toBe(0);

    // Opened from the keyboard: the button shows the focus ring when focus comes back.
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    expect(await ring(nameField(dialog))).toBe("solid");
    await page.keyboard.press("Escape");
    await expect(newSpriteButton(page)).toBeFocused();
    expect(await ring(newSpriteButton(page))).toBe("solid");

    // Opened from the File menu: the item is gone with its menu, so focus returns to File.
    await openNewSpriteFromMenu(page);
    await expect(nameField(dialog)).toBeFocused();
    await dialogButton(dialog, "Cancel").click();
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "File")).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expectShellUsable(page);

    // The same from the keyboard: File, Enter, Enter on New Sprite…, Escape.
    await page.keyboard.press("Enter");
    await expect(menuItem(page, "file.new")).toBeFocused();
    await expect(menuItem(page, "file.new")).toHaveText("New Sprite…Ctrl+Alt+N");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(nameField(dialog)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "File")).toBeFocused();
    expect(await ring(menuTrigger(page, "File"))).toBe("solid");

    // After Create the opener in the empty state no longer exists; the menu still does.
    await page.keyboard.press("Enter");
    await expect(menuItem(page, "file.new")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(nameField(dialog)).toBeFocused();
    await page.keyboard.type("hero");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "File")).toBeFocused();
    await expect(documentName(page)).toHaveText("hero");
    // The menus work again right away.
    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toBeVisible();
});

test("creating a document replaces the open one after a discard confirmation", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const first = await openSession(page, { name: "first", width: 8, height: 8 });
    // An undoable change: the document now has unsaved changes.
    await rename(page, first, "first draft", "Pencil");
    expect(await activeDocument(page)).toMatchObject({ name: "first draft", dirty: true });

    const dialog = await openNewSpriteFromMenu(page);
    const confirm = discardDialog(page);
    await nameField(dialog).fill("second");
    await setNumber(field(dialog, "Width"), 24);
    await create(dialog).click();

    // Asked once, naming the document; nothing has been replaced yet. The question is the one
    // dialog on screen: the New sprite dialog waits behind it, hidden.
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("“first draft” has unsaved changes");
    await expect(page.locator(".ui-dialog:visible")).toHaveCount(1);
    await expect(
        page.getByRole("heading", { name: "New sprite", includeHidden: true }),
    ).toBeHidden();
    await expect(dialogButton(confirm, "Cancel")).toBeFocused();
    expect(await storeSnapshot(page)).toMatchObject({
        count: 1,
        active: { id: first, name: "first draft", dirty: true },
    });

    // Cancel goes back to the New sprite dialog with its values; the document stays.
    await dialogButton(confirm, "Cancel").click();
    await expect(confirm).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(nameField(dialog)).toHaveValue("second");
    await expect(field(dialog, "Width")).toHaveValue("24");
    await expect(create(dialog)).toBeFocused();
    expect((await activeDocument(page)).id).toBe(first);

    // Escape closes the question only. It is pressed once the question holds the focus: before,
    // the New sprite dialog is still the top layer and Escape would close that instead.
    await page.keyboard.press("Enter");
    await expect(confirm).toBeVisible();
    await expect(dialogButton(confirm, "Cancel")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(dialog).toBeVisible();
    expect(await activeDocument(page)).toMatchObject({ id: first, undoLabel: "Pencil" });

    // Discard replaces the document: one session, the new one, with nothing to undo.
    await create(dialog).click();
    await expect(confirm).toBeVisible();
    await dialogButton(confirm, "Discard").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const { count, active } = await storeSnapshot(page);
    expect(count).toBe(1);
    expect(active).toMatchObject({
        name: "second",
        width: 24,
        height: 32,
        undoCount: 0,
        dirty: false,
    });
    expect(active?.id).not.toBe(first);
    await expect(documentName(page)).toHaveText("second");
    expect(await statusBar(page)).toMatchObject({ size: "24 × 32" });
    await expect(menuTrigger(page, "File")).toBeFocused();
    await page.evaluate(() => window.__ngneTest!.assertInvariants());
    await expectShellUsable(page);
    expect(errors).toEqual([]);
});

test("cancelling the New sprite dialog keeps the open document and asks nothing", async ({
    page,
}) => {
    await openEditor(page);
    const first = await openSession(page, { name: "first", width: 8, height: 8 });
    await rename(page, first, "first draft", "Pencil");
    const dialog = await openNewSpriteFromMenu(page);
    await nameField(dialog).fill("second");
    await dialogButton(dialog, "Cancel").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await storeSnapshot(page)).toMatchObject({
        count: 1,
        active: { id: first, name: "first draft", undoCount: 1 },
    });
});

test("a document without unsaved changes is replaced without a confirmation", async ({ page }) => {
    await openEditor(page);
    const first = await openSession(page, { name: "first", width: 8, height: 8 });
    // A view preference alone does not make a document dirty (SPEC §5.2) …
    await page.evaluate((id) => {
        window.__ngneTest!.sessions.getState().updateDocSettings(id, (settings) => {
            settings.grid.visible = true;
        });
    }, first);
    // … and neither does a change that was undone again.
    await rename(page, first, "first draft", "Pencil");
    await page.keyboard.press("Control+KeyZ");
    expect(await activeDocument(page)).toMatchObject({ name: "first", dirty: false });

    const dialog = await openNewSpriteFromMenu(page);
    await nameField(dialog).fill("second");
    await create(dialog).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await storeSnapshot(page)).toMatchObject({ count: 1, active: { name: "second" } });
    expect((await activeDocument(page)).id).not.toBe(first);
    await expect(documentName(page)).toHaveText("second");
});

test("a new document takes its grid size from the preference store's default grid", async ({
    page,
}) => {
    await openEditor(page);
    const defaults = await page.evaluate(() => window.__ngneTest!.preferences.get("grid"));
    expect(defaults).toEqual({ width: 16, height: 16 });

    let dialog = await openFromEmptyState(page);
    await create(dialog).click();
    expect((await activeDocument(page)).grid).toEqual({
        width: 16,
        height: 16,
        offsetX: 0,
        offsetY: 0,
        visible: false,
    });

    // Another default grid: the next new document has it, whatever its own size.
    await page.evaluate(() => window.__ngneTest!.preferences.set("grid", { width: 8, height: 12 }));
    dialog = await openNewSpriteFromMenu(page);
    await setNumber(field(dialog, "Width"), 64);
    await create(dialog).click();
    await expect(dialog).toBeHidden();
    expect(await activeDocument(page)).toMatchObject({
        width: 64,
        grid: { width: 8, height: 12, offsetX: 0, offsetY: 0 },
    });

    // The preference is stored, so it also holds after a reload.
    await page.reload();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    dialog = await openFromEmptyState(page);
    await create(dialog).click();
    expect((await activeDocument(page)).grid).toMatchObject({ width: 8, height: 12 });
});
