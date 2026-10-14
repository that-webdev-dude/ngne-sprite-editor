import type { Locator, Page } from "@playwright/test";
// The page imports these modules from the dev server; here they are needed for their types.
import type {} from "../../src/app/overlay/mountOverlay";
import { decodePng } from "../../src/core/png";
import type * as ThemeModule from "../../src/ui/theme/theme";
import { settle } from "./se-011-support";
import { twoFrames } from "./se-012-support";
import type { Screen } from "./se-012-support";

// Shared helpers of the SE-013 specs: the overlay canvas, its test hook and the grid settings
// of a document.

/** The overlay canvas: a canvas child of the viewport element. */
export const overlayCanvas = (page: Page): Locator =>
    page.locator("[data-viewport] > canvas[data-viewport-overlay]");

/** The overlay's probe as the page has it now. */
export function overlayState(
    page: Page,
): Promise<{ redraws: number; pending: boolean; canvasSize: { width: number; height: number } }> {
    return page.evaluate(() => {
        const probe = window.__ngneTest?.overlay;
        if (!probe) throw new Error("se-013: no overlay on the page");
        return { redraws: probe.redraws, pending: probe.pending, canvasSize: probe.canvasSize };
    });
}

/** Redraws of the overlay so far. */
export async function redraws(page: Page): Promise<number> {
    return (await overlayState(page)).redraws;
}

/**
 * Waits until the NGNE viewport is at rest and the overlay has drawn what was asked of it, at
 * the size of the NGNE canvas; then lets two animation frames pass, so the screen shows both.
 */
export async function overlaySettled(page: Page): Promise<void> {
    await settle(page);
    await page.waitForFunction(
        () => {
            const overlay = window.__ngneTest?.overlay;
            const size = window.__ngneTest?.viewport?.canvasSize;
            return (
                overlay !== undefined &&
                size !== null &&
                size !== undefined &&
                !overlay.pending &&
                overlay.canvasSize.width === size.width &&
                overlay.canvasSize.height === size.height
            );
        },
        undefined,
        { polling: 50 },
    );
    await twoFrames(page);
}

export interface GridChange {
    pixelGrid?: boolean;
    grid?: Partial<{
        width: number;
        height: number;
        offsetX: number;
        offsetY: number;
        visible: boolean;
    }>;
}

/** Changes the grid settings of a document through the session store (no history entry). */
export function setGrids(page: Page, id: string, change: GridChange): Promise<void> {
    return page.evaluate(
        ({ id, change }) =>
            window.__ngneTest!.sessions.getState().updateDocSettings(id, (settings) => {
                if (change.pixelGrid !== undefined) settings.pixelGrid = change.pixelGrid;
                Object.assign(settings.grid, change.grid ?? {});
            }),
        { id, change },
    );
}

/** The RGBA of device pixels of the overlay canvas itself, read with `getImageData`. */
export function overlayPixels(
    page: Page,
    points: readonly { x: number; y: number }[],
): Promise<number[][]> {
    return overlayCanvas(page).evaluate((canvas, points) => {
        const context = (canvas as HTMLCanvasElement).getContext("2d");
        if (!context) throw new Error("se-013: no 2D context");
        return points.map(({ x, y }) => Array.from(context.getImageData(x, y, 1, 1).data));
    }, points);
}

/** Switches the app's theme as the Preferences dialog does. */
export async function useTheme(page: Page, theme: "dark" | "light"): Promise<void> {
    await page.evaluate(async (theme) => {
        const path = "/src/ui/theme/theme.ts";
        const module = (await import(/* @vite-ignore */ path)) as typeof ThemeModule;
        module.setTheme(theme);
    }, theme);
}

/** A screenshot of the page at device resolution, with its RGBA bytes for fast comparison. */
export interface Shot extends Screen {
    readonly data: Uint8ClampedArray;
}

/** Takes a screenshot of the whole page (SPEC §6.7). */
export async function shot(page: Page): Promise<Shot> {
    const { width, height, data } = await decodePng(await page.screenshot());
    return {
        width,
        height,
        data,
        at: (x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)),
    };
}

/** One look at both canvases, taken in an animation frame of the page. */
export interface CanvasSample {
    /** The viewport element's size in device pixels, as last observed. */
    host: [number, number];
    /** Backing size of the NGNE canvas on screen; null while there is none. */
    ngne: [number, number] | null;
    /** Backing size of the overlay. */
    overlay: [number, number];
    /** Whether the two canvases fill the same box on the page. */
    sameBox: boolean;
    /** The overlay's pixel at the probe position, in its backing pixels. */
    probe: number[];
}

declare global {
    interface Window {
        __se013Samples?: CanvasSample[];
        __se013Sampling?: boolean;
    }
}

/**
 * Starts looking at both canvases in every animation frame of the page until
 * `stopSampling`: their backing sizes, their boxes, and the overlay's pixel at `probe`
 * (overlay backing pixels). Each look reads everything in one task.
 */
export function startSampling(page: Page, probe: { x: number; y: number }): Promise<void> {
    return page.evaluate((probe) => {
        const host = document.querySelector("[data-viewport-canvas]");
        const overlay = document.querySelector<HTMLCanvasElement>("[data-viewport-overlay]");
        const context = overlay?.getContext("2d");
        if (!host || !overlay || !context) throw new Error("se-013: no canvases to sample");
        let device: [number, number] = [0, 0];
        const observer = new ResizeObserver(([entry]) => {
            const box = entry?.devicePixelContentBoxSize[0];
            if (box) device = [box.inlineSize, box.blockSize];
        });
        observer.observe(host, { box: "device-pixel-content-box" });
        const samples: CanvasSample[] = [];
        window.__se013Samples = samples;
        window.__se013Sampling = true;
        const look = () => {
            if (!window.__se013Sampling) {
                observer.disconnect();
                return;
            }
            const ngne = host.querySelector("canvas");
            const a = overlay.getBoundingClientRect();
            const b = ngne?.getBoundingClientRect();
            samples.push({
                host: [...device],
                ngne: ngne ? [ngne.width, ngne.height] : null,
                overlay: [overlay.width, overlay.height],
                sameBox:
                    b !== undefined &&
                    a.x === b.x &&
                    a.y === b.y &&
                    a.width === b.width &&
                    a.height === b.height,
                probe:
                    overlay.width > probe.x && overlay.height > probe.y
                        ? Array.from(context.getImageData(probe.x, probe.y, 1, 1).data)
                        : [],
            });
            requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
    }, probe);
}

/** Stops the looks of `startSampling` and returns them. */
export function stopSampling(page: Page): Promise<CanvasSample[]> {
    return page.evaluate(() => {
        window.__se013Sampling = false;
        return window.__se013Samples ?? [];
    });
}
