import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { region } from "./se-006-support";
import { openEditor, openSession } from "./se-007-support";
import { swatches } from "./se-016-support";

// Shared helpers of the SE-060 specs: the palette section and its controls, the active
// document's palette and history as the test hook reads them, and a document whose palette
// is `COLOURS`.

export const palettePanel = (page: Page): Locator =>
    region(page, "dock").locator('[data-dock-panel="palette"]');
export const grid = (page: Page): Locator => palettePanel(page).locator("[data-palette-grid]");
export const addButton = (page: Page): Locator =>
    palettePanel(page).getByRole("button", { name: "Add current colour", exact: true });
export const overflowButton = (page: Page): Locator =>
    palettePanel(page).getByRole("button", { name: "Swatch actions", exact: true });
export const presetsButton = (page: Page): Locator =>
    palettePanel(page).getByRole("button", { name: /^Presets/ });
export const swatchEditor = (page: Page): Locator =>
    page.getByRole("dialog", { name: "Edit colour" });
export const menuItem = (menu: Locator, name: string): Locator =>
    menu.getByRole("menuitem", { name, exact: true });

/** The 0xRRGGBBAA colours of the active document's palette, and its name. */
export function palette(page: Page): Promise<{ name: string; colors: number[] }> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const { name, colors } = document.session.doc.palette;
        return { name, colors: [...colors] };
    });
}

/** The active document's history: entries to undo and the label undo would reverse. */
export function history(page: Page): Promise<{ undo: number; label: string | null }> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const { history } = state.documents.find((entry) => entry.id === state.activeId)!;
        return { undo: history.undoCount, label: history.undoLabel };
    });
}

/** Sets the active document's palette as a test hook: no history entry. */
export function setPalette(page: Page, colors: readonly number[], name = "Test"): Promise<void> {
    return page.evaluate(
        ({ colors, name }) => {
            const sessions = window.__ngneTest!.sessions.getState();
            const document = sessions.documents.find((entry) => entry.id === sessions.activeId)!;
            document.session.doc.palette = { name, colors: [...colors] };
            sessions.touch(document.id);
        },
        { colors, name },
    );
}

/** The colours the swatches show, in grid order, as "#RRGGBBAA". */
export function shownColours(page: Page): Promise<(string | null)[]> {
    return swatches(page).evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-colour")),
    );
}

/** Waits until the focus is inside `surface`. Radix moves it there after the surface opens. */
export async function focusInside(surface: Locator): Promise<void> {
    await expect
        .poll(() => surface.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
}

/** The swatch at `index` once it has the focus. */
export async function focused(page: Page, index: number): Promise<void> {
    await expect(swatches(page).nth(index)).toBeFocused();
}

export const COLOURS = [0x000000ff, 0xff0000ff, 0x00ff00ff, 0x0000ffff, 0xffffffff, 0x80808080];

/** The editor with a document whose palette is `COLOURS`, the palette section expanded. */
export async function openPalettePanel(page: Page): Promise<void> {
    // Tall enough for the palette section to start expanded (DESIGN §2).
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditor(page);
    await openSession(page, { name: "palette", width: 16, height: 16 });
    await setPalette(page, COLOURS);
    await expect(swatches(page)).toHaveCount(COLOURS.length);
}
