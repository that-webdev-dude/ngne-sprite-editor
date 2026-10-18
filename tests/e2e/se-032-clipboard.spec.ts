import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as PngModule from "../../src/core/png";
import { collectErrors, region } from "./se-006-support";
import { openDocument, openViewportEditor, paint, setView, settle } from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { geometry, viewportArea } from "./se-012-support";
import type { View } from "./se-012-support";
import { setGrids } from "./se-013-support";
import { historyOf, toolsState } from "./se-014-support";
import { celBytes } from "./se-015-support";
import { selectionState, setSelection } from "./se-030-support";

// SE-032: the clipboard in Chrome (SPEC §7.2, §7.8). Ctrl+C copies the selected pixels to the
// editor's own clipboard and, as `image/png`, to the system clipboard; Ctrl+V pastes them as a
// floating selection centred on the viewport. Copied and pasted in the app, the region is
// byte for byte the one copied, translucent pixels included. Through the system clipboard
// alone (the page reloaded, the editor's clipboard gone), opaque pixels are identical. With
// the permission to read the clipboard not granted, the editor's clipboard still works and
// the status bar says why it was used. Chrome grants writing to a page with the focus; the
// tests grant reading through the browser context, or deny it (DevTools protocol) for the
// denied case.

const WIDTH = 16;
const HEIGHT = 10;
const SCALE = 8;
const SOURCE = { x: 2, y: 1, width: 5, height: 4 };

/** Opaque, translucent and transparent pixels; the transparent ones carry a colour. */
function pixels(): number[] {
    const data: number[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const alpha = (x + y) % 3 === 0 ? 255 : (x + y) % 3 === 1 ? 90 : 0;
            data.push((20 + x * 13) & 255, (40 + y * 21) & 255, (x * y * 7) & 255, alpha);
        }
    }
    return data;
}

function rows(rect: typeof SOURCE): string[] {
    return Array.from({ length: HEIGHT }, (_, y) =>
        Array.from({ length: WIDTH }, (_, x) =>
            x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
                ? "#"
                : ".",
        ).join(""),
    );
}

/** The RGBA of every pixel of `rect` in an image of the document's width, row by row. */
function region4(image: readonly number[], rect: typeof SOURCE): number[][] {
    const out: number[][] = [];
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            const from = (y * WIDTH + x) * 4;
            out.push(image.slice(from, from + 4));
        }
    }
    return out;
}

/**
 * Opens a document whose pixel (6.5, 4.25) lies at the centre of the viewport, so a paste
 * lands on the canvas, with the test pixels in its cel unless `empty`. Returns the document
 * and its view.
 */
async function openTestDocument(
    page: Page,
    empty = false,
): Promise<{ document: TestDocument; view: View }> {
    const document = await openDocument(
        page,
        { width: WIDTH, height: HEIGHT },
        { scale: SCALE, originX: 0, originY: 0 },
    );
    // The viewport's size is known once a document shows.
    await settle(page);
    const { device } = await geometry(page);
    const view: View = {
        scale: SCALE,
        originX: Math.round(device.width / 2 - 6.5 * SCALE),
        originY: Math.round(device.height / 2 - 4.25 * SCALE),
    };
    await setView(page, document.id, view);
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    if (!empty) await paint(page, document.id, pixels());
    await settle(page);
    return { document, view };
}

/** Opens the app and the test document. */
async function setUp(page: Page): Promise<{ document: TestDocument; view: View }> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openViewportEditor(page);
    return openTestDocument(page);
}

/** Where a pasted image of `width` × `height` goes: its centre on the viewport's centre pixel. */
async function pastedAt(page: Page, view: View, width: number, height: number) {
    const { device } = await geometry(page);
    const centreX = (device.width / 2 - view.originX) / view.scale;
    const centreY = (device.height / 2 - view.originY) / view.scale;
    return {
        x: Math.floor(centreX - width / 2 + 0.5),
        y: Math.floor(centreY - height / 2 + 0.5),
    };
}

function floating(page: Page): Promise<boolean> {
    return page.evaluate(() => window.__ngneTest!.keyContexts.getState().floating);
}

const feedback = (page: Page) =>
    region(page, "status-bar").locator('[data-status="message"][data-kind="feedback"]');

async function pressOnViewport(page: Page, key: string): Promise<void> {
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press(key);
}

/** The PNG image on the system clipboard, decoded with the app's own decoder. */
function systemImage(page: Page): Promise<{ width: number; height: number; data: number[] }> {
    return page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const item = items.find((entry) => entry.types.includes("image/png"));
        if (!item) throw new Error("se-032: no image on the system clipboard");
        const bytes = new Uint8Array(await (await item.getType("image/png")).arrayBuffer());
        const path = "/src/core/png/index.ts";
        const png = (await import(/* @vite-ignore */ path)) as typeof PngModule;
        const image = await png.decodePng(bytes);
        return { width: image.width, height: image.height, data: Array.from(image.data) };
    });
}

/** Copies the source region with Ctrl+C and waits for the editor's clipboard to hold it. */
async function copySource(page: Page, document: TestDocument): Promise<void> {
    await setSelection(page, document.id, rows(SOURCE));
    await pressOnViewport(page, "Control+KeyC");
    await expect
        .poll(() =>
            page.evaluate(async () => {
                const path = "/src/app/selection/clipboard.commands.ts";
                const module = (await import(/* @vite-ignore */ path)) as {
                    editorClipboard: { content: unknown };
                };
                return module.editorClipboard.content !== null;
            }),
        )
        .toBe(true);
}

test("with the permission: Ctrl+C puts the selection on the system clipboard as a PNG; Ctrl+V pastes it centred on the viewport, byte for byte", async ({
    page,
    context,
}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors = collectErrors(page);
    const { document, view } = await setUp(page);
    const before = (await celBytes(page, document.id))!;
    await copySource(page, document);
    await expect(feedback(page)).toHaveCount(0);

    // The system clipboard holds the region as a PNG: identical where it is opaque.
    await expect.poll(async () => (await systemImage(page)).width).toBe(SOURCE.width);
    const system = await systemImage(page);
    expect(system.height).toBe(SOURCE.height);
    const copied = region4(before, SOURCE);
    copied.forEach((rgba, index) => {
        if (rgba[3] === 255) expect(system.data.slice(index * 4, index * 4 + 4)).toEqual(rgba);
        else expect(system.data[index * 4 + 3]).toBe(rgba[3]);
    });

    await pressOnViewport(page, "Control+KeyV");
    await expect.poll(() => floating(page)).toBe(true);
    expect((await toolsState(page)).selected).toBe("move");
    const at = await pastedAt(page, view, SOURCE.width, SOURCE.height);
    expect((await selectionState(page, document.id))?.bounds).toEqual({
        ...at,
        width: SOURCE.width,
        height: SOURCE.height,
    });
    await expect(feedback(page)).toHaveCount(0);
    await pressOnViewport(page, "Enter");
    expect(await floating(page)).toBe(false);
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    // The pasted region is the copied one, translucent and transparent pixels included: the
    // editor recognised its own copy on the system clipboard.
    const after = (await celBytes(page, document.id))!;
    expect(region4(after, { ...SOURCE, ...at })).toEqual(copied);
    expect(errors).toEqual([]);
});

test("copied to the system clipboard and pasted back after a reload (the editor's clipboard gone): opaque pixels are identical", async ({
    page,
    context,
}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors = collectErrors(page);
    const first = await setUp(page);
    const copied = region4((await celBytes(page, first.document.id))!, SOURCE);
    await copySource(page, first.document);
    await expect.poll(async () => (await systemImage(page)).width).toBe(SOURCE.width);

    await page.reload();
    await expect(region(page, "viewport")).toBeVisible();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    // A new document with an empty cel to paste onto.
    const { document, view } = await openTestDocument(page, true);
    expect(await celBytes(page, document.id)).toBeNull();
    await pressOnViewport(page, "Control+KeyV");
    await expect.poll(() => floating(page)).toBe(true);
    const at = await pastedAt(page, view, SOURCE.width, SOURCE.height);
    // A PNG has no shape: the whole rectangle floats.
    expect((await selectionState(page, document.id))?.bounds).toEqual({
        ...at,
        width: SOURCE.width,
        height: SOURCE.height,
    });
    await pressOnViewport(page, "Enter");
    const pasted = region4((await celBytes(page, document.id))!, { ...SOURCE, ...at });
    let opaque = 0;
    copied.forEach((rgba, index) => {
        if (rgba[3] !== 255) return;
        opaque++;
        expect(pasted[index], `pixel ${index}`).toEqual(rgba);
    });
    expect(opaque).toBeGreaterThan(4);
    expect(errors).toEqual([]);
});

test("without the permission to read the clipboard, Ctrl+C and Ctrl+V still work with the editor's clipboard, and the status bar explains", async ({
    page,
    context,
    baseURL,
}) => {
    const errors = collectErrors(page);
    const { document, view } = await setUp(page);
    // Without a grant the permission would be asked for: headless Chrome refuses at once, a
    // headed one (CI) shows a prompt nobody answers. Granting writing alone refuses every
    // other permission of the origin (DevTools `Browser.grantPermissions`), reading included,
    // as a user who said no.
    await context.grantPermissions(["clipboard-write"], { origin: new URL(baseURL!).origin });
    expect(
        await page.evaluate(
            async () =>
                (await navigator.permissions.query({ name: "clipboard-read" as PermissionName }))
                    .state,
        ),
    ).toBe("denied");
    const before = (await celBytes(page, document.id))!;
    await copySource(page, document);

    await pressOnViewport(page, "Control+KeyV");
    await expect(feedback(page)).toHaveText(
        "No access to the system clipboard: pasted from the editor's clipboard",
    );
    await expect.poll(() => floating(page)).toBe(true);
    const at = await pastedAt(page, view, SOURCE.width, SOURCE.height);
    await pressOnViewport(page, "Enter");
    expect(await floating(page)).toBe(false);
    const after = (await celBytes(page, document.id))!;
    expect(region4(after, { ...SOURCE, ...at })).toEqual(region4(before, SOURCE));
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    expect(errors).toEqual([]);
});
