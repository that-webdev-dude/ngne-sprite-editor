import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as CoreModel from "../../src/core/model";
import { boxOf, collectErrors, region } from "./se-006-support";
import { addTextField, closeMenu, menuItem, openMenu, statusBar } from "./se-007-support";
import { dialogButton, field, newSpriteButton, newSpriteDialog, setNumber } from "./se-008-support";
import {
    expectImage,
    hostDeviceSize,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    setView,
    settle,
} from "./se-011-support";
import {
    activeView,
    clientAt,
    cursorField,
    fitButton,
    fittedView,
    geometry,
    pixelAt,
    twoFrames,
    viewAtScale,
    viewportArea,
    wheelBy,
    zoomField,
} from "./se-012-support";
import type { View } from "./se-012-support";

// SE-012: new and opened documents start fitted and centred; the keys 0 to 6, the View menu
// and the status bar's "Fit" navigate the view; the status bar shows zoom and cursor live.

/** A wholly transparent image: the viewport shows the bare checkerboard. */
const transparent = (width: number, height: number) =>
    Array.from({ length: width * height * 4 }, () => 0);

/** The views of the open documents, by document id. */
function views(page: Page): Promise<Record<string, View>> {
    return page.evaluate(() =>
        Object.fromEntries(
            window
                .__ngneTest!.sessions.getState()
                .documents.map((document) => [document.id, { ...document.view }]),
        ),
    );
}

test("a new sprite starts fitted and centred: the largest zoom step that fits", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    // Through the interface: the empty state's button and the New sprite dialog.
    await newSpriteButton(page).click();
    const dialog = newSpriteDialog(page);
    await setNumber(field(dialog, "Width"), 40);
    await setNumber(field(dialog, "Height"), 24);
    await dialogButton(dialog, "Create").click();
    await expect(dialog).toBeHidden();
    await settle(page);

    const size = { width: 40, height: 24 };
    const viewport = await hostDeviceSize(page);
    const view = await activeView(page);
    expect(view).toEqual(fittedView(size, viewport));
    // Not the view a document is created with (1× in the corner): a real step, centred.
    expect(view.scale).toBeGreaterThan(1);
    expect(size.width * view.scale).toBeLessThanOrEqual(viewport.width);
    expect(size.height * view.scale).toBeLessThanOrEqual(viewport.height);
    const right = viewport.width - (view.originX + size.width * view.scale);
    const bottom = viewport.height - (view.originY + size.height * view.scale);
    expect([right - view.originX, bottom - view.originY]).toEqual([0, 0]);
    // The canvas shows the document there: the checkerboard in that rectangle, the workspace
    // around it.
    await expectImage(page, size, view, transparent(size.width, size.height));
    expect(await statusBar(page)).toMatchObject({ size: "40 × 24", zoom: `${view.scale}×` });
    expect(errors).toEqual([]);
});

test("opened documents start fitted, each for its own size; a view that was set is kept", async ({
    page,
}) => {
    await openViewportEditor(page);
    // The first document, read in the task that opens it: no viewport is mounted yet, and the
    // document is fitted already. Nothing the stores hold changes after `open` has returned.
    const { first, atOpen, canvases } = await page.evaluate(() => {
        const hook = window.__ngneTest!;
        const first = hook.openSession({ name: "first", width: 8, height: 8 });
        const document = hook.sessions.getState().documents.find((entry) => entry.id === first);
        return {
            first,
            atOpen: { ...document!.view },
            canvases: globalThis.document.querySelectorAll("[data-viewport] canvas").length,
        };
    });
    expect(canvases).toBe(0);
    await settle(page);
    const viewport = await hostDeviceSize(page);
    expect(atOpen).toEqual(fittedView({ width: 8, height: 8 }, viewport));
    expect(atOpen.scale).toBe(48);
    expect(await activeView(page)).toEqual(atOpen);
    // The size was the region's, measured while no document was open: the element that is
    // measured has the box of the viewport element.
    const probe = page.locator(".viewport-probe");
    await expect(probe).toHaveAttribute("aria-hidden", "true");
    expect(await boxOf(probe)).toEqual(await boxOf(page.locator("[data-viewport-canvas]")));
    expect(
        await probe.evaluate((element) => {
            const style = getComputedStyle(element);
            return [style.visibility, style.pointerEvents, element.childNodes.length];
        }),
    ).toEqual(["hidden", "none", 0]);

    // Documents opened from here on are fitted at once as well.
    const opened = await page.evaluate(() => {
        const hook = window.__ngneTest!;
        const view = (id: string) =>
            hook.sessions.getState().documents.find((entry) => entry.id === id)?.view;
        const wide = hook.openSession({ name: "wide", width: 256, height: 16 });
        const afterOpen = view(wide);
        const large = hook.openSession({ name: "large", width: 1024, height: 1024 });
        return { wide: afterOpen, large: view(large) };
    });
    expect(opened.wide).toEqual(fittedView({ width: 256, height: 16 }, viewport));
    // 1024 pixels do not fit at 1×: an overview step.
    expect(opened.large).toEqual(fittedView({ width: 1024, height: 1024 }, viewport));
    expect(opened.large?.scale).toBeLessThan(1);
    expect(1024 * (opened.large?.scale ?? 1)).toBeLessThanOrEqual(viewport.height);
    await expect(zoomField(page)).toHaveText(`${opened.large?.scale}×`);

    // A view given with the document, or set in the same task or the next step, is kept.
    const kept = await page.evaluate(async () => {
        const path = "/src/core/model/index.ts";
        const core = (await import(/* @vite-ignore */ path)) as typeof CoreModel;
        const sessions = window.__ngneTest!.sessions.getState();
        const given = sessions.open(core.createDocument({ name: "given", width: 16, height: 16 }), {
            view: { scale: 3, originX: 11, originY: 7 },
        });
        const set = window.__ngneTest!.openSession({ name: "set", width: 16, height: 16 });
        sessions.setView(set, { scale: 5, originX: -9, originY: 13 });
        const view = (id: string) =>
            window.__ngneTest!.sessions.getState().documents.find((entry) => entry.id === id)?.view;
        return { given: view(given.id), set: view(set) };
    });
    expect(kept.given).toEqual({ scale: 3, originX: 11, originY: 7 });
    expect(kept.set).toEqual({ scale: 5, originX: -9, originY: 13 });
    const nextStep = await openDocument(
        page,
        { width: 5, height: 3 },
        { scale: 8, originX: 40, originY: 24 },
    );
    await paint(page, nextStep.id, pattern(5, 3, 2));
    await settle(page);
    expect(await activeView(page)).toEqual({ scale: 8, originX: 40, originY: 24 });
    await expectImage(page, nextStep, { scale: 8, originX: 40, originY: 24 }, pattern(5, 3, 2));

    // Nothing was fitted a second time: the first document has the view it was given then.
    expect((await views(page))[first]).toEqual(fittedView({ width: 8, height: 8 }, viewport));
});

test("a view set before the viewport reports its first size is kept, however long that takes", async ({
    page,
}) => {
    await openViewportEditor(page);
    // Open and set the view in one task: the viewport is not even mounted yet.
    const id = await page.evaluate(() => {
        const hook = window.__ngneTest!;
        const id = hook.openSession({ name: "early", width: 5, height: 3 });
        hook.sessions.getState().setView(id, { scale: 6, originX: 30, originY: 18 });
        return id;
    });
    await paint(page, id, pattern(5, 3, 4));
    await settle(page);
    const view = { scale: 6, originX: 30, originY: 18 };
    expect(await activeView(page)).toEqual(view);
    await expectImage(page, { width: 5, height: 3 }, view, pattern(5, 3, 4));
});

test("a resize keeps the view; Fit fits the new size", async ({ page }) => {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: 32, height: 32 });
    await paint(page, document.id, pattern(32, 32, 6));
    await settle(page);
    const before = await hostDeviceSize(page);
    const fitted = await activeView(page);
    expect(fitted).toEqual(fittedView(document, before));

    await page.setViewportSize({ width: 1500, height: 900 });
    await settle(page);
    const after = await hostDeviceSize(page);
    expect(after.width).toBeGreaterThan(before.width);
    // The viewport grew; the document stays where the user left it.
    expect(await activeView(page)).toEqual(fitted);
    await expectImage(page, document, fitted, pattern(32, 32, 6));

    await page.keyboard.press("0");
    const refitted = fittedView(document, after);
    expect(refitted.scale).toBeGreaterThan(fitted.scale);
    await expect.poll(() => activeView(page)).toEqual(refitted);
    await settle(page);
    await expectImage(page, document, refitted, pattern(32, 32, 6));
});

test("keys 1 to 6 zoom to 1×, 2×, 4×, 8×, 16×, 32× and 0 fits, in the canvas context only", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const sprite = await openDocument(page, { width: 32, height: 32 });
    await settle(page);
    const layout = await geometry(page);
    const fitted = await activeView(page);
    const centre = clientAt(layout, {
        x: layout.device.width / 2,
        y: layout.device.height / 2,
    });
    const middle = pixelAt(layout, fitted, centre);
    expect(middle).toEqual({ x: 16, y: 16 });

    // With the viewport focused.
    await viewportArea(page).focus();
    for (const [key, scale] of [
        ["4", 8],
        ["1", 1],
        ["6", 32],
        ["2", 2],
        ["5", 16],
        ["3", 4],
    ] as const) {
        await page.keyboard.press(key);
        const view = await viewAtScale(page, scale);
        // Without a cursor the zoom is about the centre of the viewport.
        expect(pixelAt(layout, view, centre), `key ${key}`).toEqual(middle);
        await expect(zoomField(page)).toHaveText(`${scale}×`);
    }
    await setView(page, sprite.id, { scale: 4, originX: -50, originY: 300 });
    await page.keyboard.press("0");
    await expect.poll(() => activeView(page)).toEqual(fitted);

    // On a control that is no text field, and with nothing focused: still the canvas context.
    const control = region(page, "dock").getByRole("button").first();
    await control.focus();
    await expect(control).toBeFocused();
    await page.keyboard.press("2");
    await viewAtScale(page, 2);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("3");
    await viewAtScale(page, 4);

    // In a text field a digit is text.
    const text = await addTextField(page, "context-bar");
    await text.focus();
    await page.keyboard.press("6");
    await page.keyboard.press("0");
    await expect(text).toHaveValue("60");
    await twoFrames(page);
    expect((await activeView(page)).scale).toBe(4);
    expect(errors).toEqual([]);
});

test("the View menu zooms in and out, fits and shows 100%", async ({ page }) => {
    await openViewportEditor(page);
    const ITEMS = ["view.zoomIn", "view.zoomOut", "view.fit", "view.zoom100"];

    // No document: the items are there, disabled.
    await openMenu(page, "View");
    for (const id of ITEMS) {
        await expect(menuItem(page, id)).toHaveAttribute("aria-disabled", "true");
    }
    await closeMenu(page);

    const document = await openDocument(page, { width: 32, height: 32 });
    await settle(page);
    const fitted = await activeView(page);
    expect(fitted.scale).toBe(12);

    const menu = await openMenu(page, "View");
    const titles = await menu.getByRole("menuitem").allTextContents();
    // The first group of the menu, with the keys of SPEC §7.8 beside Fit and 100%.
    expect(titles.slice(0, 4)).toEqual(["Zoom In", "Zoom Out", "Fit0", "100%1"]);
    for (const id of ITEMS) {
        await expect(menuItem(page, id)).not.toHaveAttribute("aria-disabled", "true");
    }
    await menuItem(page, "view.zoomIn").click();
    await viewAtScale(page, 16);

    const choose = async (id: string) => {
        await openMenu(page, "View");
        await menuItem(page, id).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
    };
    await choose("view.zoomOut");
    await viewAtScale(page, 12);
    await choose("view.zoomOut");
    await viewAtScale(page, 10);
    await choose("view.zoom100");
    await viewAtScale(page, 1);
    await choose("view.fit");
    await expect.poll(() => activeView(page)).toEqual(fitted);

    // At the largest step there is nothing to zoom in to; at the smallest, nothing out.
    await setView(page, document.id, { scale: 64, originX: 0, originY: 0 });
    await openMenu(page, "View");
    await expect(menuItem(page, "view.zoomIn")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "view.zoomOut")).not.toHaveAttribute("aria-disabled", "true");
    await closeMenu(page);
    await setView(page, document.id, { scale: 0.125, originX: 100, originY: 100 });
    await openMenu(page, "View");
    await expect(menuItem(page, "view.zoomIn")).not.toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "view.zoomOut")).toHaveAttribute("aria-disabled", "true");
    await closeMenu(page);
});

test('the status bar shows document size and zoom live, with "Fit" beside the zoom readout', async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    // No document: neither a readout nor the button.
    await expect(zoomField(page)).toHaveCount(0);
    await expect(fitButton(page)).toHaveCount(0);

    const document = await openDocument(page, { width: 48, height: 20 });
    await settle(page);
    const fitted = await activeView(page);
    expect(await statusBar(page)).toMatchObject({ size: "48 × 20", zoom: `${fitted.scale}×` });

    // The readout follows every change of the zoom: keys, wheel, store.
    await page.keyboard.press("3");
    await expect(zoomField(page)).toHaveText("4×");
    const layout = await geometry(page);
    const centre = clientAt(layout, {
        x: Math.floor(layout.device.width / 2),
        y: Math.floor(layout.device.height / 2),
    });
    await page.mouse.move(centre.x, centre.y);
    await wheelBy(page, 0, 100);
    await expect(zoomField(page)).toHaveText("3×");
    await setView(page, document.id, { scale: 0.5, originX: 300, originY: 200 });
    await expect(zoomField(page)).toHaveText("0.5×");

    // "Fit" follows the zoom readout (DESIGN §6) and fits.
    const bar = region(page, "status-bar");
    const order = await bar.evaluate((element) =>
        Array.from(
            element.children,
            (child) =>
                child.getAttribute("data-status") ?? child.getAttribute("data-status-action"),
        ),
    );
    expect(order.slice(0, 3)).toEqual(["size", "zoom", "fit"]);
    const button = fitButton(page);
    await expect(button).toBeEnabled();
    const box = await boxOf(button);
    const barBox = await boxOf(bar);
    // A pointer target of 24 px (DESIGN §8), inside the bar, close to the readout.
    expect(box.height).toBe(24);
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.y).toBe(barBox.y);
    expect(barBox.height).toBe(24);
    const zoomBox = await boxOf(zoomField(page));
    expect(box.x - (zoomBox.x + zoomBox.width)).toBeLessThanOrEqual(8);
    expect(box.x).toBeGreaterThanOrEqual(zoomBox.x + zoomBox.width);

    await button.click();
    await expect.poll(() => activeView(page)).toEqual(fitted);
    await expect(zoomField(page)).toHaveText(`${fitted.scale}×`);
    // From the keyboard as well.
    await page.keyboard.press("1");
    await viewAtScale(page, 1);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => activeView(page)).toEqual(fitted);
    expect(errors).toEqual([]);
});

test("the cursor readout follows the view under a resting pointer, and pointer movement draws nothing", async ({
    page,
}) => {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: 32, height: 32 });
    await paint(page, document.id, pattern(32, 32, 7));
    await settle(page);
    const layout = await geometry(page);
    const view = { scale: 8, originX: 200, originY: 80 };
    await setView(page, document.id, view);
    await settle(page);
    const field = cursorField(page);

    // Device (300, 180): document pixel 12, 12.
    const pointer = clientAt(layout, { x: 300, y: 180 });
    await page.mouse.move(pointer.x, pointer.y);
    await expect(field).toHaveText("12, 12");

    // The pointer rests; the view moves under it.
    await page.keyboard.down("Shift");
    await wheelBy(page, 0, 48);
    await page.keyboard.up("Shift");
    await expect
        .poll(() => activeView(page))
        .toEqual({ ...view, originX: 200 - Math.round(48 * layout.ratio) });
    await expect(field).toHaveText("18, 12");
    await setView(page, document.id, { scale: 8, originX: 200, originY: 20 });
    await expect(field).toHaveText("12, 20");
    // A key zooms about the centre of the viewport, not about the pointer.
    await page.keyboard.press("5");
    const zoomed = await viewAtScale(page, 16);
    const under = pixelAt(layout, zoomed, pointer);
    await expect(field).toHaveText(`${under.x}, ${under.y}`);
    // The document moved away from under the pointer: no readout.
    await setView(page, document.id, { scale: 1, originX: 0, originY: 0 });
    await expect(field).toHaveCount(0);
    await setView(page, document.id, view);
    await expect(field).toHaveText("12, 12");

    // Moving the pointer changes the readout and nothing on the canvas: no frame is drawn.
    await settle(page);
    await twoFrames(page);
    const frames = () => page.evaluate(() => window.__ngneTest!.viewport!.submittedFrames);
    const before = await frames();
    for (let step = 1; step <= 12; step++) {
        const at = clientAt(layout, { x: 300 + step * 9, y: 180 + step * 5 });
        await page.mouse.move(at.x, at.y);
    }
    await expect(field).toHaveText("26, 20");
    await twoFrames(page);
    expect(await frames()).toBe(before);
});
