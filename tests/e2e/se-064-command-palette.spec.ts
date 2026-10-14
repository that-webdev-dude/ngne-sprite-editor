import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { formatChord } from "../../src/app/commands/chord";
import { boxOf, collectErrors, region, settleTimers } from "./se-006-support";
import {
    addTextField,
    menuItem,
    menuTrigger,
    openEditor,
    openMenu,
    openSession,
    rename,
    snapshot,
} from "./se-007-support";
import { documentName, nameField, newSpriteButton, newSpriteDialog } from "./se-008-support";
import {
    activeOption,
    calls,
    expectShellUsable,
    openFromEditMenu,
    openPalette,
    PALETTE_COMMAND,
    palette,
    paletteIds,
    paletteInput,
    paletteList,
    paletteOption,
    paletteOptions,
    paletteTrigger,
    preferencesDialog,
    recentCommands,
    registerProbes,
    registryCommands,
    ringOf,
    runFromPalette,
    shortcutSheet,
    spyOnCommands,
} from "./se-064-support";
import type { Probe } from "./se-064-support";

// SE-064: the command palette (DESIGN §4) — Ctrl+K, fuzzy search over the command registry,
// shortcuts and disabled state, recent commands first; every enabled command runs from it.
//
// Commands these tests add are their own (ids "se064.…", outside the menus, with titles no
// other command matches), so the tests keep their meaning as later tickets add commands.

/** Three commands that only the query "quokka" finds, in this order. */
const PROBES: readonly Probe[] = [
    { id: "se064.first", title: "Quokka First" },
    { id: "se064.second", title: "Quokka Second", shortcut: "Ctrl+Alt+F9" },
    { id: "se064.third", title: "Quokka Third (disabled)", enabled: false },
];

/** What a palette row shows, read from the page. */
function shownRows(page: Page) {
    return paletteOptions(page).evaluateAll((options) =>
        options.map((option) => ({
            id: option.getAttribute("data-command") ?? "",
            title: option.querySelector(".command-palette__title")?.textContent ?? "",
            group: option.querySelector(".command-palette__group")?.textContent ?? "",
            shortcut: option.querySelector(".command-palette__shortcut")?.textContent ?? "",
            disabled: option.getAttribute("aria-disabled") === "true",
        })),
    );
}

test("Ctrl+K opens the command palette, also from a text field; Escape closes it and returns focus", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);

    // With nothing focused.
    await openPalette(page);
    await expect(palette(page)).toBeVisible();
    await expect(paletteInput(page)).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await expectShellUsable(page);

    // † of SPEC §7.8: the chord also acts while a text field has focus, and types nothing.
    const text = await addTextField(page, "context-bar");
    await text.focus();
    await page.keyboard.type("a");
    await page.keyboard.press("Control+KeyK");
    await expect(paletteInput(page)).toBeFocused();
    await expect(text).toHaveValue("a");
    // What is typed now goes to the search field.
    await page.keyboard.type("b");
    await expect(paletteInput(page)).toHaveValue("b");
    await expect(text).toHaveValue("a");
    // Escape gives focus back to the field the palette was opened from.
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await expect(text).toBeFocused();
    await expectShellUsable(page);
    expect(errors).toEqual([]);
});

test("Ctrl+K does nothing while a menu or a dialog is open, and its browser default is suppressed", async ({
    page,
}) => {
    await openEditor(page);
    await page.evaluate(() => {
        const prevented: boolean[] = [];
        Object.assign(window, { se064Prevented: prevented });
        // Registered after the keymap's listener: the event as the keymap left it.
        window.addEventListener("keydown", (event) => {
            if (event.key === "k") prevented.push(event.defaultPrevented);
        });
    });
    const prevented = () =>
        page.evaluate(() => (window as unknown as { se064Prevented: boolean[] }).se064Prevented);

    const menu = await openMenu(page, "File");
    await page.keyboard.press("Control+KeyK");
    await expect(menu).toBeVisible();
    await expect(palette(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    await newSpriteButton(page).click();
    await expect(newSpriteDialog(page)).toBeVisible();
    await page.keyboard.press("Control+KeyK");
    await expect(newSpriteDialog(page)).toBeVisible();
    await expect(palette(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(newSpriteDialog(page)).toBeHidden();

    // The palette is such a dialog itself: the key does not open a second one.
    await openPalette(page);
    await page.keyboard.press("Control+KeyK");
    await expect(palette(page)).toHaveCount(1);
    await expect(paletteInput(page)).toHaveValue("");
    expect(await prevented()).toEqual([true, true, true, true]);
});

test("the palette lists every command of the registry with its menu, its shortcut and its disabled state", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const id = await openSession(page, { name: "start", width: 8, height: 8 });
    await rename(page, id, "first", "Pencil");
    await registerProbes(page, PROBES);
    const registry = await registryCommands(page);
    // Both kinds are there, so neither half of the comparison is empty.
    expect(registry.filter((command) => command.enabled).length).toBeGreaterThanOrEqual(5);
    expect(registry.filter((command) => !command.enabled).length).toBeGreaterThanOrEqual(2);
    expect(registry.filter((command) => command.shortcuts.length > 0).length).toBeGreaterThan(4);

    await openPalette(page);
    const rows = await shownRows(page);
    // Every command once, none besides.
    expect(rows.map((row) => row.id).sort()).toEqual(registry.map((command) => command.id).sort());
    for (const command of registry) {
        const row = rows.find((entry) => entry.id === command.id);
        const [shortcut] = command.shortcuts;
        expect(row, command.id).toEqual({
            id: command.id,
            title: command.title,
            group: command.menuPath?.join(" › ") ?? "",
            // As the menus show it: the first chord.
            shortcut: shortcut ? formatChord(shortcut) : "",
            disabled: !command.enabled,
        });
    }
    // Titles follow the state, as in the Edit menu.
    await expect(paletteOption(page, "edit.undo")).toHaveText("Undo PencilEditCtrl+Z");
    await expect(paletteOption(page, "edit.redo")).toHaveAttribute("aria-disabled", "true");
    await expect(paletteOption(page, "se064.second")).toHaveText("Quokka SecondCtrl+Alt+F9");

    // A disabled row stays visible, in the colour of disabled controls (DESIGN §3.1).
    const colours = await paletteOption(page, "se064.third").evaluate((element) => {
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
    expect(errors).toEqual([]);
});

test("every enabled command can be run from the palette; disabled commands are listed but inert", async ({
    page,
}) => {
    // One round through the palette for every command of the registry, which grows with every
    // ticket: three times the usual limit.
    test.slow();
    const errors = collectErrors(page);
    await openEditor(page);
    // A document with something to undo: more of the registry is enabled.
    const id = await openSession(page, { name: "start", width: 8, height: 8 });
    await rename(page, id, "first", "Pencil");
    await registerProbes(page, [
        ...PROBES,
        { id: "se064.hold", title: "Quokka Hold", shortcut: "Alt+F9", hold: true },
    ]);
    // The palette's own command stays as it is: it is what opens the palette here.
    await spyOnCommands(page, [PALETTE_COMMAND]);
    const registry = await registryCommands(page);
    const enabled = registry.filter((command) => command.enabled);
    const disabled = registry.filter((command) => !command.enabled);
    expect(enabled.map((command) => command.id)).toEqual(
        expect.arrayContaining([
            "edit.undo",
            "file.new",
            "sprite.properties",
            "focus.nextRegion",
            "edit.preferences",
            "edit.shortcuts",
            "se064.first",
        ]),
    );
    expect(disabled.map((command) => command.id)).toEqual(
        expect.arrayContaining(["edit.redo", "se064.third"]),
    );

    // Every enabled command: its row runs it, once, and nothing else.
    const expected: string[] = [];
    for (const command of enabled) {
        await openPalette(page);
        const row = paletteOption(page, command.id);
        await expect(row, command.id).not.toHaveAttribute("aria-disabled", "true");
        if (command.id === PALETTE_COMMAND) {
            // Its effect is the palette itself: open again, with an empty search.
            await paletteInput(page).fill("command palette");
            await row.click();
            await expect(paletteInput(page), command.id).toHaveValue("");
            await expect(paletteInput(page), command.id).toBeFocused();
            await page.keyboard.press("Escape");
        } else {
            await row.click();
            expected.push(command.id);
            // A hold binding is released after it ran, like a key that is let go.
            if (command.hold) expected.push(`${command.id}:release`);
        }
        await expect(palette(page), command.id).toBeHidden();
        await expect.poll(() => calls(page), command.id).toEqual(expected);
    }

    // Every disabled command: its row is there and does nothing; the palette stays open.
    await openPalette(page);
    for (const command of disabled) {
        const row = paletteOption(page, command.id);
        await expect(row, command.id).toHaveAttribute("aria-disabled", "true");
        await row.click({ force: true });
        await expect(palette(page), command.id).toBeVisible();
        await expect(paletteInput(page), command.id).toBeFocused();
    }
    // From the keyboard as well: Enter on a disabled row.
    await page.keyboard.type("quokka third");
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.third");
    await page.keyboard.press("Enter");
    await settleTimers(page);
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await settleTimers(page);
    expect(await calls(page)).toEqual(expected);
    expect(errors).toEqual([]);
});

test("typing searches the commands; arrow keys move through the rows; Enter runs the active one", async ({
    page,
}) => {
    await openEditor(page);
    await registerProbes(page, PROBES);
    await openPalette(page);
    const all = await paletteOptions(page).count();

    // The search is fuzzy: letters in order, upper or lower case, any of them left out.
    await page.keyboard.type("QUOK");
    await expect(paletteOptions(page)).toHaveText([
        "Quokka First",
        "Quokka SecondCtrl+Alt+F9",
        "Quokka Third (disabled)",
    ]);
    expect(all).toBeGreaterThan(3);
    await paletteInput(page).fill("qkscd");
    await expect(paletteOptions(page)).toHaveText(["Quokka SecondCtrl+Alt+F9"]);
    // Every term of the query has to match; their order does not matter.
    await paletteInput(page).fill("third quokka");
    expect(await paletteIds(page)).toEqual(["se064.third"]);
    await paletteInput(page).fill("quokka edit");
    await expect(paletteOptions(page)).toHaveCount(0);
    // The menu is searched with the title.
    await paletteInput(page).fill("edit undo");
    expect((await paletteIds(page))[0]).toBe("edit.undo");
    await paletteInput(page).fill("");
    await expect(paletteOptions(page)).toHaveCount(all);

    // The first row is the active one; the search field names it for assistive technology.
    await paletteInput(page).fill("quokka");
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.first");
    const activeId = () => activeOption(page).getAttribute("id");
    await expect(paletteInput(page)).toHaveAttribute("aria-activedescendant", (await activeId())!);
    await expect(paletteInput(page)).toHaveAttribute("aria-expanded", "true");
    await expect(paletteInput(page)).toHaveAttribute(
        "aria-controls",
        (await paletteList(page).getAttribute("id"))!,
    );

    // Arrow keys move the active row and wrap around; focus stays in the search field.
    await page.keyboard.press("ArrowDown");
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.second");
    await page.keyboard.press("ArrowDown");
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.third");
    await expect(paletteInput(page)).toHaveAttribute("aria-activedescendant", (await activeId())!);
    await page.keyboard.press("ArrowDown");
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.first");
    await page.keyboard.press("ArrowUp");
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.third");
    await page.keyboard.press("ArrowUp");
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.second");
    await expect(paletteInput(page)).toBeFocused();
    await expect(paletteInput(page)).toHaveValue("quokka");
    await expect(activeOption(page)).toHaveCount(1);

    // Enter runs the active row and closes the palette.
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeHidden();
    await expect.poll(() => calls(page)).toEqual(["se064.second"]);
    // The command's own key still runs it: the palette is one more way to the same command.
    await page.keyboard.press("Control+Alt+F9");
    expect(await calls(page)).toEqual(["se064.second", "se064.second"]);

    // Typing again starts from the first row, which is the command just run.
    await openPalette(page);
    await page.keyboard.type("quokka");
    expect(await paletteIds(page)).toEqual(["se064.second", "se064.first", "se064.third"]);
    await page.keyboard.press("ArrowDown");
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.first");
    await page.keyboard.type(" s");
    expect(await paletteIds(page)).toEqual(["se064.second", "se064.first", "se064.third"]);
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.second");
    await page.keyboard.press("Enter");
    await expect.poll(() => calls(page)).toEqual(["se064.second", "se064.second", "se064.second"]);
});

test("a query that matches no command says so, and Enter does nothing", async ({ page }) => {
    await openEditor(page);
    await openPalette(page);
    await expect(palette(page).getByRole("status")).toHaveText("");
    await page.keyboard.type("no such command anywhere");
    await expect(paletteOptions(page)).toHaveCount(0);
    await expect(palette(page).getByRole("status")).toHaveText("No matching commands");
    // No list: the search field no longer points at one.
    await expect(paletteInput(page)).toHaveAttribute("aria-expanded", "false");
    await expect(paletteInput(page)).not.toHaveAttribute("aria-activedescendant");
    await expect(paletteInput(page)).not.toHaveAttribute("aria-controls");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await settleTimers(page);
    await expect(palette(page)).toBeVisible();
    await expect(paletteInput(page)).toBeFocused();
    // The list comes back with the query.
    await paletteInput(page).fill("undo");
    await expect(activeOption(page)).toHaveAttribute("data-command", "edit.undo");
    await expect(palette(page).getByRole("status")).toHaveText("");
});

test("the pointer picks a row: hovering makes it active, a click runs it, a click outside closes the palette", async ({
    page,
}) => {
    await openEditor(page);
    await registerProbes(page, PROBES);
    await openPalette(page);
    await page.keyboard.type("quokka");
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.first");

    await paletteOption(page, "se064.second").hover();
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.second");
    await expect(activeOption(page)).toHaveCount(1);
    // The press does not take focus from the search field.
    await paletteOption(page, "se064.third").click({ force: true });
    await expect(paletteInput(page)).toBeFocused();
    await expect(palette(page)).toBeVisible();
    await paletteOption(page, "se064.first").click();
    await expect(palette(page)).toBeHidden();
    await expect.poll(() => calls(page)).toEqual(["se064.first"]);

    await openPalette(page);
    await settleTimers(page);
    await page.mouse.click(8, 600);
    await expect(palette(page)).toBeHidden();
    await settleTimers(page);
    expect(await calls(page)).toEqual(["se064.first"]);
    await expectShellUsable(page);
});

test("recent commands come first, newest first, and are remembered across a reload", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    expect(await recentCommands(page)).toEqual([]);
    await openPalette(page);
    const initial = await paletteIds(page);
    // Menu order while nothing is recent: File first.
    expect(initial[0]).toBe("file.new");
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();

    // Two commands run from the palette, one after the other.
    await runFromPalette(page, "edit.shortcuts");
    await expect(shortcutSheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcutSheet(page)).toBeHidden();
    await runFromPalette(page, "focus.nextRegion");
    await expect(menuTrigger(page, "File")).toBeFocused();
    expect(await recentCommands(page)).toEqual(["focus.nextRegion", "edit.shortcuts"]);

    await openPalette(page);
    const withoutRecent = initial.filter(
        (id) => id !== "focus.nextRegion" && id !== "edit.shortcuts",
    );
    expect(await paletteIds(page)).toEqual([
        "focus.nextRegion",
        "edit.shortcuts",
        ...withoutRecent,
    ]);
    // The newest is the active row: Enter repeats it.
    await expect(activeOption(page)).toHaveAttribute("data-command", "focus.nextRegion");
    // Running a recent command again moves it to the front; each command is listed once.
    await paletteOption(page, "edit.shortcuts").click();
    await expect(shortcutSheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcutSheet(page)).toBeHidden();
    expect(await recentCommands(page)).toEqual(["edit.shortcuts", "focus.nextRegion"]);

    // A command run from a menu or by its key is not a palette choice.
    await openFromEditMenu(page, "edit.preferences", preferencesDialog(page));
    await page.keyboard.press("Escape");
    await expect(preferencesDialog(page)).toBeHidden();
    const recent = ["edit.shortcuts", "focus.nextRegion"];
    expect(await recentCommands(page)).toEqual(recent);

    // While searching, the best match is first; recency decides between equal matches.
    await registerProbes(page, PROBES);
    const found = async (query: string) => {
        await openPalette(page);
        await page.keyboard.type(query);
        const ids = await paletteIds(page);
        await page.keyboard.press("Escape");
        await expect(palette(page)).toBeHidden();
        return ids;
    };
    expect(await found("quokka")).toEqual(["se064.first", "se064.second", "se064.third"]);
    await runFromPalette(page, "se064.second");
    expect(await found("quokka")).toEqual(["se064.second", "se064.first", "se064.third"]);
    await runFromPalette(page, "se064.first");
    expect(await found("quokka")).toEqual(["se064.first", "se064.second", "se064.third"]);
    // "s" starts a word of Quokka Second only: the better match is ahead of the newer command.
    expect(await found("quokka s")).toEqual(["se064.second", "se064.first", "se064.third"]);
    expect(await recentCommands(page)).toEqual(["se064.first", "se064.second", ...recent]);

    // The list is kept in localStorage: it is there after a reload. The commands of this test
    // are not: an id the registry does not know is passed over.
    await page.reload();
    await openEditor(page);
    expect((await recentCommands(page)).slice(0, 2)).toEqual(["se064.first", "se064.second"]);
    await openPalette(page);
    expect(await paletteIds(page)).toEqual([...recent, ...withoutRecent]);
    expect(errors).toEqual([]);
});

test("a chosen command runs after the palette has closed, where focus was; a dialog it opens returns focus there", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const text = await addTextField(page, "context-bar");
    await text.focus();

    // New Sprite… from the palette, opened from a text field.
    await openPalette(page);
    await page.keyboard.type("new sprite");
    await expect(activeOption(page)).toHaveAttribute("data-command", "file.new");
    await expect(activeOption(page)).toHaveText("New Sprite…FileCtrl+Alt+N");
    await page.keyboard.press("Enter");
    const dialog = newSpriteDialog(page);
    await expect(dialog).toBeVisible();
    await expect(palette(page)).toHaveCount(0);
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    // The dialog's opener is the field the palette was opened from.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(text).toBeFocused();
    await expectShellUsable(page);

    // The whole way from the keyboard: palette, command, dialog, document.
    await openPalette(page);
    await page.keyboard.type("nsp");
    await expect(activeOption(page)).toHaveAttribute("data-command", "file.new");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(nameField(dialog)).toBeFocused();
    await page.keyboard.type("hero");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(documentName(page)).toHaveText("hero");
    await expect(text).toBeFocused();

    // Preferences from the palette: one surface takes the place of the other.
    await openPalette(page);
    await page.keyboard.type("preferences");
    await expect(activeOption(page)).toHaveAttribute("data-command", "edit.preferences");
    await page.keyboard.press("Enter");
    await expect(preferencesDialog(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(preferencesDialog(page)).toBeHidden();
    await expect(text).toBeFocused();
    await expectShellUsable(page);
    expect(errors).toEqual([]);
});

test("Undo and Redo run from the palette and its rows follow the document", async ({ page }) => {
    await openEditor(page);
    const id = await openSession(page, { name: "start", width: 8, height: 8 });
    await rename(page, id, "first", "Pencil");

    await openPalette(page);
    await page.keyboard.type("undo");
    await expect(activeOption(page)).toHaveText("Undo PencilEditCtrl+Z");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeHidden();
    await expect.poll(async () => (await snapshot(page, id)).name).toBe("start");

    // Undo is the recent command now, and it has nothing left to undo: listed, inert.
    await openPalette(page);
    await expect(activeOption(page)).toHaveText("UndoEditCtrl+Z");
    await expect(activeOption(page)).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await settleTimers(page);
    await expect(palette(page)).toBeVisible();
    await page.keyboard.type("redo");
    await expect(activeOption(page)).toHaveText("Redo PencilEditCtrl+Y");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeHidden();
    await expect.poll(async () => (await snapshot(page, id)).name).toBe("first");
    expect((await snapshot(page, id)).position).toBe(1);
});

test("a command that fails in the palette is reported by an error toast", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
        window.__ngneTest!.commands.register({
            id: "se064.fails",
            title: "Quokka Failing",
            run() {
                throw new Error("Could not allocate 4096 bytes of pixel memory.");
            },
        });
    });
    await runFromPalette(page, "se064.fails");
    await expect(page.getByRole("alert")).toHaveText(
        "Quokka Failing failed: Could not allocate 4096 bytes of pixel memory.",
    );
    // The app goes on working, the palette included.
    await openPalette(page);
    await expect(activeOption(page)).toHaveAttribute("data-command", "se064.fails");
});

test("the menu bar has the command palette trigger at its right, with the shortcut of the registry", async ({
    page,
}) => {
    await openEditor(page);
    const trigger = paletteTrigger(page);
    await expect(trigger).toBeVisible();
    // The key shown and announced is the registry's.
    const [shortcut] =
        (await registryCommands(page)).find((command) => command.id === PALETTE_COMMAND)
            ?.shortcuts ?? [];
    expect(shortcut).toBe("Ctrl+K");
    await expect(trigger).toHaveText("CommandsCtrl+K");
    await expect(trigger.locator("kbd")).toHaveAttribute("data-chord", "Ctrl+K");
    await expect(trigger).toHaveAttribute("aria-keyshortcuts", "Control+K");
    await expect(trigger.locator("svg")).toHaveCount(1);

    // At the right edge of the 36 px bar, a 24 px target.
    const bar = await boxOf(region(page, "menu-bar"));
    const box = await boxOf(trigger);
    expect(bar.height).toBe(36);
    expect(box.height).toBe(24);
    expect(Math.round(bar.x + bar.width - (box.x + box.width))).toBe(8);

    // With a document open its name stays centred between the menus and the trigger.
    await openSession(page, { name: "hero", width: 8, height: 8 });
    const menus = await boxOf(region(page, "menu-bar").getByRole("menubar"));
    const name = await boxOf(documentName(page));
    const moved = await boxOf(trigger);
    expect(moved).toEqual(box);
    const free = (menus.x + menus.width + moved.x) / 2;
    expect(Math.abs(name.x + name.width / 2 - free)).toBeLessThanOrEqual(1);
    // A long name is cut off before the trigger.
    await openSession(page, {
        name: "a very long sprite name ".repeat(20).trim(),
        width: 8,
        height: 8,
    });
    const long = await boxOf(documentName(page));
    expect(await boxOf(trigger)).toEqual(box);
    expect(long.x + long.width).toBeLessThanOrEqual(box.x);
    expect(long.x).toBeGreaterThanOrEqual(menus.x + menus.width);

    // A click opens the palette; closing it returns focus to the trigger, without a ring.
    await trigger.click();
    await expect(paletteInput(page)).toBeFocused();
    expect(await ringOf(palette(page).locator(".command-palette__search"))).toBe("none");
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await ringOf(trigger)).toBe("none");
    // From the keyboard: Enter opens it, and the ring is back when focus returns.
    await page.keyboard.press("Enter");
    await expect(paletteInput(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(await ringOf(trigger)).not.toBe("none");
});

test("the Edit menu opens the palette, and focus returns to the menu", async ({ page }) => {
    await openEditor(page);
    await openMenu(page, "Edit");
    await expect(menuItem(page, PALETTE_COMMAND)).toHaveText("Command Palette…Ctrl+K");
    await expect(menuItem(page, PALETTE_COMMAND)).not.toHaveAttribute("aria-disabled", "true");
    await menuItem(page, PALETTE_COMMAND).click();
    await expect(paletteInput(page)).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await expect(menuTrigger(page, "Edit")).toBeFocused();
    await expectShellUsable(page);
});

test("the palette is a list that scrolls inside the window; the active row is kept in view", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditor(page);
    await openPalette(page);
    const count = await paletteOptions(page).count();
    expect(count).toBeGreaterThan(30);

    // Inside the window, at most 560 px wide, below the menu bar.
    const box = await boxOf(palette(page));
    expect(box.width).toBe(560);
    expect(Math.round(box.x + box.width / 2)).toBe(640);
    expect(box.y).toBeGreaterThan(36);
    expect(box.y + box.height).toBeLessThanOrEqual(720 - 24);
    // The rows are 28 px high and scroll; the search field stays where it is.
    for (const option of (await paletteOptions(page).all()).slice(0, 5)) {
        expect((await boxOf(option)).height).toBe(28);
    }
    const scroll = () => paletteList(page).evaluate((list) => list.scrollTop);
    const overflow = await paletteList(page).evaluate(
        (list) => list.scrollHeight - list.clientHeight,
    );
    expect(overflow).toBeGreaterThan(0);
    expect(await scroll()).toBe(0);
    const field = await boxOf(paletteInput(page));

    // Up from the first row is the last one, scrolled into view.
    await page.keyboard.press("ArrowUp");
    await expect(activeOption(page)).toHaveAttribute(
        "data-command",
        (await paletteIds(page)).at(-1)!,
    );
    // All the way down, but for the 4 px of padding under the last row.
    await expect.poll(scroll).toBeGreaterThanOrEqual(overflow - 4);
    const list = await boxOf(paletteList(page));
    const last = await boxOf(activeOption(page));
    expect(last.y + last.height).toBeLessThanOrEqual(list.y + list.height);
    expect(await boxOf(paletteInput(page))).toEqual(field);
    await page.keyboard.press("ArrowDown");
    await expect(activeOption(page)).toHaveAttribute("data-command", "file.new");
    await expect.poll(scroll).toBe(0);
});
