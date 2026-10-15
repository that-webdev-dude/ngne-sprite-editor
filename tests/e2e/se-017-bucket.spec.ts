import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, region } from "./se-006-support";
import {
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    setView,
    settle,
} from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { clientAt, geometry, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { expectFeedback, historyOf, toolsState } from "./se-014-support";
import { celBytes, setColours, setToolOptions } from "./se-015-support";
import { contextMenus, recordContextMenus } from "./se-016-support";
import { changedTexels, moveOver, rectangleTexels, rowMajor } from "./se-017-support";
import { setSelection } from "./se-030-support";

// SE-017: the paint bucket as the user works with it. G selects it; a click fills the area of
// the pixel under the pointer — one undo step, which undo takes back — and NGNE shows it; the
// right button fills with the background colour and opens no menu; Contiguous and Tolerance
// from the context bar; a selection keeps the fill inside it; below 1× the click is refused;
// a fill that changes nothing records nothing.

const WIDTH = 24;
const HEIGHT = 16;
const VIEW: View = { scale: 8, originX: 64, originY: 40 };
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

/** A black outline (3, 2)–(12, 9) on white, and a second one (16, 4)–(21, 11). */
function framed(): number[] {
    const outline = new Set(
        [
            ...rectangleTexels({ x: 3, y: 2 }, { x: 12, y: 9 }),
            ...rectangleTexels({ x: 16, y: 4 }, { x: 21, y: 11 }),
        ].map(({ x, y }) => `${x},${y}`),
    );
    const pixels: number[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) pixels.push(...(outline.has(`${x},${y}`) ? BLACK : WHITE));
    }
    return pixels;
}

/** The inside of the first outline. */
const INSIDE = rectangleTexels({ x: 4, y: 3 }, { x: 11, y: 8 }, true);

async function setUp(page: Page): Promise<{ document: TestDocument; before: number[] }> {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await paint(page, document.id, framed());
    await setColours(page, 0xff00ffff, 0x00ff00ff);
    await settle(page);
    return { document, before: (await celBytes(page, document.id))! };
}

async function click(page: Page, texel: Point, button: "left" | "right" = "left"): Promise<void> {
    await moveOver(page, VIEW, [texel]);
    await page.mouse.down({ button });
    await page.mouse.up({ button });
}

test("G selects the bucket; a click fills the area inside an outline, one undo step that undo takes back", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await viewportArea(page).focus();
    await page.keyboard.press("KeyG");
    await expect.poll(async () => (await toolsState(page)).selected).toBe("bucket");
    await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText(
        "Paint bucket",
    );
    // A crosshair names the pixel the fill starts from.
    expect((await toolsState(page)).cursor).toBe("crosshair");

    await click(page, { x: 7, y: 5 });
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const after = (await celBytes(page, document.id))!;
    expect(changedTexels(before, after, WIDTH)).toEqual(INSIDE);
    for (const { x, y } of INSIDE) {
        expect(after.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)).toEqual([
            255, 0, 255, 255,
        ]);
    }
    await settle(page);
    await expectImage(page, document, VIEW, after);

    await page.evaluate(() => window.__ngneTest!.commands.get("edit.undo")!.run());
    expect(await celBytes(page, document.id)).toEqual(before);
    await settle(page);
    await expectImage(page, document, VIEW, before);
    expect(errors).toEqual([]);
});

test("the right button fills with the background colour, and no context menu opens", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await page.evaluate(() => window.__ngneTest!.editor.getState().setTool("bucket"));
    await recordContextMenus(page);
    await click(page, { x: 18, y: 7 }, "right");
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const after = (await celBytes(page, document.id))!;
    const inside = rectangleTexels({ x: 17, y: 5 }, { x: 20, y: 10 }, true);
    expect(changedTexels(before, after, WIDTH)).toEqual(inside);
    expect(after.slice((7 * WIDTH + 18) * 4, (7 * WIDTH + 18) * 4 + 4)).toEqual([0, 255, 0, 255]);
    // Chrome sends the menu at the press (Linux) or at the release (Windows): either way it
    // was cancelled.
    await expect.poll(async () => (await contextMenus(page)).length).toBeGreaterThan(0);
    expect((await contextMenus(page)).every((menu) => menu.prevented)).toBe(true);
    await settle(page);
    await expectImage(page, document, VIEW, after);
    expect(errors).toEqual([]);
});

test("Contiguous off and a tolerance set in the context bar: every near colour is filled", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    // Two texels off white by 3 and by 9, in the two outlines.
    const near = [...before];
    near.splice((5 * WIDTH + 6) * 4, 4, 252, 255, 255, 255);
    near.splice((7 * WIDTH + 18) * 4, 4, 246, 255, 255, 255);
    await paint(page, document.id, near);
    await viewportArea(page).focus();
    await page.keyboard.press("KeyG");
    const bar = region(page, "context-bar");
    await expect(bar.locator("[data-context-tool]")).toHaveText("Paint bucket");
    // DESIGN §5.2: mode toggles · tolerance · ink · opacity.
    expect(
        await bar
            .locator("[data-tool-option]")
            .evaluateAll((items) => items.map((item) => item.getAttribute("data-tool-option"))),
    ).toEqual(["contiguous", "sample", "tolerance", "ink", "opacity"]);

    const contiguous = bar.getByRole("button", { name: "Contiguous" });
    await expect(contiguous).toHaveAttribute("aria-pressed", "true");
    await contiguous.click();
    await expect(contiguous).toHaveAttribute("aria-pressed", "false");
    const tolerance = bar.getByRole("spinbutton", { name: "Tolerance" });
    await tolerance.click();
    await tolerance.fill("4");
    await page.keyboard.press("Enter");
    await expect(tolerance).toHaveValue("4");

    await click(page, { x: 0, y: 0 });
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    const after = (await celBytes(page, document.id))!;
    // Every white texel and the one off by 3 are filled, wherever they are; not the one off
    // by 9, nor the outlines.
    const expected = [...near];
    for (let index = 0; index < WIDTH * HEIGHT; index++) {
        const pixel = near.slice(index * 4, index * 4 + 4);
        const within = pixel.every((value, channel) => Math.abs(value - WHITE[channel]!) <= 4);
        if (within) expected.splice(index * 4, 4, 255, 0, 255, 255);
    }
    expect(after).toEqual(expected);
    expect(after.slice((7 * WIDTH + 18) * 4, (7 * WIDTH + 18) * 4 + 4)).toEqual([
        246, 255, 255, 255,
    ]);
    await settle(page);
    await expectImage(page, document, VIEW, after);
    expect(errors).toEqual([]);
});

test("with a selection, the fill stays inside it", async ({ page }) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    const isSelected = ({ x, y }: Point) => x >= 6 && x < 18 && y >= 0 && y < 6;
    await setSelection(
        page,
        document.id,
        Array.from({ length: HEIGHT }, (_, y) =>
            Array.from({ length: WIDTH }, (_, x) => (isSelected({ x, y }) ? "#" : ".")).join(""),
        ),
    );
    await page.evaluate(() => window.__ngneTest!.editor.getState().setTool("bucket"));
    await click(page, { x: 8, y: 4 });
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    const after = (await celBytes(page, document.id))!;
    // The part of the outline's inside that is selected; not the white around the outline,
    // which the selection reaches only through the black outline.
    expect(changedTexels(before, after, WIDTH)).toEqual(
        rectangleTexels({ x: 6, y: 3 }, { x: 11, y: 5 }, true),
    );
    await settle(page);
    await expectImage(page, document, VIEW, after);
    expect(errors).toEqual([]);
});

test("below 1× a click is refused with the status-bar message; a fill that changes nothing records nothing", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await setUp(page);
    await page.evaluate(() => window.__ngneTest!.editor.getState().setTool("bucket"));
    await setView(page, document.id, { scale: 0.5, originX: 64, originY: 40 });
    await settle(page);
    // A device pixel inside the outline: texel 8, 6 at ½×.
    const inside = clientAt(await geometry(page), { x: 64 + 4, y: 40 + 3 });
    await page.mouse.click(inside.x, inside.y);
    await expectFeedback(page, "Zoom in to 1× or more to paint");
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });

    await setView(page, document.id, VIEW);
    await settle(page);
    // White into white: nothing changes, nothing is recorded.
    await setColours(page, 0xffffffff, 0x00ff00ff);
    await click(page, { x: 7, y: 5 });
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    expect(await celBytes(page, document.id)).toEqual(before);
    // Sample: Composite gives the same area on this one-layer document.
    await setColours(page, 0xff00ffff, 0x00ff00ff);
    await setToolOptions(page, "bucket", { sample: "composite" });
    await click(page, { x: 7, y: 5 });
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    expect(
        changedTexels(before, (await celBytes(page, document.id))!, WIDTH).sort(rowMajor),
    ).toEqual(INSIDE);
    expect(errors).toEqual([]);
});
