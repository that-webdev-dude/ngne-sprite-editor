import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares the tools probe on `window.__ngneTest` (SE-014).
import type {} from "../../src/app/tools/attachToolPointer";
import { region } from "./se-006-support";
import { clientAt } from "./se-012-support";
import type { Geometry, Point, View } from "./se-012-support";

// Shared helpers of the SE-014 specs: the active tool, the stroke in progress, the history and
// the pixels of the active cel, read through the test hooks.

/** What the tools probe reports. */
export interface ToolsState {
    selected: string;
    active: string;
    stroking: boolean;
    cursor: string;
}

/** The tools probe, which is on the page while a viewport is. */
export function toolsState(page: Page): Promise<ToolsState> {
    return page.evaluate(() => {
        const tools = window.__ngneTest?.tools;
        if (!tools) throw new Error("se-014: no tools probe on the page");
        return {
            selected: tools.selected,
            active: tools.active,
            stroking: tools.stroking,
            cursor: tools.cursor,
        };
    });
}

/** Selects a tool as the rail or its key does, through the editor store. */
export function selectTool(page: Page, id: string): Promise<void> {
    return page.evaluate((id) => window.__ngneTest!.editor.getState().setTool(id), id);
}

/** The history of a document: entries to undo, and whether a transaction is open. */
export function historyOf(page: Page, id: string): Promise<{ undo: number; open: boolean }> {
    return page.evaluate((id) => {
        const document = window
            .__ngneTest!.sessions.getState()
            .documents.find((entry) => entry.id === id);
        if (!document) throw new Error(`se-014: no document ${id}`);
        return { undo: document.history.undoCount, open: document.history.transaction !== null };
    }, id);
}

/** The RGBA of pixel `x, y` of the active cel; null while that cel is empty. */
export function celPixel(page: Page, id: string, at: Point): Promise<number[] | null> {
    return page.evaluate(
        ({ id, at }) => {
            const document = window
                .__ngneTest!.sessions.getState()
                .documents.find((entry) => entry.id === id);
            if (!document) throw new Error(`se-014: no document ${id}`);
            const { doc, activeLayerId, activeFrameId } = document.session;
            const cel = doc.cels.get(`${activeLayerId}:${activeFrameId}`);
            const image = cel ? doc.images.get(cel.imageId) : undefined;
            if (!image) return null;
            const from = (at.y * image.width + at.x) * 4;
            return Array.from(image.data.slice(from, from + 4));
        },
        { id, at },
    );
}

/** Sets a flag of the active layer through the session store, as a test hook. */
export function setLayerFlag(
    page: Page,
    id: string,
    flag: "locked" | "visible",
    value: boolean,
): Promise<void> {
    return page.evaluate(
        ({ id, flag, value }) => {
            const sessions = window.__ngneTest!.sessions.getState();
            const document = sessions.documents.find((entry) => entry.id === id);
            if (!document) throw new Error(`se-014: no document ${id}`);
            const { doc, activeLayerId } = document.session;
            const layer = doc.layers.find((entry) => entry.id === activeLayerId);
            if (!layer) throw new Error("se-014: no active layer");
            layer[flag] = value;
            sessions.touch(id);
        },
        { id, flag, value },
    );
}

/**
 * The client position of a device pixel of texel `texel` under `view` (a zoom step of 1 or
 * more): its first device pixel, its last, or the one at its centre. Whole device pixels, as
 * the SE-012 pointer tests place the mouse: at 1.25 Chrome reports such a position just short
 * of its device pixel (SPEC §6.7).
 */
export function texelClient(
    layout: Geometry,
    view: View,
    texel: Point,
    where: "first" | "last" | "centre" = "centre",
): Point {
    const offset =
        where === "first" ? 0 : where === "last" ? view.scale - 1 : Math.floor(view.scale / 2);
    return clientAt(layout, {
        x: view.originX + texel.x * view.scale + offset,
        y: view.originY + texel.y * view.scale + offset,
    });
}

/** A copy of `pixels` (RGBA rows of `width`) with the texels at `points` set to `rgba`. */
export function withTexels(
    pixels: readonly number[],
    width: number,
    points: readonly Point[],
    rgba: readonly number[],
): number[] {
    const result = [...pixels];
    for (const { x, y } of points) result.splice((y * width + x) * 4, 4, ...rgba);
    return result;
}

/** The button of a tool in the rail. */
export function railButton(page: Page, name: string): Locator {
    return region(page, "tool-rail").getByRole("button", { name, exact: true });
}

/** Waits until the status bar shows `message` as tool feedback. */
export async function expectFeedback(page: Page, message: string): Promise<void> {
    const field = region(page, "status-bar").locator('[data-status="message"]');
    await expect(field).toHaveText(message);
    await expect(field).toHaveAttribute("data-kind", "feedback");
}
