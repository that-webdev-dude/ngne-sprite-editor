import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { boxOf, region } from "./se-006-support";
import { hostDeviceSize, viewportHost } from "./se-011-support";

// Shared helpers of the SE-012 specs: the view of the active document as the store holds it,
// and the geometry of the viewport worked out here, from the page's layout, and not by the
// mapping functions under test.

/** SPEC §6.4: the zoom steps, ascending; the first three are the overview steps. */
export const ZOOM_STEPS = [
    1 / 8,
    1 / 4,
    1 / 2,
    1,
    2,
    3,
    4,
    5,
    6,
    8,
    10,
    12,
    16,
    20,
    24,
    32,
    48,
    64,
] as const;
/** The steps at which texels are whole device pixels. */
export const EXACT_STEPS: readonly number[] = ZOOM_STEPS.filter((step) => step >= 1);
/** Pan limit of the ticket: device pixels of the document that stay visible. */
export const MIN_VISIBLE = 32;

export interface View {
    scale: number;
    originX: number;
    originY: number;
}

export interface Point {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

/** The viewport element of SE-012: the focusable container of the NGNE canvas. */
export const viewportArea = (page: Page): Locator => page.locator("[data-viewport]");
/** The cursor field of the status bar; absent while the cursor is not over the document. */
export const cursorField = (page: Page): Locator =>
    region(page, "status-bar").locator('[data-status="cursor"]');
export const zoomField = (page: Page): Locator =>
    region(page, "status-bar").locator('[data-status="zoom"]');
export const fitButton = (page: Page): Locator =>
    region(page, "status-bar").getByRole("button", { name: "Fit", exact: true });

/** The view of the active document, as the store holds it. */
export function activeView(page: Page): Promise<View> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) throw new Error("se-012: no active document");
        return { ...document.view };
    });
}

/** Waits until the active document's scale is `scale`; returns the view. */
export async function viewAtScale(page: Page, scale: number): Promise<View> {
    await expect.poll(async () => (await activeView(page)).scale).toBe(scale);
    return activeView(page);
}

/** Where the viewport element is and how large, read from the page's layout. */
export interface Geometry {
    /** Device pixels per CSS pixel. */
    ratio: number;
    /** The element's box in client coordinates, CSS pixels. */
    left: number;
    top: number;
    /** The element's size in device pixels, as a `ResizeObserver` reports it. */
    device: Size;
}

export async function geometry(page: Page): Promise<Geometry> {
    const box = await boxOf(viewportHost(page));
    const ratio = await page.evaluate(() => devicePixelRatio);
    return { ratio, left: box.x, top: box.y, device: await hostDeviceSize(page) };
}

/**
 * The device pixel of the viewport element under a client position. The element's corner
 * lies on a whole device pixel (the browser lays boxes out so); a mouse position in whole CSS
 * pixels is a whole or a half device pixel at the ratios tested.
 */
export function deviceAt(geometry: Geometry, client: Point): Point {
    return {
        x: client.x * geometry.ratio - Math.round(geometry.left * geometry.ratio),
        y: client.y * geometry.ratio - Math.round(geometry.top * geometry.ratio),
    };
}

/** The client position of a device position of the viewport element. */
export function clientAt(geometry: Geometry, device: Point): Point {
    return {
        x: (Math.round(geometry.left * geometry.ratio) + device.x) / geometry.ratio,
        y: (Math.round(geometry.top * geometry.ratio) + device.y) / geometry.ratio,
    };
}

/** The document pixel under a client position, for a view at a zoom step of 1 or above. */
export function pixelAt(geometry: Geometry, view: View, client: Point): Point {
    const device = deviceAt(geometry, client);
    return {
        x: Math.floor((device.x - view.originX) / view.scale),
        y: Math.floor((device.y - view.originY) / view.scale),
    };
}

/** The fitted view (SPEC §6.4): the largest zoom step that fits, centred. */
export function fittedView(document: Size, viewport: Size): View {
    const side = (length: number, scale: number) => Math.max(1, Math.round(length * scale));
    let scale: number = ZOOM_STEPS[0];
    for (const step of ZOOM_STEPS) {
        if (side(document.width, step) > viewport.width) break;
        if (side(document.height, step) > viewport.height) break;
        scale = step;
    }
    return {
        scale,
        originX: Math.floor((viewport.width - side(document.width, scale)) / 2),
        originY: Math.floor((viewport.height - side(document.height, scale)) / 2),
    };
}

/** Device pixels of the document inside the viewport along each axis. */
export function visible(view: View, document: Size, viewport: Size): Size {
    const along = (origin: number, length: number, viewLength: number) =>
        Math.max(0, Math.min(origin + length, viewLength) - Math.max(origin, 0));
    return {
        width: along(view.originX, Math.round(document.width * view.scale), viewport.width),
        height: along(view.originY, Math.round(document.height * view.scale), viewport.height),
    };
}

/** One notch of a mouse wheel: up (away from the user) zooms in. */
export const NOTCH = 100;

/** Wheel events seen by the window after the page handled them. */
export interface WheelRecord {
    defaultPrevented: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    deltaX: number;
    deltaY: number;
}

declare global {
    interface Window {
        __se012Wheels?: WheelRecord[];
    }
}

/**
 * Records every wheel event from the first call on, as it is when it has bubbled to the
 * window; returns how many were recorded so far.
 */
export function recordWheels(page: Page): Promise<number> {
    return page.evaluate(() => {
        if (!window.__se012Wheels) {
            const wheels: WheelRecord[] = [];
            window.__se012Wheels = wheels;
            window.addEventListener("wheel", (event) => {
                wheels.push({
                    defaultPrevented: event.defaultPrevented,
                    ctrlKey: event.ctrlKey,
                    shiftKey: event.shiftKey,
                    deltaX: event.deltaX,
                    deltaY: event.deltaY,
                });
            });
        }
        return window.__se012Wheels.length;
    });
}

export function wheels(page: Page): Promise<WheelRecord[]> {
    return page.evaluate(() => window.__se012Wheels ?? []);
}

/**
 * Turns the wheel at the mouse position and waits until the page has handled the event.
 * `page.mouse.wheel` returns when the event is sent, not when it is handled: an event still on
 * its way would otherwise arrive in the middle of the next step.
 */
export async function wheelBy(page: Page, deltaX: number, deltaY: number): Promise<void> {
    const before = await recordWheels(page);
    await page.mouse.wheel(deltaX, deltaY);
    await expect.poll(async () => (await wheels(page)).length).toBe(before + 1);
}

/** Turns the wheel by one notch at the mouse position: `1` up, `-1` down. */
export function wheel(page: Page, direction: 1 | -1): Promise<void> {
    return wheelBy(page, 0, direction === 1 ? -NOTCH : NOTCH);
}

/** The colour of one device pixel of the viewport's canvas, read back now (SPEC §6.7). */
export function devicePixel(page: Page, at: Point): Promise<number[]> {
    return page.evaluate((at) => {
        const image = window.__ngneTest!.viewport!.readCanvas();
        if (!image) throw new Error("se-012: the viewport has no ready renderer");
        return window.__se011.crop(image, { x: at.x, y: at.y, width: 1, height: 1 }).data;
    }, at);
}

/** The RGBA of texel `x, y` of an image of `width` pixels a row. */
export function texel(pixels: readonly number[], width: number, x: number, y: number): number[] {
    return pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4);
}

/** Lets two animation frames pass: what a pending redraw needs to be submitted. */
export function twoFrames(page: Page): Promise<void> {
    return page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
    );
}
