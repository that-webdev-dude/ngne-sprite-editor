import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports these modules from the dev server; here they are needed for their types.
import type * as EditorModule from "../../src/app/state/editor";
import type * as ToolRegistryModule from "../../src/app/tools/toolRegistry";
import {
    boxOf,
    contains,
    dragBy,
    openShell,
    overlap,
    region,
    regionBoxes,
    REGIONS,
    tabTo,
} from "./se-006-support";
import type { Box, Region } from "./se-006-support";

// SE-006: app shell — regions, overflow rules, resizing and persisted sizes (DESIGN §2).

const MOCKUP_URL = new URL("../../docs/design/mockup.html", import.meta.url).href;
const MOCKUP_SELECTORS: Record<Region, string> = {
    "menu-bar": ".menubar",
    "tool-rail": ".rail",
    "context-bar": ".context",
    viewport: ".viewport",
    dock: ".dock",
    timeline: ".timeline",
    "status-bar": ".status",
};
const LAYOUT_KEY = "ngne-sprite-editor.layout";

const toolButtons = (page: Page) => region(page, "tool-rail").getByRole("button");
const dockHeaders = (page: Page) => region(page, "dock").locator(".dock-section__toggle");
const dockSplitter = (page: Page) => page.getByRole("separator", { name: "Resize panels" });
const timelineSplitter = (page: Page) => page.getByRole("separator", { name: "Resize timeline" });

/** No two regions share a pixel and every region lies inside the window. */
function expectSoundLayout(boxes: Record<Region, Box>, window: { width: number; height: number }) {
    for (const id of REGIONS) {
        expect(boxes[id].width, `${id} width`).toBeGreaterThan(0);
        expect(boxes[id].height, `${id} height`).toBeGreaterThan(0);
        expect(contains({ x: 0, y: 0, ...window }, boxes[id]), `${id} inside the window`).toBe(
            true,
        );
    }
    for (const [index, first] of REGIONS.entries()) {
        for (const second of REGIONS.slice(index + 1)) {
            expect(overlap(boxes[first], boxes[second]), `${first} overlaps ${second}`).toBe(0);
        }
    }
    // Together the regions cover the window: nothing is left over for a stray gap.
    const area = REGIONS.reduce((sum, id) => sum + boxes[id].width * boxes[id].height, 0);
    expect(area).toBeCloseTo(window.width * window.height, 0);
}

/** Every tool button is entirely inside the rail and no two buttons overlap. */
async function expectToolsVisible(page: Page) {
    const rail = await boxOf(region(page, "tool-rail"));
    const buttons = await toolButtons(page).all();
    expect(buttons).toHaveLength(13);
    const boxes: Box[] = [];
    for (const button of buttons) {
        await expect(button).toBeVisible();
        const box = await boxOf(button);
        expect(box.width).toBe(28);
        expect(box.height).toBe(28);
        expect(contains(rail, box), `${await button.getAttribute("aria-label")} in rail`).toBe(
            true,
        );
        boxes.push(box);
    }
    for (const [index, first] of boxes.entries()) {
        for (const second of boxes.slice(index + 1)) expect(overlap(first, second)).toBe(0);
    }
}

test("the shell at 1440×900 matches the region sizes of the mockup within 1 px", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(MOCKUP_URL);
    const mockup = {} as Record<Region, Box>;
    for (const id of REGIONS) mockup[id] = await boxOf(page.locator(MOCKUP_SELECTORS[id]));

    await openShell(page);
    const shell = await regionBoxes(page);

    for (const id of REGIONS) {
        for (const side of ["x", "y", "width", "height"] as const) {
            expect(
                Math.abs(shell[id][side] - mockup[id][side]),
                `${id} ${side}: shell ${shell[id][side]}, mockup ${mockup[id][side]}`,
            ).toBeLessThanOrEqual(1);
        }
    }
    // The sizes of DESIGN §2, so the comparison cannot pass on two wrong layouts.
    expect(shell["menu-bar"]).toEqual({ x: 0, y: 0, width: 1440, height: 36 });
    expect(shell["tool-rail"]).toEqual({ x: 0, y: 36, width: 44, height: 640 });
    expect(shell["context-bar"]).toEqual({ x: 44, y: 36, width: 1132, height: 36 });
    expect(shell.viewport).toEqual({ x: 44, y: 72, width: 1132, height: 604 });
    expect(shell.dock).toEqual({ x: 1176, y: 36, width: 264, height: 640 });
    expect(shell.timeline).toEqual({ x: 0, y: 676, width: 1440, height: 200 });
    expect(shell["status-bar"]).toEqual({ x: 0, y: 876, width: 1440, height: 24 });
    expectSoundLayout(shell, { width: 1440, height: 900 });
});

test("at 1280×720 every tool button is visible, every dock header is reachable and no region overlaps", async ({
    page,
}) => {
    await openShell(page, { width: 1280, height: 720 });

    const boxes = await regionBoxes(page);
    expectSoundLayout(boxes, { width: 1280, height: 720 });
    // Default timeline height: min(200 px, 28% of 720).
    expect(boxes.timeline.height).toBe(200);
    expect(boxes.dock.width).toBe(264);

    await expectToolsVisible(page);

    // The dock is one scrolling column: its content is taller than the region here.
    const scroller = region(page, "dock").locator(".shell-dock__scroll");
    const scroll = await scroller.evaluate((element) => ({
        content: element.scrollHeight,
        visible: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
    }));
    expect(scroll.overflowY).toBe("auto");
    expect(scroll.content).toBeGreaterThan(scroll.visible);

    // Expanding every section pushes headers further down; each stays reachable by scrolling.
    const headers = await dockHeaders(page).all();
    expect(headers).toHaveLength(3);
    for (const header of headers) {
        if ((await header.getAttribute("aria-expanded")) === "false") await header.click();
    }
    for (const header of headers) {
        await header.scrollIntoViewIfNeeded();
        const dock = await boxOf(region(page, "dock"));
        const box = await boxOf(header);
        expect(contains(dock, box), `${await header.textContent()} header inside the dock`).toBe(
            true,
        );
        // Not covered by anything: the header itself is what a click at its centre hits.
        const hit = await header.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const top = document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
            );
            return top !== null && element.contains(top);
        });
        expect(hit).toBe(true);
    }
    expectSoundLayout(await regionBoxes(page), { width: 1280, height: 720 });
});

test("the rail switches to two columns when one does not fit and never clips a tool", async ({
    page,
}) => {
    await openShell(page, { width: 1280, height: 720 });
    const rail = region(page, "tool-rail");
    await expect(rail).toHaveAttribute("data-columns", "1");
    expect((await boxOf(rail)).width).toBe(44);

    // The tallest timeline (50% of the window) leaves the rail 300 px.
    await timelineSplitter(page).focus();
    await page.keyboard.press("End");
    await expect(rail).toHaveAttribute("data-columns", "2");
    const boxes = await regionBoxes(page);
    expect(boxes.timeline.height).toBe(360);
    expect(boxes["tool-rail"]).toEqual({ x: 0, y: 36, width: 72, height: 300 });
    expect(boxes.viewport.x).toBe(72);
    expectSoundLayout(boxes, { width: 1280, height: 720 });
    await expectToolsVisible(page);
    const overflow = await rail.evaluate((element) => ({
        scrolls: element.scrollHeight > element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
    }));
    expect(overflow).toEqual({ scrolls: false, overflowY: "visible" });

    // Dock headers stay reachable in the shorter dock as well.
    for (const header of await dockHeaders(page).all()) {
        await header.scrollIntoViewIfNeeded();
        expect(contains(await boxOf(region(page, "dock")), await boxOf(header))).toBe(true);
    }

    await page.keyboard.press("Home");
    await expect(rail).toHaveAttribute("data-columns", "1");
    expect((await boxOf(rail)).width).toBe(44);
    await expectToolsVisible(page);
});

test("the dock resizes between 220 and 360 px, resets on double-click and keeps its width", async ({
    page,
}) => {
    await openShell(page, { width: 1440, height: 900 });
    const dock = region(page, "dock");
    const width = async () => (await boxOf(dock)).width;
    const splitter = dockSplitter(page);

    // 8 px hit area centred on the dock's edge.
    const hit = await boxOf(splitter);
    expect(hit.width).toBe(8);
    expect(hit.x).toBe(1176 - 4);

    await dragBy(page, splitter, -60, 0);
    expect(await width()).toBe(324);
    await expect(splitter).toHaveAttribute("aria-valuenow", "324");
    expect((await regionBoxes(page)).viewport.width).toBe(1440 - 44 - 324);

    await dragBy(page, splitter, -400, 0);
    expect(await width()).toBe(360);
    await dragBy(page, splitter, 700, 0);
    expect(await width()).toBe(220);
    expectSoundLayout(await regionBoxes(page), { width: 1440, height: 900 });

    await dragBy(page, splitter, -80, 0);
    expect(await width()).toBe(300);
    expect(await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY)).toContain(
        '"dockWidth":300',
    );
    await page.reload();
    await expect(dock).toBeVisible();
    expect(await width()).toBe(300);

    await splitter.dblclick();
    expect(await width()).toBe(264);
    await page.reload();
    await expect(dock).toBeVisible();
    expect(await width()).toBe(264);
});

test("the timeline resizes between 120 px and half the window, resets on double-click and keeps its height", async ({
    page,
}) => {
    await openShell(page, { width: 1440, height: 900 });
    const timeline = region(page, "timeline");
    const height = async () => (await boxOf(timeline)).height;
    const splitter = timelineSplitter(page);

    const hit = await boxOf(splitter);
    expect(hit.height).toBe(8);
    expect(hit.y).toBe(676 - 4);

    await dragBy(page, splitter, 0, -50);
    expect(await height()).toBe(250);
    await dragBy(page, splitter, 0, -600);
    expect(await height()).toBe(450);
    await dragBy(page, splitter, 0, 800);
    expect(await height()).toBe(120);
    expectSoundLayout(await regionBoxes(page), { width: 1440, height: 900 });

    await dragBy(page, splitter, 0, -140);
    expect(await height()).toBe(260);
    await page.reload();
    await expect(timeline).toBeVisible();
    expect(await height()).toBe(260);

    // A stored height above half of a smaller window is limited when rendered.
    await dragBy(page, splitter, 0, -600);
    expect(await height()).toBe(450);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(height).toBe(360);

    await splitter.dblclick();
    expect(await height()).toBe(200);
    await page.reload();
    await expect(timeline).toBeVisible();
    expect(await height()).toBe(200);
});

test("the splitters resize with the keyboard", async ({ page }) => {
    await openShell(page, { width: 1440, height: 900 });
    const dockWidth = async () => (await boxOf(region(page, "dock"))).width;
    const timelineHeight = async () => (await boxOf(region(page, "timeline"))).height;

    await tabTo(page, dockSplitter(page));
    await page.keyboard.press("ArrowLeft");
    expect(await dockWidth()).toBe(272);
    await page.keyboard.press("Shift+ArrowRight");
    expect(await dockWidth()).toBe(240);
    await page.keyboard.press("End");
    expect(await dockWidth()).toBe(360);
    await page.keyboard.press("Enter");
    expect(await dockWidth()).toBe(264);

    await tabTo(page, timelineSplitter(page));
    await page.keyboard.press("ArrowUp");
    expect(await timelineHeight()).toBe(208);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await timelineHeight()).toBe(192);
    await page.keyboard.press("Home");
    expect(await timelineHeight()).toBe(120);
    await page.keyboard.press("Enter");
    expect(await timelineHeight()).toBe(200);
});

test("dock sections collapse from their headers; the palette starts collapsed under 800 px", async ({
    page,
}) => {
    await openShell(page, { width: 1440, height: 900 });
    const header = (name: string) => region(page, "dock").getByRole("button", { name });
    for (const name of ["Colour", "Palette", "Preview · NGNE"]) {
        await expect(header(name)).toHaveAttribute("aria-expanded", "true");
    }

    // The default follows the window height until the user chooses.
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(header("Palette")).toHaveAttribute("aria-expanded", "false");
    await expect(header("Colour")).toHaveAttribute("aria-expanded", "true");
    await expect(header("Preview · NGNE")).toHaveAttribute("aria-expanded", "true");
    await expect(region(page, "dock").locator('[data-dock-panel="palette"] > div')).toBeHidden();

    await header("Palette").click();
    await expect(header("Palette")).toHaveAttribute("aria-expanded", "true");
    await expect(region(page, "dock").locator('[data-dock-panel="palette"] > div')).toBeVisible();

    await tabTo(page, header("Colour"));
    const before = (await boxOf(header("Palette"))).y;
    await page.keyboard.press("Enter");
    await expect(header("Colour")).toHaveAttribute("aria-expanded", "false");
    expect((await boxOf(header("Palette"))).y).toBeLessThan(before);
    await page.keyboard.press("Space");
    await expect(header("Colour")).toHaveAttribute("aria-expanded", "true");

    // The user's choice now outlives the height rule.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(header("Palette")).toHaveAttribute("aria-expanded", "true");
});

test("regions carry their landmarks; the context bar and status bar hold only the active tool's name, options and hint", async ({
    page,
}) => {
    await openShell(page);
    await expect(page.getByRole("banner")).toHaveAttribute("data-region", "menu-bar");
    await expect(page.getByRole("navigation", { name: "Tools" })).toHaveAttribute(
        "data-region",
        "tool-rail",
    );
    await expect(page.getByRole("region", { name: "Tool options" })).toHaveAttribute(
        "data-region",
        "context-bar",
    );
    await expect(page.getByRole("main")).toHaveAttribute("data-region", "viewport");
    await expect(page.getByRole("complementary", { name: "Panels" })).toHaveAttribute(
        "data-region",
        "dock",
    );
    await expect(page.getByRole("region", { name: "Timeline" })).toHaveAttribute(
        "data-region",
        "timeline",
    );
    await expect(page.getByRole("contentinfo")).toHaveAttribute("data-region", "status-bar");

    // With no document open, the context bar and the status bar hold only what the active
    // tool brings (SE-014; the default tool is registered since SE-015): its name and its
    // options, and the hint of its modifiers.
    const active = await page.evaluate(async () => {
        const registryPath = "/src/app/tools/toolRegistry.ts";
        const editorPath = "/src/app/state/editor.ts";
        const registry = (await import(
            /* @vite-ignore */ registryPath
        )) as typeof ToolRegistryModule;
        const editor = (await import(/* @vite-ignore */ editorPath)) as typeof EditorModule;
        const tool = registry.toolRegistry.get(editor.editorStore.getState().tool);
        if (!tool) return null;
        const options = tool.options.map((option) => option.key);
        return { label: tool.label, options, hint: tool.hint ?? null };
    });
    const contextBar = region(page, "context-bar");
    const statusBar = region(page, "status-bar");
    if (!active) {
        await expect(contextBar).toBeEmpty();
    } else {
        await expect(contextBar.locator(":scope > *")).toHaveCount(1 + active.options.length);
        await expect(contextBar.locator(":scope > [data-context-tool]")).toHaveText(active.label);
        expect(
            await contextBar
                .locator(":scope > [data-tool-option]")
                .evaluateAll((items) => items.map((item) => item.getAttribute("data-tool-option"))),
        ).toEqual(active.options);
    }
    if (!active?.hint) {
        await expect(statusBar).toBeEmpty();
    } else {
        await expect(statusBar.locator(":scope > *")).toHaveCount(1);
        await expect(statusBar.locator(':scope > [data-status="message"]')).toHaveText(active.hint);
        await expect(statusBar.locator(':scope > [data-status="message"]')).toHaveAttribute(
            "data-kind",
            "hint",
        );
    }
    await expect(region(page, "timeline").locator(".shell-timeline__content")).toBeEmpty();
    // Rail tools are placeholders until their tickets register them (SE-014): a tool's button
    // is enabled exactly when the tool registry has a tool of its id.
    const toolSlots = region(page, "tool-rail").locator("[data-tool]");
    const tools = await toolSlots.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-tool") ?? ""),
    );
    const registered = await page.evaluate(async (ids) => {
        const path = "/src/app/tools/toolRegistry.ts";
        const module = (await import(/* @vite-ignore */ path)) as typeof ToolRegistryModule;
        return ids.map((id) => module.toolRegistry.get(id) !== undefined);
    }, tools);
    for (const [index, button] of (await toolSlots.all()).entries()) {
        if (registered[index]) await expect(button).toBeEnabled();
        else await expect(button).toBeDisabled();
    }
});
