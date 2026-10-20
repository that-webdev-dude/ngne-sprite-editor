import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { menuItem, openMenu } from "./se-007-support";
import { openDocument, openViewportEditor, settle } from "./se-011-support";
import { geometry } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlayPixels, overlaySettled } from "./se-013-support";
import { historyOf, texelClient } from "./se-014-support";
import { celBytes, setColours } from "./se-015-support";
import { activeState } from "./se-041-support";

// SE-062: symmetry as the user works with it, at device pixel ratio 1. The View menu's
// toggles switch each axis of symmetry and of tiled mode on and off, their titles saying what
// choosing them does; the axis shows on the overlay; a pencil stroke is a pixel-exact mirror
// and one undo step; dragging an axis's handle moves the axis by half pixels. None of it is a
// history entry or marks the document unsaved.

const WIDTH = 8;
const HEIGHT = 6;
const VIEW: View = { scale: 16, originX: 64, originY: 64 };
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];
const MAGENTA = [255, 0, 255, 255];

function symmetryOf(page: Page) {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const { symmetry, tiled } = document.session.doc.settings;
        return { ...symmetry, tiled };
    });
}

/** Chooses the View menu's item of `command` with the mouse. */
async function chooseFromView(page: Page, command: string): Promise<void> {
    await openMenu(page, "View");
    await menuItem(page, command).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
}

async function moveOver(page: Page, texels: readonly Point[]): Promise<void> {
    const layout = await geometry(page);
    for (const texel of texels) {
        const client = texelClient(layout, VIEW, texel);
        await page.mouse.move(client.x, client.y);
    }
}

test("the View menu's toggles switch each axis on and off, titled by what choosing them does; no history entry, the document stays clean", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await openMenu(page, "View");
    await expect(menuItem(page, "view.symmetryX")).toHaveText("Turn On Horizontal Symmetry");
    await expect(menuItem(page, "view.symmetryY")).toHaveText("Turn On Vertical Symmetry");
    await expect(menuItem(page, "view.tiledX")).toHaveText("Turn On Tiling in X");
    await expect(menuItem(page, "view.tiledY")).toHaveText("Turn On Tiling in Y");
    await menuItem(page, "view.symmetryX").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await symmetryOf(page)).toMatchObject({ mode: "x", tiled: "none" });

    await chooseFromView(page, "view.symmetryY");
    await chooseFromView(page, "view.tiledY");
    expect(await symmetryOf(page)).toMatchObject({ mode: "both", tiled: "y" });
    expect(await activeState(page)).toMatchObject({ undo: 0, dirty: false });
    await expect(page.locator("[data-unsaved-marker]")).toHaveCount(0);

    await openMenu(page, "View");
    await expect(menuItem(page, "view.symmetryX")).toHaveText("Turn Off Horizontal Symmetry");
    await expect(menuItem(page, "view.tiledY")).toHaveText("Turn Off Tiling in Y");
    await expect(menuItem(page, "view.tiledX")).toHaveText("Turn On Tiling in X");
    await menuItem(page, "view.symmetryX").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await symmetryOf(page)).toMatchObject({ mode: "y", tiled: "y" });
    expect(errors).toEqual([]);
});

test("with horizontal symmetry the axis shows on the overlay and a pencil stroke is a pixel-exact mirror, one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await setColours(page, 0xff00ffff, 0xffffffff);
    await settle(page);
    await chooseFromView(page, "view.symmetryX");
    expect(await symmetryOf(page)).toMatchObject({ mode: "x", axisX: WIDTH });
    await overlaySettled(page);

    // The axis on the canvas's centre line: a white device column with black on each side,
    // and a handle above and below the document.
    const axis = VIEW.originX + (WIDTH / 2) * VIEW.scale;
    const middle = VIEW.originY + 40;
    expect(
        await overlayPixels(page, [
            { x: axis - 1, y: middle },
            { x: axis, y: middle },
            { x: axis + 1, y: middle },
            { x: axis, y: VIEW.originY - 6 },
            { x: axis, y: VIEW.originY + HEIGHT * VIEW.scale + 6 },
            { x: axis - 12, y: VIEW.originY - 6 },
        ]),
    ).toEqual([BLACK, WHITE, BLACK, WHITE, WHITE, [0, 0, 0, 0]]);

    await moveOver(page, [{ x: 1, y: 1 }]);
    await page.mouse.down();
    await moveOver(page, [
        { x: 2, y: 3 },
        { x: 0, y: 5 },
    ]);
    await page.mouse.up();
    const pixels = await celBytes(page, document.id);
    if (!pixels) throw new Error("no cel");
    const at = (x: number, y: number) => pixels.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4);
    expect(at(1, 1)).toEqual(MAGENTA);
    expect(at(WIDTH - 2, 1)).toEqual(MAGENTA);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) expect(at(x, y)).toEqual(at(WIDTH - 1 - x, y));
    }
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    await page.evaluate(() => window.__ngneTest!.commands.get("edit.undo")!.run());
    expect(await celBytes(page, document.id)).toBeNull();
    expect(errors).toEqual([]);
});

test("dragging an axis's handle moves the axis by half pixels; Escape puts it back; no history entry", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await settle(page);
    await chooseFromView(page, "view.symmetryX");
    await chooseFromView(page, "view.symmetryY");
    await overlaySettled(page);
    const layout = await geometry(page);
    const toClient = (x: number, y: number) => ({
        x: layout.left + x / layout.ratio,
        y: layout.top + y / layout.ratio,
    });

    // The vertical axis's handle above the document: 24 device pixels right is 1.5 texels,
    // 3 half pixels.
    const top = toClient(VIEW.originX + (WIDTH / 2) * VIEW.scale, VIEW.originY - 6);
    await page.mouse.move(top.x, top.y);
    await expect
        .poll(() =>
            page
                .locator("[data-viewport]")
                .evaluate((element) =>
                    getComputedStyle(element).getPropertyValue("--shell-tool-cursor").trim(),
                ),
        )
        .toBe("ew-resize");
    await page.mouse.down();
    await page.mouse.move(top.x + 12, top.y + 30);
    await page.mouse.move(top.x + 24, top.y + 30);
    await page.mouse.up();
    expect(await symmetryOf(page)).toMatchObject({ axisX: WIDTH + 3, axisY: HEIGHT });

    // The horizontal axis's handle right of the document, dragged up a texel and taken back.
    const right = toClient(
        VIEW.originX + WIDTH * VIEW.scale + 6,
        VIEW.originY + (HEIGHT / 2) * VIEW.scale,
    );
    await page.mouse.move(right.x, right.y);
    await page.mouse.down();
    await page.mouse.move(right.x, right.y - 16);
    expect(await symmetryOf(page)).toMatchObject({ axisY: HEIGHT - 2 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await symmetryOf(page)).toMatchObject({ axisX: WIDTH + 3, axisY: HEIGHT });

    expect(await historyOf(page, document.id)).toEqual({ undo: 0, open: false });
    expect(await celBytes(page, document.id)).toBeNull();
    expect(await activeState(page)).toMatchObject({ dirty: false });
    expect(errors).toEqual([]);
});
