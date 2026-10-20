import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type * as MenuModel from "../../src/app/commands/menuModel";
import type * as CoreTags from "../../src/core/tags";
import type * as EditIds from "../../src/app/timeline/timelineEditIds";
import { boxOf, collectErrors, region, settleTimers } from "./se-006-support";
import {
    activeCell,
    cell,
    documentState,
    frameHeader,
    layerHeader,
    runCommands,
    selectedCells,
    selectedLayers,
    timeline,
} from "./se-022-support";
import { celGrid, centreOf, openCels } from "./se-026-support";

// SE-026: the timeline's context menus (DESIGN §4) — generated from the command registry for
// layers, frames, cels and tags; what their items do, the locked-layer rule of the SE-021
// review, and how a right press opens them on Windows (the context menu arrives at the release).

/** The open context menu of the timeline, by its name (Layer, Frame, Cel, Tag). */
const contextMenu = (page: Page, name: string) => page.getByRole("menu", { name, exact: true });
const tagSpan = (page: Page, name: string) =>
    timeline(page)
        .getByRole("list", { name: "Tags" })
        .getByRole("listitem")
        .filter({ has: page.getByText(name, { exact: true }) });

/** Waits until an open menu has the focus: Radix moves it there after opening. */
async function menuFocused(menu: Locator): Promise<void> {
    await expect(menu).toBeVisible();
    await expect
        .poll(() => menu.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
}

/** Closes the open menu with Escape, once it has the focus. */
async function closeMenu(page: Page, menu: Locator): Promise<void> {
    await menuFocused(menu);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await settleTimers(page);
}

/** The items of an open menu: command id, text and whether it is disabled; separators as "-". */
function menuItems(menu: Locator) {
    return menu.evaluate((element) =>
        [...element.querySelectorAll('[role="menuitem"], [role="separator"]')].map((item) =>
            item.getAttribute("role") === "separator"
                ? "-"
                : {
                      id: item.getAttribute("data-command"),
                      // The text without the shortcut beside it.
                      title: item.firstChild?.textContent ?? "",
                      disabled: item.hasAttribute("data-disabled"),
                  },
        ),
    );
}

/**
 * The timeline's context menus as the registry generates them now: for each menu name of
 * `TIMELINE_MENUS`, its items (`buildContextMenu`) with their titles and states.
 */
function registryMenus(page: Page) {
    return page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { buildContextMenu } = (await load(
            "/src/app/commands/menuModel.ts",
        )) as typeof MenuModel;
        const { TIMELINE_MENUS } = (await load(
            "/src/app/timeline/timelineEditIds.ts",
        )) as typeof EditIds;
        const commands = window.__ngneTest!.commands.list();
        return Object.fromEntries(
            Object.entries(TIMELINE_MENUS).map(([kind, menu]) => [
                kind,
                buildContextMenu(commands, menu).map((node) =>
                    node.kind === "command"
                        ? {
                              id: node.command.id,
                              title: node.command.title(),
                              disabled: !node.command.enabled(),
                          }
                        : "-",
                ),
            ]),
        );
    });
}

/** Adds a tag over frames `from`–`to` (from 1) through the core command. */
function addTag(page: Page, name: string, from: number, to: number): Promise<void> {
    return page.evaluate(
        async ({ name, from, to }) => {
            const path = "/src/core/tags/index.ts";
            const tags = (await import(/* @vite-ignore */ path)) as typeof CoreTags;
            const state = window.__ngneTest!.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId)!;
            const { doc } = document.session;
            const command = tags.createTagCommand(doc, {
                name,
                color: 0x3366ccff,
                fromFrameId: doc.frames[from - 1]!.id,
                toFrameId: doc.frames[to - 1]!.id,
                direction: "forward",
                repeat: 0,
            });
            document.history.execute(command);
        },
        { name, from, to },
    );
}

test("every item of the layer, frame, cel and tag menus is a registry entry: the menus are enumerated from the registry", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 3, 4, ["Layer 1/1", "Layer 1/2"]);
    await addTag(page, "walk", 2, 3);
    await expect(tagSpan(page, "walk")).toBeVisible();

    const targets: [kind: string, name: string, target: Locator][] = [
        ["layer", "Layer", layerHeader(page, "Layer 2").locator(".timeline__name")],
        ["frame", "Frame", frameHeader(page, 2)],
        ["cel", "Cel", cell(page, "Layer 1", 1)],
        ["tag", "Tag", tagSpan(page, "walk")],
    ];
    // What this ticket puts in each menu (other tickets may add more).
    const owned: Record<string, string[]> = {
        layer: ["layer.mergeDown", "layer.flatten", "layer.properties"],
        frame: ["frame.reverse", "frame.newTag"],
        cel: ["cel.link", "cel.unlink", "cel.clear"],
        tag: ["frame.newTag", "frame.tagProperties", "frame.deleteTag"],
    };
    for (const [kind, name, target] of targets) {
        await target.click({ button: "right" });
        const menu = contextMenu(page, name);
        await menuFocused(menu);
        // The registry is read while the menu is open: the item states are those of now.
        const expected = (await registryMenus(page))[kind];
        expect(expected?.length, kind).toBeGreaterThan(0);
        expect(await menuItems(menu), kind).toEqual(expected);
        const ids = (expected ?? []).flatMap((item) => (item === "-" ? [] : [item.id]));
        expect(ids, kind).toEqual(expect.arrayContaining(owned[kind] ?? []));
        await closeMenu(page, menu);
    }
    expect(errors).toEqual([]);
});

test("Clear Cels, Link Cels and Unlink Cels act on the selected cels in one undo step each; the focus returns to the active cell", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 2, 3, ["Layer 1/1", "Layer 1/3", "Layer 2/1"]);
    const start = await documentState(page);

    // Link: frames 1–3 of Layer 1 share the image of frame 1.
    await cell(page, "Layer 1", 1).click();
    await cell(page, "Layer 1", 3).click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedCells(page)).toHaveLength(3);
    await cell(page, "Layer 1", 2).click({ button: "right" });
    let menu = contextMenu(page, "Cel");
    await menuFocused(menu);
    await expect(menu.getByRole("menuitem", { name: "Unlink Cels", exact: true })).toHaveAttribute(
        "data-disabled",
    );
    await menu.getByRole("menuitem", { name: "Link Cels", exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect.poll(() => celGrid(page)).toEqual(["2/1 . .", "1/1 1/1 1/1"]);
    await expect(activeCell(page)).toBeFocused();
    // The selection held: unlink them again.
    await cell(page, "Layer 1", 1).click({ button: "right" });
    menu = contextMenu(page, "Cel");
    await menuFocused(menu);
    await menu.getByRole("menuitem", { name: "Unlink Cels", exact: true }).click();
    await expect.poll(() => celGrid(page)).toEqual(["2/1 . .", "+ + 1/1"]);

    // Clear: a right-click on a cel outside the selection selects it, and clears it alone.
    await cell(page, "Layer 2", 1).click({ button: "right" });
    menu = contextMenu(page, "Cel");
    await menuFocused(menu);
    await menu.getByRole("menuitem", { name: "Clear Cels", exact: true }).click();
    await expect.poll(() => selectedCells(page)).toEqual(["Layer 2/1"]);
    await expect.poll(() => celGrid(page)).toEqual([". . .", "+ + 1/1"]);
    const state = await documentState(page);
    expect(state.undoCount).toBe(start.undoCount + 3);
    expect(state.undoLabel).toBe("Clear Cel");
    await expect(activeCell(page)).toBeFocused();
    expect(errors).toEqual([]);
});

test("Clear on a selection of locked layers only is disabled, changes nothing and adds no undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 3, 2, ["Layer 1/1", "Layer 2/2", "Layer 3/1"]);
    for (const name of ["Layer 1", "Layer 2"]) {
        await layerHeader(page, name).getByRole("button", { name: "Locked" }).click();
    }
    await expect
        .poll(async () => (await documentState(page)).layers.map((layer) => layer.locked))
        .toEqual([true, true, false]);
    await layerHeader(page, "Layer 2").locator(".timeline__name").click();
    await layerHeader(page, "Layer 1")
        .locator(".timeline__name")
        .click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedLayers(page)).toEqual(["Layer 2", "Layer 1"]);
    const start = await documentState(page);
    const before = await celGrid(page);

    // A cel of a selected row keeps the selection: Clear is disabled, and pressing it does
    // nothing.
    await cell(page, "Layer 1", 1).click({ button: "right" });
    const menu = contextMenu(page, "Cel");
    await menuFocused(menu);
    const clear = menu.getByRole("menuitem", { name: "Clear Cels", exact: true });
    await expect(clear).toHaveAttribute("data-disabled");
    await clear.click({ force: true });
    await closeMenu(page, menu);
    await expect.poll(() => selectedLayers(page)).toEqual(["Layer 2", "Layer 1"]);
    // Run through the registry all the same: still nothing.
    await page.evaluate(() => void window.__ngneTest!.commands.get("cel.clear")!.run());
    expect(await celGrid(page)).toEqual(before);
    expect((await documentState(page)).undoCount).toBe(start.undoCount);

    // With the unlocked layer selected as well, only its cel is cleared.
    await layerHeader(page, "Layer 3")
        .locator(".timeline__name")
        .click({ modifiers: ["Control"] });
    await expect.poll(() => selectedLayers(page)).toEqual(["Layer 3", "Layer 2", "Layer 1"]);
    await runCommands(page, ["cel.clear"]);
    await expect.poll(() => celGrid(page)).toEqual([". .", ". 2/2", "1/1 ."]);
    expect((await documentState(page)).undoCount).toBe(start.undoCount + 1);
    expect(errors).toEqual([]);
});

test("the layer menu merges down and the frame menu reverses the selected frames, one undo step each", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 2, 3, ["Layer 1/1", "Layer 2/2"]);
    const start = await documentState(page);
    const ids = start.frames.map((frame) => frame.id);

    await frameHeader(page, 1).click();
    await frameHeader(page, 3).click({ modifiers: ["Shift"] });
    await frameHeader(page, 2).click({ button: "right" });
    let menu = contextMenu(page, "Frame");
    await menuFocused(menu);
    await menu.getByRole("menuitem", { name: "Reverse Frames", exact: true }).click();
    await expect
        .poll(async () => (await documentState(page)).frames.map((frame) => frame.id))
        .toEqual([...ids].reverse());

    await layerHeader(page, "Layer 2").locator(".timeline__name").click({ button: "right" });
    menu = contextMenu(page, "Layer");
    await menuFocused(menu);
    await menu.getByRole("menuitem", { name: "Merge Down", exact: true }).click();
    await expect
        .poll(async () => (await documentState(page)).layers.map((layer) => layer.name))
        .toEqual(["Layer 1"]);
    const state = await documentState(page);
    expect(state.undoCount).toBe(start.undoCount + 2);
    expect(state.undoLabel).toBe("Merge Down");
    expect(errors).toEqual([]);
});

test("a tag's menu acts on its tag: Delete Tag deletes the tag right-clicked, not the active one", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 1, 4);
    await addTag(page, "long", 1, 4);
    await addTag(page, "short", 1, 1);
    await expect(tagSpan(page, "long")).toBeVisible();
    // At frame 1 the active tag is the shorter one.
    await tagSpan(page, "long").click({ button: "right", position: { x: 60, y: 8 } });
    const menu = contextMenu(page, "Tag");
    await menuFocused(menu);
    await menu.getByRole("menuitem", { name: "Delete Tag", exact: true }).click();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const state = window.__ngneTest!.sessions.getState();
                const { doc } = state.documents.find(
                    (entry) => entry.id === state.activeId,
                )!.session;
                return doc.tags.map((tag) => tag.name);
            }),
        )
        .toEqual(["short"]);
    expect(errors).toEqual([]);
});

test("a right press opens the menu of the item it was pressed on wherever it is released in the timeline, none outside it; Shift+F10 opens the focused cell's", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 2, 4, ["Layer 1/1"]);

    // Pressed on Layer 1/2, released over Layer 2/4: Chrome on Windows sends the context menu
    // at the release, to the cell under the pointer then.
    const from = await centreOf(cell(page, "Layer 1", 2));
    const to = await centreOf(cell(page, "Layer 2", 4));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up({ button: "right" });
    let menu = contextMenu(page, "Cel");
    await menuFocused(menu);
    await closeMenu(page, menu);
    await expect.poll(() => selectedCells(page)).toEqual(["Layer 1/2"]);

    // Pressed in the timeline, released over the viewport. On Windows the context menu
    // arrives at the release, over the viewport: no menu. Elsewhere Chrome sends it at the
    // press, in the timeline: the pressed cel's menu, and only that one.
    const canvas = await boxOf(region(page, "viewport"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, {
        steps: 4,
    });
    await page.mouse.up({ button: "right" });
    await settleTimers(page);
    if (process.platform === "win32") {
        await expect(page.getByRole("menu")).toHaveCount(0);
    } else {
        menu = contextMenu(page, "Cel");
        await menuFocused(menu);
        await expect(page.getByRole("menu")).toHaveCount(1);
        await closeMenu(page, menu);
        await expect.poll(() => selectedCells(page)).toEqual(["Layer 1/2"]);
    }

    // From the keyboard: the focused cell's menu.
    await cell(page, "Layer 1", 1).click();
    await expect(cell(page, "Layer 1", 1)).toBeFocused();
    await page.keyboard.press("Shift+F10");
    menu = contextMenu(page, "Cel");
    await menuFocused(menu);
    await expect(
        menu.getByRole("menuitem", { name: "Clear Cels", exact: true }),
    ).not.toHaveAttribute("data-disabled");
    await closeMenu(page, menu);
    await expect(activeCell(page)).toBeFocused();
    expect(errors).toEqual([]);
});

test("a right press begun outside the timeline and released over a cel changes neither the active cel nor the selection, and opens no menu", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 2, 3, ["Layer 1/1"]);
    await cell(page, "Layer 1", 2).click();
    await expect.poll(() => selectedCells(page)).toEqual(["Layer 1/2"]);
    const before = await documentState(page);
    const over = await centreOf(cell(page, "Layer 2", 3));

    // From the viewport (a right-button stroke there, whose menu is cancelled) and from the
    // status bar: on Windows the context menu arrives at the release, over the cel.
    for (const from of ["viewport", "status-bar"] as const) {
        const box = await boxOf(region(page, from));
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down({ button: "right" });
        await page.mouse.move(over.x, over.y, { steps: 4 });
        await page.mouse.up({ button: "right" });
        await settleTimers(page);
        await expect(page.getByRole("menu"), from).toHaveCount(0);
        const state = await documentState(page);
        expect([state.activeLayer, state.activeFrame], from).toEqual([
            before.activeLayer,
            before.activeFrame,
        ]);
        await expect.poll(() => selectedCells(page), from).toEqual(["Layer 1/2"]);
    }
    expect(errors).toEqual([]);
});

test("a right-click in the rename field opens neither the Layer menu nor commits the rename", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openCels(page, 2, 2);
    await layerHeader(page, "Layer 2").locator(".timeline__name").dblclick();
    const field = timeline(page).getByRole("textbox", { name: "Layer name" });
    await expect(field).toBeFocused();
    await page.keyboard.insertText("Renamed");
    const before = await documentState(page);

    await field.click({ button: "right" });
    await settleTimers(page);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("Renamed");
    const state = await documentState(page);
    expect(state.layers.map((layer) => layer.name)).toEqual(["Layer 1", "Layer 2"]);
    expect(state.undoCount).toBe(before.undoCount);
    // The field still applies with Enter.
    await page.keyboard.press("Enter");
    await expect
        .poll(async () => (await documentState(page)).layers.map((layer) => layer.name))
        .toEqual(["Layer 1", "Renamed"]);
    expect(errors).toEqual([]);
});
