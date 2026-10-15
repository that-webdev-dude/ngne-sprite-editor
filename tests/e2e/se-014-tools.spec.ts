import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports these modules from the dev server; here they are needed for their types.
import type * as PlannedToolsModule from "../../src/app/tools/planned.tools";
import type * as ToolRegistryModule from "../../src/app/tools/toolRegistry";
import { collectErrors, region, settleTimers } from "./se-006-support";
import { menuTrigger } from "./se-007-support";
import {
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
} from "./se-011-support";
import { activeView, geometry, pixelAt, viewAtScale, viewportArea } from "./se-012-support";
import type { View } from "./se-012-support";
import {
    DOT,
    historyOf,
    railButton,
    selectDot,
    selectTool,
    texelClient,
    toolsState,
} from "./se-014-support";

// SE-014: the tools as the interface offers them — the rail and the keys select them, the
// context bar shows the active tool's options, a held Space is a temporary hand, the zoom
// tool steps about the clicked pixel — and the focus rules of SPEC §7.8 around them.

const WIDTH = 24;
const HEIGHT = 16;
const VIEW: View = { scale: 8, originX: 120, originY: 60 };

async function openPainted(page: Page) {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    const pixels = pattern(WIDTH, HEIGHT, 4);
    await paint(page, document.id, pixels);
    await settle(page);
    return { document, pixels };
}

/** Registers a tool with one option of each kind, at run time, as a test of the context bar. */
function registerOptionsTool(page: Page): Promise<void> {
    return page.evaluate(async () => {
        const path = "/src/app/tools/toolRegistry.ts";
        const module = (await import(/* @vite-ignore */ path)) as typeof ToolRegistryModule;
        module.toolRegistry.register({
            id: "se014.options",
            label: "Options probe",
            options: [
                {
                    kind: "number",
                    key: "size",
                    label: "Size",
                    min: 1,
                    max: 64,
                    default: 1,
                    unit: "px",
                },
                {
                    kind: "choice",
                    key: "shape",
                    label: "Shape",
                    choices: [
                        { value: "square", label: "Square" },
                        { value: "circle", label: "Circle" },
                    ],
                    default: "square",
                },
                { kind: "toggle", key: "perfect", label: "Pixel-perfect", default: true },
                {
                    kind: "choice",
                    key: "ink",
                    label: "Ink",
                    display: "select",
                    choices: [
                        { value: "simple", label: "Simple" },
                        { value: "alpha", label: "Alpha compositing" },
                    ],
                    default: "simple",
                },
            ],
        });
    });
}

function storedOptions(page: Page, tool: string): Promise<Record<string, unknown> | undefined> {
    return page.evaluate((tool) => window.__ngneTest!.editor.getState().toolOptions[tool], tool);
}

/** The planned rail slots, in order, and whether the registry has a tool of each of `ids`. */
function railState(page: Page, ids: readonly string[]) {
    return page.evaluate(async (ids) => {
        const registryPath = "/src/app/tools/toolRegistry.ts";
        const plannedPath = "/src/app/tools/planned.tools.ts";
        const registry = (await import(
            /* @vite-ignore */ registryPath
        )) as typeof ToolRegistryModule;
        const planned = (await import(/* @vite-ignore */ plannedPath)) as typeof PlannedToolsModule;
        return {
            planned: planned.plannedTools.map((plan) => plan.id),
            registered: ids.map((id) => registry.toolRegistry.get(id) !== undefined),
        };
    }, ids);
}

/**
 * Records what Ctrl+S runs while a text field has the focus: the commands bound to it in the
 * `text` context record instead of running (once Save exists, SE-041), or a probe bound there
 * records while none is.
 */
function recordSave(page: Page): Promise<void> {
    return page.evaluate(() => {
        const calls: string[] = [];
        (window as unknown as { __se014Saves: string[] }).__se014Saves = calls;
        const { commands } = window.__ngneTest!;
        const bound = commands.bindings("text", "Ctrl+S");
        const record = () => void calls.push("save");
        if (bound.length > 0) {
            for (const command of bound) command.run = record;
            return;
        }
        commands.register({
            id: "se014.save",
            title: "SE-014 save probe",
            shortcut: "Ctrl+S",
            context: ["global", "text"],
            run: record,
        });
    });
}

test("the rail shows the tools of the registry: Hand and Zoom work, later tools are disabled slots", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPainted(page);
    const rail = region(page, "tool-rail");
    const slots = rail.locator("[data-tool]");
    await expect(slots).toHaveCount(13);
    const ids = await slots.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-tool") ?? ""),
    );
    const { planned, registered } = await railState(page, ids);
    // Hand and Zoom are registered, in their planned slots.
    for (const id of ["hand", "zoom"]) {
        expect(registered[ids.indexOf(id)], id).toBe(true);
        expect(ids.indexOf(id), id).toBe(planned.indexOf(id));
    }
    // A slot's button is enabled exactly when the registry has a tool of its id.
    for (const [index, id] of ids.entries()) {
        const button = rail.locator(`[data-tool="${id}"]`);
        if (registered[index]) await expect(button, id).toBeEnabled();
        else await expect(button, id).toBeDisabled();
    }
    // The default tool, the pencil (registered by SE-015), is active: its button alone of the
    // tool buttons is pressed and the context bar shows it.
    await expect(rail.locator('[data-tool][aria-pressed="true"]')).toHaveCount(1);
    await expect(rail.locator('[data-tool][aria-pressed="true"]')).toHaveAttribute(
        "data-tool",
        "pencil",
    );
    await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText("Pencil");
    expect(await toolsState(page)).toMatchObject({ selected: "pencil", active: "pencil" });

    await railButton(page, "Zoom").click();
    await expect(railButton(page, "Zoom")).toHaveAttribute("aria-pressed", "true");
    await expect(region(page, "context-bar")).toHaveText("Zoom");
    await expect(region(page, "status-bar").locator('[data-status="message"]')).toHaveText(
        "Alt: zoom out",
    );
    expect((await toolsState(page)).cursor).toBe("zoom-in");
    expect(errors).toEqual([]);
});

test("click a rail tool button, then press H: the hand is active with no click on the canvas; in a number field H types and Ctrl+S still reaches the registry", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPainted(page);
    await railButton(page, "Zoom").click();
    await expect(railButton(page, "Zoom")).toHaveAttribute("aria-pressed", "true");
    // Pointer activation of a tool button gives the focus back to the viewport (SPEC §7.8).
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("KeyH");
    await expect(railButton(page, "Hand")).toHaveAttribute("aria-pressed", "true");
    await expect(railButton(page, "Zoom")).toHaveAttribute("aria-pressed", "false");
    expect((await toolsState(page)).selected).toBe("hand");
    await page.keyboard.press("KeyZ");
    await expect(railButton(page, "Zoom")).toHaveAttribute("aria-pressed", "true");

    // The tests' dot tool has a number option in the context bar.
    await selectDot(page);
    const field = region(page, "context-bar").getByRole("spinbutton", { name: "Alpha" });
    await expect(field).toHaveValue("255");
    await recordSave(page);
    await field.click();
    await expect(field).toBeFocused();
    await page.keyboard.press("KeyH");
    await expect(field).toHaveValue("255h");
    expect((await toolsState(page)).selected).toBe(DOT);
    await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText("Dot");
    await page.keyboard.press("Control+KeyS");
    expect(
        await page.evaluate(() => (window as unknown as { __se014Saves: string[] }).__se014Saves),
    ).toEqual(["save"]);
    // The field keeps the focus: it is a text field.
    await expect(field).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(field).toHaveValue("255");
    expect(errors).toEqual([]);
});

test("the context bar renders the active tool's option schema and sets its options", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPainted(page);
    await registerOptionsTool(page);
    await selectTool(page, "se014.options");
    const bar = region(page, "context-bar");
    await expect(bar.locator("[data-context-tool]")).toHaveText("Options probe");
    // In the tool's order: size · shape · mode toggles · ink (DESIGN §5.2).
    expect(
        await bar
            .locator("[data-tool-option]")
            .evaluateAll((items) => items.map((item) => item.getAttribute("data-tool-option"))),
    ).toEqual(["size", "shape", "perfect", "ink"]);
    const size = bar.getByRole("spinbutton", { name: "Size" });
    const circle = bar.getByRole("radio", { name: "Circle" });
    const perfect = bar.getByRole("button", { name: "Pixel-perfect" });
    const ink = bar.getByRole("combobox", { name: "Ink" });
    await expect(size).toHaveValue("1");
    await expect(bar.getByRole("radio", { name: "Square" })).toBeChecked();
    await expect(perfect).toHaveAttribute("aria-pressed", "true");
    await expect(ink).toHaveText("Simple");

    // A number field is typed in and keeps the focus.
    await size.click();
    await size.fill("8");
    await page.keyboard.press("Enter");
    await expect(size).toHaveValue("8");
    await expect(size).toBeFocused();

    // A toggle and a segment activated with the pointer return the focus to the viewport.
    await perfect.click();
    await expect(perfect).toHaveAttribute("aria-pressed", "false");
    await expect(viewportArea(page)).toBeFocused();
    await circle.click();
    await expect(circle).toBeChecked();
    await expect(viewportArea(page)).toBeFocused();

    // A select opens its list, which takes the focus; the choice is made there. Opened and
    // chosen with the pointer, the focus goes back to the viewport once the list has gone.
    await ink.click();
    const option = page.getByRole("option", { name: "Alpha compositing" });
    await expect(option).toBeVisible();
    await expect(page.getByRole("option").first()).toBeFocused();
    await option.click();
    await expect(ink).toHaveText("Alpha compositing");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(viewportArea(page)).toBeFocused();

    expect(await storedOptions(page, "se014.options")).toEqual({
        size: 8,
        perfect: false,
        shape: "circle",
        ink: "alpha",
    });

    // Activated from the keyboard, a toggle keeps the focus.
    await perfect.focus();
    await expect(perfect).toBeFocused();
    await page.keyboard.press("Space");
    await expect(perfect).toHaveAttribute("aria-pressed", "true");
    await settleTimers(page);
    await expect(perfect).toBeFocused();

    // Opened and chosen with the keyboard, a select keeps the focus.
    await ink.focus();
    await expect(ink).toBeFocused();
    await page.keyboard.press("Enter");
    const simple = page.getByRole("option", { name: "Simple" });
    await expect(page.getByRole("option", { name: "Alpha compositing" })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(simple).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(ink).toHaveText("Simple");
    await expect(ink).toBeFocused();
    await settleTimers(page);
    await expect(ink).toBeFocused();
    expect((await storedOptions(page, "se014.options"))?.ink).toBe("simple");
    expect(errors).toEqual([]);
});

test("focus returns to the viewport after pointer activation of a control outside the timeline only", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPainted(page);
    // A dock header: a non-text control outside the timeline.
    const palette = region(page, "dock").getByRole("button", { name: "Palette" });
    await palette.click();
    await expect(viewportArea(page)).toBeFocused();
    // Activated from the keyboard it keeps the focus.
    await palette.focus();
    await expect(palette).toBeFocused();
    await page.keyboard.press("Enter");
    await settleTimers(page);
    await expect(palette).toBeFocused();

    // In the timeline a click keeps the focus.
    const splitter = page.getByRole("separator", { name: "Resize timeline" });
    const box = await splitter.boundingBox();
    if (!box) throw new Error("no splitter");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await settleTimers(page);
    await expect(splitter).toBeFocused();

    // A menu trigger opens its menu, which keeps the focus.
    await menuTrigger(page, "View").click();
    const menu = page.getByRole("menu", { name: "View" });
    await expect(menu).toBeVisible();
    await expect
        .poll(() => menu.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
    await settleTimers(page);
    await expect(viewportArea(page)).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    expect(errors).toEqual([]);
});

for (const tool of [DOT, "zoom"]) {
    test(`holding Space pans with the ${tool} tool active, and the tool is back on release`, async ({
        page,
    }) => {
        const errors = collectErrors(page);
        const { document, pixels } = await openPainted(page);
        if (tool === DOT) await selectDot(page);
        else await selectTool(page, tool);
        const layout = await geometry(page);
        const start = texelClient(layout, VIEW, { x: 5, y: 5 });
        await page.mouse.move(start.x, start.y);
        await viewportArea(page).focus();
        await expect(viewportArea(page)).toBeFocused();

        await page.keyboard.down("Space");
        await expect.poll(async () => (await toolsState(page)).active).toBe("hand");
        expect(await toolsState(page)).toMatchObject({ selected: tool, cursor: "grab" });
        await page.mouse.down();
        await page.mouse.move(start.x + 30, start.y + 20, { steps: 3 });
        expect((await toolsState(page)).cursor).toBe("grabbing");
        await page.mouse.up();
        const panned = {
            ...VIEW,
            originX: VIEW.originX + Math.round(30 * layout.ratio),
            originY: VIEW.originY + Math.round(20 * layout.ratio),
        };
        expect(await activeView(page)).toEqual(panned);

        await page.keyboard.up("Space");
        await expect.poll(async () => (await toolsState(page)).active).toBe(tool);
        // Nothing painted, nothing zoomed, nothing recorded.
        expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
        await settle(page);
        await expectImage(page, document, panned, pixels);
        expect(errors).toEqual([]);
    });
}

test("zoom tool: a click steps in and an Alt-click steps out, about the clicked document pixel", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document } = await openPainted(page);
    await railButton(page, "Zoom").click();
    await expect(viewportArea(page)).toBeFocused();
    const layout = await geometry(page);
    const client = texelClient(layout, VIEW, { x: 13, y: 9 }, "last");
    const pixel = pixelAt(layout, VIEW, client);
    expect(pixel).toEqual({ x: 13, y: 9 });

    await page.mouse.click(client.x, client.y);
    let view = await viewAtScale(page, 10);
    expect(pixelAt(layout, view, client)).toEqual(pixel);
    await page.mouse.click(client.x, client.y);
    view = await viewAtScale(page, 12);
    expect(pixelAt(layout, view, client)).toEqual(pixel);

    await page.keyboard.down("Alt");
    await expect.poll(async () => (await toolsState(page)).cursor).toBe("zoom-out");
    await page.mouse.click(client.x, client.y);
    view = await viewAtScale(page, 10);
    expect(pixelAt(layout, view, client)).toEqual(pixel);
    await page.mouse.click(client.x, client.y);
    view = await viewAtScale(page, 8);
    expect(pixelAt(layout, view, client)).toEqual(pixel);
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await toolsState(page)).cursor).toBe("zoom-in");
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    expect(errors).toEqual([]);
});

test("the cursor over the viewport is the active tool's, by the modifiers and whether the pointer is over the document", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPainted(page);
    await page.evaluate(async () => {
        const path = "/src/app/tools/toolRegistry.ts";
        const module = (await import(/* @vite-ignore */ path)) as typeof ToolRegistryModule;
        module.toolRegistry.register({
            id: "se014.cursor",
            label: "Cursor probe",
            cursor: ({ overDocument, modifiers }) =>
                modifiers.shift ? "copy" : overDocument ? "crosshair" : "not-allowed",
        });
    });
    await selectTool(page, "se014.cursor");
    const area = viewportArea(page);
    const cursorOf = () => area.evaluate((element) => getComputedStyle(element).cursor);
    const layout = await geometry(page);
    const inside = texelClient(layout, VIEW, { x: 3, y: 3 });
    const beside = texelClient(layout, VIEW, { x: -4, y: 3 });

    await page.mouse.move(inside.x, inside.y);
    await expect.poll(cursorOf).toBe("crosshair");
    await page.mouse.move(beside.x, beside.y);
    await expect.poll(cursorOf).toBe("not-allowed");
    await page.keyboard.down("Shift");
    await expect.poll(cursorOf).toBe("copy");
    await page.keyboard.up("Shift");
    await expect.poll(cursorOf).toBe("not-allowed");
    // The overlay canvas, the pointer target, takes it from the viewport element.
    expect(
        await page.evaluate(
            () => getComputedStyle(document.querySelector("[data-viewport-overlay]")!).cursor,
        ),
    ).toBe("not-allowed");

    // A middle-drag shows its own cursor while it pans (SE-012).
    await page.mouse.move(inside.x, inside.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(inside.x + 10, inside.y + 5);
    await expect.poll(cursorOf).toBe("grabbing");
    await page.mouse.up({ button: "middle" });
    await expect.poll(cursorOf).toBe("crosshair");
    expect(errors).toEqual([]);
});

test("a touch or pen stroke is the tool's: the viewport element and the overlay take no browser panning", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPainted(page);
    const touchAction = (selector: string) =>
        page.evaluate(
            (selector) => getComputedStyle(document.querySelector(selector)!).touchAction,
            selector,
        );
    expect(await touchAction("[data-viewport]")).toBe("none");
    expect(await touchAction("[data-viewport] > canvas[data-viewport-overlay]")).toBe("none");
    expect(errors).toEqual([]);
});
