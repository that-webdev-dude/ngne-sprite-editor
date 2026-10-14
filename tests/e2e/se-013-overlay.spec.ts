import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { boxOf, collectErrors, settleTimers } from "./se-006-support";
import { addTextField, closeMenu, menuItem, openMenu } from "./se-007-support";
import { openDocument, openViewportEditor, settle, viewportHost } from "./se-011-support";
import {
    activeView,
    clientAt,
    fitButton,
    geometry,
    viewAtScale,
    viewportArea,
    wheel,
} from "./se-012-support";
import {
    overlayCanvas,
    overlayPixels,
    overlaySettled,
    overlayState,
    setGrids,
    useTheme,
} from "./se-013-support";

// SE-013: the overlay canvas in the viewport element — where it sits, the focus a pointer
// down gives the viewport element, the events it lets through to view navigation, the grid
// toggles of the View menu and the colours of the theme. Its alignment with the NGNE image is
// checked on the screen by se-013-grid-*; its redraws by se-013-redraw.

/** A document view with the pixel grid (8×) and room around the document. */
const VIEW = { scale: 8, originX: 37, originY: 23 };
const SIZE = { width: 40, height: 24 };

/** Device pixels of the overlay canvas, relative to the document rectangle of `VIEW`. */
const inDocument = (dx: number, dy: number) => ({ x: VIEW.originX + dx, y: VIEW.originY + dy });
/** On a pixel-grid line only: the first device column of texel 1, inside texel row 0. */
const PIXEL_LINE = inDocument(8, 3);
/** On a tile-grid line (the default grid is 16 × 16): the first device column of texel 16. */
const TILE_LINE = inDocument(16 * 8, 3);
/** Inside a texel, on no line. */
const NO_LINE = inDocument(4, 3);
/** The outline, 1 device pixel left of the document. */
const OUTLINE = inDocument(-1, 5);

async function openGridDocument(page: Page) {
    await openViewportEditor(page);
    const document = await openDocument(page, SIZE, VIEW);
    await overlaySettled(page);
    return document;
}

/** Whether a pixel of the overlay holds the ink at the alpha of a grid (8-bit). */
function inkAt(pixel: readonly number[] | undefined, ink: number, alpha: number): boolean {
    if (!pixel) return false;
    const stored = Math.round(alpha * 255);
    return (
        pixel.slice(0, 3).every((channel) => channel === ink) &&
        Math.abs((pixel[3] ?? 0) - stored) <= 1
    );
}

test("the overlay is the second child of the viewport element, a sibling of the element NGNE fills", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openGridDocument(page);
    const structure = await viewportArea(page).evaluate((element) => {
        const [first, second] = Array.from(element.children);
        const overlay = second as HTMLCanvasElement | undefined;
        return {
            first: first?.hasAttribute("data-viewport-canvas"),
            second: overlay?.tagName,
            isOverlay: overlay?.hasAttribute("data-viewport-overlay"),
            // NGNE's element still holds its canvas alone.
            hostChildren: Array.from(first?.children ?? [], (child) => child.tagName),
            // Chrome for the eye only, never focused itself.
            ariaHidden: overlay?.getAttribute("aria-hidden"),
            tabindex: overlay?.getAttribute("tabindex") ?? null,
            pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
            context: overlay?.getContext("2d") !== null,
        };
    });
    expect(structure).toEqual({
        first: true,
        second: "CANVAS",
        isOverlay: true,
        hostChildren: ["CANVAS"],
        ariaHidden: "true",
        tabindex: null,
        pointerEvents: "auto",
        context: true,
    });

    // NGNE replaces its canvas at a resize; the overlay is the same element, at the new size.
    await overlayCanvas(page).evaluate((canvas) => {
        (window as unknown as { __se013Overlay: unknown }).__se013Overlay = canvas;
    });
    await page.setViewportSize({ width: 1400, height: 800 });
    await overlaySettled(page);
    const after = await overlayCanvas(page).evaluate((canvas) => ({
        same: canvas === (window as unknown as { __se013Overlay: unknown }).__se013Overlay,
        size: [(canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height],
        ngne: window.__ngneTest!.viewport!.canvasSize,
    }));
    expect(after.same).toBe(true);
    expect(after.size).toEqual([after.ngne?.width, after.ngne?.height]);
    expect(await boxOf(overlayCanvas(page))).toEqual(await boxOf(viewportHost(page)));
    expect(errors).toEqual([]);
});

test("clicking the viewport makes the viewport element document.activeElement", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openGridDocument(page);
    const area = viewportArea(page);
    const layout = await geometry(page);
    const field = await addTextField(page, "dock");
    const isActive = () => area.evaluate((element) => element === document.activeElement);

    // Over the document and over the workspace beside it, from a text field and from a button.
    const overDocument = clientAt(layout, inDocument(100, 60));
    const overWorkspace = clientAt(layout, {
        x: layout.device.width - 40,
        y: layout.device.height - 40,
    });
    for (const [from, point] of [
        [field, overDocument],
        [fitButton(page), overWorkspace],
    ] as const) {
        await from.focus();
        await expect(from).toBeFocused();
        // The pointer lands on the overlay, not on the NGNE canvas under it.
        expect(
            await page.evaluate(
                ({ x, y }) =>
                    document.elementFromPoint(x, y)?.hasAttribute("data-viewport-overlay"),
                point,
            ),
        ).toBe(true);
        await page.mouse.click(point.x, point.y);
        await expect(area).toBeFocused();
        expect(await isActive()).toBe(true);
    }

    // A tool that cancels the default of its pointer down (as the pointer pipeline may):
    // the browser then sends no `mousedown` and focuses nothing; the overlay still does.
    await page.evaluate(() => {
        const overlay = document.querySelector("[data-viewport-overlay]")!;
        const seen: string[] = [];
        (window as unknown as { __se013Seen: string[] }).__se013Seen = seen;
        overlay.addEventListener("pointerdown", (event) => event.preventDefault());
        overlay.addEventListener("mousedown", () => void seen.push("mousedown"));
    });
    await field.focus();
    await expect(field).toBeFocused();
    await page.mouse.click(overDocument.x, overDocument.y);
    await expect(area).toBeFocused();
    expect(
        await page.evaluate(() => (window as unknown as { __se013Seen: string[] }).__se013Seen),
    ).toEqual([]);

    // The middle button pans and moves no focus (SE-012).
    await field.focus();
    await page.mouse.move(overDocument.x, overDocument.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.up({ button: "middle" });
    await expect(field).toBeFocused();
    expect(errors).toEqual([]);
});

test("the overlay stops neither the wheel nor the middle button: view navigation acts through it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openGridDocument(page);
    const layout = await geometry(page);
    await page.evaluate(() => {
        const targets: string[] = [];
        (window as unknown as { __se013Targets: string[] }).__se013Targets = targets;
        for (const type of ["wheel", "pointerdown", "pointermove", "pointerup"]) {
            window.addEventListener(type, (event) => {
                const target = event.target as Element | null;
                if (target?.hasAttribute("data-viewport-overlay")) targets.push(type);
            });
        }
    });
    const targets = () =>
        page.evaluate(() => (window as unknown as { __se013Targets: string[] }).__se013Targets);

    // The wheel zooms about the cursor, its event aimed at the overlay.
    const point = clientAt(layout, inDocument(100, 60));
    await page.mouse.move(point.x, point.y);
    await wheel(page, 1);
    const zoomed = await viewAtScale(page, 10);
    expect(await targets()).toContain("wheel");

    // A middle-drag pans. Its pointer down is aimed at the overlay; view navigation then
    // captures the pointer on the viewport element, which receives the rest.
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(point.x - 20, point.y + 10);
    await page.mouse.up({ button: "middle" });
    await expect
        .poll(() => activeView(page))
        .toEqual({
            ...zoomed,
            originX: zoomed.originX - Math.round(20 * layout.ratio),
            originY: zoomed.originY + Math.round(10 * layout.ratio),
        });
    expect(await targets()).toEqual(expect.arrayContaining(["wheel", "pointerdown"]));
    expect(errors).toEqual([]);
});

test("Grid and Pixel Grid in the View menu toggle the document's settings, which the overlay shows", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await openGridDocument(page);
    const state = () =>
        page.evaluate((id) => {
            const { documents } = window.__ngneTest!.sessions.getState();
            const entry = documents.find((candidate) => candidate.id === id)!;
            const { settings } = entry.session.doc;
            return {
                grid: settings.grid.visible,
                pixelGrid: settings.pixelGrid,
                position: entry.history.position,
                canUndo: entry.history.canUndo,
                saved: entry.savedPosition,
            };
        }, document.id);
    const shown = async () => {
        await overlaySettled(page);
        const [pixel, tile, none, outline] = await overlayPixels(page, [
            PIXEL_LINE,
            TILE_LINE,
            NO_LINE,
            OUTLINE,
        ]);
        return {
            pixelGrid: inkAt(pixel, 255, 0.12),
            tileGrid: inkAt(tile, 255, 0.25),
            pixelGridUnderTile: inkAt(tile, 255, 0.12),
            empty: none?.join() === "0,0,0,0",
            outline: outline?.join(),
        };
    };
    const choose = async (id: string, title: string) => {
        await openMenu(page, "View");
        await expect(menuItem(page, id)).toHaveText(title);
        await menuItem(page, id).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await settleTimers(page);
    };

    // A new document: pixel grid shown, tile grid hidden (SPEC §5.1 defaults).
    expect(await state()).toEqual({
        grid: false,
        pixelGrid: true,
        position: 0,
        canUndo: false,
        saved: 0,
    });
    expect(await shown()).toEqual({
        pixelGrid: true,
        tileGrid: false,
        pixelGridUnderTile: true,
        empty: true,
        outline: "58,58,64,255",
    });
    const menu = await openMenu(page, "View");
    await expect(menuItem(page, "view.grid")).toHaveText("Show Grid");
    await expect(menuItem(page, "view.pixelGrid")).toHaveText("Hide Pixel Grid");
    for (const id of ["view.grid", "view.pixelGrid"]) {
        await expect(menuItem(page, id)).not.toHaveAttribute("aria-disabled", "true");
    }
    // The menu takes the focus a moment after it opens; Escape is its key only from then on.
    await expect
        .poll(() => menu.evaluate((element) => element.contains(globalThis.document.activeElement)))
        .toBe(true);
    await closeMenu(page);

    await choose("view.pixelGrid", "Hide Pixel Grid");
    expect(await state()).toMatchObject({ grid: false, pixelGrid: false });
    expect(await shown()).toMatchObject({ pixelGrid: false, tileGrid: false, empty: true });

    await choose("view.grid", "Show Grid");
    expect(await state()).toMatchObject({ grid: true, pixelGrid: false });
    expect(await shown()).toMatchObject({ pixelGrid: false, tileGrid: true, empty: true });

    await choose("view.pixelGrid", "Show Pixel Grid");
    expect(await state()).toMatchObject({ grid: true, pixelGrid: true });
    // Where the two grids meet, the tile grid's line shows at its own strength.
    expect(await shown()).toMatchObject({ pixelGrid: true, tileGrid: true, empty: true });

    await choose("view.grid", "Hide Grid");
    expect(await shown()).toMatchObject({
        pixelGrid: true,
        tileGrid: false,
        pixelGridUnderTile: true,
    });

    // View preferences: no history entry, and the document is as saved (SPEC §5.2).
    expect(await state()).toEqual({
        grid: false,
        pixelGrid: true,
        position: 0,
        canUndo: false,
        saved: 0,
    });
    expect(errors).toEqual([]);
});

test("the overlay takes its colours from the theme and redraws when it changes", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await openGridDocument(page);
    await setGrids(page, document.id, { grid: { visible: true } });
    const read = async () => {
        await overlaySettled(page);
        return overlayPixels(page, [PIXEL_LINE, TILE_LINE, OUTLINE]);
    };

    // Dark: white ink, `--border-strong` #3a3a40.
    let [pixel, tile, outline] = await read();
    expect(inkAt(pixel, 255, 0.12)).toBe(true);
    expect(inkAt(tile, 255, 0.25)).toBe(true);
    expect(outline).toEqual([0x3a, 0x3a, 0x40, 255]);

    // Light: black ink, `--border-strong` #b4b4ba.
    const before = (await overlayState(page)).redraws;
    await useTheme(page, "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect.poll(async () => (await overlayState(page)).redraws).toBeGreaterThan(before);
    [pixel, tile, outline] = await read();
    expect(inkAt(pixel, 0, 0.12)).toBe(true);
    expect(inkAt(tile, 0, 0.25)).toBe(true);
    expect(outline).toEqual([0xb4, 0xb4, 0xba, 255]);

    await useTheme(page, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(async () => (await read())[2]).toEqual([0x3a, 0x3a, 0x40, 255]);
    await settle(page);
    expect(errors).toEqual([]);
});
