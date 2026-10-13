import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { boxOf, collectErrors, region } from "./se-006-support";
import { openSession } from "./se-007-support";
import { audit, emptyState, startInTheme, THEMES } from "./se-008-support";
import type { Theme } from "./se-008-support";
import {
    hostDeviceSize,
    openDocument,
    openViewportEditor,
    settle,
    viewportHost,
} from "./se-011-support";
import {
    activeView,
    clientAt,
    fitButton,
    fittedView,
    geometry,
    twoFrames,
    viewAtScale,
    viewportArea,
    wheel,
    wheelBy,
    wheels,
} from "./se-012-support";

// SE-012: the viewport element — the focusable container of the NGNE canvas, the F6 target of
// the viewport region, and the place of the pointer listeners. NGNE replaces its canvas at
// every resize, so none of this is on a canvas.

/** Presses F6 until the viewport element has focus. */
async function focusViewportWithF6(page: Page): Promise<void> {
    for (let presses = 0; presses < 10; presses++) {
        await page.keyboard.press("F6");
        if (await viewportArea(page).evaluate((element) => element === document.activeElement)) {
            return;
        }
    }
    throw new Error("F6 did not reach the viewport element");
}

/** The focus ring of the viewport element: the frame drawn above its canvases. */
function ring(
    page: Page,
): Promise<{ content: string; style: string; width: string; colour: string }> {
    return viewportArea(page).evaluate((element) => {
        const frame = getComputedStyle(element, "::after");
        return {
            content: frame.content,
            style: frame.borderTopStyle,
            width: frame.borderTopWidth,
            colour: frame.borderTopColor,
        };
    });
}

test("the viewport element is the focusable container of the NGNE canvas and fills the region", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    // No document: no viewport element; the region shows the empty state.
    await expect(viewportArea(page)).toHaveCount(0);
    await expect(emptyState(page)).toBeVisible();

    await openDocument(page, { width: 32, height: 32 });
    await settle(page);
    const area = viewportArea(page);
    await expect(area).toHaveCount(1);
    await expect(area).toHaveAttribute("tabindex", "0");
    // SPEC §7.8: the element the keymap takes for "the viewport itself"; F6 enters here.
    await expect(area).toHaveAttribute("data-viewport-focus", "");
    await expect(area).toHaveAttribute("data-region-focus", "");
    // A name for what has focus.
    await expect(area).toHaveAttribute("role", "application");
    await expect(area).toHaveAttribute("aria-label", "Canvas");

    // It holds the element NGNE fills, and that holds NGNE's canvas alone. The canvas itself
    // takes no focus and carries none of the marks.
    const structure = await area.evaluate((element) => ({
        inRegion: element.closest("[data-region]")?.getAttribute("data-region"),
        children: Array.from(element.children, (child) => child.className),
        canvases: element.querySelectorAll("canvas").length,
        hostChildren: Array.from(
            element.querySelector("[data-viewport-canvas]")?.children ?? [],
            (child) => child.tagName,
        ),
        canvasTabindex: element.querySelector("canvas")?.getAttribute("tabindex") ?? null,
    }));
    expect(structure).toEqual({
        inRegion: "viewport",
        children: ["viewport-canvas"],
        canvases: 1,
        hostChildren: ["CANVAS"],
        canvasTabindex: null,
    });
    // Same box as the region and as the element inside it: the device size is unchanged.
    const box = await boxOf(area);
    expect(box).toEqual(await boxOf(region(page, "viewport")));
    expect(box).toEqual(await boxOf(viewportHost(page)));
    expect(errors).toEqual([]);
});

test("F6 enters the viewport region at the viewport element; a click on the canvas focuses it", async ({
    page,
}) => {
    await openViewportEditor(page);
    await openDocument(page, { width: 32, height: 32 });
    await settle(page);
    const area = viewportArea(page);
    const layout = await geometry(page);

    // A click anywhere on the canvas: the element is `document.activeElement`.
    const point = clientAt(layout, { x: 120, y: 90 });
    await page.mouse.click(point.x, point.y);
    await expect(area).toBeFocused();
    // Focused with the pointer: no ring (DESIGN §3.3).
    await expect(page.locator("html")).toHaveAttribute("data-modality", "pointer");
    expect((await ring(page)).content).toBe("none");

    // Away, and back with F6: the region's target is the element, not something inside it.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(area).not.toBeFocused();
    await focusViewportWithF6(page);
    await expect(area).toBeFocused();
    // Shift+F6 leaves to the region before it and F6 comes back.
    await page.keyboard.press("Shift+F6");
    await expect(area).not.toBeFocused();
    await page.keyboard.press("F6");
    await expect(area).toBeFocused();

    // Focused from the keyboard: the ring, 2 px of the accent, drawn above the canvas.
    await expect(page.locator("html")).toHaveAttribute("data-modality", "keyboard");
    const accent = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--accent)";
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
    });
    expect(await ring(page)).toEqual({
        content: '""',
        style: "solid",
        width: "2px",
        colour: accent,
    });
    expect(
        await area.evaluate((element) => {
            const frame = getComputedStyle(element, "::after");
            return [frame.position, frame.pointerEvents, frame.zIndex];
        }),
    ).toEqual(["absolute", "none", "1"]);

    // Tab moves on from the element (it is an ordinary stop in the tab order) …
    await page.keyboard.press("Tab");
    await expect(area).not.toBeFocused();
    // … and Shift+Tab comes back to it.
    await page.keyboard.press("Shift+Tab");
    await expect(area).toBeFocused();
});

test("the keymap takes the element for the viewport: its native keys reach canvas bindings", async ({
    page,
}) => {
    await openViewportEditor(page);
    await openDocument(page, { width: 32, height: 32 });
    await settle(page);
    // A canvas binding of a native key acts only while the viewport itself is focused
    // (SPEC §7.8): this is how the keymap recognises the element.
    await page.evaluate(() => {
        const calls: string[] = [];
        (window as unknown as { __se012Calls: string[] }).__se012Calls = calls;
        window.__ngneTest!.commands.register({
            id: "se012.arrow",
            title: "SE-012 arrow",
            shortcut: "ArrowLeft",
            context: "canvas",
            run: () => void calls.push("arrow"),
        });
    });
    const calls = () =>
        page.evaluate(() => (window as unknown as { __se012Calls: string[] }).__se012Calls);

    await viewportArea(page).focus();
    await page.keyboard.press("ArrowLeft");
    expect(await calls()).toEqual(["arrow"]);

    // On another control the arrow is the control's own key.
    await fitButton(page).focus();
    await page.keyboard.press("ArrowLeft");
    expect(await calls()).toEqual(["arrow"]);
    await viewportArea(page).focus();
    await page.keyboard.press("ArrowLeft");
    expect(await calls()).toEqual(["arrow", "arrow"]);
});

test("focus and listeners stay on the element when NGNE replaces its canvas at a resize", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    await openDocument(page, { width: 32, height: 32 });
    await settle(page);
    const area = viewportArea(page);
    await area.focus();
    await area.evaluate((element) => {
        const canvas = element.querySelector("canvas");
        (window as unknown as { __se012Canvas: unknown }).__se012Canvas = canvas;
        (window as unknown as { __se012Area: unknown }).__se012Area = element;
    });
    const fitted = await activeView(page);

    await page.setViewportSize({ width: 1400, height: 800 });
    await settle(page);
    const after = await area.evaluate((element) => {
        const kept = window as unknown as { __se012Canvas: unknown; __se012Area: unknown };
        return {
            sameElement: element === kept.__se012Area,
            sameCanvas: element.querySelector("canvas") === kept.__se012Canvas,
            canvases: element.querySelectorAll("canvas").length,
        };
    });
    // A new canvas in the same element, which still has the focus.
    expect(after).toEqual({ sameElement: true, sameCanvas: false, canvases: 1 });
    await expect(area).toBeFocused();

    // The wheel, the middle button and the keys still navigate.
    const layout = await geometry(page);
    const centre = clientAt(layout, {
        x: Math.floor(layout.device.width / 2),
        y: Math.floor(layout.device.height / 2),
    });
    await page.mouse.move(centre.x, centre.y);
    await wheel(page, 1);
    const zoomed = await viewAtScale(page, 16);
    expect(fitted.scale).toBe(12);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(centre.x - 30, centre.y + 12);
    await page.mouse.up({ button: "middle" });
    await expect
        .poll(() => activeView(page))
        .toEqual({
            ...zoomed,
            originX: zoomed.originX - Math.round(30 * layout.ratio),
            originY: zoomed.originY + Math.round(12 * layout.ratio),
        });
    await page.keyboard.press("2");
    await viewAtScale(page, 2);
    await expect(area).toBeFocused();
    expect(errors).toEqual([]);
});

test("the viewport element leaves with the last document and comes back with the next", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const first = await openSession(page, { name: "first", width: 16, height: 16 });
    await settle(page);
    const layout = await geometry(page);
    const point = clientAt(layout, { x: Math.floor(layout.device.width / 2), y: 200 });
    await page.mouse.move(point.x, point.y);
    await expect(region(page, "status-bar").locator('[data-status="cursor"]')).toHaveCount(1);

    await page.evaluate((id) => window.__ngneTest!.sessions.getState().close(id), first);
    await expect(viewportArea(page)).toHaveCount(0);
    await expect(emptyState(page)).toBeVisible();
    // No cursor readout is left behind, and the wheel over the empty workspace is nobody's:
    // the listeners went with the element. The event is waited for, so it cannot reach the
    // next viewport element instead.
    expect(await page.evaluate(() => window.__ngneTest!.status.getState().cursor)).toBeNull();
    await wheelBy(page, 0, -100);
    expect((await wheels(page)).at(-1)?.defaultPrevented).toBe(false);

    // The next document is fitted again, in a new viewport element.
    await openSession(page, { name: "second", width: 16, height: 16 });
    await settle(page);
    await expect(viewportArea(page)).toHaveCount(1);
    const fitted = await activeView(page);
    expect(fitted.scale).toBe(24);
    await page.mouse.move(point.x + 1, point.y);
    await wheel(page, -1);
    await viewAtScale(page, 20);
    expect(errors).toEqual([]);
});

test("a resize of the viewport region is followed without a ResizeObserver loop, document or not", async ({
    page,
}) => {
    // The browser reports a size that changed while sizes were being delivered as an error
    // event on the window, not as an exception.
    await page.addInitScript(() => {
        const seen: string[] = [];
        (window as unknown as { __se012Errors: string[] }).__se012Errors = seen;
        window.addEventListener("error", (event) => seen.push(event.message));
    });
    const loops = () =>
        page.evaluate(() =>
            (window as unknown as { __se012Errors: string[] }).__se012Errors.filter((message) =>
                message.includes("ResizeObserver"),
            ),
        );
    await openViewportEditor(page);
    const rail = region(page, "tool-rail");
    const splitter = page.getByRole("separator", { name: "Resize timeline" });

    // The tallest timeline leaves the rail too short for one column: in one delivery the rail
    // changes its columns and the viewport region its size, twice over.
    const squeeze = async () => {
        await splitter.focus();
        await page.keyboard.press("End");
        await expect(rail).toHaveAttribute("data-columns", "2");
        await twoFrames(page);
        await page.keyboard.press("Home");
        await expect(rail).toHaveAttribute("data-columns", "1");
        await twoFrames(page);
    };
    await squeeze();
    expect(await loops()).toEqual([]);

    const sprite = await openDocument(page, { width: 32, height: 32 });
    await settle(page);
    const fitted = await activeView(page);
    await squeeze();
    await settle(page);
    expect(await loops()).toEqual([]);
    // The view is the user's: a resize does not fit again.
    expect(await activeView(page)).toEqual(fitted);

    // The size is followed: with the timeline at its tallest, Fit fits the smaller viewport.
    await splitter.focus();
    await page.keyboard.press("End");
    await expect(rail).toHaveAttribute("data-columns", "2");
    await settle(page);
    const smaller = await hostDeviceSize(page);
    expect(smaller.height).toBeLessThan(32 * fitted.scale);
    await fitButton(page).click();
    await expect.poll(() => activeView(page)).toEqual(fittedView(sprite, smaller));
    expect(await loops()).toEqual([]);

    // Hidden behind the window-too-small notice and back: still no loop, and the view kept.
    const small = await activeView(page);
    await page.setViewportSize({ width: 1000, height: 600 });
    await expect(page.locator(".shell")).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator(".shell")).toBeVisible();
    await settle(page);
    expect(await activeView(page)).toEqual(small);
    expect(await loops()).toEqual([]);
});

const PANEL: Record<Theme, string> = { dark: "rgb(24, 24, 26)", light: "rgb(244, 244, 245)" };

for (const theme of THEMES) {
    test(`axe reports no AA violations with a document open, in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(90_000);
        const errors = collectErrors(page);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await startInTheme(page, theme);
        await openViewportEditor(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
            PANEL[theme],
        );
        await openDocument(page, { width: 32, height: 32 });
        await settle(page);
        await expect(fitButton(page)).toBeVisible();

        const whole = await audit(page);
        expect(whole.violations).toEqual([]);
        // The viewport element, with its role and name.
        const viewport = await audit(page, "[data-viewport]");
        expect(viewport.violations).toEqual([]);
        // The status bar: its texts and "Fit" were judged for contrast, none left undecided.
        const status = await audit(page, '[data-region="status-bar"]');
        expect(status.violations).toEqual([]);
        expect(status.contrastUndecided).toEqual([]);
        expect(status.contrastChecked).toBeGreaterThanOrEqual(5);

        // With the element focused from the keyboard, ring and all.
        await focusViewportWithF6(page);
        expect((await audit(page)).violations).toEqual([]);
        expect(errors).toEqual([]);
    });
}
