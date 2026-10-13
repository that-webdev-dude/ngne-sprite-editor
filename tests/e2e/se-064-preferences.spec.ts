import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
    PREFERENCES_STORAGE_KEY,
    PREFERENCES_VERSION,
} from "../../src/app/preferences/preferences";
import type { PreferenceKey, Preferences } from "../../src/app/preferences/preferences";
import { boxOf, collectErrors, settleTimers } from "./se-006-support";
import { menuItem, menuTrigger, openEditor, openMenu } from "./se-007-support";
import { dialogButton, field, setNumber } from "./se-008-support";
import {
    activeOption,
    arrowTo,
    choose,
    expectShellUsable,
    hexField,
    openPalette,
    openPreferences,
    PANEL,
    PREFERENCES_COMMAND,
    preferencesDialog,
    ringOf,
    section,
    segment,
    storedPreferences,
    toggle,
} from "./se-064-support";

// SE-064: the Preferences dialog (DESIGN §7). It edits the preference store of SE-007 and,
// for the theme, the theme store of SE-006; a change applies at once and persists.

const THEME_KEY = "ngne-sprite-editor.theme";

type Mutable<Value> = { -readonly [Key in keyof Value]: Mutable<Value[Key]> };
type Draft = Mutable<Preferences>;

const checkerboard = (dialog: Locator) => section(dialog, "Checkerboard");
const grid = (dialog: Locator) => section(dialog, "Default grid");
const onion = (dialog: Locator) => section(dialog, "Onion skin defaults");
const importDefaults = (dialog: Locator) => section(dialog, "Import defaults");
const autosave = (dialog: Locator) => section(dialog, "Autosave");
const select = (scope: Locator, name: string) => scope.getByRole("combobox", { name, exact: true });
const preview = (dialog: Locator) => dialog.locator(".preferences__checker");

const theme = (page: Page) => page.locator("html").getAttribute("data-theme");
const bodyColour = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const storedRecord = (page: Page) =>
    page.evaluate((key) => localStorage.getItem(key), PREFERENCES_STORAGE_KEY);
/** The two colours the checkerboard preview is drawn with. */
const previewColours = (dialog: Locator) =>
    preview(dialog).evaluate((element) => {
        const style = getComputedStyle(element);
        return [
            style.getPropertyValue("--check-a").trim(),
            style.getPropertyValue("--check-b").trim(),
        ];
    });

/** Every field of the preferences as "section.field" with its value as JSON. */
function leaves(preferences: Preferences): Map<string, string> {
    return new Map(
        (Object.keys(preferences) as PreferenceKey[]).flatMap((key) =>
            Object.entries(preferences[key]).map(([name, value]) => [
                `${key}.${name}`,
                JSON.stringify(value),
            ]),
        ),
    );
}

declare global {
    interface Window {
        /** What the test subscriber of the preference store was told, in order. */
        se064Seen?: [string, unknown][];
    }
}

/** Subscribes to the preference store of the page; each call is recorded with a copy. */
async function subscribe(page: Page): Promise<void> {
    await page.evaluate(() => {
        const seen: [string, unknown][] = (window.se064Seen = []);
        window.__ngneTest!.preferences.subscribe((key, all) => {
            seen.push([key, JSON.parse(JSON.stringify(all[key]))]);
        });
    });
}
const seen = (page: Page) => page.evaluate(() => window.se064Seen ?? []);

test("the Edit menu opens Preferences: the theme and every value of the preference store", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openMenu(page, "Edit");
    await expect(menuItem(page, PREFERENCES_COMMAND)).toHaveText("Preferences…");
    await expect(menuItem(page, PREFERENCES_COMMAND)).not.toHaveAttribute("aria-disabled", "true");
    await menuItem(page, PREFERENCES_COMMAND).click();
    const dialog = preferencesDialog(page);
    await expect(dialog.getByRole("heading", { name: "Preferences" })).toBeVisible();
    expect((await boxOf(dialog)).width).toBe(560);

    // The sections of DESIGN §7, in its order.
    await expect(dialog.getByRole("group")).toHaveCount(6);
    expect(
        await dialog
            .getByRole("group")
            .evaluateAll((groups) =>
                groups.map(
                    (group) =>
                        document.getElementById(group.getAttribute("aria-labelledby") ?? "")
                            ?.textContent,
                ),
            ),
    ).toEqual([
        "Theme",
        "Checkerboard",
        "Default grid",
        "Onion skin defaults",
        "Import defaults",
        "Autosave",
    ]);

    // The values as they ship (SE-007 defaults; the theme is dark).
    await expect(segment(dialog, "Theme", "Dark")).toBeChecked();
    await expect(segment(checkerboard(dialog), "Colours", "Theme")).toBeChecked();
    await expect(field(checkerboard(dialog), "Size")).toHaveValue("8");
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(field(grid(dialog), "Width")).toHaveValue("16");
    await expect(field(grid(dialog), "Height")).toHaveValue("16");
    await expect(segment(onion(dialog), "Onion skin", "Off")).toBeChecked();
    await expect(field(onion(dialog), "Before")).toHaveValue("1");
    await expect(field(onion(dialog), "After")).toHaveValue("1");
    await expect(field(onion(dialog), "Opacity")).toHaveValue("128");
    await expect(field(onion(dialog), "Falloff")).toHaveValue("0.50");
    await expect(segment(onion(dialog), "Placement", "Behind")).toBeChecked();
    await expect(toggle(onion(dialog), "Tint")).toHaveAttribute("aria-pressed", "false");
    await expect(toggle(onion(dialog), "Within tag")).toHaveAttribute("aria-pressed", "false");
    await expect(field(importDefaults(dialog), "Target width")).toHaveValue("32");
    await expect(field(importDefaults(dialog), "Target height")).toHaveValue("32");
    await expect(select(importDefaults(dialog), "Resample")).toHaveText("Area average");
    await expect(field(importDefaults(dialog), "Alpha threshold")).toHaveValue("128");
    await expect(field(importDefaults(dialog), "Colours")).toHaveValue("16");
    await expect(select(importDefaults(dialog), "Dither")).toHaveText("None");
    await expect(segment(autosave(dialog), "Autosave", "On")).toBeChecked();

    // Close and Escape close it; nothing was stored by looking.
    await dialogButton(dialog, "Close").click();
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "Edit")).toBeFocused();
    expect(await storedRecord(page)).toBeNull();
    await expectShellUsable(page);
    expect(errors).toEqual([]);
});

test("changing a preference updates the store and notifies a test subscriber, for every field, without a reload; the value persists across reloads", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const defaults = await storedPreferences(page);
    await subscribe(page);
    const dialog = await openPreferences(page);

    /** One change made in the dialog and what it does to the preferences. */
    type Step = [field: string, act: () => Promise<void>, apply: (draft: Draft) => void];
    const steps: Step[] = [
        [
            // Custom starts from the colours of the theme (dark here).
            "checkerboard.colors",
            () => segment(checkerboard(dialog), "Colours", "Custom").click(),
            (draft) => void (draft.checkerboard.colors = { a: 0x3a3a3a, b: 0x4a4a4a }),
        ],
        [
            "checkerboard.colors",
            async () => {
                await hexField(checkerboard(dialog), "Colour A").fill("#112233");
                await page.keyboard.press("Enter");
            },
            (draft) => void (draft.checkerboard.colors = { a: 0x112233, b: 0x4a4a4a }),
        ],
        [
            "checkerboard.colors",
            async () => {
                await hexField(checkerboard(dialog), "Colour B").fill("DDEEFF");
                await hexField(checkerboard(dialog), "Colour B").blur();
            },
            (draft) => void (draft.checkerboard.colors = { a: 0x112233, b: 0xddeeff }),
        ],
        [
            "checkerboard.size",
            () => setNumber(field(checkerboard(dialog), "Size"), 16),
            (draft) => void (draft.checkerboard.size = 16),
        ],
        [
            "grid.width",
            () => setNumber(field(grid(dialog), "Width"), 8),
            (draft) => void (draft.grid.width = 8),
        ],
        [
            "grid.height",
            () => setNumber(field(grid(dialog), "Height"), 24),
            (draft) => void (draft.grid.height = 24),
        ],
        [
            "onion.enabled",
            () => segment(onion(dialog), "Onion skin", "On").click(),
            (draft) => void (draft.onion.enabled = true),
        ],
        [
            "onion.before",
            () => setNumber(field(onion(dialog), "Before"), 3),
            (draft) => void (draft.onion.before = 3),
        ],
        [
            "onion.after",
            () => setNumber(field(onion(dialog), "After"), 0),
            (draft) => void (draft.onion.after = 0),
        ],
        [
            "onion.opacity",
            () => setNumber(field(onion(dialog), "Opacity"), 64),
            (draft) => void (draft.onion.opacity = 64),
        ],
        [
            "onion.falloff",
            () => setNumber(field(onion(dialog), "Falloff"), "0.25"),
            (draft) => void (draft.onion.falloff = 0.25),
        ],
        [
            "onion.tint",
            () => toggle(onion(dialog), "Tint").click(),
            (draft) => void (draft.onion.tint = true),
        ],
        [
            "onion.placement",
            () => segment(onion(dialog), "Placement", "In front").click(),
            (draft) => void (draft.onion.placement = "front"),
        ],
        [
            "onion.withinTag",
            () => toggle(onion(dialog), "Within tag").click(),
            (draft) => void (draft.onion.withinTag = true),
        ],
        [
            "import.targetWidth",
            () => setNumber(field(importDefaults(dialog), "Target width"), 64),
            (draft) => void (draft.import.targetWidth = 64),
        ],
        [
            "import.targetHeight",
            () => setNumber(field(importDefaults(dialog), "Target height"), 48),
            (draft) => void (draft.import.targetHeight = 48),
        ],
        [
            "import.resample",
            () => choose(page, importDefaults(dialog), "Resample", "Nearest"),
            (draft) => void (draft.import.resample = "nearest"),
        ],
        [
            "import.alphaThreshold",
            () => setNumber(field(importDefaults(dialog), "Alpha threshold"), 200),
            (draft) => void (draft.import.alphaThreshold = 200),
        ],
        [
            "import.colors",
            () => setNumber(field(importDefaults(dialog), "Colours"), 32),
            (draft) => void (draft.import.colors = 32),
        ],
        [
            "import.dither",
            () => choose(page, importDefaults(dialog), "Dither", "Floyd–Steinberg"),
            (draft) => void (draft.import.dither = "floyd-steinberg"),
        ],
        [
            "autosave.enabled",
            () => segment(autosave(dialog), "Autosave", "Off").click(),
            (draft) => void (draft.autosave.enabled = false),
        ],
    ];

    // The steps reach every field the store has.
    expect([...new Set(steps.map(([name]) => name))].sort()).toEqual(
        [...leaves(defaults).keys()].sort(),
    );

    const expected = structuredClone(defaults) as Draft;
    const told: [string, unknown][] = [];
    for (const [name, act, apply] of steps) {
        const key = name.split(".")[0] as PreferenceKey;
        await act();
        apply(expected);
        told.push([key, structuredClone(expected[key])]);
        // The subscriber was told once, of this preference, with its new value …
        await expect.poll(() => seen(page), name).toEqual(told);
        // … and the store holds it, with nothing else changed.
        expect(await storedPreferences(page), name).toEqual(expected);
    }
    // Every field now differs from its default: none was left out, none was changed back.
    const changed = leaves(expected);
    for (const [name, value] of leaves(defaults)) {
        expect(changed.get(name), name).not.toBe(value);
    }

    // One versioned record in localStorage holds them.
    expect(JSON.parse((await storedRecord(page)) ?? "null")).toEqual({
        version: PREFERENCES_VERSION,
        values: expected,
    });
    await dialogButton(dialog, "Close").click();
    await expect(dialog).toBeHidden();

    // After a reload the store and the dialog show the same values.
    await page.reload();
    await openEditor(page);
    expect(await storedPreferences(page)).toEqual(expected);
    const reopened = await openPreferences(page);
    await expect(segment(checkerboard(reopened), "Colours", "Custom")).toBeChecked();
    await expect(hexField(checkerboard(reopened), "Colour A")).toHaveValue("#112233");
    await expect(hexField(checkerboard(reopened), "Colour B")).toHaveValue("#ddeeff");
    await expect(field(checkerboard(reopened), "Size")).toHaveValue("16");
    await expect(field(grid(reopened), "Width")).toHaveValue("8");
    await expect(field(grid(reopened), "Height")).toHaveValue("24");
    await expect(segment(onion(reopened), "Onion skin", "On")).toBeChecked();
    await expect(field(onion(reopened), "Before")).toHaveValue("3");
    await expect(field(onion(reopened), "After")).toHaveValue("0");
    await expect(field(onion(reopened), "Opacity")).toHaveValue("64");
    await expect(field(onion(reopened), "Falloff")).toHaveValue("0.25");
    await expect(toggle(onion(reopened), "Tint")).toHaveAttribute("aria-pressed", "true");
    await expect(segment(onion(reopened), "Placement", "In front")).toBeChecked();
    await expect(toggle(onion(reopened), "Within tag")).toHaveAttribute("aria-pressed", "true");
    await expect(field(importDefaults(reopened), "Target width")).toHaveValue("64");
    await expect(field(importDefaults(reopened), "Target height")).toHaveValue("48");
    await expect(select(importDefaults(reopened), "Resample")).toHaveText("Nearest");
    await expect(field(importDefaults(reopened), "Alpha threshold")).toHaveValue("200");
    await expect(field(importDefaults(reopened), "Colours")).toHaveValue("32");
    await expect(select(importDefaults(reopened), "Dither")).toHaveText("Floyd–Steinberg");
    await expect(segment(autosave(reopened), "Autosave", "Off")).toBeChecked();
    expect(errors).toEqual([]);
});

test("changing the theme changes the running app immediately", async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEditor(page);
    expect(await theme(page)).toBe("dark");
    expect(await bodyColour(page)).toBe(PANEL.dark);
    await subscribe(page);

    const dialog = await openPreferences(page);
    const surface = () => dialog.evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect(segment(dialog, "Theme", "Dark")).toBeChecked();
    expect(await surface()).toBe(PANEL.dark);

    // Light: the page behind the open dialog and the dialog itself change at once.
    await segment(dialog, "Theme", "Light").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(segment(dialog, "Theme", "Light")).toBeChecked();
    expect(await bodyColour(page)).toBe(PANEL.light);
    expect(await surface()).toBe(PANEL.light);
    // The checkerboard of the theme follows.
    expect(await previewColours(dialog)).toEqual(["#c8c8c8", "#ffffff"]);

    // The theme store is its owner: its own key is written, the preference store is not told.
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe("light");
    expect(await seen(page)).toEqual([]);
    expect(await storedRecord(page)).toBeNull();

    // From the keyboard: the arrow keys move the choice, and the app follows.
    await arrowTo(page, "ArrowLeft", segment(dialog, "Theme", "Dark"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bodyColour(page)).toBe(PANEL.dark);
    expect(await previewColours(dialog)).toEqual(["#3a3a3a", "#4a4a4a"]);
    await arrowTo(page, "ArrowRight", segment(dialog, "Theme", "Light"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // It is still light after the dialog is closed and after a reload.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await theme(page)).toBe("light");
    await page.reload();
    await openEditor(page);
    expect(await theme(page)).toBe("light");
    expect(await bodyColour(page)).toBe(PANEL.light);
    await expect(segment(await openPreferences(page), "Theme", "Light")).toBeChecked();
    expect(errors).toEqual([]);
});

test("number fields keep to the ranges of the store: nothing invalid can be stored", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const defaults = await storedPreferences(page);
    const dialog = await openPreferences(page);
    const stored = async () => (await storedPreferences(page)) as Draft;

    // Too large, too small, not a number.
    const width = field(grid(dialog), "Width");
    await setNumber(width, 5000);
    await expect(width).toHaveValue("1024");
    expect((await stored()).grid.width).toBe(1024);
    await setNumber(width, 0);
    await expect(width).toHaveValue("1");
    expect((await stored()).grid.width).toBe(1);
    await setNumber(width, "wide");
    await expect(width).toHaveValue("1");
    await setNumber(width, 12.6);
    await expect(width).toHaveValue("13");
    expect((await stored()).grid).toEqual({ width: 13, height: defaults.grid.height });

    // The limits of the other ranges.
    const limits: [Locator, string, string][] = [
        [field(checkerboard(dialog), "Size"), "1", "64"],
        [field(onion(dialog), "Before"), "0", "3"],
        [field(onion(dialog), "After"), "0", "3"],
        [field(onion(dialog), "Opacity"), "0", "255"],
        [field(onion(dialog), "Falloff"), "0.00", "1.00"],
        [field(importDefaults(dialog), "Target width"), "1", "1024"],
        [field(importDefaults(dialog), "Target height"), "1", "1024"],
        [field(importDefaults(dialog), "Alpha threshold"), "1", "255"],
        [field(importDefaults(dialog), "Colours"), "2", "256"],
    ];
    for (const [target, min, max] of limits) {
        await setNumber(target, -99999);
        await expect(target).toHaveValue(min);
        await setNumber(target, 99999);
        await expect(target).toHaveValue(max);
    }
    expect(await stored()).toMatchObject({
        checkerboard: { size: 64 },
        onion: { before: 3, after: 3, opacity: 255, falloff: 1 },
        import: { targetWidth: 1024, targetHeight: 1024, alphaThreshold: 255, colors: 256 },
    });

    // Arrow keys step by one, the falloff by a twentieth; each step is stored.
    const falloff = field(onion(dialog), "Falloff");
    await falloff.focus();
    await page.keyboard.press("ArrowDown");
    await expect(falloff).toHaveValue("0.95");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(falloff).toHaveValue("0.45");
    expect((await stored()).onion.falloff).toBe(0.45);
    await setNumber(falloff, "0.333");
    await expect(falloff).toHaveValue("0.33");
    expect((await stored()).onion.falloff).toBe(0.33);
    const before = field(onion(dialog), "Before");
    await before.focus();
    await page.keyboard.press("ArrowDown");
    await expect(before).toHaveValue("2");
    expect((await stored()).onion.before).toBe(2);

    // No value was refused by the store: no error toast, nothing on the console.
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("custom checkerboard colours are typed as hex; text that is not a colour is dropped", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEditor(page);
    await subscribe(page);
    const dialog = await openPreferences(page);
    const colours = async () => (await storedPreferences(page)).checkerboard.colors;
    const a = hexField(checkerboard(dialog), "Colour A");
    const b = hexField(checkerboard(dialog), "Colour B");

    // The colours of the theme: no fields, and the preview shows the theme's checkerboard.
    expect(await colours()).toBe("theme");
    await expect(a).toHaveCount(0);
    expect(await previewColours(dialog)).toEqual(["#3a3a3a", "#4a4a4a"]);

    // Custom starts from what is on screen, so nothing changes until a colour is typed.
    await segment(checkerboard(dialog), "Colours", "Custom").click();
    await expect(a).toHaveValue("#3a3a3a");
    await expect(b).toHaveValue("#4a4a4a");
    expect(await colours()).toEqual({ a: 0x3a3a3a, b: 0x4a4a4a });

    // Applied on Enter and when the field is left; the short form and upper case are read.
    await a.fill("#1af");
    expect(await colours()).toEqual({ a: 0x3a3a3a, b: 0x4a4a4a });
    await page.keyboard.press("Enter");
    await expect(a).toHaveValue("#11aaff");
    expect(await colours()).toEqual({ a: 0x11aaff, b: 0x4a4a4a });
    await b.fill("FFD700");
    await page.keyboard.press("Tab");
    await expect(b).toHaveValue("#ffd700");
    expect(await colours()).toEqual({ a: 0x11aaff, b: 0xffd700 });
    expect(await previewColours(dialog)).toEqual(["#11aaff", "#ffd700"]);

    // Not a colour: the field goes back to the stored one and the store is not touched.
    const told = (await seen(page)).length;
    for (const text of ["#12", "blue", "#gggggg", ""]) {
        await a.fill(text);
        await a.blur();
        await expect(a, text).toHaveValue("#11aaff");
    }
    expect(await colours()).toEqual({ a: 0x11aaff, b: 0xffd700 });
    expect((await seen(page)).length).toBe(told);

    // Theme and back: the custom colours are not lost while the dialog is open.
    await segment(checkerboard(dialog), "Colours", "Theme").click();
    expect(await colours()).toBe("theme");
    await expect(a).toHaveCount(0);
    expect(await previewColours(dialog)).toEqual(["#3a3a3a", "#4a4a4a"]);
    await segment(checkerboard(dialog), "Colours", "Custom").click();
    await expect(a).toHaveValue("#11aaff");
    await expect(b).toHaveValue("#ffd700");
    expect(await colours()).toEqual({ a: 0x11aaff, b: 0xffd700 });

    // In the light theme Custom starts from the light checkerboard (in a dialog that has no
    // colours to remember).
    await segment(checkerboard(dialog), "Colours", "Theme").click();
    await segment(dialog, "Theme", "Light").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await dialogButton(dialog, "Close").click();
    await expect(dialog).toBeHidden();
    const light = await openPreferences(page);
    await segment(checkerboard(light), "Colours", "Custom").click();
    await expect(hexField(checkerboard(light), "Colour A")).toHaveValue("#c8c8c8");
    await expect(hexField(checkerboard(light), "Colour B")).toHaveValue("#ffffff");
    expect(errors).toEqual([]);
});

test("Restore defaults returns every preference and the theme to the default", async ({ page }) => {
    await openEditor(page);
    const defaults = await storedPreferences(page);
    const dialog = await openPreferences(page);
    await segment(dialog, "Theme", "Light").click();
    await setNumber(field(grid(dialog), "Width"), 8);
    await segment(checkerboard(dialog), "Colours", "Custom").click();
    await toggle(onion(dialog), "Tint").click();
    await choose(page, importDefaults(dialog), "Dither", "Ordered (Bayer 4×4)");
    await segment(autosave(dialog), "Autosave", "Off").click();
    expect(await storedPreferences(page)).toMatchObject({
        grid: { width: 8 },
        onion: { tint: true },
        import: { dither: "ordered" },
        autosave: { enabled: false },
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await dialogButton(dialog, "Restore defaults").click();
    // The dialog stays open and shows the defaults.
    await expect(dialog).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(segment(dialog, "Theme", "Dark")).toBeChecked();
    await expect(field(grid(dialog), "Width")).toHaveValue("16");
    await expect(segment(checkerboard(dialog), "Colours", "Theme")).toBeChecked();
    await expect(toggle(onion(dialog), "Tint")).toHaveAttribute("aria-pressed", "false");
    await expect(select(importDefaults(dialog), "Dither")).toHaveText("None");
    await expect(segment(autosave(dialog), "Autosave", "On")).toBeChecked();
    expect(await storedPreferences(page)).toEqual(defaults);

    // And they are what a reload finds.
    await page.reload();
    await openEditor(page);
    expect(await storedPreferences(page)).toEqual(defaults);
    expect(await theme(page)).toBe("dark");
});

test("the dialog works from the keyboard and returns focus to the Edit menu", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const dialog = preferencesDialog(page);

    // Edit, Enter, End (Preferences… is the last item), Enter.
    await menuTrigger(page, "Edit").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Edit" })).toBeVisible();
    await page.keyboard.press("End");
    await expect(menuItem(page, PREFERENCES_COMMAND)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    // Focus starts on the first control: the theme.
    await expect(segment(dialog, "Theme", "Dark")).toBeFocused();
    expect(await ringOf(segment(dialog, "Theme", "Dark"))).not.toBe("none");

    // Tab walks every control and never leaves the dialog. A group of segments is one stop.
    const stopsInDialog = await dialog.evaluate(
        (element) =>
            element.querySelectorAll('input, button:not([role="radio"]), [role="radiogroup"]')
                .length,
    );
    expect(stopsInDialog).toBe(22);
    const visited = new Set<string>();
    for (let presses = 0; presses < stopsInDialog + 4; presses++) {
        await page.keyboard.press("Tab");
        visited.add(
            await page.evaluate(() => {
                const active = document.activeElement;
                const group = active?.closest('[role="radiogroup"]');
                const scope = active?.closest('[role="group"]')?.getAttribute("aria-labelledby");
                const name =
                    group?.getAttribute("aria-label") ??
                    active?.getAttribute("aria-label") ??
                    active?.id ??
                    "";
                return `${scope ?? "actions"}/${name || active?.textContent}`;
            }),
        );
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
            true,
        );
    }
    expect(visited.size).toBe(stopsInDialog);

    // Space presses a toggle, arrow keys move a choice, a select opens with Enter.
    await toggle(onion(dialog), "Tint").focus();
    await page.keyboard.press("Space");
    await expect(toggle(onion(dialog), "Tint")).toHaveAttribute("aria-pressed", "true");
    await segment(autosave(dialog), "Autosave", "On").focus();
    await arrowTo(page, "ArrowRight", segment(autosave(dialog), "Autosave", "Off"));
    await select(importDefaults(dialog), "Resample").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: "Area average" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: "Dominant colour" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(select(importDefaults(dialog), "Resample")).toHaveText("Dominant colour");
    expect(await storedPreferences(page)).toMatchObject({
        onion: { tint: true },
        autosave: { enabled: false },
        import: { resample: "dominant" },
    });

    // Escape closes the dialog; focus goes back to the menu it was opened from, with its ring.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "Edit")).toBeFocused();
    expect(await ringOf(menuTrigger(page, "Edit"))).not.toBe("none");
    await expectShellUsable(page);
    expect(errors).toEqual([]);
});

test("Preferences opens from the command palette; a click outside closes it", async ({ page }) => {
    await openEditor(page);
    await openPalette(page);
    await page.keyboard.type("pref");
    await expect(activeOption(page)).toHaveAttribute("data-command", PREFERENCES_COMMAND);
    await page.keyboard.press("Enter");
    const dialog = preferencesDialog(page);
    await expect(dialog).toBeVisible();
    await settleTimers(page);
    await page.mouse.click(8, 600);
    await expect(dialog).toBeHidden();
    await expectShellUsable(page);
});
