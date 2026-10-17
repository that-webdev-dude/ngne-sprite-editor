import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as SprayToolsModule from "../../src/app/tools/spray/spray.tools";
import {
    createBrush,
    forEachCurvePixel,
    forEachPolygonOutlinePixel,
    forEachPolygonRun,
    paintInk,
    SprayStroke,
} from "../../src/core/raster";
import { collectErrors, region, settleTimers } from "./se-006-support";
import {
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
} from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { geometry, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { expectFeedback, historyOf, setLayerFlag, texelClient, toolsState } from "./se-014-support";
import { celBytes, setColours, setToolOptions } from "./se-015-support";
import { contextMenus, recordContextMenus } from "./se-016-support";
import { changedTexels, moveOver, rowMajor } from "./se-017-support";
import { setSelection } from "./se-030-support";

// SE-065: the curve, polygon, contour and spray as the user works with them (SPEC §7.1,
// Curve, contour, polygon and spray). Each is selected by its key from the rail slot it shares
// (Shift+L in the ellipse's, D and Shift+D in the rectangle's, Shift+B in the eraser's), and a
// key pressed again switches within the slot. The curve is a drag and two clicks, the polygon
// clicks closed by Enter (which then reaches no `canvas` binding) or a double click; both show
// the shape while it is made and keep it as one undo step, and Escape takes it back. The
// contour fills its path at the release; the spray with a fixed seed draws the same stroke
// again. The expected pixels come from `core/raster`, whose geometry SE-065's unit tests pin
// with golden rasters.

const WIDTH = 24;
const HEIGHT = 16;
const VIEW: View = { scale: 8, originX: 64, originY: 40 };
const MAGENTA = 0xff00ffff;
const CYAN = 0x00ffffff;

async function setUp(page: Page): Promise<{ document: TestDocument; before: number[] }> {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await paint(page, document.id, pattern(WIDTH, HEIGHT, 3));
    await setColours(page, MAGENTA, CYAN);
    await settle(page);
    const before = await celBytes(page, document.id);
    if (!before) throw new Error("no cel");
    return { document, before };
}

/** Selects a tool with its key from the viewport, and waits until it is the selected one. */
async function pressToolKey(page: Page, key: string, id: string): Promise<void> {
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press(key);
    await expect.poll(async () => (await toolsState(page)).selected).toBe(id);
}

async function click(page: Page, texel: Point, button: "left" | "right" = "left"): Promise<void> {
    await moveOver(page, VIEW, [texel]);
    await page.mouse.down({ button });
    await page.mouse.up({ button });
}

/** The texels a set of `visit` calls covers inside the document, row by row. */
function texels(fill: (set: (x: number, y: number) => void) => void): Point[] {
    const keys = new Set<string>();
    fill((x, y) => {
        if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) keys.add(`${x},${y}`);
    });
    return [...keys]
        .map((key) => {
            const [x, y] = key.split(",").map(Number) as [number, number];
            return { x, y };
        })
        .sort(rowMajor);
}

/** The curve's texels with a 1 px brush. */
const curveTexels = (points: Point[]) => texels((set) => forEachCurvePixel(points, set));

/** The polygon's texels with a 1 px brush: its sides, and with `filled` its inside. */
const polygonTexels = (points: Point[], filled: boolean) =>
    texels((set) => {
        forEachPolygonOutlinePixel(points, set);
        if (!filled) return;
        forEachPolygonRun(points, (y, x, end) => {
            for (let px = x; px < end; px++) set(px, y);
        });
    });

const changed = (before: number[], after: number[]) =>
    changedTexels(before, after, WIDTH).sort(rowMajor);

const slotButton = (page: Page, slot: string): Locator =>
    region(page, "tool-rail").locator(`[data-tool="${slot}"]`);

const gestureContext = (page: Page) =>
    page.evaluate(() => window.__ngneTest!.keyContexts.getState().gesture);

const undo = (page: Page) =>
    page.evaluate(() => window.__ngneTest!.commands.get("edit.undo")!.run());
const redo = (page: Page) =>
    page.evaluate(() => window.__ngneTest!.commands.get("edit.redo")!.run());

/** Makes what the `canvas` bindings of Enter (play/pause) run a record. */
function recordCanvasEnter(page: Page): Promise<void> {
    return page.evaluate(() => {
        const calls: string[] = [];
        const probe = window as unknown as { __se065Enter: string[]; __se065Restore: () => void };
        probe.__se065Enter = calls;
        const { commands } = window.__ngneTest!;
        const record = () => void calls.push("enter");
        const bound = commands.bindings("canvas", "Enter");
        if (bound.length > 0) {
            // Play/pause may be disabled on a one-frame document: enabled here, as the probe.
            const kept = bound.map((command) => ({ run: command.run, enabled: command.enabled }));
            probe.__se065Restore = () =>
                bound.forEach((command, index) => {
                    command.run = kept[index]!.run;
                    command.enabled = kept[index]!.enabled;
                });
            for (const command of bound) {
                command.run = record;
                command.enabled = () => true;
            }
            return;
        }
        probe.__se065Restore = commands.register({
            id: "se065.play",
            title: "SE-065 play probe",
            shortcut: "Enter",
            context: "canvas",
            run: record,
        });
    });
}

const restoreCanvasEnter = (page: Page) =>
    page.evaluate(() => (window as unknown as { __se065Restore: () => void }).__se065Restore());

const canvasEnters = (page: Page) =>
    page.evaluate(() => (window as unknown as { __se065Enter: string[] }).__se065Enter.length);

test("curve: Shift+L in the ellipse's slot; a drag and two clicks draw it, shown as it is made, kept as one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await pressToolKey(page, "Shift+KeyL", "curve");
    await expect(slotButton(page, "ellipse")).toHaveAttribute("data-tool-variant", "curve");
    await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText("Curve");

    const start = { x: 2, y: 13 };
    const end = { x: 21, y: 12 };
    const first = { x: 4, y: 1 };
    const second = { x: 18, y: 3 };
    await moveOver(page, VIEW, [start]);
    await page.mouse.down();
    await moveOver(page, VIEW, [{ x: 12, y: 2 }, end], 3);
    await page.mouse.up();
    // The gesture stays open: the line from start to end.
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
    expect(await gestureContext(page)).toBe(true);
    expect(changed(before, (await celBytes(page, document.id))!)).toEqual(
        curveTexels([start, end, end, end]),
    );
    // The pointer bends it: both control points follow it.
    await moveOver(page, VIEW, [first]);
    const bent = (await celBytes(page, document.id))!;
    expect(changed(before, bent)).toEqual(curveTexels([start, first, first, end]));
    await settle(page);
    await expectImage(page, document, VIEW, bent);
    await click(page, first);
    await moveOver(page, VIEW, [second]);
    expect(changed(before, (await celBytes(page, document.id))!)).toEqual(
        curveTexels([start, first, second, end]),
    );
    await click(page, second);
    expect(await gestureContext(page)).toBe(false);
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const after = (await celBytes(page, document.id))!;
    expect(changed(before, after)).toEqual(curveTexels([start, first, second, end]));
    await settle(page);
    await expectImage(page, document, VIEW, after);

    await undo(page);
    expect(await celBytes(page, document.id)).toEqual(before);
    await redo(page);
    expect(await celBytes(page, document.id)).toEqual(after);

    // L selects the line, and L pressed again keeps it (SE-065 review): the curve shares no
    // slot with a tool of its letter. Shift+L pressed again keeps the curve.
    await pressToolKey(page, "KeyL", "line");
    await pressToolKey(page, "KeyL", "line");
    await pressToolKey(page, "KeyL", "line");
    await expect(slotButton(page, "line")).toHaveAttribute("aria-pressed", "true");
    await pressToolKey(page, "Shift+KeyL", "curve");
    await pressToolKey(page, "Shift+KeyL", "curve");
    await expect(slotButton(page, "ellipse")).toHaveAttribute("data-tool-variant", "curve");
    expect(errors).toEqual([]);
});

test("curve: Escape takes an open curve back, NGNE's image as it was; Enter keeps it as shown", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await pressToolKey(page, "Shift+KeyL", "curve");
    await moveOver(page, VIEW, [{ x: 1, y: 1 }]);
    await page.mouse.down();
    await moveOver(page, VIEW, [{ x: 20, y: 14 }], 3);
    await page.mouse.up();
    await moveOver(page, VIEW, [{ x: 20, y: 2 }]);
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Escape");
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    expect(await gestureContext(page)).toBe(false);
    expect(await celBytes(page, document.id)).toEqual(before);
    await settle(page);
    await expectImage(page, document, VIEW, before);

    await recordCanvasEnter(page);
    await moveOver(page, VIEW, [{ x: 3, y: 3 }]);
    await page.mouse.down();
    await moveOver(page, VIEW, [{ x: 19, y: 3 }], 3);
    await page.mouse.up();
    await moveOver(page, VIEW, [{ x: 11, y: 12 }]);
    await page.keyboard.press("Enter");
    expect(await canvasEnters(page)).toBe(0);
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const p = (x: number, y: number) => ({ x, y });
    expect(changed(before, (await celBytes(page, document.id))!)).toEqual(
        curveTexels([p(3, 3), p(11, 12), p(11, 12), p(19, 3)]),
    );
    await restoreCanvasEnter(page);
    expect(errors).toEqual([]);
});

test("polygon: Shift+D, clicks add vertices; Enter closes it and does not reach play/pause; a double click closes too", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await recordCanvasEnter(page);
    await pressToolKey(page, "Shift+KeyD", "polygon");
    await expect(slotButton(page, "rectangle")).toHaveAttribute("data-tool-variant", "polygon");

    const vertices = [
        { x: 2, y: 2 },
        { x: 20, y: 3 },
        { x: 12, y: 7 },
        { x: 19, y: 13 },
    ];
    for (const vertex of vertices) await click(page, vertex);
    expect(await gestureContext(page)).toBe(true);
    // The polygon runs on to the pointer between the clicks.
    await moveOver(page, VIEW, [{ x: 3, y: 12 }]);
    const shown = (await celBytes(page, document.id))!;
    expect(changed(before, shown)).toEqual(polygonTexels([...vertices, { x: 3, y: 12 }], false));
    await settle(page);
    await expectImage(page, document, VIEW, shown);
    await click(page, { x: 3, y: 12 });
    await moveOver(page, VIEW, [{ x: 22, y: 14 }]);
    await expect(viewportArea(page)).toBeFocused();
    // Space and Alt held while it is open do nothing (SE-065 review): it keeps its tool.
    for (const held of ["Space", "Alt"]) {
        await page.keyboard.down(held);
        expect((await toolsState(page)).active, held).toBe("polygon");
        expect(await gestureContext(page), held).toBe(true);
        await page.keyboard.up(held);
    }
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
    await page.keyboard.press("Enter");
    expect(await canvasEnters(page)).toBe(0);
    expect(await gestureContext(page)).toBe(false);
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const closed = (await celBytes(page, document.id))!;
    expect(changed(before, closed)).toEqual(polygonTexels([...vertices, { x: 3, y: 12 }], false));
    await settle(page);
    await expectImage(page, document, VIEW, closed);

    // Filled, closed by a double click on its last vertex.
    await setToolOptions(page, "polygon", { filled: true });
    const triangle = [
        { x: 5, y: 9 },
        { x: 14, y: 10 },
        { x: 8, y: 15 },
    ];
    await click(page, triangle[0]!);
    await click(page, triangle[1]!);
    await moveOver(page, VIEW, [triangle[2]!]);
    const layout = await geometry(page);
    const last = texelClient(layout, VIEW, triangle[2]!);
    await page.mouse.dblclick(last.x, last.y);
    expect(await gestureContext(page)).toBe(false);
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    expect(changed(closed, (await celBytes(page, document.id))!)).toEqual(
        polygonTexels(triangle, true).filter(
            ({ x, y }) =>
                closed.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4).join() !==
                "255,0,255,255",
        ),
    );

    // Escape takes an open polygon back.
    for (const vertex of vertices) await click(page, vertex);
    await page.keyboard.press("Escape");
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    expect(await gestureContext(page)).toBe(false);
    await restoreCanvasEnter(page);
    expect(errors).toEqual([]);
});

test("polygon: with the right button it paints the background, and no context menu opens", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await recordContextMenus(page);
    await pressToolKey(page, "Shift+KeyD", "polygon");
    const vertices = [
        { x: 3, y: 2 },
        { x: 18, y: 4 },
        { x: 9, y: 13 },
    ];
    for (const vertex of vertices) await click(page, vertex, "right");
    await page.keyboard.press("Enter");
    const after = (await celBytes(page, document.id))!;
    expect(changed(before, after)).toEqual(polygonTexels(vertices, false));
    const { x, y } = vertices[0]!;
    expect(after.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)).toEqual([0, 255, 255, 255]);
    // Chrome sends one per right click, at the press or (Windows) at the release: none opens.
    const menus = await contextMenus(page);
    expect(menus.length).toBeGreaterThan(0);
    expect(menus.every((menu) => menu.prevented)).toBe(true);
    expect(errors).toEqual([]);
});

test("contour: D in the rectangle's slot; a drag draws its path and the release fills it, the polygon through the same points", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await pressToolKey(page, "KeyD", "contour");
    await expect(slotButton(page, "rectangle")).toHaveAttribute("data-tool-variant", "contour");
    const path = [
        { x: 3, y: 2 },
        { x: 12, y: 1 },
        { x: 20, y: 4 },
        { x: 13, y: 7 },
        { x: 19, y: 13 },
        { x: 6, y: 14 },
        { x: 9, y: 8 },
    ];
    await moveOver(page, VIEW, path.slice(0, 1));
    await page.mouse.down();
    await moveOver(page, VIEW, path.slice(1));
    // While the button is held: the path only, not closed and not filled.
    const held = (await celBytes(page, document.id))!;
    expect(changed(before, held)).toEqual(
        texels((set) =>
            path.slice(1).forEach((to, index) => {
                const from = path[index]!;
                forEachPolygonOutlinePixel([from, to], set);
            }),
        ),
    );
    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const after = (await celBytes(page, document.id))!;
    expect(changed(before, after)).toEqual(polygonTexels(path, true));
    await settle(page);
    await expectImage(page, document, VIEW, after);
    await undo(page);
    expect(await celBytes(page, document.id)).toEqual(before);

    // D again: the polygon of the same slot; D once more the contour.
    await pressToolKey(page, "KeyD", "polygon");
    await pressToolKey(page, "KeyD", "contour");
    // U is the rectangle's alone.
    await pressToolKey(page, "KeyU", "rectangle");
    await pressToolKey(page, "KeyU", "rectangle");
    expect(errors).toEqual([]);
});

test("contour: refused on a locked layer; with a selection it fills only inside it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await pressToolKey(page, "KeyD", "contour");
    const square = [
        { x: 1, y: 1 },
        { x: 22, y: 1 },
        { x: 22, y: 14 },
        { x: 1, y: 14 },
    ];
    await setLayerFlag(page, document.id, "locked", true);
    await moveOver(page, VIEW, square.slice(0, 1));
    await page.mouse.down();
    await moveOver(page, VIEW, square.slice(1));
    await page.mouse.up();
    await expectFeedback(page, "Layer is locked");
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    expect(await celBytes(page, document.id)).toEqual(before);

    await setLayerFlag(page, document.id, "locked", false);
    const isSelected = ({ x, y }: Point) => x >= 6 && x < 14 && y >= 4 && y < 10;
    await setSelection(
        page,
        document.id,
        Array.from({ length: HEIGHT }, (_, y) =>
            Array.from({ length: WIDTH }, (_, x) => (isSelected({ x, y }) ? "#" : ".")).join(""),
        ),
    );
    await moveOver(page, VIEW, square.slice(0, 1));
    await page.mouse.down();
    await moveOver(page, VIEW, square.slice(1));
    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    expect(changed(before, (await celBytes(page, document.id))!)).toEqual(
        polygonTexels(square, true).filter(isSelected),
    );
    expect(errors).toEqual([]);
});

test("spray: Shift+B in the eraser's slot; with a fixed seed a stroke is drawn again the same, one undo step each", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    const SEED = 4242;
    await page.evaluate(async (seed) => {
        const path = "/src/app/tools/spray/spray.tools.ts";
        const module = (await import(/* @vite-ignore */ path)) as typeof SprayToolsModule;
        module.spraySeeds.next = () => seed;
    }, SEED);
    await pressToolKey(page, "Shift+KeyB", "spray");
    await expect(slotButton(page, "eraser")).toHaveAttribute("data-tool-variant", "spray");
    await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText("Spray");
    const options = await region(page, "context-bar")
        .locator("[data-tool-option]")
        .evaluateAll((items) => items.map((item) => item.getAttribute("data-tool-option")));
    expect(options).toEqual(["size", "shape", "radius", "density", "ink", "opacity"]);

    const path = [
        { x: 5, y: 5 },
        { x: 11, y: 6 },
        { x: 17, y: 10 },
        { x: 9, y: 12 },
    ];
    const spray = async () => {
        await moveOver(page, VIEW, path.slice(0, 1));
        await page.mouse.down();
        await moveOver(page, VIEW, path.slice(1));
        await page.mouse.up();
    };
    await spray();
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const sprayed = (await celBytes(page, document.id))!;
    // The core's stroke for that seed, those samples and the default options.
    const image = { width: WIDTH, height: HEIGHT, data: new Uint8ClampedArray(before) };
    const original = { width: WIDTH, height: HEIGHT, data: new Uint8ClampedArray(before) };
    const stroke = new SprayStroke(image, original, {
        brush: createBrush("circle", 1),
        ink: paintInk("simple", MAGENTA, 255),
        radius: 8,
        density: 20,
        seed: SEED,
    });
    stroke.start(path[0]!);
    for (const point of path.slice(1)) stroke.to(point);
    expect(sprayed).toEqual(Array.from(image.data));
    await settle(page);
    await expectImage(page, document, VIEW, sprayed);

    await undo(page);
    expect(await celBytes(page, document.id)).toEqual(before);
    await spray();
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    expect(await celBytes(page, document.id)).toEqual(sprayed);

    // B selects the pencil, and B pressed again keeps it (SE-065 review); Shift+B again keeps
    // the spray.
    await pressToolKey(page, "KeyB", "pencil");
    await pressToolKey(page, "KeyB", "pencil");
    await pressToolKey(page, "KeyB", "pencil");
    await expect(slotButton(page, "pencil")).toHaveAttribute("aria-pressed", "true");
    await pressToolKey(page, "Shift+KeyB", "spray");
    await pressToolKey(page, "Shift+KeyB", "spray");
    expect(errors).toEqual([]);
});

test("the rectangle's variants menu lists the contour and the polygon with their keys; a choice selects one", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await setUp(page);
    const rectangle = slotButton(page, "rectangle");
    await rectangle.click({ button: "right" });
    const menu = page.locator('[role="menu"][data-tool-variants="rectangle"]');
    await expect(menu).toBeVisible();
    const item = (tool: string) => menu.locator(`[data-variant="${tool}"]`);
    await expect(item("rectangle")).toHaveText(/Rectangle\s*U/);
    await expect(item("contour")).toHaveText(/Contour\s*D/);
    await expect(item("polygon")).toHaveText(/Polygon\s*Shift\+D/);
    await settleTimers(page);
    await item("polygon").click();
    await expect(menu).toHaveCount(0);
    expect((await toolsState(page)).selected).toBe("polygon");
    await expect(rectangle).toHaveAttribute("data-tool-variant", "polygon");
    await expect(viewportArea(page)).toBeFocused();
    expect(errors).toEqual([]);
});
