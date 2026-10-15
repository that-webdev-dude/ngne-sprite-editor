import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares the stroke echo's probe on `window.__ngneTest` (SE-015).
import type {} from "../../src/app/tools/strokeEcho.overlay";
import { collectErrors, region } from "./se-006-support";
import {
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
} from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { twoFrames, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlayPixels, overlaySettled, setGrids } from "./se-013-support";
import { historyOf, toolsState } from "./se-014-support";
import { celBytes, setColours, setToolOptions, texelsOf } from "./se-015-support";
import {
    changedTexels,
    ELLIPSE_9X9,
    holdUploads,
    lineTexels,
    moveOver,
    openUploads,
    rectangleTexels,
    rowMajor,
    texelsOfRows,
} from "./se-017-support";
import { setSelection } from "./se-030-support";

// SE-017: the line, rectangle and ellipse tools as the user works with them. Each is selected
// by its key; a drag shows the shape of the pointer's last position while the button is held,
// in the cel and in NGNE's image, and the release keeps exactly what was shown as one undo
// step, which undo takes back byte for byte. Escape leaves the canvas as it was. Each move
// takes the previous shape back, on the stroke echo too. Shift and Ctrl, the context bar's
// options, and a selection that clips the shape.

const WIDTH = 24;
const HEIGHT = 16;
const VIEW: View = { scale: 8, originX: 64, originY: 40 };
const MAGENTA = [255, 0, 255, 255];

async function setUp(page: Page): Promise<{ document: TestDocument; before: number[] }> {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await paint(page, document.id, pattern(WIDTH, HEIGHT, 3));
    await setColours(page, 0xff00ffff, 0xffffffff);
    await settle(page);
    const before = await celBytes(page, document.id);
    if (!before) throw new Error("no cel");
    return { document, before };
}

const CASES = [
    {
        id: "line",
        key: "KeyL",
        label: "Line",
        from: { x: 2, y: 2 },
        to: { x: 20, y: 13 },
        texels: () => lineTexels({ x: 2, y: 2 }, { x: 20, y: 13 }),
    },
    {
        id: "rectangle",
        key: "KeyU",
        label: "Rectangle",
        from: { x: 3, y: 2 },
        to: { x: 18, y: 12 },
        texels: () => rectangleTexels({ x: 3, y: 2 }, { x: 18, y: 12 }),
    },
    {
        id: "ellipse",
        key: "Shift+KeyU",
        label: "Ellipse",
        from: { x: 4, y: 3 },
        to: { x: 12, y: 11 },
        texels: () => texelsOfRows(ELLIPSE_9X9, { x: 4, y: 3 }),
    },
] as const;

for (const shape of CASES) {
    test(`${shape.key.replace("Key", "")} selects the ${shape.id} tool; the shape shown while the button is held is the one the release keeps, one undo step that undo takes back`, async ({
        page,
    }) => {
        const errors = collectErrors(page);
        const { document, before } = await setUp(page);
        await viewportArea(page).focus();
        await page.keyboard.press(shape.key);
        await expect.poll(async () => (await toolsState(page)).selected).toBe(shape.id);
        await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText(
            shape.label,
        );

        // Pressed at the first point, dragged far past the last one and back to it.
        await moveOver(page, VIEW, [shape.from]);
        await page.mouse.down();
        await moveOver(page, VIEW, [{ x: 23, y: 15 }, { x: 1, y: 14 }, shape.to], 3);
        expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
        const held = (await celBytes(page, document.id))!;
        // Only the shape of the pointer's last position.
        expect(texelsOf(held, WIDTH, MAGENTA)).toEqual([...shape.texels()].sort(rowMajor));
        expect(changedTexels(before, held, WIDTH).sort(rowMajor)).toEqual(
            [...shape.texels()].sort(rowMajor),
        );
        await settle(page);
        await expectImage(page, document, VIEW, held);

        await page.mouse.up();
        expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
        const after = (await celBytes(page, document.id))!;
        expect(after).toEqual(held);
        await settle(page);
        await expectImage(page, document, VIEW, after);

        await page.evaluate(() => window.__ngneTest!.commands.get("edit.undo")!.run());
        expect(await celBytes(page, document.id)).toEqual(before);
        await settle(page);
        await expectImage(page, document, VIEW, before);
        await page.evaluate(() => window.__ngneTest!.commands.get("edit.redo")!.run());
        expect(await celBytes(page, document.id)).toEqual(after);
        expect(errors).toEqual([]);
    });
}

test("Escape during a drag leaves the canvas as it was: no entry, NGNE's image unchanged", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await setToolOptions(page, "rectangle", { filled: true });
    await page.evaluate(() => window.__ngneTest!.editor.getState().setTool("rectangle"));
    await moveOver(page, VIEW, [{ x: 2, y: 2 }]);
    await page.mouse.down();
    await moveOver(page, VIEW, [{ x: 15, y: 11 }], 3);
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
    await settle(page);
    // The press gave the viewport the focus: Escape is the canvas's.
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Escape");
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    expect(await celBytes(page, document.id)).toEqual(before);
    await settle(page);
    await expectImage(page, document, VIEW, before);
    expect(errors).toEqual([]);
});

test("each move takes the previous shape back, on the stroke echo as in the cel; NGNE then shows the last shape", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { document, before } = await setUp(page);
    // The overlay shows the echo and the brush cursor alone.
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    await setToolOptions(page, "ellipse", { filled: true });
    await page.evaluate(() => window.__ngneTest!.editor.getState().setTool("ellipse"));
    await overlaySettled(page);

    // NGNE gets no upload while the button is held: the echo alone shows the stroke.
    await holdUploads(page);
    await moveOver(page, VIEW, [{ x: 1, y: 1 }]);
    await page.mouse.down();
    await moveOver(page, VIEW, [{ x: 22, y: 14 }], 3);
    await page.waitForFunction(() => window.__ngneTest?.overlay?.pending === false);
    await twoFrames(page);
    const big = (await celBytes(page, document.id))!;
    const bigShape = changedTexels(before, big, WIDTH);
    expect(bigShape.length).toBeGreaterThan(200);
    // Back to a small ellipse.
    const last = { x: 6, y: 5 };
    await moveOver(page, VIEW, [last], 3);
    await page.waitForFunction(() => window.__ngneTest?.overlay?.pending === false);
    await twoFrames(page);
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
    const small = (await celBytes(page, document.id))!;
    const smallShape = changedTexels(before, small, WIDTH);
    expect(smallShape.length).toBeGreaterThan(10);
    expect(smallShape.length).toBeLessThan(bigShape.length / 4);

    // The middle device pixel of each texel on the overlay, but the brush cursor's: the
    // small ellipse in magenta; every other texel clear or as it was, never magenta. The
    // texels of the big ellipse the small one leaves were echoed again, as they were.
    const texels: Point[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (Math.max(Math.abs(x - last.x), Math.abs(y - last.y)) > 1) texels.push({ x, y });
        }
    }
    const middles = await overlayPixels(
        page,
        texels.map(({ x, y }) => ({
            x: VIEW.originX + x * VIEW.scale + VIEW.scale / 2,
            y: VIEW.originY + y * VIEW.scale + VIEW.scale / 2,
        })),
    );
    const inSmall = new Set(smallShape.map(({ x, y }) => `${x},${y}`));
    const inBig = new Set(bigShape.map(({ x, y }) => `${x},${y}`));
    const wrong: string[] = [];
    let echoedBack = 0;
    texels.forEach((texel, index) => {
        const shown = middles[index]!;
        const key = `${texel.x},${texel.y}`;
        const at = (texel.y * WIDTH + texel.x) * 4;
        const original = before.slice(at, at + 4).join();
        if (inSmall.has(key)) {
            if (shown.join() !== MAGENTA.join()) wrong.push(`${key} in the shape: ${shown}`);
        } else if (shown[3] !== 0 && shown.join() !== original) {
            wrong.push(`${key} outside the shape: ${shown}`);
        } else if (inBig.has(key) && shown.join() === original) {
            echoedBack++;
        }
    });
    expect(wrong.slice(0, 8)).toEqual([]);
    expect(echoedBack).toBeGreaterThan(100);

    // NGNE draws, the button comes up: the small ellipse is kept, and NGNE shows it.
    await openUploads(page);
    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    expect(await celBytes(page, document.id)).toEqual(small);
    await settle(page);
    await expectImage(page, document, VIEW, small);
    await expect.poll(() => page.evaluate(() => window.__ngneTest!.strokeEcho!.regions)).toBe(0);
    expect(errors).toEqual([]);
});

test("Shift and Ctrl pressed while the button is held: a square from the centre, drawn at once", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await page.evaluate(() => window.__ngneTest!.editor.getState().setTool("rectangle"));
    const centre = { x: 11, y: 8 };
    await moveOver(page, VIEW, [centre]);
    await page.mouse.down();
    await moveOver(page, VIEW, [{ x: 16, y: 10 }], 3);
    await expect
        .poll(async () => texelsOf((await celBytes(page, document.id))!, WIDTH, MAGENTA))
        .toEqual(rectangleTexels(centre, { x: 16, y: 10 }).sort(rowMajor));
    // Shift with no pointer move: a square towards the pointer, as large as the larger side.
    await page.keyboard.down("Shift");
    await expect
        .poll(async () => texelsOf((await celBytes(page, document.id))!, WIDTH, MAGENTA))
        .toEqual(rectangleTexels(centre, { x: 16, y: 13 }).sort(rowMajor));
    // Ctrl as well: from the centre.
    await page.keyboard.down("Control");
    await expect
        .poll(async () => texelsOf((await celBytes(page, document.id))!, WIDTH, MAGENTA))
        .toEqual(rectangleTexels({ x: 6, y: 3 }, { x: 16, y: 13 }).sort(rowMajor));
    await page.mouse.up();
    await page.keyboard.up("Control");
    await page.keyboard.up("Shift");
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const after = (await celBytes(page, document.id))!;
    expect(changedTexels(before, after, WIDTH).sort(rowMajor)).toEqual(
        rectangleTexels({ x: 6, y: 3 }, { x: 16, y: 13 }).sort(rowMajor),
    );
    await settle(page);
    await expectImage(page, document, VIEW, after);
    expect(errors).toEqual([]);
});

test("the context bar shows the rectangle's options in order; Filled set there fills it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await viewportArea(page).focus();
    await page.keyboard.press("KeyU");
    const bar = region(page, "context-bar");
    await expect(bar.locator("[data-context-tool]")).toHaveText("Rectangle");
    const options = () =>
        bar
            .locator("[data-tool-option]")
            .evaluateAll((items) => items.map((item) => item.getAttribute("data-tool-option")));
    // DESIGN §5.2: size · shape · mode toggles · ink · opacity.
    expect(await options()).toEqual(["size", "shape", "filled", "ink", "opacity"]);

    const filled = bar.getByRole("button", { name: "Filled" });
    await filled.click();
    await expect(filled).toHaveAttribute("aria-pressed", "true");
    // A toggle activated with the pointer gives the focus back to the viewport (SE-014).
    await expect(viewportArea(page)).toBeFocused();
    await moveOver(page, VIEW, [{ x: 4, y: 3 }]);
    await page.mouse.down();
    await moveOver(page, VIEW, [{ x: 12, y: 9 }], 3);
    await page.mouse.up();
    const after = (await celBytes(page, document.id))!;
    expect(changedTexels(before, after, WIDTH).sort(rowMajor)).toEqual(
        rectangleTexels({ x: 4, y: 3 }, { x: 12, y: 9 }, true),
    );
    await settle(page);
    await expectImage(page, document, VIEW, after);

    // The line keeps its own options (SPEC §7.1: options per tool), and has no Filled.
    await page.keyboard.press("KeyL");
    await expect(bar.locator("[data-context-tool]")).toHaveText("Line");
    expect(await options()).toEqual(["size", "shape", "ink", "opacity"]);
    expect(errors).toEqual([]);
});

test("with a selection, a filled rectangle across its edges changes pixels only inside it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    const isSelected = ({ x, y }: Point) => x >= 6 && x < 14 && y >= 4 && y < 10;
    await setSelection(
        page,
        document.id,
        Array.from({ length: HEIGHT }, (_, y) =>
            Array.from({ length: WIDTH }, (_, x) => (isSelected({ x, y }) ? "#" : ".")).join(""),
        ),
    );
    await setToolOptions(page, "rectangle", { filled: true });
    await page.evaluate(() => window.__ngneTest!.editor.getState().setTool("rectangle"));
    await settle(page);
    await moveOver(page, VIEW, [{ x: 2, y: 2 }]);
    await page.mouse.down();
    await moveOver(page, VIEW, [{ x: 20, y: 13 }], 3);
    const held = (await celBytes(page, document.id))!;
    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    const after = (await celBytes(page, document.id))!;
    expect(after).toEqual(held);
    // Exactly the selection changed: the rectangle covers all of it.
    const changed = changedTexels(before, after, WIDTH);
    expect(changed).toEqual(rectangleTexels({ x: 6, y: 4 }, { x: 13, y: 9 }, true));
    expect(changed.every(isSelected)).toBe(true);
    await settle(page);
    await expectImage(page, document, VIEW, after);
    expect(errors).toEqual([]);
});
