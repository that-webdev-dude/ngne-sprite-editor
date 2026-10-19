import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as CoreSelection from "../../src/core/selection";
import { focusInside, menuItem, overflowButton } from "./se-060-support";

// Shared helpers of the SE-066 specs: the palette's overflow menu, a cel painted as a test
// hook, a selection made through the history, and the Replace colour dialog.

/** Opens the palette's overflow menu and chooses `item` there; waits until the menu is gone. */
export async function chooseInPaletteMenu(page: Page, item: string): Promise<void> {
    await overflowButton(page).click();
    const menu = page.getByRole("menu", { name: "Swatch actions" });
    await expect(menu).toBeVisible();
    await focusInside(menu);
    await expect(menuItem(menu, item)).toBeEnabled();
    await menuItem(menu, item).click();
    await expect(menu).toBeHidden();
}

/** Makes the active cel hold `colours` (0xRRGGBBAA), row by row, from the top left. */
export function paintCel(page: Page, colours: readonly number[]): Promise<void> {
    return page.evaluate((colours) => {
        const sessions = window.__ngneTest!.sessions.getState();
        const document = sessions.documents.find((entry) => entry.id === sessions.activeId)!;
        const { doc, activeLayerId, activeFrameId } = document.session;
        const data = new Uint8ClampedArray(doc.width * doc.height * 4);
        const view = new DataView(data.buffer);
        colours.forEach((colour, index) => view.setUint32(index * 4, colour));
        doc.images.set("se066-image", { width: doc.width, height: doc.height, data });
        doc.cels.set(`${activeLayerId}:${activeFrameId}`, { imageId: "se066-image", opacity: 255 });
        sessions.touch(document.id);
    }, colours);
}

/** The colours of the active cel, 0xRRGGBBAA, row by row. */
export function celColours(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const sessions = window.__ngneTest!.sessions.getState();
        const document = sessions.documents.find((entry) => entry.id === sessions.activeId)!;
        const { doc, activeLayerId, activeFrameId } = document.session;
        const cel = doc.cels.get(`${activeLayerId}:${activeFrameId}`)!;
        const { data } = doc.images.get(cel.imageId)!;
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        return Array.from({ length: data.length / 4 }, (_, index) => view.getUint32(index * 4));
    });
}

/**
 * Selects a rectangle of the active document through its history, as a marquee does: in
 * place of the selection, or added to it.
 */
export function selectRect(
    page: Page,
    rect: { x: number; y: number; width: number; height: number },
    mode: "replace" | "add" = "replace",
): Promise<void> {
    return page.evaluate(
        async ({ rect, mode }) => {
            const path = "/src/core/selection/index.ts";
            const selection = (await import(/* @vite-ignore */ path)) as typeof CoreSelection;
            const sessions = window.__ngneTest!.sessions.getState();
            const document = sessions.documents.find((entry) => entry.id === sessions.activeId)!;
            const { session, history } = document;
            const mask = selection.rectMask(session.doc.width, session.doc.height, rect);
            history.execute(selection.selectCommand(session, mask, mode, "Select")!);
        },
        { rect, mode },
    );
}

export const replaceDialog = (page: Page): Locator =>
    page.getByRole("dialog", { name: "Replace colour" });

/** The scope radio of the Replace colour dialog. */
export const scopeRadio = (page: Page, name: string): Locator =>
    replaceDialog(page).getByRole("radiogroup", { name: "Scope" }).getByRole("radio", { name });
