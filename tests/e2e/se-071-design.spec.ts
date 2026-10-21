import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as ToolRegistryModule from "../../src/app/tools/toolRegistry";
import { arrowToRadio, collectErrors, settleTimers } from "./se-006-support";
import { menuTrigger } from "./se-007-support";
import { openTab, overflowButton } from "./se-047-support";
import {
    closeAll,
    focusInside,
    openRichDocument,
    runCommand,
    startEditor,
    surfaceOpened,
    topSurface,
    visitAllSurfaces,
} from "./se-071-support";

// SE-071: the side-by-side review against DESIGN.md, the parts a page can measure. In the
// shell and in every surface a command or a situation opens (`visitAllSurfaces`): text is
// 11, 12 or 13 px in weight 400 or 500 and never upper-cased (DESIGN §3.2); icons are 16 px
// with a 1.5 px stroke in the text colour (§3.3); no segmented control offers just On and
// Off (§4, Toggle). Every icon-only control of the shell and of every surface has a name and
// shows it in a tooltip (§4, §8). Every tab stop of the shell and of every surface, and every
// item the arrow keys reach (menu items, segments, timeline cells, swatches), shows the focus
// (§8).

/** What breaks the type and icon rules inside `selector`. */
function designProblems(page: Page, selector: string): Promise<string[]> {
    return page.locator(selector).evaluate((root) => {
        const problems = new Set<string>();
        const describe = (element: Element) =>
            `${element.tagName.toLowerCase()}.${String(element.getAttribute("class") ?? "").split(" ")[0]}`;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (!parent || (node.textContent ?? "").trim() === "" || !parent.checkVisibility()) {
                continue;
            }
            // Visually hidden text for assistive technology is not seen.
            const box = parent.getBoundingClientRect();
            if (box.width <= 1 || box.height <= 1) continue;
            const style = getComputedStyle(parent);
            if (!["11px", "12px", "13px"].includes(style.fontSize)) {
                problems.add(`${describe(parent)}: font size ${style.fontSize}`);
            }
            if (!["400", "500"].includes(style.fontWeight)) {
                problems.add(`${describe(parent)}: weight ${style.fontWeight}`);
            }
            if (style.textTransform !== "none") {
                problems.add(`${describe(parent)}: text-transform ${style.textTransform}`);
            }
        }
        for (const icon of root.querySelectorAll("svg.lucide")) {
            if (!icon.checkVisibility()) continue;
            const box = icon.getBoundingClientRect();
            const style = getComputedStyle(icon);
            if (box.width !== 16 || box.height !== 16) {
                problems.add(`${String(icon.getAttribute("class"))}: ${box.width} × ${box.height}`);
            }
            if (style.strokeWidth !== "1.5px") {
                problems.add(`${String(icon.getAttribute("class"))}: stroke ${style.strokeWidth}`);
            }
            if (icon.getAttribute("stroke") !== "currentColor") {
                problems.add(`${String(icon.getAttribute("class"))}: stroke colour`);
            }
        }
        return [...problems].sort();
    });
}

/**
 * The radio groups inside `selector` whose options are just On and Off: DESIGN §4 keeps one
 * idiom for an on/off setting, the toggle, and a segmented control for named values only.
 */
function onOffSegments(page: Page, selector: string): Promise<string[]> {
    return page.locator(selector).evaluate((root) =>
        [...root.querySelectorAll('[role="radiogroup"]')]
            .filter((group) => {
                const options = [...group.querySelectorAll('[role="radio"]')]
                    .map((radio) =>
                        (radio.getAttribute("aria-label") ?? radio.textContent ?? "").trim(),
                    )
                    .sort();
                return options.length === 2 && options[0] === "Off" && options[1] === "On";
            })
            .map((group) => group.getAttribute("aria-label") ?? group.id),
    );
}

/** The ids of the tool registry's tools. */
function toolIds(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
        const path = "/src/app/tools/toolRegistry.ts";
        const { toolRegistry } = (await import(
            /* @vite-ignore */ path
        )) as typeof ToolRegistryModule;
        return toolRegistry.list().map((tool) => tool.id);
    });
}

test("type and icons follow DESIGN §3, and no segmented control is On/Off, in the shell and in every surface", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    expect(await designProblems(page, "body"), "empty shell").toEqual([]);
    expect(await onOffSegments(page, "body"), "empty shell").toEqual([]);
    await openRichDocument(page, "design");
    await runCommand(page, "select.all");
    const toggles = page.locator('.dock-section__toggle[aria-expanded="false"]');
    while ((await toggles.count()) > 0) await toggles.first().click();
    expect(await designProblems(page, "body"), "shell with a document").toEqual([]);
    expect(await onOffSegments(page, "body"), "shell with a document").toEqual([]);
    // The context bar of every tool.
    const initialTool = await page.evaluate(() => window.__ngneTest!.editor.getState().tool);
    for (const tool of await toolIds(page)) {
        await runCommand(page, `tool.${tool}`);
        await expect
            .poll(() => page.evaluate(() => window.__ngneTest!.editor.getState().tool))
            .toBe(tool);
        await settleTimers(page);
        const bar = '[data-region="context-bar"]';
        expect(await designProblems(page, bar), `context bar of ${tool}`).toEqual([]);
        expect(await onOffSegments(page, bar), `context bar of ${tool}`).toEqual([]);
    }
    await runCommand(page, `tool.${initialTool}`);
    await visitAllSurfaces(page, async ({ source, name, selector }) => {
        expect(await designProblems(page, selector), `${source}: ${name}`).toEqual([]);
        expect(await onOffSegments(page, selector), `${source}: ${name}`).toEqual([]);
    });
    expect(errors).toEqual([]);
});

/**
 * The icon-only buttons inside `selector` (buttons that show no text of their own: their
 * content is an icon or a colour) without a name, and those whose tooltip does not show their
 * name on hover; a cell of a choice that shows no icon (a radio showing a place or a colour)
 * needs its name only (DESIGN §8). A tooltip is closed by moving the pointer to `rest`, or, where moving there
 * could cross another trigger (the shell), with Escape.
 */
async function iconButtonProblems(
    page: Page,
    selector: string,
    buttons: string,
    rest: { x: number; y: number },
    close: "escape" | "pointer",
): Promise<{ count: number; unnamed: string[]; withoutTooltip: string[] }> {
    const iconOnly = await page.locator(selector).evaluate((root, buttons) => {
        for (const element of document.querySelectorAll("[data-se071-icon-button]")) {
            element.removeAttribute("data-se071-icon-button");
        }
        const found: { index: string; cell: boolean }[] = [];
        root.querySelectorAll<HTMLElement>(buttons).forEach((button, index) => {
            if (!button.checkVisibility() || button.innerText.trim() !== "") return;
            // A cell of a choice that shows a place or a colour, no icon (the pivot and anchor
            // grids, the tag colour presets): named, without a tooltip (DESIGN §8).
            const cell = button.getAttribute("role") === "radio" && !button.querySelector("svg");
            button.setAttribute("data-se071-icon-button", `${index}`);
            found.push({ index: `${index}`, cell });
        });
        return found;
    }, buttons);
    const unnamed: string[] = [];
    const withoutTooltip: string[] = [];
    for (const { index, cell } of iconOnly) {
        const button = page.locator(`[data-se071-icon-button="${index}"]`);
        const name = (await button.getAttribute("aria-label")) ?? "";
        if (name.trim() === "") {
            unnamed.push(await button.evaluate((element) => element.outerHTML.slice(0, 120)));
            continue;
        }
        if (cell) continue;
        // A disabled button takes no pointer: it is a tooltip's trigger all the same (Radix
        // marks its trigger with `data-state`).
        if (await button.isDisabled()) {
            if ((await button.getAttribute("data-state")) === null) withoutTooltip.push(name);
            continue;
        }
        // In a surface no control keeps the focus, whose tooltip would stay open with it: the
        // surface itself takes it (still inside it, for Escape).
        if (close === "pointer") {
            await page.locator(selector).evaluate((element) => {
                if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
                (element as HTMLElement).focus();
            });
            await expect(page.getByRole("tooltip")).toHaveCount(0);
        }
        // The tooltip appears on hover after 400 ms.
        await button.hover();
        const shown = await page
            .getByRole("tooltip")
            .filter({ hasText: name })
            .first()
            .waitFor({ state: "visible", timeout: 3000 })
            .then(() => true)
            .catch(() => false);
        if (!shown) withoutTooltip.push(name);
        // In the shell Escape closes it (a move away could pass over the tooltip, which keeps
        // it open); in a surface Escape would close the surface, so the pointer leaves in one
        // step to a place where no trigger is.
        if (close === "escape") await page.keyboard.press("Escape");
        await page.mouse.move(rest.x, rest.y);
        // Radix keeps a tooltip open while the pointer may still be on its way to it: it
        // decides at the next move.
        await page.mouse.move(rest.x + 1, rest.y);
        await expect(page.getByRole("tooltip").filter({ hasText: name })).toHaveCount(0);
    }
    return { count: iconOnly.length, unnamed, withoutTooltip };
}

test("every icon-only control of the shell has a name and shows it in a tooltip", async ({
    page,
}) => {
    test.setTimeout(5 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    await runCommand(page, "select.all");
    const palette = page.locator('[data-dock-panel="palette"] .dock-section__toggle');
    if ((await palette.getAttribute("aria-expanded")) === "false") await palette.click();
    // The panels have drawn the document (the timeline waits two frames, SE-022).
    await expect(page.locator("[data-timeline-cell]").first()).toBeVisible();
    await expect(
        page.locator('[data-dock-panel="palette"] [role="gridcell"]').first(),
    ).toBeVisible();
    const workspace = await page.locator('[data-region="viewport"]').boundingBox();
    const rest = { x: workspace!.x + 4, y: workspace!.y + 4 };
    const { count, unnamed, withoutTooltip } = await iconButtonProblems(
        page,
        "body",
        "[data-region] button",
        rest,
        "escape",
    );
    expect(count).toBeGreaterThan(20);
    // The tab strip's overflow button, there while the tabs do not fit (SE-047).
    for (let index = 1; index <= 12; index++) await openTab(page, `sprite ${index}`);
    await overflowButton(page).hover();
    await expect(page.getByRole("tooltip").filter({ hasText: "All documents" })).toBeVisible();
    expect(unnamed, "icon-only buttons without a name").toEqual([]);
    expect(withoutTooltip, "icon-only buttons without a tooltip").toEqual([]);
    expect(errors).toEqual([]);
});

test("every icon-only control of every surface has a name and shows it in a tooltip", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    const problems: string[] = [];
    const counted: string[] = [];
    let total = 0;
    await visitAllSurfaces(page, async ({ source, name, selector }) => {
        // At rest: the window's bottom-left corner, on a modal dialog's overlay or on the
        // status bar's text, where no trigger is and no surface lies.
        const rest = { x: 2, y: page.viewportSize()!.height - 2 };
        const found = await iconButtonProblems(page, selector, "button", rest, "pointer");
        counted.push(`${source}: ${found.count}`);
        total += found.count;
        for (const button of found.unnamed) problems.push(`${source}: ${name}: no name: ${button}`);
        for (const button of found.withoutTooltip) {
            problems.push(`${source}: ${name}: no tooltip: ${button}`);
        }
    });
    test.info().annotations.push({ type: "icon buttons", description: counted.join("; ") });
    expect(total, "icon-only buttons in the surfaces").toBeGreaterThan(5);
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
});

/**
 * Pointer targets smaller than 24 × 24 px inside `selector`, but the exceptions of DESIGN §8:
 * palette swatches, timeline cells, splitters, tag spans and their drag handles (each also
 * operable from the keyboard).
 */
function smallTargets(page: Page, selector: string): Promise<string[]> {
    return page.locator(selector).evaluate((root) => {
        const exception =
            '[data-dock-panel="palette"] [role="gridcell"], [data-timeline-cell], [role="separator"], [data-tag], [data-tag] *';
        const targets = root.querySelectorAll<HTMLElement>(
            'button, input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"], [role="checkbox"], [role="slider"], [role="combobox"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"]',
        );
        const found: string[] = [];
        for (const element of targets) {
            if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
                continue;
            }
            if (getComputedStyle(element).pointerEvents === "none") continue;
            if (element.matches(exception)) continue;
            // A field's whole box is its target (the number field's frame, SE-006).
            const box = (element.closest(".ui-number") ?? element).getBoundingClientRect();
            if (box.width <= 1 || box.height <= 1) continue;
            if (box.width < 24 || box.height < 24) {
                const name = element.getAttribute("aria-label") ?? element.textContent ?? "";
                found.push(`${name.trim().slice(0, 30)}: ${box.width} × ${box.height}`);
            }
        }
        return found;
    });
}

test("pointer targets are at least 24 × 24 px in the shell and every surface, but the exceptions of DESIGN §8", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    expect(await smallTargets(page, "body"), "empty shell").toEqual([]);
    await openRichDocument(page, "targets");
    await runCommand(page, "select.all");
    const toggles = page.locator('.dock-section__toggle[aria-expanded="false"]');
    while ((await toggles.count()) > 0) await toggles.first().click();
    await expect(page.locator("[data-timeline-cell]").first()).toBeVisible();
    expect(await smallTargets(page, "body"), "shell with a document").toEqual([]);
    await visitAllSurfaces(page, async ({ source, name, selector }) => {
        expect(await smallTargets(page, selector), `${source}: ${name}`).toEqual([]);
    });
    expect(errors).toEqual([]);
});

/** The focused element: a key to tell it from the others, its name, whether it shows the focus. */
interface Focused {
    key: string;
    name: string;
    shown: boolean;
}

/**
 * The focused element and whether it shows the focus (DESIGN §3.3, §8): an outline of at
 * least 2 px, or one drawn by the box it sits in (the number field's frame, the command
 * palette's search box), or an inset ring in the accent colour; a menu item or a list option,
 * which Radix highlights instead, by its highlight. Null while the page's body has the focus.
 */
function focused(page: Page): Promise<Focused | null> {
    return page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return null;
        const box = element.getBoundingClientRect();
        const key =
            element.id ||
            `${element.tagName}|${element.getAttribute("aria-label") ?? ""}|${(element.textContent ?? "").slice(0, 20)}|${box.x}|${box.y}`;
        const probe = document.createElement("span");
        probe.style.color = "var(--accent)";
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        const outlined = (target: Element) => {
            const style = getComputedStyle(target);
            return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
        };
        const style = getComputedStyle(element);
        const frame = element.closest(".ui-number, .command-palette__search");
        const role = element.getAttribute("role") ?? "";
        let highlighted = false;
        if (/^(menuitem|menuitemradio|menuitemcheckbox|option)$/.test(role)) {
            const list = element.closest('[role="menu"], [role="listbox"]');
            const background = style.backgroundColor;
            highlighted =
                element.hasAttribute("data-highlighted") &&
                background !== "rgba(0, 0, 0, 0)" &&
                list !== null &&
                background !== getComputedStyle(list).backgroundColor;
        }
        const shown =
            outlined(element) ||
            (frame !== null && outlined(frame)) ||
            (/inset/.test(style.boxShadow) && style.boxShadow.includes(accent)) ||
            highlighted;
        const name = element.getAttribute("aria-label") ?? (element.textContent ?? "").slice(0, 30);
        return { key, shown, name: `${element.tagName.toLowerCase()}[${role}] "${name}"` };
    });
}

/**
 * Presses Tab until the focus comes back to an element it was on, or leaves `scope` (when
 * given); returns the elements reached and those of them that did not show the focus.
 */
async function tabWalk(
    page: Page,
    scope: string | null,
): Promise<{ seen: number; unmarked: string[] }> {
    const seen = new Set<string>();
    const unmarked: string[] = [];
    for (let presses = 0; presses < 200; presses++) {
        await page.keyboard.press("Tab");
        if (scope !== null && !(await focusInside(page, scope))) break;
        const focus = await focused(page);
        if (!focus) continue;
        if (seen.has(focus.key)) break;
        seen.add(focus.key);
        if (!focus.shown) unmarked.push(focus.name);
    }
    return { seen: seen.size, unmarked };
}

test("every tab stop of the shell shows the focus ring when reached from the keyboard", async ({
    page,
}) => {
    test.setTimeout(5 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    await expect(page.locator("[data-timeline-cell]").first()).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const { seen, unmarked } = await tabWalk(page, null);
    expect(seen).toBeGreaterThan(20);
    expect(unmarked, "tab stops without a visible focus ring").toEqual([]);
    expect(errors).toEqual([]);
});

test("every tab stop of every surface shows the focus ring when reached from the keyboard", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    const unmarked: string[] = [];
    const counted: string[] = [];
    await visitAllSurfaces(page, async ({ source, name, selector, surface }) => {
        const walk = await tabWalk(page, selector);
        counted.push(`${source}: ${walk.seen}`);
        for (const stop of walk.unmarked) unmarked.push(`${source}: ${name}: ${stop}`);
        // A popover the focus has left may stay open: the focus goes back for Escape.
        if ((await surface.count()) > 0 && !(await focusInside(page, selector))) {
            await page.keyboard.press("Shift+Tab");
            if (!(await focusInside(page, selector))) {
                await surface
                    .locator('button:not([disabled]), input:not([disabled]), [tabindex="0"]')
                    .first()
                    .focus();
            }
        }
    });
    test.info().annotations.push({ type: "tab stops", description: counted.join("; ") });
    expect(unmarked, "tab stops without a visible focus ring").toEqual([]);
    expect(errors).toEqual([]);
});

test("items the arrow keys reach show the focus: menu items, segments, timeline cells and swatches", async ({
    page,
}) => {
    test.setTimeout(5 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    const palette = page.locator('[data-dock-panel="palette"] .dock-section__toggle');
    if ((await palette.getAttribute("aria-expanded")) === "false") await palette.click();
    await expect(page.locator("[data-timeline-cell]").first()).toBeVisible();
    const unmarked: string[] = [];
    /**
     * Moves the focus `times` times with the first of `keys` that moves it (at the end of a row
     * or a column the next one does), waiting for it to move each time (Radix).
     */
    const step = async (what: string, keys: string[], times: number) => {
        const reached = new Set<string>();
        for (let press = 0; press < times; press++) {
            const before = (await focused(page))?.key;
            let moved = false;
            for (const key of keys) {
                await page.keyboard.press(key);
                await settleTimers(page);
                moved = await expect
                    .poll(async () => (await focused(page))?.key, { timeout: 2000 })
                    .not.toBe(before)
                    .then(() => true)
                    .catch(() => false);
                if (moved) break;
            }
            expect(moved, `${what}: ${keys.join(" or ")} moves the focus`).toBe(true);
            const focus = (await focused(page))!;
            reached.add(focus.key);
            if (!focus.shown) unmarked.push(`${what}: ${focus.name}`);
        }
        expect(reached.size, `${what}: items reached`).toBeGreaterThan(0);
    };

    // The File menu's items, opened from the keyboard.
    await menuTrigger(page, "File").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "File" })).toBeVisible();
    await expect.poll(async () => (await focused(page))?.name ?? "").toMatch(/^div\[menuitem/);
    await settleTimers(page);
    const first = (await focused(page))!;
    if (!first.shown) unmarked.push(`File menu: ${first.name}`);
    await step("File menu", ["ArrowDown"], 3);
    await closeAll(page);

    // A segmented control: New Sprite's size presets (Escape drops the change).
    await runCommand(page, "file.new");
    expect(await surfaceOpened(page)).toBe(true);
    const dialog = page.locator((await topSurface(page))!.selector);
    const presets = dialog.getByRole("radiogroup", { name: "Size presets" }).getByRole("radio");
    expect(await presets.count()).toBeGreaterThan(2);
    // Reached with Tab, so that the focus comes from the keyboard.
    const group = dialog.getByRole("radiogroup", { name: "Size presets" });
    for (let presses = 0; presses < 20; presses++) {
        if (await group.evaluate((element) => element.contains(document.activeElement))) break;
        await page.keyboard.press("Tab");
    }
    await expect.poll(async () => (await focused(page))?.name ?? "").toMatch(/\[radio\]/);
    const segment = (await focused(page))!;
    if (!segment.shown) unmarked.push(`Size presets: ${segment.name}`);
    for (let press = 0; press < 2; press++) {
        const index = await presets.evaluateAll((radios) =>
            radios.findIndex((radio) => radio === document.activeElement),
        );
        const next = presets.nth(index + 1 < (await presets.count()) ? index + 1 : 0);
        await arrowToRadio(page, "ArrowRight", next);
        await settleTimers(page);
        const focus = (await focused(page))!;
        if (!focus.shown) unmarked.push(`Size presets: ${focus.name}`);
    }
    await closeAll(page);

    // The timeline's cells.
    await page.locator('[data-timeline-cell][tabindex="0"]').focus();
    await step("timeline cells", ["ArrowRight", "ArrowLeft"], 3);
    await step("timeline cells", ["ArrowUp", "ArrowDown"], 1);

    // The palette's swatches.
    await page.locator('[data-dock-panel="palette"] [role="gridcell"][tabindex="0"]').focus();
    await step("swatches", ["ArrowRight", "ArrowLeft"], 3);

    expect(unmarked, "items without a visible focus").toEqual([]);
    expect(errors).toEqual([]);
});
