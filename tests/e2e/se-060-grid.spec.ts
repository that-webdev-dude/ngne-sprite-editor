import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import config from "../../playwright.config";
import { boxOf, collectErrors, region } from "./se-006-support";
import { swatches } from "./se-016-support";
import { focused, grid, openPalettePanel, setPalette } from "./se-060-support";

// SE-060: a 256-colour palette in the narrowest and the widest dock (DESIGN §2, §5.4). The
// headless browser hides scroll bars unless told not to; these cases need them, so the
// grid's room for its scroll bar is measured as in a headed browser. Launch options take a
// worker of their own, hence a file of their own.
test.use({
    launchOptions: {
        ...config.use?.launchOptions,
        ignoreDefaultArgs: ["--hide-scrollbars"],
    },
});

/** Whether the grid has taken the width of the section: inside it, and one column short. */
function gridFitsSection(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const section = document.querySelector('[data-dock-panel="palette"]')!;
        const panel = section.querySelector("[data-palette-panel]")!;
        const element = section.querySelector<HTMLElement>("[data-palette-grid]")!;
        const columns = element.querySelector('[role="row"]')!.children.length;
        const chrome = element.offsetWidth - element.clientWidth;
        return (
            element.getBoundingClientRect().right <= panel.getBoundingClientRect().right &&
            element.scrollWidth <= element.clientWidth &&
            (columns + 1) * 16 + chrome > panel.clientWidth
        );
    });
}

for (const width of [220, 360]) {
    test(`a 256-colour palette renders as a scrolling grid of 16 px swatches with no horizontal overflow at dock width ${width}`, async ({
        page,
    }) => {
        const errors = collectErrors(page);
        await openPalettePanel(page);
        const many = Array.from(
            { length: 256 },
            (_, index) => ((index * 0x010305) << 8) | 0xff,
        ).map((colour) => colour >>> 0);
        await setPalette(page, many);
        await expect(swatches(page)).toHaveCount(256);

        const splitter = page.getByRole("separator", { name: "Resize panels" });
        await splitter.focus();
        await expect(splitter).toBeFocused();
        await page.keyboard.press(width === 220 ? "Home" : "End");
        await expect.poll(async () => (await boxOf(region(page, "dock"))).width).toBe(width);
        // The grid lays out again for the new width after its section is measured.
        await expect.poll(() => gridFitsSection(page)).toBe(true);

        const sizes = await swatches(page).evaluateAll((items) =>
            items.map((item) => {
                const box = item.getBoundingClientRect();
                return `${box.width}x${box.height}`;
            }),
        );
        expect(new Set(sizes)).toEqual(new Set(["16x16"]));

        const layout = await page.evaluate(() => {
            const dock = document.querySelector('[data-region="dock"]')!;
            const scroller = dock.querySelector(".shell-dock__scroll")!;
            const section = dock.querySelector('[data-dock-panel="palette"]')!;
            const panel = section.querySelector("[data-palette-panel]")!;
            const element = section.querySelector<HTMLElement>("[data-palette-grid]")!;
            const header = section.querySelector("h2")!;
            const toggle = header.querySelector("button")!;
            const swatches = [...element.querySelectorAll('[role="gridcell"]')];
            const rows = new Set(swatches.map((item) => (item as HTMLElement).offsetTop)).size;
            const columns = element.querySelector('[role="row"]')!.children.length;
            return {
                rows,
                columns,
                gridRight: element.getBoundingClientRect().right,
                // The border and, while it scrolls, the scroll bar.
                gridChrome: element.offsetWidth - element.clientWidth,
                panelWidth: panel.clientWidth,
                panelRight: panel.getBoundingClientRect().right,
                dockRight: scroller.getBoundingClientRect().left + scroller.clientWidth,
                gridScrollWidth: element.scrollWidth,
                gridClientWidth: element.clientWidth,
                gridScrollHeight: element.scrollHeight,
                gridClientHeight: element.clientHeight,
                dockScrollWidth: scroller.scrollWidth,
                dockClientWidth: scroller.clientWidth,
                headerRight: header.getBoundingClientRect().right,
                headerScrollWidth: header.scrollWidth,
                headerClientWidth: header.clientWidth,
                toggleScrollWidth: toggle.scrollWidth,
                toggleClientWidth: toggle.clientWidth,
            };
        });
        // A grid: whole rows of swatches, more of them than it shows, so it scrolls.
        expect(layout.columns * (layout.rows - 1)).toBeLessThan(256);
        expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(256);
        expect(layout.gridScrollHeight).toBe(layout.rows * 16);
        expect(layout.gridClientHeight).toBe(8 * 16);
        // The scroll bar is shown, and the grid has room for it beside its border.
        expect(layout.gridChrome).toBeGreaterThan(2);
        // No horizontal overflow: not in the grid, the grid inside the panel, nor in the dock.
        expect(layout.gridScrollWidth).toBeLessThanOrEqual(layout.gridClientWidth);
        expect(layout.gridClientWidth).toBe(layout.columns * 16);
        expect(layout.gridRight).toBeLessThanOrEqual(layout.panelRight);
        expect(layout.panelRight).toBeLessThanOrEqual(layout.dockRight);
        expect(layout.dockScrollWidth).toBeLessThanOrEqual(layout.dockClientWidth);
        // As many columns as fit: one more, with the border and the scroll bar, would not.
        expect((layout.columns + 1) * 16 + layout.gridChrome).toBeGreaterThan(layout.panelWidth);
        // The header keeps its title and controls inside the dock.
        expect(layout.headerScrollWidth).toBeLessThanOrEqual(layout.headerClientWidth);
        expect(layout.toggleScrollWidth).toBeLessThanOrEqual(layout.toggleClientWidth);
        expect(layout.headerRight).toBeLessThanOrEqual(layout.dockRight);

        // The last swatch is reached by scrolling the grid, from the keyboard as well.
        await swatches(page).nth(0).focus();
        await page.keyboard.press("End");
        await focused(page, 255);
        await expect(swatches(page).nth(255)).toBeInViewport();
        expect(await grid(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });
}
