import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, region } from "./se-006-support";
import { addTextField } from "./se-007-support";
import {
    DARK,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    readback,
    setView,
    settle,
} from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import {
    activeView,
    clientAt,
    geometry,
    MIN_VISIBLE,
    NOTCH,
    pixelAt,
    recordWheels,
    twoFrames,
    viewAtScale,
    viewportArea,
    visible,
    wheel,
    wheelBy,
    wheels,
} from "./se-012-support";
import type { Geometry, Point, View } from "./se-012-support";

// SE-012: view navigation with the pointer — wheel, Ctrl+wheel, Shift+wheel and middle-drag,
// bound by pointer location (SPEC §7.8) — and the pan limits.

/** A 32×32 document, opaque, no texel in the workspace colour; it starts fitted. */
async function openPainted(page: Page, side = 32): Promise<TestDocument> {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: side, height: side });
    await paint(page, document.id, pattern(side, side, 5));
    await settle(page);
    return document;
}

/** A middle-drag between two device positions of the viewport, in a few moves. */
async function middleDrag(page: Page, layout: Geometry, from: Point, to: Point): Promise<void> {
    const start = clientAt(layout, from);
    const end = clientAt(layout, to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up({ button: "middle" });
}

/**
 * The canvas shows the document inside `rect` only: every device pixel of the rectangle is
 * the document's (no texel has the workspace colour), every pixel outside it the workspace.
 */
async function expectDocumentOnlyIn(
    page: Page,
    rect: { x: number; y: number; width: number; height: number },
): Promise<void> {
    await settle(page);
    const result = await readback(page, rect);
    expect(result.outside).toBe(0);
    expect(result.crop.data.length).toBe(rect.width * rect.height * 4);
    let workspace = 0;
    for (let at = 0; at < result.crop.data.length; at += 4) {
        const [r, g, b] = result.crop.data.slice(at, at + 3);
        if (r === DARK.workspace[0] && g === DARK.workspace[1] && b === DARK.workspace[2]) {
            workspace++;
        }
    }
    expect(workspace).toBe(0);
}

test("the document cannot be panned so that fewer than 32 device pixels of it remain visible", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await openPainted(page);
    const layout = await geometry(page);
    const { width, height } = layout.device;
    const fitted = await activeView(page);
    const side = 32 * fitted.scale;
    expect(side).toBeGreaterThan(MIN_VISIBLE);

    const margin = 40;
    const corners = {
        left: margin,
        right: width - margin,
        top: margin,
        bottom: height - margin,
    };
    // Each drag crosses the viewport; three of them are more than the way to the limit and
    // far beyond it.
    const push = async (from: Point, to: Point) => {
        for (let drag = 0; drag < 3; drag++) await middleDrag(page, layout, from, to);
    };

    const cases: { name: string; from: Point; to: Point; expected: View }[] = [
        {
            name: "up and left",
            from: { x: corners.right, y: corners.bottom },
            to: { x: corners.left, y: corners.top },
            expected: { ...fitted, originX: MIN_VISIBLE - side, originY: MIN_VISIBLE - side },
        },
        {
            name: "down and right",
            from: { x: corners.left, y: corners.top },
            to: { x: corners.right, y: corners.bottom },
            expected: { ...fitted, originX: width - MIN_VISIBLE, originY: height - MIN_VISIBLE },
        },
        {
            name: "up and right",
            from: { x: corners.left, y: corners.bottom },
            to: { x: corners.right, y: corners.top },
            expected: { ...fitted, originX: width - MIN_VISIBLE, originY: MIN_VISIBLE - side },
        },
        {
            name: "down and left",
            from: { x: corners.right, y: corners.top },
            to: { x: corners.left, y: corners.bottom },
            expected: { ...fitted, originX: MIN_VISIBLE - side, originY: height - MIN_VISIBLE },
        },
    ];
    for (const { name, from, to, expected } of cases) {
        await setView(page, document.id, fitted);
        await push(from, to);
        await expect.poll(() => activeView(page), name).toEqual(expected);
        // Exactly 32 × 32 device pixels of the document are left in the viewport …
        expect(visible(expected, document, layout.device), name).toEqual({
            width: MIN_VISIBLE,
            height: MIN_VISIBLE,
        });
        // … and that is what the canvas shows: the document in that corner, nothing else.
        await expectDocumentOnlyIn(page, {
            x: Math.max(expected.originX, 0),
            y: Math.max(expected.originY, 0),
            width: MIN_VISIBLE,
            height: MIN_VISIBLE,
        });
        // One more drag the same way moves nothing.
        await middleDrag(page, layout, from, to);
        await twoFrames(page);
        expect(await activeView(page), name).toEqual(expected);
    }
    expect(errors).toEqual([]);
});

test("the pan limits hold for Shift+wheel and for a zoom that pushes the document away", async ({
    page,
}) => {
    const document = await openPainted(page);
    const layout = await geometry(page);
    const { width, height } = layout.device;
    const fitted = await activeView(page);
    const side = 32 * fitted.scale;
    const centre = clientAt(layout, { x: width / 2, y: height / 2 });
    await page.mouse.move(centre.x, centre.y);

    // Shift+wheel, far more than the way to the limit: the document stops 32 pixels in.
    await page.keyboard.down("Shift");
    for (let notch = 0; notch < 40; notch++) await wheelBy(page, 0, NOTCH);
    await expect.poll(() => activeView(page)).toEqual({ ...fitted, originX: MIN_VISIBLE - side });
    for (let notch = 0; notch < 80; notch++) await wheelBy(page, 0, -NOTCH);
    await expect.poll(() => activeView(page)).toEqual({ ...fitted, originX: width - MIN_VISIBLE });
    await page.keyboard.up("Shift");
    expect(visible(await activeView(page), document, layout.device)).toEqual({
        width: MIN_VISIBLE,
        height: side,
    });

    // Down to the bottom limit as well: the document is in the bottom-right corner.
    for (let drag = 0; drag < 3; drag++) {
        await middleDrag(page, layout, { x: 100, y: 40 }, { x: 100, y: height - 40 });
    }
    const cornered = { ...fitted, originX: width - MIN_VISIBLE, originY: height - MIN_VISIBLE };
    await expect.poll(() => activeView(page)).toEqual(cornered);

    // The cursor is in the opposite corner. Zooming in about it pushes the document away,
    // right and down: it stays 32 pixels in at every step.
    const corner = clientAt(layout, { x: 40, y: 40 });
    await page.mouse.move(corner.x, corner.y);
    const larger = [16, 20, 24, 32, 48, 64].filter((step) => step > fitted.scale);
    expect(larger.length).toBeGreaterThan(2);
    for (const scale of larger) {
        await wheel(page, 1);
        const view = await viewAtScale(page, scale);
        expect(view, `at ${scale}×`).toEqual({ ...cornered, scale });
        expect(visible(view, document, layout.device), `at ${scale}×`).toEqual({
            width: MIN_VISIBLE,
            height: MIN_VISIBLE,
        });
    }
    const last = await activeView(page);
    expect(last).toEqual({
        scale: 64,
        originX: width - MIN_VISIBLE,
        originY: height - MIN_VISIBLE,
    });
    await expectDocumentOnlyIn(page, {
        x: last.originX,
        y: last.originY,
        width: MIN_VISIBLE,
        height: MIN_VISIBLE,
    });
});

test("a document smaller than 32 device pixels stays visible in full", async ({ page }) => {
    const document = await openPainted(page, 8);
    const layout = await geometry(page);
    const { width, height } = layout.device;
    // Key 1: 1×, so the document is 8 × 8 device pixels.
    await page.keyboard.press("1");
    await viewAtScale(page, 1);

    const margin = 40;
    for (let drag = 0; drag < 3; drag++) {
        await middleDrag(
            page,
            layout,
            { x: width - margin, y: height - margin },
            { x: margin, y: margin },
        );
    }
    await expect.poll(() => activeView(page)).toEqual({ scale: 1, originX: 0, originY: 0 });
    await expectDocumentOnlyIn(page, { x: 0, y: 0, width: 8, height: 8 });

    for (let drag = 0; drag < 3; drag++) {
        await middleDrag(
            page,
            layout,
            { x: margin, y: margin },
            { x: width - margin, y: height - margin },
        );
    }
    const expected = { scale: 1, originX: width - 8, originY: height - 8 };
    await expect.poll(() => activeView(page)).toEqual(expected);
    expect(visible(expected, document, layout.device)).toEqual({ width: 8, height: 8 });
    await expectDocumentOnlyIn(page, { x: width - 8, y: height - 8, width: 8, height: 8 });
});

test("a middle-drag pans by the pointer's travel, also outside the viewport; other buttons do not pan", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await openPainted(page);
    const layout = await geometry(page);
    const { ratio } = layout;
    const fitted = await activeView(page);
    const area = viewportArea(page);
    await page.evaluate(() => {
        const presses: unknown[] = [];
        (window as unknown as { __se012Presses: unknown[] }).__se012Presses = presses;
        window.addEventListener("mousedown", (event) =>
            presses.push([event.button, event.defaultPrevented]),
        );
    });

    const start = clientAt(layout, { x: 300, y: 200 });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: "middle" });
    await expect(area).toHaveAttribute("data-panning", "");
    expect(await area.evaluate((element) => getComputedStyle(element).cursor)).toBe("grabbing");
    // Pressing alone moves nothing.
    expect(await activeView(page)).toEqual(fitted);

    await page.mouse.move(start.x + 37, start.y - 21);
    const moved = {
        ...fitted,
        originX: fitted.originX + Math.round(37 * ratio),
        originY: fitted.originY + Math.round(-21 * ratio),
    };
    await expect.poll(() => activeView(page)).toEqual(moved);
    // Back to where the drag began: back to the view it began with, nothing lost to rounding.
    await page.mouse.move(start.x + 10.4, start.y + 3.3);
    await page.mouse.move(start.x, start.y);
    await expect.poll(() => activeView(page)).toEqual(fitted);

    // The drag goes on over another region: the timeline, below the viewport.
    const timeline = await region(page, "timeline").boundingBox();
    const outside = { x: start.x + 40, y: (timeline?.y ?? 0) + 30 };
    expect(outside.y).toBeGreaterThan(start.y + 100);
    await page.mouse.move(outside.x, outside.y);
    await expect
        .poll(() => activeView(page))
        .toEqual({
            ...fitted,
            originX: fitted.originX + Math.round(40 * ratio),
            originY: fitted.originY + Math.round((outside.y - start.y) * ratio),
        });
    await page.mouse.up({ button: "middle" });
    await expect(area).not.toHaveAttribute("data-panning");
    const released = await activeView(page);

    // Released: moving the pointer pans no more.
    await page.mouse.move(start.x, start.y);
    await page.mouse.move(start.x + 80, start.y + 80);
    await twoFrames(page);
    expect(await activeView(page)).toEqual(released);

    // The left and the right button do not pan.
    await setView(page, document.id, fitted);
    for (const button of ["left", "right"] as const) {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down({ button });
        await page.mouse.move(start.x + 50, start.y + 30);
        await page.mouse.up({ button });
        await twoFrames(page);
        expect(await activeView(page), button).toEqual(fitted);
        await expect(area).not.toHaveAttribute("data-panning");
    }

    // The middle button's own default (autoscroll) was prevented; the others' was not.
    const presses = await page.evaluate(
        () => (window as unknown as { __se012Presses: [number, boolean][] }).__se012Presses,
    );
    expect(presses).toEqual([
        [1, true],
        [0, false],
        [2, false],
    ]);
    expect(errors).toEqual([]);
});

test("Shift+wheel pans horizontally; the wheel and Ctrl+wheel zoom, and none of them moves the page", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPainted(page);
    const layout = await geometry(page);
    const { ratio } = layout;
    const fitted = await activeView(page);
    // Over the document, off its centre.
    const cursor = clientAt(layout, {
        x: Math.floor(layout.device.width / 2) + 61,
        y: Math.floor(layout.device.height / 2) - 35,
    });
    await page.mouse.move(cursor.x, cursor.y);
    await recordWheels(page);
    const pixel = pixelAt(layout, fitted, cursor);

    // Shift+wheel: one notch down moves the view right, the document left, by the notch.
    await page.keyboard.down("Shift");
    await wheelBy(page, 0, NOTCH);
    const left = { ...fitted, originX: fitted.originX - Math.round(NOTCH * ratio) };
    await expect.poll(() => activeView(page)).toEqual(left);
    await wheelBy(page, 0, -NOTCH);
    await wheelBy(page, 0, -NOTCH);
    await expect
        .poll(() => activeView(page))
        .toEqual({ ...fitted, originX: fitted.originX + Math.round(NOTCH * ratio) });
    // Travel a device reports as horizontal pans the same way.
    await wheelBy(page, NOTCH, 0);
    await expect.poll(() => activeView(page)).toEqual(fitted);
    await page.keyboard.up("Shift");

    // Ctrl+wheel zooms like the wheel: one step, the pixel under the cursor kept.
    const stepUp = fitted.scale === 12 ? 16 : fitted.scale === 16 ? 20 : -1;
    expect(stepUp).toBeGreaterThan(0);
    await page.keyboard.down("Control");
    await wheel(page, 1);
    const zoomed = await viewAtScale(page, stepUp);
    expect(pixelAt(layout, zoomed, cursor)).toEqual(pixel);
    await wheel(page, -1);
    expect(pixelAt(layout, await viewAtScale(page, fitted.scale), cursor)).toEqual(pixel);
    await page.keyboard.up("Control");
    await wheel(page, 1);
    expect(await viewAtScale(page, stepUp)).toEqual(zoomed);

    // Horizontal travel without Shift is not a zoom.
    await wheelBy(page, NOTCH, 0);
    await twoFrames(page);
    expect(await activeView(page)).toEqual(zoomed);

    // Every one of these events had its default prevented: no scroll, no page zoom.
    const seen = await wheels(page);
    expect(seen.length).toBe(8);
    expect(seen.filter((event) => !event.defaultPrevented)).toEqual([]);
    expect(seen.filter((event) => event.shiftKey).length).toBe(4);
    expect(seen.filter((event) => event.ctrlKey).length).toBe(2);
    expect(
        await page.evaluate(() => ({
            ratio: devicePixelRatio,
            scale: window.visualViewport?.scale,
            scrollX,
            scrollY,
        })),
    ).toEqual({ ratio, scale: 1, scrollX: 0, scrollY: 0 });
    expect(errors).toEqual([]);
});

test("the wheel walks every zoom step, the overview steps included, and stops at both ends", async ({
    page,
}) => {
    await openPainted(page);
    const layout = await geometry(page);
    const centre = clientAt(layout, {
        x: Math.floor(layout.device.width / 2),
        y: Math.floor(layout.device.height / 2),
    });
    await page.mouse.move(centre.x, centre.y);
    const fitted = await activeView(page);

    const steps = [0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];
    const at = steps.indexOf(fitted.scale);
    expect(at).toBeGreaterThan(3);
    for (const scale of steps.slice(0, at).reverse()) {
        await wheel(page, -1);
        const view = await viewAtScale(page, scale);
        expect(Number.isInteger(view.originX) && Number.isInteger(view.originY)).toBe(true);
    }
    // At the smallest step one more notch changes nothing.
    const smallest = await activeView(page);
    await wheel(page, -1);
    await twoFrames(page);
    expect(await activeView(page)).toEqual(smallest);
    // The document is small now and stays inside the viewport.
    expect(visible(smallest, { width: 32, height: 32 }, layout.device)).toEqual({
        width: 4,
        height: 4,
    });

    for (const scale of steps.slice(1)) {
        await wheel(page, 1);
        await viewAtScale(page, scale);
    }
    const largest = await activeView(page);
    await wheel(page, 1);
    await twoFrames(page);
    expect(await activeView(page)).toEqual(largest);
});

test("wheel and middle-drag act by pointer location, whatever has focus, and move no focus", async ({
    page,
}) => {
    await openPainted(page);
    const layout = await geometry(page);
    const fitted = await activeView(page);
    const field = await addTextField(page, "context-bar");
    await field.focus();
    await field.pressSequentially("ab");
    await expect(field).toBeFocused();

    const cursor = clientAt(layout, {
        x: Math.floor(layout.device.width / 2),
        y: Math.floor(layout.device.height / 2),
    });
    await page.mouse.move(cursor.x, cursor.y);
    // Focus is in a text field: the wheel over the viewport still zooms.
    await wheel(page, -1);
    expect(fitted.scale).toBe(12);
    const out = await viewAtScale(page, 10);
    await expect(field).toBeFocused();

    // … and the middle button still pans, and takes the focus from nowhere.
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(cursor.x + 20, cursor.y + 10);
    await page.mouse.up({ button: "middle" });
    await expect
        .poll(() => activeView(page))
        .toEqual({
            ...out,
            originX: out.originX + Math.round(20 * layout.ratio),
            originY: out.originY + Math.round(10 * layout.ratio),
        });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("ab");
    const panned = await activeView(page);

    // The viewport has the focus, the pointer is over another region: the wheel does not
    // reach the view.
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    const dock = await region(page, "dock").boundingBox();
    await page.mouse.move((dock?.x ?? 0) + 60, (dock?.y ?? 0) + 120);
    await wheel(page, 1);
    await wheel(page, 1);
    await twoFrames(page);
    expect(await activeView(page)).toEqual(panned);
});
