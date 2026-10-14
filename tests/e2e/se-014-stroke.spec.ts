import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, region } from "./se-006-support";
import {
    captures,
    documentRect,
    expectImage,
    framesUntil,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
    shows,
} from "./se-011-support";
import type { FrameTimes, TestDocument } from "./se-011-support";
import { geometry, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import {
    expectFeedback,
    historyOf,
    selectTool,
    setLayerFlag,
    texelClient,
    toolsState,
    withTexels,
} from "./se-014-support";

// SE-014: strokes of the development "dot" tool through the pointer pipeline, as the user
// makes them: a stroke shows in the viewport while the button is held, is one undo step after
// the release, goes on outside the canvas, and is refused on a locked layer.

const WIDTH = 12;
const HEIGHT = 8;
const VIEW: View = { scale: 8, originX: 64, originY: 40 };
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

interface Painted {
    document: TestDocument;
    before: number[];
}

/** A painted document at `VIEW` with the dot tool selected and the viewport at rest. */
async function openPainted(page: Page): Promise<Painted> {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    const before = pattern(WIDTH, HEIGHT, 1);
    await paint(page, document.id, before);
    await selectTool(page, "dot");
    await settle(page);
    await expectImage(page, document, VIEW, before);
    return { document, before };
}

/** Moves the mouse onto the centre of each texel in turn (one move each). */
async function moveOver(page: Page, texels: readonly Point[]): Promise<void> {
    const layout = await geometry(page);
    for (const texel of texels) {
        const client = texelClient(layout, VIEW, texel);
        await page.mouse.move(client.x, client.y);
    }
}

test("a stroke shows in the viewport while the button is held; after the release, undo removes it within two animation frames @alone", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await openPainted(page);
    const path = [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 3 },
        { x: 5, y: 3 },
        { x: 6, y: 4 },
    ];
    const stroked = withTexels(before, WIDTH, path, BLACK);

    await moveOver(page, path.slice(0, 1));
    await page.mouse.down();
    await moveOver(page, path.slice(1));
    // Held: the stroke is on screen, and still an open transaction, not an entry.
    expect(await toolsState(page)).toMatchObject({ active: "dot", stroking: true });
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
    await settle(page);
    await expectImage(page, document, VIEW, stroked);

    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    await settle(page);
    await expectImage(page, document, VIEW, stroked);

    // Undo, through the registered command, at the start of an animation frame.
    const rect = documentRect(document, VIEW);
    const times: FrameTimes = await page.evaluate((rect) => {
        const undo = window.__ngneTest!.commands.get("edit.undo")!;
        window.__se011.record(rect);
        return window.__se011.atFrameStart(() => void undo.run(), 12);
    }, rect);
    const frames = (await captures(page)).filter((capture) => capture.stamp > times.start);
    const seen = frames.map((capture) => shows(capture.crop, [before, stroked], WIDTH, VIEW.scale));
    // Never anything but the stroke or the image before it, each in full.
    expect(seen).not.toContain(-1);
    const at = seen.indexOf(0);
    expect(at).toBeGreaterThanOrEqual(0);
    const undoFrames = framesUntil(times, frames[at]?.stamp ?? Infinity);
    expect(undoFrames).toBeGreaterThanOrEqual(1);
    expect(undoFrames).toBeLessThanOrEqual(2);
    await settle(page);
    await expectImage(page, document, VIEW, before);
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    expect(errors).toEqual([]);
});

test("with the active layer locked through the store, a stroke changes no pixel and the status bar says so", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await openPainted(page);
    await setLayerFlag(page, document.id, "locked", true);

    await moveOver(page, [{ x: 3, y: 3 }]);
    await page.mouse.down();
    await moveOver(page, [
        { x: 4, y: 3 },
        { x: 5, y: 4 },
    ]);
    expect((await toolsState(page)).stroking).toBe(false);
    await page.mouse.up();
    await expectFeedback(page, "Layer is locked");
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    await settle(page);
    await expectImage(page, document, VIEW, before);

    // A hidden layer is refused as well; unlocked and shown, the stroke paints.
    await setLayerFlag(page, document.id, "locked", false);
    await setLayerFlag(page, document.id, "visible", false);
    await page.mouse.down();
    await page.mouse.up();
    await expectFeedback(page, "Layer is hidden");
    await setLayerFlag(page, document.id, "visible", true);
    await page.mouse.down();
    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    await expect(region(page, "status-bar").locator('[data-status="message"]')).toHaveCount(0);
    await settle(page);
    await expectImage(page, document, VIEW, withTexels(before, WIDTH, [{ x: 5, y: 4 }], BLACK));
    expect(errors).toEqual([]);
});

test("a stroke that leaves the canvas and comes back while the button is held continues", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await openPainted(page);
    const dock = await region(page, "dock").boundingBox();
    if (!dock) throw new Error("no dock");

    await moveOver(page, [{ x: 10, y: 2 }]);
    await page.mouse.down();
    await moveOver(page, [{ x: 11, y: 2 }]);
    // Out of the viewport element altogether, over the dock, and back in.
    await page.mouse.move(dock.x + 40, dock.y + 100);
    await page.mouse.move(dock.x + 60, dock.y + 160);
    expect((await toolsState(page)).stroking).toBe(true);
    await moveOver(page, [
        { x: 11, y: 5 },
        { x: 9, y: 5 },
    ]);
    await page.mouse.up();

    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const painted = [
        { x: 10, y: 2 },
        { x: 11, y: 2 },
        { x: 11, y: 5 },
        { x: 9, y: 5 },
    ];
    await settle(page);
    await expectImage(page, document, VIEW, withTexels(before, WIDTH, painted, BLACK));
    expect(errors).toEqual([]);
});

test("Escape during a stroke puts the pixels back and records nothing", async ({ page }) => {
    const errors = collectErrors(page);
    const { document, before } = await openPainted(page);
    await moveOver(page, [{ x: 1, y: 1 }]);
    await page.mouse.down();
    await moveOver(page, [
        { x: 2, y: 1 },
        { x: 3, y: 1 },
    ]);
    await settle(page);
    await expectImage(
        page,
        document,
        VIEW,
        withTexels(
            before,
            WIDTH,
            [
                { x: 1, y: 1 },
                { x: 2, y: 1 },
                { x: 3, y: 1 },
            ],
            BLACK,
        ),
    );
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Escape");
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    // The rest of the drag does nothing.
    await moveOver(page, [{ x: 4, y: 1 }]);
    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    await settle(page);
    await expectImage(page, document, VIEW, before);
    expect(errors).toEqual([]);
});

test("the right button paints the background colour, and the canvas has no context menu", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, before } = await openPainted(page);
    await page.evaluate(() => {
        const seen: boolean[] = [];
        (window as unknown as { __se014Menus: boolean[] }).__se014Menus = seen;
        // After the viewport's own listener: whether the menu's default was cancelled.
        window.addEventListener("contextmenu", (event) => void seen.push(event.defaultPrevented));
    });
    await moveOver(page, [{ x: 7, y: 6 }]);
    await page.mouse.down({ button: "right" });
    await moveOver(page, [{ x: 8, y: 6 }]);
    await page.mouse.up({ button: "right" });
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    const menus = await page.evaluate(
        () => (window as unknown as { __se014Menus: boolean[] }).__se014Menus,
    );
    expect(menus.length).toBeGreaterThan(0);
    expect(menus.every(Boolean)).toBe(true);
    await settle(page);
    await expectImage(
        page,
        document,
        VIEW,
        withTexels(
            before,
            WIDTH,
            [
                { x: 7, y: 6 },
                { x: 8, y: 6 },
            ],
            WHITE,
        ),
    );
    expect(errors).toEqual([]);
});
