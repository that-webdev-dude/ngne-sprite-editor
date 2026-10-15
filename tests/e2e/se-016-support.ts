import type { Locator, Page } from "@playwright/test";
import { region } from "./se-006-support";

// Shared helpers of the SE-016 specs: the colours of the editor store, the controls of the
// colour panel, the palette and the rail chips, and a record of the context menus the page
// saw.

export interface Hsv {
    h: number;
    s: number;
    v: number;
}

export interface ColourState {
    foreground: number;
    background: number;
    foregroundHsv: Hsv;
    backgroundHsv: Hsv;
}

/** The colours of the editor store (0xRRGGBBAA) and the HSV the colour panel keeps. */
export function colourState(page: Page): Promise<ColourState> {
    return page.evaluate(() => {
        const { foreground, background, foregroundHsv, backgroundHsv } =
            window.__ngneTest!.editor.getState();
        return {
            foreground,
            background,
            foregroundHsv: { ...foregroundHsv },
            backgroundHsv: { ...backgroundHsv },
        };
    });
}

/** Sets a colour from HSV and alpha, as the colour panel does. */
export function setColourHsv(
    page: Page,
    slot: "foreground" | "background",
    hsv: Hsv,
    alpha = 255,
): Promise<void> {
    return page.evaluate(
        ({ slot, hsv, alpha }) =>
            window.__ngneTest!.editor.getState().setColourHsv(slot, hsv, alpha),
        { slot, hsv, alpha },
    );
}

export const colourPanel = (page: Page): Locator =>
    region(page, "dock").locator("[data-colour-panel]");
export const svField = (page: Page): Locator =>
    colourPanel(page).getByRole("slider", { name: "Saturation and value", exact: true });
export const hueStrip = (page: Page): Locator =>
    colourPanel(page).getByRole("slider", { name: "Hue", exact: true });
export const alphaStrip = (page: Page): Locator =>
    colourPanel(page).getByRole("slider", { name: "Alpha", exact: true });
export const hexField = (page: Page): Locator =>
    colourPanel(page).getByRole("textbox", { name: "Hex", exact: true });
export const numberField = (page: Page, name: string): Locator =>
    colourPanel(page).getByRole("spinbutton", { name, exact: true });

export const colourChips = (page: Page): Locator =>
    region(page, "tool-rail").getByRole("button", { name: "Swap colours", exact: true });
export const resetColours = (page: Page): Locator =>
    region(page, "tool-rail").getByRole("button", { name: "Reset colours", exact: true });

export const swatches = (page: Page): Locator =>
    region(page, "dock").locator('[data-dock-panel="palette"] [role="option"]');

/** The colour 0xRRGGBBAA as "#RRGGBBAA", as the chips and swatches carry it. */
export function hex8(colour: number): string {
    return `#${(colour >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

declare global {
    interface Window {
        /** Every context menu event the page saw: whether its default was cancelled, where. */
        se016Menus?: { prevented: boolean; region: string }[];
    }
}

/**
 * Records every `contextmenu` event after all of the page's listeners: whether its default
 * (the browser's menu) was cancelled, and the region it went to.
 */
export function recordContextMenus(page: Page): Promise<void> {
    return page.evaluate(() => {
        const seen: { prevented: boolean; region: string }[] = [];
        window.se016Menus = seen;
        window.addEventListener("contextmenu", (event) => {
            const target = event.target instanceof Element ? event.target : null;
            seen.push({
                prevented: event.defaultPrevented,
                region: target?.closest("[data-region]")?.getAttribute("data-region") ?? "",
            });
        });
    });
}

export const contextMenus = (page: Page) => page.evaluate(() => window.se016Menus ?? []);
