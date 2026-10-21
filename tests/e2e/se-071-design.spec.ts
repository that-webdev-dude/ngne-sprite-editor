import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openTab, overflowButton } from "./se-047-support";
import { openRichDocument, runCommand, startEditor, visitAllSurfaces } from "./se-071-support";

// SE-071: the side-by-side review against DESIGN.md, the parts a page can measure. In the
// shell and in every surface a command or a situation opens (`visitAllSurfaces`): text is
// 11, 12 or 13 px in weight 400 or 500 and never upper-cased (DESIGN §3.2); icons are 16 px
// with a 1.5 px stroke in the text colour (§3.3). And every icon-only control of the shell
// has a name and shows it in a tooltip (§4, §8).

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

test("type and icons follow DESIGN §3 in the shell and in every surface", async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    expect(await designProblems(page, "body"), "empty shell").toEqual([]);
    await openRichDocument(page, "design");
    await runCommand(page, "select.all");
    const toggles = page.locator('.dock-section__toggle[aria-expanded="false"]');
    while ((await toggles.count()) > 0) await toggles.first().click();
    expect(await designProblems(page, "body"), "shell with a document").toEqual([]);
    await visitAllSurfaces(page, async ({ source, name, selector }) => {
        expect(await designProblems(page, selector), `${source}: ${name}`).toEqual([]);
    });
    expect(errors).toEqual([]);
});

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
    // Buttons that show no text of their own: their content is an icon (or a colour).
    const iconOnly = await page.evaluate(() => {
        const found: string[] = [];
        document.querySelectorAll<HTMLElement>("[data-region] button").forEach((button, index) => {
            if (!button.checkVisibility() || button.innerText.trim() !== "") return;
            button.setAttribute("data-se071-icon-button", `${index}`);
            found.push(`${index}`);
        });
        return found;
    });
    expect(iconOnly.length).toBeGreaterThan(20);
    const workspace = await page.locator('[data-region="viewport"]').boundingBox();
    const rest = { x: workspace!.x + 4, y: workspace!.y + 4 };
    const unnamed: string[] = [];
    const withoutTooltip: string[] = [];
    for (const index of iconOnly) {
        const button = page.locator(`[data-se071-icon-button="${index}"]`);
        const name = (await button.getAttribute("aria-label")) ?? "";
        if (name.trim() === "") {
            unnamed.push(await button.evaluate((element) => element.outerHTML.slice(0, 120)));
            continue;
        }
        // A disabled button takes no pointer: it is a tooltip's trigger all the same (Radix
        // marks its trigger with `data-state`).
        if (await button.isDisabled()) {
            if ((await button.getAttribute("data-state")) === null) withoutTooltip.push(name);
            continue;
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
        // Escape closes it (a move away could pass over the tooltip, which keeps it open).
        await page.keyboard.press("Escape");
        await page.mouse.move(rest.x, rest.y);
        await expect(page.getByRole("tooltip").filter({ hasText: name })).toHaveCount(0);
    }
    // The tab strip's overflow button, there while the tabs do not fit (SE-047).
    for (let index = 1; index <= 12; index++) await openTab(page, `sprite ${index}`);
    await overflowButton(page).hover();
    await expect(page.getByRole("tooltip").filter({ hasText: "All documents" })).toBeVisible();
    expect(unnamed, "icon-only buttons without a name").toEqual([]);
    expect(withoutTooltip, "icon-only buttons without a tooltip").toEqual([]);
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
            '[role="gridcell"], [data-timeline-cell], [role="separator"], [data-tag], [data-tag] *';
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

test("every tab stop of the shell shows the focus ring when reached from the keyboard", async ({
    page,
}) => {
    test.setTimeout(5 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await openRichDocument(page);
    await expect(page.locator("[data-timeline-cell]").first()).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen = new Set<string>();
    const unmarked: string[] = [];
    for (let presses = 0; presses < 200; presses++) {
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => {
            const element = document.activeElement as HTMLElement | null;
            if (!element || element === document.body) return null;
            const key =
                element.id ||
                `${element.tagName}|${element.getAttribute("aria-label") ?? ""}|${(element.textContent ?? "").slice(0, 20)}|${element.getBoundingClientRect().x}|${element.getBoundingClientRect().y}`;
            const style = getComputedStyle(element);
            const ring =
                (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2) ||
                // A box whose ring is drawn by its frame (the number field) or an inset shadow.
                (element.closest(".ui-number") !== null &&
                    getComputedStyle(element.closest(".ui-number")!).outlineStyle !== "none") ||
                /inset/.test(style.boxShadow);
            const name =
                element.getAttribute("aria-label") ?? (element.textContent ?? "").slice(0, 30);
            return { key, ring, name: `${element.tagName.toLowerCase()} "${name}"` };
        });
        if (!focus) continue;
        if (seen.has(focus.key)) break;
        seen.add(focus.key);
        if (!focus.ring) unmarked.push(focus.name);
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(unmarked, "tab stops without a visible focus ring").toEqual([]);
    expect(errors).toEqual([]);
});
