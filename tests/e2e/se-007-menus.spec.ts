import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { boxOf, collectErrors, region } from "./se-006-support";
import {
    closeMenu,
    menuItem,
    menuTrigger,
    openEditor,
    openMenu,
    openSession,
    rename,
    snapshot,
} from "./se-007-support";

// SE-007: the menu bar of the real app. Menus are generated from the command registry
// (DESIGN §4): every item is a registry entry, planned commands are present and disabled.
//
// Commands these tests add are their own (ids "se007.…", at the end of View), so the tests
// keep their meaning when later tickets implement the planned commands.

const MENUS = ["File", "Edit", "Sprite", "Layer", "Frame", "Select", "View"];

interface RenderedItem {
    command: string | null;
    title: string;
    shortcut: string;
    disabled: boolean;
}

interface RegistryItem {
    id: string;
    title: string;
    shortcut: string;
    enabled: boolean;
    planned: boolean;
    menu: string | null;
}

/**
 * Every item of an open menu as rendered, those of its submenus included (each submenu is
 * opened in turn). A submenu's own entry is not an item: it runs nothing.
 */
async function renderedItems(page: Page, menu: Locator): Promise<RenderedItem[]> {
    const items = await menu.evaluate((element) =>
        Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]'), (item) => {
            const shortcut = item.querySelector(".ui-menu__shortcut")?.textContent ?? "";
            const text = item.textContent ?? "";
            return {
                command: item.getAttribute("data-command"),
                submenu: item.getAttribute("data-submenu"),
                title: shortcut ? text.slice(0, -shortcut.length) : text,
                shortcut,
                disabled: item.getAttribute("aria-disabled") === "true",
            };
        }),
    );
    const rendered: RenderedItem[] = [];
    for (const { submenu, ...item } of items) {
        if (submenu === null) {
            rendered.push(item);
            continue;
        }
        await menu.locator(`[data-submenu="${submenu}"]`).hover();
        const nested = page.getByRole("menu", { name: submenu, exact: true });
        await expect(nested).toBeVisible();
        rendered.push(...(await renderedItems(page, nested)));
    }
    return rendered;
}

/** Every entry of the app's registry, as the registry reports it now. */
function registryItems(page: Page): Promise<RegistryItem[]> {
    return page.evaluate(() =>
        window.__ngneTest!.commands.list().map((command) => ({
            id: command.id,
            title: command.title(),
            shortcut: command.shortcuts[0] ?? "",
            enabled: command.enabled(),
            planned: command.planned,
            menu: command.menuPath?.[0] ?? null,
        })),
    );
}

/** Ids of the commands that ran, recorded by the commands these tests register. */
const calls = (page: Page) =>
    page.evaluate(() => (window as unknown as { se007Calls?: string[] }).se007Calls ?? []);

test("the menu bar holds File, Edit, Sprite, Layer, Frame, Select and View", async ({ page }) => {
    await openEditor(page);
    const bar = region(page, "menu-bar").getByRole("menubar", { name: "Main menu" });
    await expect(bar.getByRole("menuitem")).toHaveText(MENUS);

    // The menus do not change the height of the region, and sit at its left edge.
    expect((await boxOf(region(page, "menu-bar"))).height).toBe(36);
    expect((await boxOf(menuTrigger(page, "File"))).x).toBe(8);
    // Pointer targets of at least 24×24 px (DESIGN §8), in the bar and in a menu.
    for (const name of MENUS) {
        const trigger = await boxOf(menuTrigger(page, name));
        expect(trigger.height, name).toBe(24);
        expect(trigger.width, name).toBeGreaterThanOrEqual(24);
    }
    const menu = await openMenu(page, "File");
    for (const item of await menu.getByRole("menuitem").all()) {
        expect((await boxOf(item)).height).toBe(24);
    }
});

test("every menu item corresponds to a registry entry", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    // With a submenu present, so that nested items are enumerated as well.
    await page.evaluate(() => {
        window.__ngneTest!.commands.register({
            id: "se007.nested",
            title: "Nested item",
            menuPath: ["View", "SE-007 Submenu"],
            run() {},
        });
    });
    const registry = await registryItems(page);
    const byId = new Map(registry.map((entry) => [entry.id, entry]));
    const seen: string[] = [];

    for (const name of MENUS) {
        const items = await renderedItems(page, await openMenu(page, name));
        expect(items.length, `${name} has items`).toBeGreaterThan(0);
        for (const item of items) {
            // An item without a command id, or with an id the registry does not know, is an
            // orphan.
            expect(item.command, `${name} › ${item.title} names its command`).not.toBeNull();
            const entry = byId.get(item.command ?? "");
            expect(
                entry,
                `${name} › ${item.title} (${item.command}) is in the registry`,
            ).toBeDefined();
            expect(entry?.menu, `${item.command} is listed in its own menu`).toBe(name);
            expect(item.title, `${item.command} title`).toBe(entry?.title);
            expect(item.shortcut, `${item.command} shortcut`).toBe(entry?.shortcut);
            expect(item.disabled, `${item.command} disabled`).toBe(!entry?.enabled);
            seen.push(item.command ?? "");
        }
        await closeMenu(page);
    }

    // And the other way round: every registry entry with a menu is shown, once.
    const expected = registry.filter((entry) => entry.menu !== null).map((entry) => entry.id);
    expect(expected).toContain("se007.nested");
    expect([...seen].sort()).toEqual(expected.sort());
    expect(new Set(seen).size).toBe(seen.length);
    expect(errors).toEqual([]);
});

test("items of unimplemented commands are present and disabled", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
        window.__ngneTest!.commands.plan({
            id: "se007.planned",
            title: "Planned Item…",
            menuPath: ["View"],
            menuOrder: 9000,
        });
    });
    const planned = (await registryItems(page)).filter((entry) => entry.planned);
    expect(planned.map((entry) => entry.id)).toContain("se007.planned");

    // Every command that is still only planned has its item: visible, disabled, and without a
    // shortcut, because its binding is registered by its own ticket.
    for (const name of MENUS) {
        const ids = planned.filter((entry) => entry.menu === name).map((entry) => entry.id);
        if (ids.length === 0) continue;
        const items = await renderedItems(page, await openMenu(page, name));
        for (const id of ids) {
            const item = items.find((entry) => entry.command === id);
            expect(item, `${name} shows ${id}`).toBeDefined();
            expect(item?.disabled, `${id} is disabled`).toBe(true);
            expect(item?.shortcut, `${id} has no shortcut`).toBe("");
        }
        await closeMenu(page);
    }

    // A disabled item does nothing when clicked; the menu stays open.
    const view = await openMenu(page, "View");
    await expect(menuItem(page, "se007.planned")).toHaveText("Planned Item…");
    await expect(menuItem(page, "se007.planned")).toHaveAttribute("aria-disabled", "true");
    await menuItem(page, "se007.planned").click({ force: true });
    await expect(view).toBeVisible();
    // Disabled items stay visible, in the colour of disabled controls (DESIGN §3.1, §4).
    const colours = await menuItem(page, "se007.planned").evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(
            "--text-faint",
        );
        document.body.append(probe);
        const faint = getComputedStyle(probe).color;
        probe.remove();
        return { faint, shown: getComputedStyle(element).color };
    });
    expect(colours.shown).toBe(colours.faint);
});

test("Undo and Redo show the step they act on and run from the menu", async ({ page }) => {
    await openEditor(page);
    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toHaveText("UndoCtrl+Z");
    await expect(menuItem(page, "edit.undo")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "edit.redo")).toHaveText("RedoCtrl+Y");
    await expect(menuItem(page, "edit.redo")).toHaveAttribute("aria-disabled", "true");
    await closeMenu(page);

    const id = await openSession(page, { name: "start", width: 8, height: 8 });
    await rename(page, id, "first", "Pencil");
    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toHaveText("Undo PencilCtrl+Z");
    await expect(menuItem(page, "edit.undo")).not.toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "edit.redo")).toHaveAttribute("aria-disabled", "true");
    // The shortcut is right-aligned and muted (DESIGN §4).
    const item = await boxOf(menuItem(page, "edit.undo"));
    const shortcut = await boxOf(menuItem(page, "edit.undo").locator(".ui-menu__shortcut"));
    expect(Math.round(item.x + item.width - (shortcut.x + shortcut.width))).toBe(8);
    const colours = await menuItem(page, "edit.undo").evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(
            "--text-muted",
        );
        document.body.append(probe);
        const muted = getComputedStyle(probe).color;
        probe.remove();
        const shown = element.querySelector(".ui-menu__shortcut");
        return { muted, shown: shown ? getComputedStyle(shown).color : "" };
    });
    expect(colours.shown).toBe(colours.muted);

    await menuItem(page, "edit.undo").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect((await snapshot(page, id)).name).toBe("start");

    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toHaveText("UndoCtrl+Z");
    await expect(menuItem(page, "edit.undo")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "edit.redo")).toHaveText("Redo PencilCtrl+Y");
    await menuItem(page, "edit.redo").click();
    expect((await snapshot(page, id)).name).toBe("first");
});

test("an open menu follows the state its commands read", async ({ page }) => {
    await openEditor(page);
    const id = await openSession(page, { name: "start", width: 8, height: 8 });
    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toHaveAttribute("aria-disabled", "true");
    await rename(page, id, "first", "Bucket");
    await expect(menuItem(page, "edit.undo")).toHaveText("Undo BucketCtrl+Z");
    await expect(menuItem(page, "edit.undo")).not.toHaveAttribute("aria-disabled", "true");
});

test("the menus work from the keyboard", async ({ page }) => {
    await openEditor(page);
    const id = await openSession(page, { name: "start", width: 8, height: 8 });
    await rename(page, id, "first", "Pencil");

    // One tab stop for the whole bar; arrows move between the menus and wrap around.
    await menuTrigger(page, "File").focus();
    await page.keyboard.press("ArrowRight");
    await expect(menuTrigger(page, "Edit")).toBeFocused();
    // Radix moves the focus one timer after the key, so each step is awaited.
    await page.keyboard.press("ArrowLeft");
    await expect(menuTrigger(page, "File")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(menuTrigger(page, "View")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(menuTrigger(page, "File")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(menuTrigger(page, "Edit")).toBeFocused();
    const tabStops = await region(page, "menu-bar")
        .getByRole("menubar")
        .evaluate(
            (bar) =>
                [...bar.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
                    (trigger) => trigger.tabIndex === 0,
                ).length,
        );
    expect(tabStops).toBe(1);

    // Enter opens the menu on its first enabled item; Enter runs it.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Edit" })).toBeVisible();
    await expect(menuItem(page, "edit.undo")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect((await snapshot(page, id)).name).toBe("start");
    await expect(menuTrigger(page, "Edit")).toBeFocused();

    // Arrow keys walk the open menus; Escape closes and returns focus to the trigger.
    await page.keyboard.press("ArrowDown");
    // A menu takes the focus a moment after it opens; the next key belongs to it only from
    // then on.
    const holdsFocus = (menu: Locator) =>
        expect
            .poll(() => menu.evaluate((element) => element.contains(document.activeElement)))
            .toBe(true);
    const edit = page.getByRole("menu", { name: "Edit" });
    await expect(edit).toBeVisible();
    await holdsFocus(edit);
    await page.keyboard.press("ArrowRight");
    const sprite = page.getByRole("menu", { name: "Sprite" });
    await expect(sprite).toBeVisible();
    await holdsFocus(sprite);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(menuTrigger(page, "Sprite")).toBeFocused();
    // The trigger shows the keyboard focus ring.
    const outline = await menuTrigger(page, "Sprite").evaluate(
        (element) => getComputedStyle(element).outlineStyle,
    );
    expect(outline).toBe("solid");
});

test("a command registered later takes its planned item and brings its shortcut", async ({
    page,
}) => {
    await openEditor(page);
    await page.evaluate(() => {
        const ran: string[] = [];
        Object.assign(window, { se007Calls: ran });
        const { commands } = window.__ngneTest!;
        commands.plan({
            id: "se007.planned",
            title: "Planned Item",
            menuPath: ["View"],
            menuOrder: 9000,
        });
        commands.plan({ id: "se007.last", title: "Last", menuPath: ["View"], menuOrder: 9020 });
        // What a later ticket's module does: implement a planned command …
        commands.register({
            id: "se007.planned",
            title: "Implemented Item",
            shortcut: "Ctrl+Alt+F9",
            context: ["global", "text"],
            run: () => void ran.push("se007.planned"),
        });
        // … and add commands of its own, here in a submenu.
        for (const name of ["hero.ngsprite", "tiles.ngsprite"]) {
            commands.register({
                id: `se007.recent.${name}`,
                title: name,
                menuPath: ["View", "SE-007 Submenu"],
                menuOrder: 9010,
                run: () => void ran.push(name),
            });
        }
    });

    const view = await openMenu(page, "View");
    // The command kept the planned position, is enabled now and shows its shortcut.
    await expect(menuItem(page, "se007.planned")).toHaveText("Implemented ItemCtrl+Alt+F9");
    await expect(menuItem(page, "se007.planned")).not.toHaveAttribute("aria-disabled", "true");
    const titles = await view.getByRole("menuitem").allTextContents();
    expect(titles.slice(-3)).toEqual(["Implemented ItemCtrl+Alt+F9", "SE-007 Submenu", "Last"]);

    await view.getByRole("menuitem", { name: "SE-007 Submenu" }).hover();
    const submenu = page.getByRole("menu", { name: "SE-007 Submenu" });
    await expect(submenu.getByRole("menuitem")).toHaveText(["hero.ngsprite", "tiles.ngsprite"]);
    await submenu.getByRole("menuitem", { name: "tiles.ngsprite" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await calls(page)).toEqual(["tiles.ngsprite"]);

    await openMenu(page, "View");
    await menuItem(page, "se007.planned").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    // Its shortcut reaches it as well.
    await page.keyboard.press("Control+Alt+F9");
    expect(await calls(page)).toEqual(["tiles.ngsprite", "se007.planned", "se007.planned"]);
});

test("a menu closed before its fade-in has started leaves the page at once and opens again on its first item", async ({
    page,
}) => {
    await openEditor(page);
    // The entrance animation starts late, as it does when the first frame after opening is
    // slow. Radix keeps a closing element in the page until its animation ends.
    await page.addStyleTag({ content: ".ui-menu { animation-delay: 2s !important; }" });
    await menuTrigger(page, "File").focus();
    await page.keyboard.press("Enter");
    await expect(menuItem(page, "file.new")).toBeFocused();
    await page.keyboard.press("Escape");
    // Read once, not awaited: a closed menu that stayed would be gone two seconds later.
    expect(await page.locator('[role="menu"]').count()).toBe(0);
    await expect(menuTrigger(page, "File")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menuItem(page, "file.new")).toBeFocused();
});

test("a command that fails is reported by an error toast", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
        window.__ngneTest!.commands.register({
            id: "se007.fails",
            title: "Failing Command",
            menuPath: ["View"],
            menuOrder: 9000,
            run() {
                throw new Error("Could not allocate 4096 bytes of pixel memory.");
            },
        });
    });
    await openMenu(page, "View");
    await menuItem(page, "se007.fails").click();
    await expect(page.getByRole("alert")).toHaveText(
        "Failing Command failed: Could not allocate 4096 bytes of pixel memory.",
    );
    // The app goes on working.
    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toBeVisible();
});
