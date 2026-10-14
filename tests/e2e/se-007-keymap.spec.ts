import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { chordKey, chordModifiers } from "../../src/app/commands/chord";
import {
    isBrowserChord,
    isCharacterChord,
    isTextEditingChord,
} from "../../src/app/keymap/keyClasses";
import { region, settleTimers } from "./se-006-support";
import { CHROME_RESERVED_CHORDS, readSpecKeyTable } from "./se-007-spec-keys";
import type { SpecBinding } from "./se-007-spec-keys";

// SE-007: every chord listed in SPEC §7.8 reaches the registry in Chrome. The harness page
// runs the real shell and the real keymap on a registry of spy commands, one per chord and
// context of the table; the list is parsed from docs/SPEC.md (se-007-spec-keys.ts).
//
// Limit of the method: Playwright delivers keys to the page below the layer where Chrome
// handles its own shortcuts, so a chord the browser reserves would still arrive here. The
// table is therefore also compared with the chords Chrome reserves (last test).

const HARNESS = "/tests/e2e/harness/se-007-keymap.html";

interface KeyRecord {
    type: string;
    key: string;
    prevented: boolean;
}
interface Harness {
    calls: string[];
    releases: string[];
    events: KeyRecord[];
    selection: boolean;
    register(bindings: SpecBinding[]): string[];
    setContext(context: "gesture" | "floating", active: boolean): void;
    reset(): void;
}
declare global {
    interface Window {
        se007?: Harness;
    }
}

const table = readSpecKeyTable();
/** The spy of the "Alt (hold)" row runs whenever Alt goes down first, as in Alt+N. */
const ALT_HOLD = table.bindings.findIndex((binding) => binding.chord === "Alt");

/** A canonical chord as Playwright presses it on a US keyboard. */
function playwrightKey(chord: string): string {
    const key = chordKey(chord);
    const modifiers = chordModifiers(chord);
    const names = [
        modifiers.ctrl ? "Control" : "",
        modifiers.alt ? "Alt" : "",
        modifiers.shift ? "Shift" : "",
        modifiers.meta ? "Meta" : "",
    ].filter(Boolean);
    if (/^[A-Z]$/.test(key)) names.push(`Key${key}`);
    else if (/^[0-9]$/.test(key)) names.push(`Digit${key}`);
    else if (key === "?") names.push("Shift", "Slash");
    else if (key.length > 1) names.push(key === "Ctrl" ? "Control" : key);
    else throw new Error(`No Playwright key for "${chord}"; add it to playwrightKey().`);
    return names.join("+");
}

/** The character a text field receives for a character chord. */
function typedCharacter(chord: string): string {
    const key = chordKey(chord);
    return /^[A-Z]$/.test(key) && !chordModifiers(chord).shift ? key.toLowerCase() : key;
}

async function openHarness(page: Page): Promise<string[]> {
    await page.goto(HARNESS);
    await expect(region(page, "viewport")).toBeVisible();
    return page.evaluate((bindings) => window.se007!.register(bindings), table.bindings);
}

interface Scene {
    gesture?: boolean;
    floating?: boolean;
    selection?: boolean;
}

/** Clears the records and sets the editor state the next key is pressed in. */
async function arrange(page: Page, scene: Scene = {}): Promise<void> {
    await page.evaluate((state) => {
        const harness = window.se007!;
        harness.reset();
        harness.setContext("gesture", state.gesture ?? false);
        harness.setContext("floating", state.floating ?? false);
        harness.selection = state.selection ?? false;
    }, scene);
}

async function press(page: Page, binding: Pick<SpecBinding, "chord" | "hold">): Promise<void> {
    const key = playwrightKey(binding.chord);
    if (!binding.hold) return page.keyboard.press(key);
    await page.keyboard.down(key);
    await page.keyboard.up(key);
}

interface Outcome {
    /** Spies that ran, without the Alt-hold spy unless that is the one under test. */
    calls: string[];
    releases: string[];
    /** Whether the default of the chord's own key-down event was prevented. */
    prevented: boolean | undefined;
}

async function outcome(page: Page, ids: string[], binding: SpecBinding): Promise<Outcome> {
    const { calls, releases, events } = await page.evaluate(() => {
        const harness = window.se007!;
        return { calls: harness.calls, releases: harness.releases, events: harness.events };
    });
    const altHold = ids[ALT_HOLD];
    const own = (id: string) => binding.chord === "Alt" || id !== altHold;
    const key = chordKey(binding.chord);
    const down = events.find(
        (event) =>
            event.type === "keydown" &&
            (event.key === (key === "Space" ? " " : key) ||
                event.key.toUpperCase() === key ||
                (key === "Ctrl" && event.key === "Control")),
    );
    return { calls: calls.filter(own), releases: releases.filter(own), prevented: down?.prevented };
}

const viewport = (page: Page) => page.getByTestId("viewport-focus");
const textField = (page: Page) => page.getByTestId("text-field");

/** Where focus is for a binding of the table: its context decides. */
function focusTarget(page: Page, binding: SpecBinding): Locator {
    return binding.context === "timeline" ? page.getByTestId("timeline-cell") : viewport(page);
}

function sceneOf(binding: SpecBinding): Scene {
    return {
        gesture: binding.context === "gesture",
        floating: binding.context === "floating",
        selection: binding.condition === "selection",
    };
}

const label = (binding: SpecBinding) => `${binding.chord} in ${binding.context} (${binding.row})`;

test("the key table of SPEC §7.8 is read in full", () => {
    expect(table.bindings.length).toBeGreaterThan(60);
    expect(table.pointerRows).toEqual(["Wheel", "Shift+wheel", "Middle-drag"]);
    expect(ALT_HOLD).toBeGreaterThanOrEqual(0);
    // Every chord can be pressed by this spec.
    for (const binding of table.bindings) expect(playwrightKey(binding.chord)).not.toBe("");
});

test("every chord listed in SPEC §7.8 reaches the registry: a spy command per chord", async ({
    page,
}) => {
    const ids = await openHarness(page);
    expect(ids).toHaveLength(table.bindings.length);

    for (const [index, binding] of table.bindings.entries()) {
        const id = ids[index] ?? "";
        await arrange(page, sceneOf(binding));
        const target = focusTarget(page, binding);
        await target.focus();
        await press(page, binding);

        const result = await outcome(page, ids, binding);
        expect.soft(result.calls, `${label(binding)} runs its spy and no other`).toEqual([id]);
        expect.soft(result.prevented, `${label(binding)} has its default prevented`).toBe(true);
        expect.soft(result.releases, `${label(binding)} release`).toEqual(binding.hold ? [id] : []);
        // Focus has not moved: Tab on the viewport did not leave it.
        await expect.soft(target, `${label(binding)} keeps focus`).toBeFocused();
    }
});

test("chords marked † also reach the registry while a text field has focus", async ({ page }) => {
    const ids = await openHarness(page);
    const marked = table.bindings.filter((binding) => binding.text);
    expect(marked.length).toBeGreaterThanOrEqual(10);

    for (const binding of marked) {
        const id = ids[table.bindings.indexOf(binding)] ?? "";
        await arrange(page);
        await textField(page).fill("");
        await textField(page).focus();
        await press(page, binding);

        const result = await outcome(page, ids, binding);
        expect.soft(result.calls, `${label(binding)} in a text field`).toEqual([id]);
        expect.soft(result.prevented, `${label(binding)} default prevented`).toBe(true);
        await expect.soft(textField(page), `${label(binding)} types nothing`).toHaveValue("");
        await expect.soft(textField(page)).toBeFocused();
    }
});

test("no other chord of SPEC §7.8 acts while a text field has focus", async ({ page }) => {
    const ids = await openHarness(page);
    const unmarked = table.bindings.filter((binding) => !binding.text);
    // Ctrl+Shift+Z is how Chrome redoes in a text field; the table lists it for Redo.
    expect(unmarked.map((binding) => binding.chord)).toContain("Ctrl+Z");

    for (const binding of unmarked) {
        const { chord } = binding;
        // Even with the conditions of the binding's own context fulfilled.
        await arrange(page, sceneOf(binding));
        await textField(page).fill("");
        await textField(page).focus();
        await press(page, binding);

        const result = await outcome(page, ids, binding);
        expect.soft(result.calls, `${label(binding)} in a text field runs nothing`).toEqual([]);
        expect.soft(result.releases, `${label(binding)} releases nothing`).toEqual([]);
        // Typing and the field's own editing keys keep their default; a bound Ctrl/Alt/F-key
        // chord that does not act has its browser default suppressed.
        const suppressed = isBrowserChord(chord) && !isTextEditingChord(chord);
        expect.soft(result.prevented, `${label(binding)} default in a text field`).toBe(suppressed);
        if (isCharacterChord(chord)) {
            await expect
                .soft(textField(page), `${label(binding)} is typed into the field`)
                .toHaveValue(typedCharacter(chord));
        }
    }
});

test("a focused control keeps the keys it consumes natively", async ({ page }) => {
    const ids = await openHarness(page);
    const spy = (chord: string, context: string) =>
        ids[
            table.bindings.findIndex(
                (binding) =>
                    binding.chord === chord &&
                    binding.context === context &&
                    binding.condition !== "selection",
            )
        ];
    const calls = () => page.evaluate(() => window.se007!.calls);
    const lastKeyDown = () =>
        page.evaluate(() =>
            window.se007!.events.filter((event) => event.type === "keydown").at(-1),
        );

    // A button: Enter and Space are its own, a tool key still acts, arrows do nothing.
    const button = page.getByTestId("plain-button");
    await arrange(page);
    await button.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Escape");
    expect(await calls()).toEqual([]);
    expect((await lastKeyDown())?.prevented).toBe(false);
    await page.keyboard.press("KeyB");
    expect(await calls()).toEqual([spy("B", "canvas")]);
    expect((await lastKeyDown())?.prevented).toBe(true);

    // Tab leaves the button: it is bound for the viewport only.
    await arrange(page);
    await button.focus();
    await page.keyboard.press("Tab");
    await expect(button).not.toBeFocused();
    expect(await calls()).toEqual([]);

    // A select: letters are typeahead, a modified chord still acts.
    const select = page.getByRole("combobox", { name: "Choice" });
    await arrange(page);
    await select.focus();
    await page.keyboard.press("KeyB");
    await page.keyboard.press("Digit1");
    expect(await calls()).toEqual([]);
    await page.keyboard.press("Control+KeyS");
    expect(await calls()).toEqual([spy("Ctrl+S", "global")]);

    // In the timeline a button takes Enter; arrows still move the active cell.
    const transport = page.getByTestId("timeline-button");
    await arrange(page);
    await transport.focus();
    await page.keyboard.press("Enter");
    expect(await calls()).toEqual([]);
    await page.keyboard.press("ArrowLeft");
    expect(await calls()).toEqual([spy("ArrowLeft", "timeline")]);
    // The timeline splitter keeps its arrows.
    await arrange(page);
    const splitter = page.getByRole("separator", { name: "Resize timeline" });
    await splitter.focus();
    const before = await splitter.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowUp");
    expect(await calls()).toEqual([]);
    expect(await splitter.getAttribute("aria-valuenow")).not.toBe(before);
    // Tool keys fall back to the canvas context inside the timeline.
    await page.getByTestId("timeline-cell").focus();
    await page.keyboard.press("KeyB");
    expect(await calls()).toEqual([spy("B", "canvas")]);

    // Nothing focused: letters and modified chords act, native keys are left alone.
    await arrange(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowLeft");
    expect(await calls()).toEqual([]);
    await page.keyboard.press("KeyB");
    await page.keyboard.press("Control+KeyD");
    expect(await calls()).toEqual([spy("B", "canvas"), spy("Ctrl+D", "global")]);
});

test("a higher context takes a key from a lower one", async ({ page }) => {
    const ids = await openHarness(page);
    const spy = (chord: string, context: string) =>
        ids[
            table.bindings.findIndex(
                (binding) => binding.chord === chord && binding.context === context,
            )
        ];
    const pressed = async (scene: Scene, target: Locator, key: string) => {
        await arrange(page, scene);
        await target.focus();
        await page.keyboard.press(key);
        return page.evaluate(() => window.se007!.calls);
    };
    const cell = page.getByTestId("timeline-cell");

    // Enter is bound in gesture, floating, timeline and canvas.
    expect(await pressed({}, viewport(page), "Enter")).toEqual([spy("Enter", "canvas")]);
    expect(await pressed({}, cell, "Enter")).toEqual([spy("Enter", "timeline")]);
    expect(await pressed({ floating: true }, cell, "Enter")).toEqual([spy("Enter", "floating")]);
    expect(await pressed({ floating: true, gesture: true }, cell, "Enter")).toEqual([
        spy("Enter", "gesture"),
    ]);
    // Escape: floating before canvas.
    expect(await pressed({}, viewport(page), "Escape")).toEqual([spy("Escape", "canvas")]);
    expect(await pressed({ floating: true }, viewport(page), "Escape")).toEqual([
        spy("Escape", "floating"),
    ]);
});

test("no chord acts while a menu or a dialog is open", async ({ page }) => {
    const ids = await openHarness(page);
    const spy = (chord: string) =>
        ids[table.bindings.findIndex((binding) => binding.chord === chord)];
    const calls = () => page.evaluate(() => window.se007!.calls);
    const keyDowns = () =>
        page.evaluate(() => window.se007!.events.filter((event) => event.type === "keydown"));

    // A menu of the menu bar.
    await arrange(page);
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("KeyB");
    await page.keyboard.press("Control+KeyS");
    await page.keyboard.press("F3");
    expect(await calls()).toEqual([]);
    // Ctrl+S and F3 are bound: no "Save page", no find bar, even though they did not act.
    expect((await keyDowns()).filter((event) => ["s", "F3"].includes(event.key))).toEqual([
        { type: "keydown", key: "s", prevented: true },
        { type: "keydown", key: "F3", prevented: true },
    ]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    // Radix moves the focus back one timer after the menu has gone.
    await settleTimers(page);
    await page.keyboard.press("KeyB");
    expect(await calls()).toEqual([spy("B")]);

    // A dialog, with a text field of its own.
    await page.getByRole("button", { name: "Open dialog" }).click();
    const dialog = page.getByRole("dialog", { name: "Test dialog" });
    await expect(dialog).toBeVisible();
    await arrange(page);
    await dialog.getByRole("button", { name: "Close" }).focus();
    await page.keyboard.press("KeyB");
    await page.keyboard.press("Control+KeyS");
    await page.keyboard.press("F6");
    expect(await calls()).toEqual([]);

    const field = page.getByTestId("dialog-field");
    await field.focus();
    await page.keyboard.press("KeyZ");
    await page.keyboard.press("Control+KeyZ");
    await expect(field).toHaveValue("");
    await page.keyboard.press("KeyZ");
    await page.keyboard.press("Control+KeyS");
    await expect(field).toHaveValue("z");
    expect(await calls()).toEqual([]);
    const downs = await keyDowns();
    // The field's own undo keeps its default; the bound Ctrl+S does not.
    expect(downs.filter((event) => event.key === "z").map((event) => event.prevented)).toEqual([
        false,
        false,
        false,
    ]);
    expect(downs.filter((event) => event.key === "s").map((event) => event.prevented)).toEqual([
        true,
        true,
    ]);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await arrange(page);
    await viewport(page).focus();
    await page.keyboard.press("Control+KeyS");
    expect(await calls()).toEqual([spy("Ctrl+S")]);
});

test("no chord of SPEC §7.8 is one Chrome reserves for itself", () => {
    // Ctrl+N and Ctrl+W are why the table uses Ctrl+Alt+N and Alt+W.
    expect(CHROME_RESERVED_CHORDS).toEqual(expect.arrayContaining(["Ctrl+N", "Ctrl+W", "Ctrl+T"]));
    const reserved = table.bindings.filter((binding) =>
        CHROME_RESERVED_CHORDS.includes(binding.chord),
    );
    expect(reserved.map(label)).toEqual([]);
});
