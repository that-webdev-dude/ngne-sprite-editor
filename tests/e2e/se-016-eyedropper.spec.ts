import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as CompositesModule from "../../src/app/state/composites";
import { collectErrors, region } from "./se-006-support";
import { openDocument, openViewportEditor, paint, settle, setView } from "./se-011-support";
import { clientAt, geometry, viewportArea } from "./se-012-support";
import type { View } from "./se-012-support";
import { historyOf, railButton, texelClient, toolsState } from "./se-014-support";
import { celBytes, setColours } from "./se-015-support";
import { colourState, contextMenus, recordContextMenus, svField } from "./se-016-support";

// SE-016: the eyedropper as the user works with it: I selects it, a click takes the exact
// RGBA of the pixel under the pointer into the foreground and a right click into the
// background, a transparent pixel gives alpha 0; Alt held over a paint tool makes it the
// active tool anywhere in the `canvas` context; below 1× it still picks.

const WIDTH = 12;
const HEIGHT = 8;
const VIEW: View = { scale: 8, originX: 80, originY: 40 };

/** Known pixels: an opaque pattern on the left, a half-transparent column, then transparent. */
function known(): number[] {
    const pixels: number[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (x < 6) pixels.push(x * 40 + 3, y * 30 + 5, 200 - x * 10 - y, 255);
            else if (x === 6) pixels.push(250, 20, 90, 128);
            else pixels.push(0, 0, 0, 0);
        }
    }
    return pixels;
}

function rgbaOf(pixels: readonly number[], x: number, y: number): number {
    const at = (y * WIDTH + x) * 4;
    return (
        ((pixels[at]! << 24) |
            (pixels[at + 1]! << 16) |
            (pixels[at + 2]! << 8) |
            pixels[at + 3]!) >>>
        0
    );
}

async function openKnown(page: Page) {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    const pixels = known();
    await paint(page, document.id, pixels);
    await settle(page);
    await setColours(page, 0x01020304, 0x05060708);
    return { document, pixels };
}

/** The composite of the active frame at a pixel, as the composite cache holds it. */
function compositeAt(page: Page, x: number, y: number): Promise<number> {
    return page.evaluate(
        async ({ x, y }) => {
            const path = "/src/app/state/composites.ts";
            const module = (await import(/* @vite-ignore */ path)) as typeof CompositesModule;
            const { activeComposites } = module;
            const session = activeComposites.session!;
            const { data, width } = activeComposites.cache!.get(session.activeFrameId);
            const at = (y * width + x) * 4;
            return (
                ((data[at]! << 24) |
                    (data[at + 1]! << 16) |
                    (data[at + 2]! << 8) |
                    data[at + 3]!) >>>
                0
            );
        },
        { x, y },
    );
}

async function clickTexel(
    page: Page,
    texel: { x: number; y: number },
    button: "left" | "right" = "left",
) {
    const layout = await geometry(page);
    const client = texelClient(layout, VIEW, texel);
    await page.mouse.click(client.x, client.y, { button });
}

test("the eyedropper on a known pixel sets the exact RGBA; on a transparent pixel it sets alpha 0", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, pixels } = await openKnown(page);
    await recordContextMenus(page);
    // I selects it, from the viewport.
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("i");
    expect(await toolsState(page)).toMatchObject({ selected: "eyedropper", active: "eyedropper" });
    await expect(railButton(page, "Eyedropper")).toHaveAttribute("aria-pressed", "true");
    await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText(
        "Eyedropper",
    );
    await expect(region(page, "context-bar").locator('[data-tool-option="sample"]')).toBeVisible();

    await clickTexel(page, { x: 3, y: 5 });
    expect((await colourState(page)).foreground).toBe(rgbaOf(pixels, 3, 5));
    // The half-transparent pixel: its RGBA as composited, alpha 128 kept.
    await clickTexel(page, { x: 6, y: 2 });
    const translucent = (await colourState(page)).foreground;
    expect(translucent).toBe(await compositeAt(page, 6, 2));
    expect(translucent).toBe(rgbaOf(pixels, 6, 2));
    expect(translucent & 0xff).toBe(128);
    // A transparent pixel: alpha 0, and nothing else either.
    await clickTexel(page, { x: 9, y: 4 });
    expect((await colourState(page)).foreground).toBe(0x00000000);

    // The right button picks into the background; no menu opens, wherever it comes up.
    await clickTexel(page, { x: 1, y: 1 }, "right");
    expect(await colourState(page)).toMatchObject({
        foreground: 0x00000000,
        background: rgbaOf(pixels, 1, 1),
    });
    await clickTexel(page, { x: 11, y: 7 }, "right");
    expect((await colourState(page)).background).toBe(0x00000000);
    const menus = await contextMenus(page);
    expect(menus.length).toBeGreaterThan(0);
    expect(menus.every((menu) => menu.prevented)).toBe(true);

    // Nothing was painted or recorded.
    expect(await celBytes(page, document.id)).toEqual(pixels);
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    expect(errors).toEqual([]);
});

test("the Active layer option samples the active layer itself, not the layers over it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, pixels } = await openKnown(page);
    // A second layer over the first, opaque red everywhere; the first stays the active one.
    await page.evaluate((id) => {
        const sessions = window.__ngneTest!.sessions.getState();
        const { session } = sessions.documents.find((entry) => entry.id === id)!;
        const { doc } = session;
        const data = new Uint8ClampedArray(doc.width * doc.height * 4);
        for (let at = 0; at < data.length; at += 4) data.set([255, 0, 0, 255], at);
        doc.images.set("se016-red", { width: doc.width, height: doc.height, data });
        doc.layers.push({
            id: "se016-top",
            name: "Top",
            kind: "pixel",
            visible: true,
            locked: false,
            opacity: 255,
            blend: "normal",
        });
        doc.cels.set(`se016-top:${session.activeFrameId}`, { imageId: "se016-red", opacity: 255 });
        sessions.touch(id);
    }, document.id);
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("i");
    await clickTexel(page, { x: 2, y: 2 });
    expect((await colourState(page)).foreground).toBe(0xff0000ff);
    await page.evaluate(() =>
        window.__ngneTest!.editor.getState().setToolOptions("eyedropper", { sample: "layer" }),
    );
    await clickTexel(page, { x: 2, y: 2 });
    expect((await colourState(page)).foreground).toBe(rgbaOf(pixels, 2, 2));
    await clickTexel(page, { x: 10, y: 2 });
    expect((await colourState(page)).foreground).toBe(0x00000000);
    expect(errors).toEqual([]);
});

test("Alt held with the pencil makes the eyedropper active until it is released, with the focus on the viewport or on a dock control", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, pixels } = await openKnown(page);
    expect(await toolsState(page)).toMatchObject({ selected: "pencil", active: "pencil" });

    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.down("Alt");
    await expect.poll(async () => (await toolsState(page)).active).toBe("eyedropper");
    await expect(railButton(page, "Eyedropper")).toHaveAttribute("aria-pressed", "true");
    await expect(railButton(page, "Pencil")).toHaveAttribute("aria-pressed", "false");
    await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText(
        "Eyedropper",
    );
    await clickTexel(page, { x: 4, y: 3 });
    expect((await colourState(page)).foreground).toBe(rgbaOf(pixels, 4, 3));
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await toolsState(page)).active).toBe("pencil");
    expect((await toolsState(page)).selected).toBe("pencil");
    // The eyedropper painted nothing.
    expect(await celBytes(page, document.id)).toEqual(pixels);

    // With the focus on a slider of the colour panel (given by the keyboard, so it keeps
    // it), Alt acts all the same: it acts throughout the canvas context (SPEC §7.8).
    const picked = await colourState(page);
    await svField(page).focus();
    await expect(svField(page)).toBeFocused();
    await page.keyboard.down("Alt");
    await expect.poll(async () => (await toolsState(page)).active).toBe("eyedropper");
    await expect(railButton(page, "Eyedropper")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await toolsState(page)).active).toBe("pencil");
    await expect(svField(page)).toBeFocused();
    expect(await colourState(page)).toEqual(picked);

    // After the release the pencil paints again, with the colour picked.
    await clickTexel(page, { x: 9, y: 6 });
    const bytes = await celBytes(page, document.id);
    const at = (6 * WIDTH + 9) * 4;
    expect(bytes?.slice(at, at + 4)).toEqual(
        pixels.slice((3 * WIDTH + 4) * 4, (3 * WIDTH + 4) * 4 + 4),
    );
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    expect(errors).toEqual([]);
});

test("below 1× the eyedropper still picks: the pixel under the pointer, never a blend", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    // 2 × 2 blocks of one colour each: at 1/2 every device pixel shows one block.
    const size = 64;
    const document = await openDocument(page, { width: size, height: size });
    const pixels: number[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const bx = x >> 1;
            const by = y >> 1;
            pixels.push(bx * 8, by * 8, 255 - bx * 4, (bx + by) % 3 === 0 ? 255 : 160);
        }
    }
    await paint(page, document.id, pixels);
    const view: View = { scale: 0.5, originX: 40, originY: 30 };
    await setView(page, document.id, view);
    await settle(page);
    await setColours(page, 0x01020304, 0x05060708);
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("i");
    const layout = await geometry(page);
    for (const block of [
        { x: 3, y: 7 },
        { x: 20, y: 11 },
        { x: 31, y: 31 },
    ]) {
        // The device pixel of the block, which holds its four texels.
        const client = clientAt(layout, { x: view.originX + block.x, y: view.originY + block.y });
        await page.mouse.click(client.x, client.y);
        const at = (block.y * 2 * size + block.x * 2) * 4;
        const expected =
            ((pixels[at]! << 24) |
                (pixels[at + 1]! << 16) |
                (pixels[at + 2]! << 8) |
                pixels[at + 3]!) >>>
            0;
        expect((await colourState(page)).foreground, `block ${block.x}, ${block.y}`).toBe(expected);
    }
    // No refusal: the status bar shows no feedback.
    await expect(region(page, "status-bar").locator('[data-kind="feedback"]')).toHaveCount(0);
    expect(errors).toEqual([]);
});
