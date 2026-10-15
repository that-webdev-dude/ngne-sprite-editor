import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as CoreModel from "../../src/core/model";
import { collectErrors, region } from "./se-006-support";
import { addTextField } from "./se-007-support";
import {
    DARK,
    hostDeviceSize,
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
        const releases: unknown[] = [];
        (window as unknown as { __se012Releases: unknown[] }).__se012Releases = releases;
        window.addEventListener("mouseup", (event) =>
            releases.push([event.button, event.defaultPrevented]),
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

    // The middle button's own default (the browser's autoscroll) never happens: no
    // `mousedown` of that button reaches the window without its default prevented. Whether
    // one arrives at all, and what becomes of the other buttons, is for the pointer pipeline
    // to say (a cancelled `pointerdown` sends no `mousedown`).
    const presses = await page.evaluate(
        () => (window as unknown as { __se012Presses: [number, boolean][] }).__se012Presses,
    );
    expect(presses.filter(([button, prevented]) => button === 1 && !prevented)).toEqual([]);
    // Nor does the default of its release: on Linux that pastes the selection of the window
    // system into the field that has the focus.
    const releases = await page.evaluate(
        () => (window as unknown as { __se012Releases: [number, boolean][] }).__se012Releases,
    );
    expect(releases.filter(([button, prevented]) => button === 1 && !prevented)).toEqual([]);
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

test("wheel notches of less than a step's travel zoom every second notch, however far apart", async ({
    page,
}) => {
    await openPainted(page);
    const layout = await geometry(page);
    const centre = clientAt(layout, {
        x: Math.floor(layout.device.width / 2),
        y: Math.floor(layout.device.height / 2),
    });
    await page.mouse.move(centre.x, centre.y);
    expect((await activeView(page)).scale).toBe(12);
    // The pause is part of what is tested: notches further apart than any pause after which
    // travel could be forgotten. A longer pause, on a slow machine, changes nothing.
    const pause = () => page.waitForTimeout(450);

    // 40 px a notch, as a wheel gives at a page zoom of 250%.
    await wheelBy(page, 0, -40);
    expect((await activeView(page)).scale).toBe(12);
    await pause();
    await wheelBy(page, 0, -40);
    await viewAtScale(page, 16);
    await pause();
    // 33.3 px a notch (300%), the other way.
    await wheelBy(page, 0, 33.3);
    expect((await activeView(page)).scale).toBe(16);
    await pause();
    await wheelBy(page, 0, 33.3);
    await viewAtScale(page, 12);

    // A turn the other way starts from zero: 40 in and 40 out are no step, 40 more out are one.
    await wheelBy(page, 0, -40);
    await wheelBy(page, 0, 40);
    expect((await activeView(page)).scale).toBe(12);
    await wheelBy(page, 0, 40);
    await viewAtScale(page, 10);
});

test("the pan limit is kept when the viewport shrinks: the document comes back inside", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1500, height: 900 });
    const document = await openPainted(page);
    const large = await hostDeviceSize(page);
    expect(large).toEqual({ width: 1192, height: 604 });
    expect((await activeView(page)).scale).toBe(16);

    // Panned to the bottom-right limit of the large viewport.
    const layout = await geometry(page);
    for (let drag = 0; drag < 3; drag++) {
        await middleDrag(
            page,
            layout,
            { x: 40, y: 40 },
            { x: large.width - 40, y: large.height - 40 },
        );
    }
    const corner = {
        scale: 16,
        originX: large.width - MIN_VISIBLE,
        originY: large.height - MIN_VISIBLE,
    };
    await expect.poll(() => activeView(page)).toEqual(corner);

    // The window shrinks: where the view is, nothing of the document would be left.
    await page.setViewportSize({ width: 1280, height: 720 });
    await settle(page);
    const small = await hostDeviceSize(page);
    // The rail is in two columns here: its colour chips (SE-016) do not fit one at 460 px.
    expect(small).toEqual({ width: 944, height: 424 });
    expect(visible(corner, document, small)).toEqual({ width: 0, height: 0 });
    const inside = {
        scale: 16,
        originX: small.width - MIN_VISIBLE,
        originY: small.height - MIN_VISIBLE,
    };
    // Moved back to the limit, not fitted: the zoom is the user's.
    await expect.poll(() => activeView(page)).toEqual(inside);
    await expectDocumentOnlyIn(page, {
        x: inside.originX,
        y: inside.originY,
        width: MIN_VISIBLE,
        height: MIN_VISIBLE,
    });

    // The timeline at its tallest takes more: the viewport is shorter; the rail keeps its
    // second column, so the width stays.
    const rail = region(page, "tool-rail");
    await page.getByRole("separator", { name: "Resize timeline" }).focus();
    await page.keyboard.press("End");
    await expect(rail).toHaveAttribute("data-columns", "2");
    await settle(page);
    const smaller = await hostDeviceSize(page);
    expect(smaller.width).toBe(small.width);
    expect(smaller.height).toBeLessThan(small.height);
    const again = {
        scale: 16,
        originX: smaller.width - MIN_VISIBLE,
        originY: smaller.height - MIN_VISIBLE,
    };
    await expect.poll(() => activeView(page)).toEqual(again);
    await expectDocumentOnlyIn(page, {
        x: again.originX,
        y: again.originY,
        width: MIN_VISIBLE,
        height: MIN_VISIBLE,
    });

    // A viewport that grows again (the timeline at its lowest) moves nothing: the view is
    // inside its limits, and more of the document shows.
    await page.keyboard.press("Home");
    await expect(rail).toHaveAttribute("data-columns", "1");
    await settle(page);
    await twoFrames(page);
    const grown = await hostDeviceSize(page);
    expect(grown.width).toBeGreaterThan(smaller.width);
    expect(grown.height).toBeGreaterThan(smaller.height);
    expect(await activeView(page)).toEqual(again);
    await expectDocumentOnlyIn(page, {
        x: again.originX,
        y: again.originY,
        width: grown.width - again.originX,
        height: grown.height - again.originY,
    });
    expect(errors).toEqual([]);
});

test("a document that becomes the active one is moved back inside the viewport, and so is a view passed to open", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1500, height: 900 });
    await openViewportEditor(page);
    const a = await openDocument(page, { name: "a", width: 32, height: 32 });
    await paint(page, a.id, pattern(32, 32, 5));
    await settle(page);
    const large = await hostDeviceSize(page);
    // Where the user left `a`: at the bottom-right limit of the large viewport.
    const corner = {
        scale: 16,
        originX: large.width - MIN_VISIBLE,
        originY: large.height - MIN_VISIBLE,
    };
    await setView(page, a.id, corner);
    const b = await openDocument(page, { name: "b", width: 8, height: 8 });
    await paint(page, b.id, pattern(8, 8, 7));
    await settle(page);
    const fittedB = await activeView(page);
    const viewOf = (id: string) =>
        page.evaluate((id) => {
            const { documents } = window.__ngneTest!.sessions.getState();
            return { ...documents.find((entry) => entry.id === id)!.view };
        }, id);

    await page.setViewportSize({ width: 1280, height: 720 });
    await settle(page);
    await twoFrames(page);
    const small = await hostDeviceSize(page);
    // `b` is on show and inside its limits; `a` is not on show. Neither is touched.
    expect(await activeView(page)).toEqual(fittedB);
    expect(await viewOf(a.id)).toEqual(corner);
    expect(visible(corner, a, small)).toEqual({ width: 0, height: 0 });

    // The user switches to `a`: it is inside the viewport in the task that activates it.
    const switched = await page.evaluate((id) => {
        const sessions = window.__ngneTest!.sessions;
        sessions.getState().activate(id);
        const state = sessions.getState();
        const active = state.documents.find((entry) => entry.id === state.activeId)!;
        return { id: active.id, view: { ...active.view }, viewSet: active.viewSet };
    }, a.id);
    const inside = {
        scale: 16,
        originX: small.width - MIN_VISIBLE,
        originY: small.height - MIN_VISIBLE,
    };
    expect(switched).toEqual({ id: a.id, view: inside, viewSet: true });
    await expectDocumentOnlyIn(page, {
        x: inside.originX,
        y: inside.originY,
        width: MIN_VISIBLE,
        height: MIN_VISIBLE,
    });
    // `b` kept the view it had.
    expect(await viewOf(b.id)).toEqual(fittedB);

    // A view passed to `open` that lies outside the viewport: 512 device pixels a side, far
    // off to the right and above. The document opens with 32 of them inside.
    const opened = await page.evaluate(async () => {
        const path = "/src/core/model/index.ts";
        const core = (await import(/* @vite-ignore */ path)) as typeof CoreModel;
        const sessions = window.__ngneTest!.sessions;
        const returned = sessions
            .getState()
            .open(core.createDocument({ name: "c", width: 32, height: 32 }), {
                view: { scale: 16, originX: 5000, originY: -5000 },
            });
        const stored = sessions.getState().documents.find((entry) => entry.id === returned.id)!;
        return { id: returned.id, returned: { ...returned.view }, stored: { ...stored.view } };
    });
    const atTop = { scale: 16, originX: small.width - MIN_VISIBLE, originY: MIN_VISIBLE - 512 };
    expect(opened.returned).toEqual(atTop);
    expect(opened.stored).toEqual(atTop);
    await paint(page, opened.id, pattern(32, 32, 7));
    await expectDocumentOnlyIn(page, {
        x: atTop.originX,
        y: 0,
        width: MIN_VISIBLE,
        height: MIN_VISIBLE,
    });

    // A document smaller than 32 device pixels is shown in full: 8 × 8 at 1×.
    const dot = await page.evaluate(async () => {
        const path = "/src/core/model/index.ts";
        const core = (await import(/* @vite-ignore */ path)) as typeof CoreModel;
        const document = window
            .__ngneTest!.sessions.getState()
            .open(core.createDocument({ name: "dot", width: 8, height: 8 }), {
                view: { scale: 1, originX: -400, originY: 9000 },
            });
        return { id: document.id, view: { ...document.view } };
    });
    expect(dot.view).toEqual({ scale: 1, originX: 0, originY: small.height - 8 });
    await paint(page, dot.id, pattern(8, 8, 7));
    await expectDocumentOnlyIn(page, { x: 0, y: small.height - 8, width: 8, height: 8 });
    expect(errors).toEqual([]);
});
