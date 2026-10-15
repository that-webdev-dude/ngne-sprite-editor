import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, region } from "./se-006-support";
import {
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
    setView,
} from "./se-011-support";
import { geometry, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { historyOf, texelClient, toolsState } from "./se-014-support";
import {
    celBytes,
    dragAtSpeed,
    pointerSamples,
    recordPointerSamples,
    setToolOptions,
    texelsOf,
} from "./se-015-support";

// SE-015: the pencil and the eraser as the user works with them: a stroke shows while the
// button is held and is one undo step that undo takes back byte for byte; a fast drag leaves
// no gap; Shift-click draws a line from the end of the last stroke; the right button paints
// the background; the eraser and the context bar's brush options.

const WIDTH = 24;
const HEIGHT = 16;
const VIEW: View = { scale: 8, originX: 64, originY: 40 };
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

/** Moves the mouse onto the centre of each texel in turn (one move each). */
async function moveOver(page: Page, texels: readonly Point[], view = VIEW): Promise<void> {
    const layout = await geometry(page);
    for (const texel of texels) {
        const client = texelClient(layout, view, texel);
        await page.mouse.move(client.x, client.y);
    }
}

/** The texels of the Bresenham line from `a` to `b`, as `core/raster` draws it. */
function line(a: Point, b: Point): Point[] {
    const points: Point[] = [];
    const dx = Math.abs(b.x - a.x);
    const dy = -Math.abs(b.y - a.y);
    const sx = a.x < b.x ? 1 : -1;
    const sy = a.y < b.y ? 1 : -1;
    let error = dx + dy;
    let { x, y } = a;
    for (;;) {
        points.push({ x, y });
        if (x === b.x && y === b.y) return points;
        const doubled = 2 * error;
        if (doubled >= dy) {
            error += dy;
            x += sx;
        }
        if (doubled <= dx) {
            error += dx;
            y += sy;
        }
    }
}

const rowMajor = (a: Point, b: Point) => a.y - b.y || a.x - b.x;

test("a pencil stroke shows while the button is held; it is one undo step, which undo takes back byte for byte", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await paint(page, document.id, pattern(WIDTH, HEIGHT, 3));
    await settle(page);
    // The pencil is the default tool.
    expect(await toolsState(page)).toMatchObject({ selected: "pencil", active: "pencil" });
    await setToolOptions(page, "pencil", { size: 2, shape: "square" });
    const before = await celBytes(page, document.id);
    if (!before) throw new Error("no cel");

    await moveOver(page, [{ x: 2, y: 2 }]);
    await page.mouse.down();
    await moveOver(page, [
        { x: 9, y: 5 },
        { x: 15, y: 12 },
    ]);
    // Held: an open transaction, shown in the viewport as it is.
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
    const held = await celBytes(page, document.id);
    expect(held).not.toEqual(before);
    await settle(page);
    await expectImage(page, document, VIEW, held!);

    await moveOver(page, [{ x: 20, y: 3 }]);
    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const after = await celBytes(page, document.id);
    await settle(page);
    await expectImage(page, document, VIEW, after!);

    await page.evaluate(() => window.__ngneTest!.commands.get("edit.undo")!.run());
    expect(await celBytes(page, document.id)).toEqual(before);
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    await settle(page);
    await expectImage(page, document, VIEW, before);
    await page.evaluate(() => window.__ngneTest!.commands.get("edit.redo")!.run());
    expect(await celBytes(page, document.id)).toEqual(after);
    expect(errors).toEqual([]);
});

test("a scripted diagonal drag across a 64 × 64 canvas at 2000 px/s leaves no gap", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const document = await openDocument(page, { width: 64, height: 64 });
    await settle(page);
    const layout = await geometry(page);
    // The largest zoom at which the whole document fits the viewport, with a margin.
    const scale = [8, 6, 5, 4].find(
        (step) => 64 * step + 40 <= Math.min(layout.device.width, layout.device.height),
    );
    if (!scale) throw new Error(`viewport too small: ${JSON.stringify(layout.device)}`);
    const view: View = { scale, originX: 20, originY: 20 };
    await setView(page, document.id, view);
    await settle(page);
    await recordPointerSamples(page);
    const from = texelClient(layout, view, { x: 0, y: 0 });
    const to = texelClient(layout, view, { x: 63, y: 63 });
    // A mouse that reports at 125 Hz: 16 px between reports, more than a texel.
    const moves = await dragAtSpeed(page, from, to, 2000, 125);
    // A drag, not a jump: however slowly the moves are delivered, several of them.
    expect(moves).toBeGreaterThanOrEqual(3);
    const samples = await pointerSamples(page);
    const gaps = samples.slice(1).map((sample, index) => {
        const previous = samples[index]!;
        return Math.max(Math.abs(sample.x - previous.x), Math.abs(sample.y - previous.y));
    });
    // The samples alone would leave gaps: some lie more than a texel apart.
    expect(Math.max(...gaps)).toBeGreaterThan(scale);

    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    const pixels = await celBytes(page, document.id);
    expect(texelsOf(pixels!, 64, BLACK)).toEqual(
        Array.from({ length: 64 }, (_, index) => ({ x: index, y: index })),
    );
    await settle(page);
    await expectImage(page, document, view, pixels!);
    expect(errors).toEqual([]);
});

test("Shift-click draws a straight line from the end of the last stroke; the right button paints the background", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await settle(page);
    await moveOver(page, [{ x: 2, y: 3 }]);
    await page.mouse.down();
    await page.mouse.up();
    await moveOver(page, [{ x: 18, y: 11 }]);
    await page.keyboard.down("Shift");
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await moveOver(page, [{ x: 21, y: 2 }]);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });

    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    const pixels = await celBytes(page, document.id);
    expect(texelsOf(pixels!, WIDTH, BLACK)).toEqual(
        line({ x: 2, y: 3 }, { x: 18, y: 11 }).sort(rowMajor),
    );
    expect(texelsOf(pixels!, WIDTH, WHITE)).toEqual([{ x: 21, y: 2 }]);
    await settle(page);
    await expectImage(page, document, VIEW, pixels!);
    expect(errors).toEqual([]);
});

test("E selects the eraser: the left button makes pixels transparent, the right erases to the background colour", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    const before = pattern(WIDTH, HEIGHT, 5);
    await paint(page, document.id, before);
    await settle(page);
    await viewportArea(page).focus();
    await page.keyboard.press("KeyE");
    await expect.poll(async () => (await toolsState(page)).selected).toBe("eraser");
    const bar = region(page, "context-bar");
    await expect(bar.locator("[data-context-tool]")).toHaveText("Eraser");

    await moveOver(page, [{ x: 1, y: 1 }]);
    await page.mouse.down();
    await moveOver(page, [{ x: 9, y: 1 }]);
    await page.mouse.up();
    await moveOver(page, [{ x: 1, y: 4 }]);
    await page.mouse.down({ button: "right" });
    await moveOver(page, [{ x: 6, y: 4 }]);
    await page.mouse.up({ button: "right" });

    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    const pixels = await celBytes(page, document.id);
    expect(texelsOf(pixels!, WIDTH, CLEAR)).toEqual(line({ x: 1, y: 1 }, { x: 9, y: 1 }));
    expect(texelsOf(pixels!, WIDTH, WHITE)).toEqual(line({ x: 1, y: 4 }, { x: 6, y: 4 }));
    // Nothing else changed.
    const expected = [...before];
    for (const { x, y } of line({ x: 1, y: 1 }, { x: 9, y: 1 })) {
        expected.splice((y * WIDTH + x) * 4, 4, ...CLEAR);
    }
    for (const { x, y } of line({ x: 1, y: 4 }, { x: 6, y: 4 })) {
        expected.splice((y * WIDTH + x) * 4, 4, ...WHITE);
    }
    expect(pixels).toEqual(expected);
    await settle(page);
    await expectImage(page, document, VIEW, expected);

    // B selects the pencil again.
    await page.keyboard.press("KeyB");
    await expect.poll(async () => (await toolsState(page)).selected).toBe("pencil");
    await expect(bar.locator("[data-context-tool]")).toHaveText("Pencil");
    expect(errors).toEqual([]);
});

test("the context bar shows the brush options in order, and the size and shape set there shape the stroke", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await settle(page);
    const bar = region(page, "context-bar");
    const options = () =>
        bar
            .locator("[data-tool-option]")
            .evaluateAll((items) => items.map((item) => item.getAttribute("data-tool-option")));
    // DESIGN §5.2: size · shape · mode toggles · ink · opacity.
    expect(await options()).toEqual(["size", "shape", "pixelPerfect", "ink", "opacity"]);

    const size = bar.getByRole("spinbutton", { name: "Size" });
    await size.click();
    await size.fill("3");
    await page.keyboard.press("Enter");
    await expect(size).toHaveValue("3");
    const square = bar.getByRole("radio", { name: "Square" });
    await square.click();
    await expect(square).toBeChecked();
    // A segment activated with the pointer gives the focus back to the viewport (SE-014).
    await expect(viewportArea(page)).toBeFocused();

    await moveOver(page, [{ x: 10, y: 7 }]);
    await page.mouse.down();
    await page.mouse.up();
    const pixels = await celBytes(page, document.id);
    const footprint: Point[] = [];
    for (let y = 6; y <= 8; y++) for (let x = 9; x <= 11; x++) footprint.push({ x, y });
    expect(texelsOf(pixels!, WIDTH, BLACK)).toEqual(footprint);

    // The eraser keeps its own values (SPEC §7.1: options per tool), and has no ink.
    await page.keyboard.press("KeyE");
    await expect(bar.locator("[data-context-tool]")).toHaveText("Eraser");
    expect(await options()).toEqual(["size", "shape", "pixelPerfect", "opacity"]);
    await expect(bar.getByRole("spinbutton", { name: "Size" })).toHaveValue("1");
    expect(errors).toEqual([]);
});
