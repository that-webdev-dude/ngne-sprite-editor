import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { boxOf, collectErrors, dragBy, openGallery, openShell, tabTo } from "./se-006-support";

// SE-006: the /gallery route — every primitive of DESIGN §4, operable by keyboard, with the
// focus ring on keyboard focus only, and free of WCAG AA violations in both themes.

type Theme = "dark" | "light";
const THEMES: readonly Theme[] = ["dark", "light"];
const ACCENT: Record<Theme, string> = { dark: "rgb(131, 232, 225)", light: "rgb(8, 127, 120)" };
const PANEL: Record<Theme, string> = { dark: "rgb(24, 24, 26)", light: "rgb(244, 244, 245)" };
const THEME_KEY = "ngne-sprite-editor.theme";

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const readout = (page: Page, name: string) => page.locator(`[data-readout="${name}"]`);
const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });

async function chooseTheme(page: Page, theme: Theme) {
    if (theme === "light") await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

// --- Contrast and other AA rules ----------------------------------------------------------

const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Whether any part of the element lies inside the visible box of its scrolling ancestors. */
function isOnScreen(page: Page, selector: string): Promise<boolean> {
    return page.locator(selector).evaluate((element) => {
        let { left, top, right, bottom } = element.getBoundingClientRect();
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.overflowX === "visible" && style.overflowY === "visible") continue;
            const clip = parent.getBoundingClientRect();
            left = Math.max(left, clip.left);
            top = Math.max(top, clip.top);
            right = Math.min(right, clip.right);
            bottom = Math.min(bottom, clip.bottom);
        }
        return right > left && bottom > top;
    });
}

/**
 * Runs axe (WCAG 2.1 A and AA) on the page, or on the subtree under `scope`, and returns the
 * violations together with what the contrast rule covered: nodes it judged, and nodes on
 * screen it could not decide on (those would hide a failure, so the tests accept none). Text
 * scrolled out of its container is not on screen; axe leaves it undecided because the
 * neighbouring box covers the place where it would be.
 */
async function audit(page: Page, scope?: string) {
    const builder = new AxeBuilder({ page }).withTags(AA_TAGS);
    const results = await (scope ? builder.include(scope) : builder).analyze();
    const contrast = (list: typeof results.passes) =>
        list.filter((rule) => rule.id === "color-contrast").flatMap((rule) => rule.nodes);
    const contrastUndecided = [];
    for (const node of contrast(results.incomplete)) {
        const selector = node.target.join(" ");
        if (await isOnScreen(page, selector)) contrastUndecided.push(selector);
    }
    return {
        violations: results.violations.flatMap((rule) =>
            rule.nodes.map(
                (node) => `${rule.id}: ${node.target.join(" ")} — ${node.failureSummary}`,
            ),
        ),
        contrastChecked: contrast(results.passes).length,
        contrastUndecided,
    };
}

interface Surface {
    name: string;
    /** Selector of the surface while it is open. */
    selector: string;
    open(): Promise<unknown>;
    close(): Promise<unknown>;
    /** Selector of a scrolling part: it is audited again scrolled to its end. */
    scroller?: string;
}

for (const theme of THEMES) {
    test(`axe reports no AA violations on the gallery in the ${theme} theme`, async ({ page }) => {
        // Many audits in one test: about 26 s alone, longer while other workers are busy.
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await openGallery(page);
        await chooseTheme(page, theme);
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
            PANEL[theme],
        );

        // Every primitive at rest. The contrast rule must have judged the text, not skipped it.
        const rest = await audit(page);
        expect(rest.violations).toEqual([]);
        expect(rest.contrastUndecided).toEqual([]);
        expect(rest.contrastChecked).toBeGreaterThan(40);

        // Surfaces that exist only while open.
        const escape = () => page.keyboard.press("Escape");
        const surfaces: Surface[] = [
            {
                name: "tooltip",
                selector: ".ui-tooltip",
                open: () => button(page, "Hover or focus").focus(),
                close: escape,
            },
            {
                name: "select list",
                selector: ".ui-menu--select",
                open: () => page.getByRole("combobox", { name: "Ink" }).click(),
                close: escape,
            },
            {
                name: "popover",
                selector: ".ui-popover",
                open: () => button(page, "Open popover").click(),
                close: escape,
            },
            {
                name: "context menu",
                selector: ".ui-menu",
                open: () => page.getByRole("group", { name: "Layer" }).click({ button: "right" }),
                close: escape,
            },
            {
                name: "dialog",
                selector: ".ui-dialog--standard",
                open: () => button(page, "Open dialog").click(),
                close: escape,
            },
            {
                name: "large dialog",
                selector: ".ui-dialog--large",
                open: () => button(page, "Open large dialog").click(),
                close: escape,
                scroller: ".ui-dialog--large .ui-dialog__body",
            },
            {
                name: "error toast",
                selector: ".ui-toast--error",
                open: () => button(page, "Show error toast").click(),
                close: () => button(page, "Dismiss").click(),
            },
            {
                name: "toast",
                selector: ".ui-toast",
                open: () => button(page, "Show toast").click(),
                close: () => expect(page.locator(".ui-toast")).toHaveCount(0, { timeout: 8000 }),
            },
            {
                name: "error boundary message",
                selector: ".region-error",
                open: () => button(page, "Break panel").click(),
                close: async () => {
                    await button(page, "Repair panel").click();
                    await button(page, "Reload").click();
                },
            },
        ];
        for (const { name, selector, open, close, scroller } of surfaces) {
            await open();
            await expect(page.locator(selector), name).toBeVisible();

            const whole = await audit(page);
            expect(whole.violations, name).toEqual([]);
            // The surface's own text was judged for contrast, and none of it left undecided.
            const own = await audit(page, selector);
            expect(own.violations, name).toEqual([]);
            expect(own.contrastUndecided, name).toEqual([]);
            expect(own.contrastChecked, name).toBeGreaterThan(0);

            if (scroller) {
                await page
                    .locator(scroller)
                    .evaluate((element) => element.scrollTo(0, element.scrollHeight));
                const scrolled = await audit(page, selector);
                expect(scrolled.violations, `${name}, scrolled`).toEqual([]);
                expect(scrolled.contrastUndecided, `${name}, scrolled`).toEqual([]);
                expect(scrolled.contrastChecked, `${name}, scrolled`).toBeGreaterThan(0);
            }

            await close();
            await expect(page.locator(selector), name).toHaveCount(0);
        }
    });
}

// --- Theme ---------------------------------------------------------------------------------

test("the theme switch is persisted in localStorage and restored on load", async ({ page }) => {
    await openGallery(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBeNull();
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await background()).toBe(PANEL.dark);

    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await background()).toBe(PANEL.light);
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe("light");

    await page.reload();
    await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await background()).toBe(PANEL.light);

    // The same setting drives the editor.
    await openShell(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await background()).toBe(PANEL.light);

    await openGallery(page);
    await page.getByRole("radio", { name: "Dark" }).click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await background()).toBe(PANEL.dark);
});

// --- Focus ring ----------------------------------------------------------------------------

/** The outline of the element that carries the ring for `target`. */
async function ringOf(target: Locator) {
    return target.evaluate((element) => {
        const owner = element.closest(".ui-number") ?? element;
        const style = getComputedStyle(owner);
        return style.outlineStyle === "none"
            ? "none"
            : `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}, offset ${style.outlineOffset}`;
    });
}

for (const theme of THEMES) {
    test(`every primitive shows the focus ring on keyboard focus only (${theme} theme)`, async ({
        page,
    }) => {
        await openGallery(page);
        await chooseTheme(page, theme);
        const ring = `2px solid ${ACCENT[theme]}, offset 1px`;

        // After the pointer click on the theme control nothing has a ring.
        expect(
            await page.evaluate(() =>
                [...document.querySelectorAll("*")].every(
                    (element) => getComputedStyle(element).outlineStyle === "none",
                ),
            ),
        ).toBe(true);

        const targets: [string, Locator][] = [
            ["button", button(page, "Default")],
            ["primary button", button(page, "Primary")],
            ["danger button", button(page, "Discard")],
            ["icon button", button(page, "Add frame")],
            ["tool button", button(page, "Eraser")],
            ["number field", page.getByRole("spinbutton", { name: "Size" })],
            ["slider", page.getByRole("slider", { name: "Tolerance" })],
            ["toggle", button(page, "Pixel grid")],
            ["text toggle", button(page, "Pixel-perfect")],
            ["segmented control", page.getByRole("radio", { name: "Circle" })],
            ["context menu target", page.getByRole("group", { name: "Layer" })],
            ["tooltip trigger", button(page, "Hover or focus")],
            ["splitter", page.getByRole("separator", { name: "Resize pane" })],
        ];
        for (const [name, target] of targets) {
            await target.click();
            await expect(target, name).toBeFocused();
            expect(await ringOf(target), `${name} after a pointer click`).toBe("none");

            await page.keyboard.press("Shift+Tab");
            await expect(target, name).not.toBeFocused();
            await page.keyboard.press("Tab");
            await expect(target, name).toBeFocused();
            expect(await ringOf(target), `${name} after Tab`).toBe(ring);
        }

        // Select: the pointer path goes through its list and back to the trigger.
        const select = page.getByRole("combobox", { name: "Ink" });
        await select.click();
        await page.getByRole("option", { name: "Lock alpha" }).click();
        await expect(select).toBeFocused();
        expect(await ringOf(select), "select after a pointer choice").toBe("none");
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(select).toBeFocused();
        expect(await ringOf(select), "select after Tab").toBe(ring);

        // A dialog moves focus by itself: ring only when it was opened from the keyboard.
        const width = page.getByRole("spinbutton", { name: "Width" });
        await button(page, "Open dialog").click();
        await expect(width).toBeFocused();
        expect(await ringOf(width), "dialog opened with the pointer").toBe("none");
        await button(page, "Cancel").click();
        await expect(button(page, "Open dialog")).toBeFocused();
        expect(await ringOf(button(page, "Open dialog"))).toBe("none");

        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Enter");
        await expect(width).toBeFocused();
        expect(await ringOf(width), "dialog opened with the keyboard").toBe(ring);
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await expect(button(page, "Cancel")).toBeFocused();
        expect(await ringOf(button(page, "Cancel")), "dialog button after Tab").toBe(ring);
        await page.keyboard.press("Escape");
        await expect(button(page, "Open dialog")).toBeFocused();
        expect(await ringOf(button(page, "Open dialog")), "opener after Escape").toBe(ring);

        // Typing in a field focused with the pointer is not keyboard navigation.
        const size = page.getByRole("spinbutton", { name: "Size" });
        await size.click();
        await page.keyboard.press("ArrowUp");
        await page.keyboard.type("4");
        expect(await ringOf(size), "number field while typing after a click").toBe("none");
    });
}

// --- Keyboard operation --------------------------------------------------------------------

test.describe("keyboard operation", () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openGallery(page);
    });

    test("button, icon button, tool button and toggle act on Enter and Space", async ({ page }) => {
        await tabTo(page, button(page, "Default"));
        await page.keyboard.press("Enter");
        await expect(readout(page, "clicks")).toHaveText("Clicks: 1");
        await page.keyboard.press("Space");
        await expect(readout(page, "clicks")).toHaveText("Clicks: 2");
        await tabTo(page, button(page, "Primary"));
        await page.keyboard.press("Enter");
        await expect(readout(page, "clicks")).toHaveText("Clicks: 3");
        // A disabled button is skipped by Tab.
        await tabTo(page, button(page, "Discard"));
        await page.keyboard.press("Tab");
        await expect(button(page, "Disabled")).toBeDisabled();
        await expect(button(page, "Add frame")).toBeFocused();

        await page.keyboard.press("Enter");
        await page.keyboard.press("Space");
        await expect(readout(page, "added")).toHaveText("Added: 2");
        await expect(button(page, "New layer")).toBeDisabled();

        await expect(button(page, "Pencil")).toHaveAttribute("aria-pressed", "true");
        await tabTo(page, button(page, "Eraser"));
        await page.keyboard.press("Space");
        await expect(button(page, "Eraser")).toHaveAttribute("aria-pressed", "true");
        await expect(button(page, "Pencil")).toHaveAttribute("aria-pressed", "false");
        await expect(readout(page, "tool")).toHaveText("Active: eraser");
        await tabTo(page, button(page, "Hand"));
        await page.keyboard.press("Enter");
        await expect(readout(page, "tool")).toHaveText("Active: hand");

        const grid = button(page, "Pixel grid");
        await expect(grid).toHaveAttribute("aria-pressed", "false");
        await tabTo(page, grid);
        await page.keyboard.press("Space");
        await expect(grid).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("Enter");
        await expect(grid).toHaveAttribute("aria-pressed", "false");
        const pixelPerfect = button(page, "Pixel-perfect");
        await tabTo(page, pixelPerfect);
        await page.keyboard.press("Space");
        await expect(pixelPerfect).toHaveAttribute("aria-pressed", "false");
    });

    test("tool and icon buttons carry a name, a 24 or 28 px target and a tooltip with the key", async ({
        page,
    }) => {
        const eraser = button(page, "Eraser");
        expect(await boxOf(eraser)).toMatchObject({ width: 28, height: 28 });
        expect(await boxOf(button(page, "Add frame"))).toMatchObject({ width: 24, height: 24 });
        expect(await boxOf(button(page, "Pixel grid"))).toMatchObject({ width: 24, height: 24 });

        await tabTo(page, eraser);
        const tooltip = page.locator(".ui-tooltip");
        await expect(tooltip).toHaveText("EraserE");
        await expect(tooltip.locator(".ui-tooltip__key")).toHaveText("E");
        await page.keyboard.press("Escape");
        await expect(tooltip).toBeHidden();

        // The active tool is an accent icon on --bg-active.
        const active = await button(page, "Pencil").evaluate((element) => {
            const style = getComputedStyle(element);
            return { color: style.color, background: style.backgroundColor };
        });
        expect(active).toEqual({ color: ACCENT.dark, background: "rgb(44, 44, 48)" });
    });

    test("a tooltip opens 400 ms after the pointer rests on its control", async ({ page }) => {
        const trigger = button(page, "Hover or focus");
        await trigger.evaluate((element) => {
            const timing = { entered: 0, shown: 0 };
            (window as unknown as { tooltipTiming: typeof timing }).tooltipTiming = timing;
            element.addEventListener("pointermove", () => (timing.entered ||= performance.now()));
            new MutationObserver(() => {
                if (document.querySelector(".ui-tooltip")) timing.shown ||= performance.now();
            }).observe(document.body, { childList: true, subtree: true });
        });
        await trigger.hover();
        await expect(page.locator(".ui-tooltip")).toHaveText("Shown after 400 msCtrl+K");
        const timing = await page.evaluate(
            () =>
                (window as unknown as { tooltipTiming: { entered: number; shown: number } })
                    .tooltipTiming,
        );
        expect(timing.entered).toBeGreaterThan(0);
        expect(timing.shown - timing.entered).toBeGreaterThanOrEqual(390);
    });

    test("number field: arrows step by 1, Shift by 10, typed values apply on Enter", async ({
        page,
    }) => {
        const size = page.getByRole("spinbutton", { name: "Size" });
        await expect(size).toHaveValue("1");
        await expect(size).toHaveAttribute("aria-valuemin", "1");
        await expect(size).toHaveAttribute("aria-valuemax", "64");

        await tabTo(page, size);
        await page.keyboard.press("ArrowUp");
        await expect(size).toHaveValue("2");
        await page.keyboard.press("Shift+ArrowUp");
        await expect(size).toHaveValue("12");
        await page.keyboard.press("ArrowDown");
        await expect(size).toHaveValue("11");
        await page.keyboard.press("Shift+ArrowDown");
        await expect(size).toHaveValue("1");
        await page.keyboard.press("ArrowDown");
        await expect(size).toHaveValue("1");
        await expect(size).toHaveAttribute("aria-valuenow", "1");

        await page.keyboard.press("Control+A");
        await page.keyboard.type("40");
        await expect(size).toHaveAttribute("aria-valuenow", "1");
        await page.keyboard.press("Enter");
        await expect(size).toHaveAttribute("aria-valuenow", "40");

        await page.keyboard.press("Control+A");
        await page.keyboard.type("999");
        await page.keyboard.press("Enter");
        await expect(size).toHaveValue("64");

        // Escape drops what was typed; so does text that is not a number.
        await page.keyboard.press("Control+A");
        await page.keyboard.type("7");
        await page.keyboard.press("Escape");
        await expect(size).toHaveValue("64");
        await page.keyboard.press("Control+A");
        await page.keyboard.type("wide");
        await page.keyboard.press("Tab");
        await expect(size).toHaveValue("64");

        // A typed value is also applied when focus leaves the field.
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Control+A");
        await page.keyboard.type("16");
        await page.keyboard.press("Tab");
        await expect(size).toHaveValue("16");

        // The unit is shown next to the value, muted, and is not part of it.
        const unit = page.locator('[data-demo="number-field"] .ui-number__unit').first();
        await expect(unit).toHaveText("px");
        expect(await unit.evaluate((element) => getComputedStyle(element).color)).toBe(
            "rgb(154, 154, 162)",
        );
    });

    test("number field: dragging the label scrubs the value", async ({ page }) => {
        const opacity = page.getByRole("spinbutton", { name: "Opacity" });
        const label = page.locator('[data-demo="number-field"] label', { hasText: "Opacity" });
        await expect(opacity).toHaveValue("100");
        expect(await label.evaluate((element) => getComputedStyle(element).cursor)).toBe(
            "ew-resize",
        );

        // One step per two pixels; the release does not move focus into the field.
        await dragBy(page, label, -40, 0);
        await expect(opacity).toHaveValue("80");
        await expect(opacity).not.toBeFocused();
        await dragBy(page, label, 12, 0);
        await expect(opacity).toHaveValue("86");
        await dragBy(page, label, 400, 0);
        await expect(opacity).toHaveValue("100");

        // A plain click on the label still focuses the field.
        await label.click();
        await expect(opacity).toBeFocused();
    });

    test("slider: arrow keys, Home and End move the thumb; the number field follows", async ({
        page,
    }) => {
        const thumb = page.getByRole("slider", { name: "Tolerance" });
        const field = page.getByRole("spinbutton", { name: "Tolerance" });
        await expect(thumb).toHaveAttribute("aria-valuenow", "32");
        await expect(field).toHaveValue("32");

        await tabTo(page, thumb);
        await page.keyboard.press("ArrowRight");
        await expect(thumb).toHaveAttribute("aria-valuenow", "33");
        await expect(field).toHaveValue("33");
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("ArrowLeft");
        await expect(field).toHaveValue("31");
        await page.keyboard.press("End");
        await expect(field).toHaveValue("255");
        await page.keyboard.press("Home");
        await expect(field).toHaveValue("0");

        // The adjacent number field drives the thumb as well.
        await page.keyboard.press("Tab");
        await expect(field).toBeFocused();
        await page.keyboard.press("Shift+ArrowUp");
        await expect(thumb).toHaveAttribute("aria-valuenow", "10");

        // DESIGN §4: 2 px track, 10 px thumb inside a 24 px hit area.
        const metrics = await thumb.evaluate((element) => {
            const dot = getComputedStyle(element, "::after");
            const track = element
                .closest(".ui-slider__root")
                ?.querySelector(".ui-slider__track")
                ?.getBoundingClientRect();
            const hit = element.getBoundingClientRect();
            return {
                hit: [hit.width, hit.height],
                dot: [dot.width, dot.height],
                track: track?.height,
            };
        });
        expect(metrics).toEqual({ hit: [24, 24], dot: ["10px", "10px"], track: 2 });
    });

    test("select: opens with Enter, arrows move, Enter chooses, Escape keeps the value", async ({
        page,
    }) => {
        const select = page.getByRole("combobox", { name: "Ink" });
        await expect(select).toHaveText("Simple");
        await tabTo(page, select);
        await page.keyboard.press("Enter");
        const list = page.getByRole("listbox");
        await expect(list).toBeVisible();
        await expect(list.getByRole("option")).toHaveText([
            "Simple",
            "Alpha compositing",
            "Lock alpha",
        ]);
        // The list is modal: the page behind it is inert, not only hidden from assistive tech.
        const behind = page.locator(".gallery");
        await expect(behind).toHaveAttribute("aria-hidden", "true");
        await expect(behind).toHaveAttribute("inert", "");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect(list).toBeHidden();
        await expect(behind).not.toHaveAttribute("aria-hidden");
        await expect(behind).not.toHaveAttribute("inert");
        await expect(select).toHaveText("Alpha compositing");
        await expect(select).toBeFocused();

        await page.keyboard.press("Space");
        await expect(list).toBeVisible();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Escape");
        await expect(list).toBeHidden();
        await expect(select).toHaveText("Alpha compositing");

        // Typeahead comes from Radix.
        await page.keyboard.press("Enter");
        await page.keyboard.type("lock");
        await page.keyboard.press("Enter");
        await expect(select).toHaveText("Lock alpha");

        // Same metrics as the number field.
        const field = page.locator('[data-demo="number-field"] .ui-number').first();
        const metrics = (locator: Locator) =>
            locator.evaluate((element) => {
                const style = getComputedStyle(element);
                return [
                    style.height,
                    style.borderTopColor,
                    style.backgroundColor,
                    style.borderRadius,
                ];
            });
        expect(await metrics(select)).toEqual(await metrics(field));
    });

    test("segmented control: arrow keys move the choice", async ({ page }) => {
        const square = page.getByRole("radio", { name: "Square" });
        const circle = page.getByRole("radio", { name: "Circle" });
        await expect(page.getByRole("radiogroup", { name: "Brush shape" })).toBeVisible();
        await expect(square).toBeChecked();
        await tabTo(page, square);
        await page.keyboard.press("ArrowRight");
        await expect(circle).toBeChecked();
        await expect(circle).toBeFocused();
        await expect(readout(page, "shape")).toHaveText("Shape: circle");
        await page.keyboard.press("ArrowLeft");
        await expect(square).toBeChecked();
        await expect(readout(page, "shape")).toHaveText("Shape: square");
    });

    test("dialog: opens from the keyboard, traps focus, closes on Escape and returns focus", async ({
        page,
    }) => {
        const opener = button(page, "Open dialog");
        await tabTo(page, opener);
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: "New sprite" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "New sprite" })).toBeVisible();

        // Standard size: at most 560 px wide, centred.
        const box = await boxOf(dialog);
        expect(box.width).toBe(560);
        expect(box.x).toBe((1440 - 560) / 2);
        expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThanOrEqual(1);

        // Focus starts inside and Tab never leaves the dialog.
        const inside = () => dialog.evaluate((element) => element.contains(document.activeElement));
        expect(await inside()).toBe(true);
        for (let presses = 0; presses < 9; presses++) {
            await page.keyboard.press("Tab");
            expect(await inside()).toBe(true);
        }
        await page.keyboard.press("Shift+Tab");
        expect(await inside()).toBe(true);

        // Right-aligned actions, the primary one accent-filled.
        const create = dialog.getByRole("button", { name: "Create" });
        const createBox = await boxOf(create);
        expect(box.x + box.width - (createBox.x + createBox.width)).toBeLessThanOrEqual(17);
        expect(await create.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
            ACCENT.dark,
        );

        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();

        // An action button closes it too, activated from the keyboard.
        await page.keyboard.press("Space");
        await expect(dialog).toBeVisible();
        await tabTo(page, create);
        await page.keyboard.press("Enter");
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
    });

    test("large dialog: at most 960 px wide and 86% of the window high, with a scrolling body", async ({
        page,
    }) => {
        await tabTo(page, button(page, "Open large dialog"));
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Export" });
        await expect(dialog).toBeVisible();
        const box = await boxOf(dialog);
        expect(box.width).toBe(960);
        expect(box.x).toBe((1440 - 960) / 2);
        expect(box.height).toBe(Math.round(900 * 0.86));

        const body = dialog.locator(".ui-dialog__body");
        const scroll = await body.evaluate((element) => ({
            content: element.scrollHeight,
            visible: element.clientHeight,
        }));
        expect(scroll.content).toBeGreaterThan(scroll.visible);
        // Title and actions stay in view while the body scrolls.
        await body.evaluate((element) => element.scrollTo(0, element.scrollHeight));
        await expect(dialog.getByRole("heading", { name: "Export" })).toBeInViewport();
        await expect(dialog.getByRole("button", { name: "Export" })).toBeInViewport();

        await page.setViewportSize({ width: 1280, height: 720 });
        const small = await boxOf(dialog);
        expect(small.width).toBe(960);
        expect(small.height).toBeLessThanOrEqual(720 * 0.86 + 0.5);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
    });

    test("popover: opens from the keyboard, closes on Escape and on an outside click", async ({
        page,
    }) => {
        const opener = button(page, "Open popover");
        await tabTo(page, opener);
        await page.keyboard.press("Enter");
        const popover = page.getByRole("dialog", { name: "Onion skin" });
        await expect(popover).toBeVisible();
        // Focus moves in; its controls work from the keyboard.
        const frames = popover.getByRole("spinbutton", { name: "Frames before" });
        await expect(frames).toBeFocused();
        await page.keyboard.press("ArrowUp");
        await expect(frames).toHaveValue("3");
        await page.keyboard.press("Escape");
        await expect(popover).toBeHidden();
        await expect(opener).toBeFocused();

        await page.keyboard.press("Space");
        await expect(popover).toBeVisible();
        await page.mouse.click(1200, 800);
        await expect(popover).toBeHidden();
    });

    test("context menu: opens with the Menu key and with right-click; arrows and Enter choose", async ({
        page,
    }) => {
        const target = page.getByRole("group", { name: "Layer" });
        const menu = page.getByRole("menu");
        await tabTo(page, target);
        await page.keyboard.press("ContextMenu");
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("menuitem")).toHaveText([
            "Duplicate",
            "RenameF2",
            "Merge down",
            "Delete",
        ]);
        // Disabled items stay visible; shortcuts are muted.
        await expect(menu.getByRole("menuitem", { name: "Merge down" })).toHaveAttribute(
            "aria-disabled",
            "true",
        );
        // Opened from the keyboard, the first item is highlighted and focused.
        const highlighted = menu.locator("[data-highlighted]");
        await expect(highlighted).toHaveText("Duplicate");
        await expect(highlighted).toBeFocused();
        // The highlight is the focus indicator inside a menu.
        expect(
            await highlighted.evaluate((element) => {
                const style = getComputedStyle(element);
                return [style.backgroundColor, style.outlineStyle];
            }),
        ).toEqual(["rgb(44, 44, 48)", "none"]);
        await page.keyboard.press("ArrowDown");
        await expect(highlighted).toHaveText("RenameF2");
        await page.keyboard.press("Enter");
        await expect(menu).toBeHidden();
        await expect(readout(page, "action")).toHaveText("Last action: Rename");

        // Arrow keys skip the disabled item; Escape closes without acting.
        await page.keyboard.press("Shift+F10");
        await expect(menu).toBeVisible();
        await page.keyboard.press("End");
        await expect(menu.locator("[data-highlighted]")).toHaveText("Delete");
        await page.keyboard.press("ArrowUp");
        await expect(menu.locator("[data-highlighted]")).toHaveText("RenameF2");
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(readout(page, "action")).toHaveText("Last action: Rename");

        await target.click({ button: "right" });
        await expect(menu).toBeVisible();
        await menu.getByRole("menuitem", { name: "Delete" }).click();
        await expect(readout(page, "action")).toHaveText("Last action: Delete");
    });

    test("splitter: arrows resize, Home and End reach the limits, Enter and double-click reset", async ({
        page,
    }) => {
        const splitter = page.getByRole("separator", { name: "Resize pane" });
        const width = readout(page, "split");
        await expect(splitter).toHaveAttribute("aria-orientation", "vertical");
        await expect(splitter).toHaveAttribute("aria-valuenow", "160");
        // 8 px hit area with a 1 px visible line.
        expect((await boxOf(splitter)).width).toBe(8);
        expect(
            await splitter.evaluate((element) => getComputedStyle(element, "::after").width),
        ).toBe("1px");

        await tabTo(page, splitter);
        await page.keyboard.press("ArrowRight");
        await expect(width).toHaveText("Width: 168");
        await page.keyboard.press("Shift+ArrowLeft");
        await expect(width).toHaveText("Width: 136");
        await page.keyboard.press("Home");
        await expect(width).toHaveText("Width: 80");
        await page.keyboard.press("End");
        await expect(width).toHaveText("Width: 320");
        await expect(splitter).toHaveAttribute("aria-valuenow", "320");
        await page.keyboard.press("Enter");
        await expect(width).toHaveText("Width: 160");

        await dragBy(page, splitter, 40, 0);
        await expect(width).toHaveText("Width: 200");
        await splitter.dblclick();
        await expect(width).toHaveText("Width: 160");
    });

    test("toast: one line at the bottom centre; an error stays until dismissed", async ({
        page,
    }) => {
        await tabTo(page, button(page, "Show toast"));
        await page.keyboard.press("Enter");
        const info = toasts(page).getByRole("status");
        await expect(info).toHaveText("Saved hero.ngsprite");
        const box = await boxOf(info);
        expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(1);
        // Above the 24 px status bar.
        expect(box.y + box.height).toBe(900 - 36);
        expect(
            await info
                .locator(".ui-toast__message")
                .evaluate((element) => getComputedStyle(element).whiteSpace),
        ).toBe("nowrap");

        await tabTo(page, button(page, "Show error toast"));
        await page.keyboard.press("Enter");
        const error = toasts(page).getByRole("alert");
        await expect(error).toHaveText("Import failed: not a PNG file");

        // The information toast leaves by itself after 4 s; the error does not.
        await expect(info).toBeHidden({ timeout: 8000 });
        await expect(error).toBeVisible();

        await tabTo(page, button(page, "Dismiss"));
        await page.keyboard.press("Enter");
        await expect(error).toBeHidden();
    });

    test("error boundary: a failing panel shows its message; Reload mounts it again", async ({
        page,
    }) => {
        const panel = page.locator('[data-demo="boundary"] .gallery__panel');
        await expect(panel).toHaveText("Panel content");
        await tabTo(page, button(page, "Break panel"));
        await page.keyboard.press("Enter");
        await expect(panel.getByRole("alert")).toHaveText("Demo panel failed to render.Reload");

        // The rest of the page keeps working.
        await button(page, "Default").click();
        await expect(readout(page, "clicks")).toHaveText("Clicks: 1");

        // Reload with the cause still there fails again; after the repair it recovers.
        await tabTo(page, button(page, "Reload"));
        await page.keyboard.press("Enter");
        await expect(panel.getByRole("alert")).toBeVisible();
        await button(page, "Repair panel").click();
        await tabTo(page, button(page, "Reload"));
        await page.keyboard.press("Enter");
        await expect(panel).toHaveText("Panel content");
    });
});

// --- Motion --------------------------------------------------------------------------------

for (const reduced of [false, true]) {
    const mode = reduced ? "without animation under reduced motion" : "with the 120 ms fade";
    test(`popover, menu, dialog, tooltip and toast open and close ${mode}`, async ({ page }) => {
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        await page.goto("/gallery");
        await expect(page.getByRole("heading", { name: "Interface gallery" })).toBeVisible();
        const fade = reduced ? "none 0s" : "ui-fade-in 0.12s";
        const animation = (surface: Locator) =>
            surface.evaluate((element) => {
                const style = getComputedStyle(element);
                return `${style.animationName} ${style.animationDuration}`;
            });

        // Hover and press: 100 ms, or none.
        const durations = await button(page, "Default").evaluate((element) => [
            ...new Set(getComputedStyle(element).transitionDuration.split(", ")),
        ]);
        expect(durations).toEqual([reduced ? "0s" : "0.1s"]);

        const surfaces: [string, () => Promise<unknown>, Locator][] = [
            ["popover", () => button(page, "Open popover").click(), page.locator(".ui-popover")],
            [
                "context menu",
                () => page.getByRole("group", { name: "Layer" }).click({ button: "right" }),
                page.getByRole("menu"),
            ],
            [
                "select list",
                () => page.getByRole("combobox", { name: "Ink" }).click(),
                page.locator(".ui-menu--select"),
            ],
            ["dialog", () => button(page, "Open dialog").click(), page.locator(".ui-dialog")],
            ["tooltip", () => button(page, "Hover or focus").focus(), page.locator(".ui-tooltip")],
        ];
        for (const [name, open, surface] of surfaces) {
            await open();
            await expect(surface, name).toBeVisible();
            expect(await animation(surface), name).toBe(fade);
            await page.keyboard.press("Escape");
            // A closed surface leaves the page; it does not wait for an animation to end.
            await expect(surface, name).toHaveCount(0);
        }

        await button(page, "Show toast").click();
        const toast = toasts(page).getByRole("status");
        await expect(toast).toBeVisible();
        expect(await animation(toast)).toBe(fade);
        // Opening and closing every surface logs no error (React and Radix report misuse there).
        expect(errors).toEqual([]);
    });
}

// --- Pointer targets -----------------------------------------------------------------------

test("pointer targets are at least 24×24 px; the 8 px splitter is the exception", async ({
    page,
}) => {
    /** Controls on the page that are smaller than 24 px in either direction. */
    const tooSmall = () =>
        page.evaluate(() =>
            [
                ...document.querySelectorAll(
                    'button, [role="radio"], [role="slider"], [role="combobox"], .ui-number',
                ),
            ]
                .map((element) => {
                    const rect = element.getBoundingClientRect();
                    const name = element.getAttribute("aria-label") ?? element.textContent;
                    return { name, width: rect.width, height: rect.height };
                })
                .filter((target) => target.width < 24 || target.height < 24)
                .map((target) => `${target.name}: ${target.width}×${target.height}`),
        );

    await openGallery(page);
    expect(await page.locator("button").count()).toBeGreaterThan(20);
    expect(await tooSmall()).toEqual([]);
    expect(await boxOf(page.getByRole("separator", { name: "Resize pane" }))).toMatchObject({
        width: 8,
    });

    // The number field's whole box is its target: a click on the unit focuses the field.
    await page.locator('[data-demo="number-field"] .ui-number__unit').first().click();
    await expect(page.getByRole("spinbutton", { name: "Size" })).toBeFocused();

    await openShell(page);
    // Not an exact count: every ticket that adds a shell control would have to edit it.
    expect(await page.locator("button").count()).toBeGreaterThan(20);
    expect(await tooSmall()).toEqual([]);
});

test("the gallery is a development route: every primitive of DESIGN §4 is on it", async ({
    page,
}) => {
    await openGallery(page);
    await expect(page.locator("[data-demo]")).toHaveCount(15);
    const demos = await page
        .locator("[data-demo]")
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-demo")));
    expect(demos).toEqual([
        "button",
        "icon-button",
        "tool-button",
        "number-field",
        "slider",
        "toggle",
        "select",
        "segmented",
        "dialog",
        "popover",
        "context-menu",
        "tooltip",
        "splitter",
        "toast",
        "boundary",
    ]);
});
