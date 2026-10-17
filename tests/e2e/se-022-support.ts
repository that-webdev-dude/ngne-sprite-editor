import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { region } from "./se-006-support";

// Shared helpers of the SE-022 specs: the timeline panel's parts, and what the active document
// holds.

export const timeline = (page: Page) => region(page, "timeline");
export const grid = (page: Page) => timeline(page).getByRole("grid", { name: "Cels" });
export const viewport = (page: Page) => page.locator("[data-viewport-focus]");

/** The row header of a layer, by its name. */
export const layerHeader = (page: Page, name: string) =>
    grid(page).getByRole("rowheader", { name, exact: true });
/** The row of a layer, by its name. */
export const layerRow = (page: Page, name: string) =>
    grid(page)
        .getByRole("row")
        // The inner locator is relative to the row.
        .filter({ has: page.getByRole("rowheader", { name, exact: true }) });
/** The cell of a layer at a frame; frames count from 1, as the header shows them. */
export const cell = (page: Page, layer: string, frame: number) =>
    layerRow(page, layer)
        .getByRole("gridcell")
        .nth(frame - 1);
/** A frame number of the header; from 1. */
export const frameHeader = (page: Page, frame: number) =>
    grid(page)
        .locator(".timeline__frame")
        .nth(frame - 1);
/** The grid's active cell: its one tab stop. */
export const activeCell = (page: Page) => grid(page).locator('[role="gridcell"][tabindex="0"]');
export const durationField = (page: Page) =>
    timeline(page).getByRole("spinbutton", { name: "Frame duration" });
export const propertiesPopover = (page: Page) =>
    page.getByRole("dialog", { name: "Layer properties" });

/** What the active document holds, as the timeline shows it and the history records it. */
export interface DocumentState {
    /** Bottom to top. */
    layers: { id: string; name: string; visible: boolean; locked: boolean; opacity: number }[];
    frames: { id: string; durationMs: number }[];
    cels: [string, string, number][];
    images: string[];
    activeLayer: string;
    /** From 1. */
    activeFrame: number;
    undoCount: number;
    undoLabel: string | null;
}

export function documentState(page: Page): Promise<DocumentState> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) throw new Error("No document is open");
        const { doc, activeLayerId, activeFrameId } = document.session;
        return {
            layers: doc.layers.map(({ id, name, visible, locked, opacity }) => ({
                id,
                name,
                visible,
                locked,
                opacity,
            })),
            frames: doc.frames.map(({ id, durationMs }) => ({ id, durationMs })),
            cels: [...doc.cels.entries()].map(
                ([key, cel]) => [key, cel.imageId, cel.opacity] as [string, string, number],
            ),
            images: [...doc.images.keys()],
            activeLayer: doc.layers.find((layer) => layer.id === activeLayerId)?.name ?? "",
            activeFrame: doc.frames.findIndex((frame) => frame.id === activeFrameId) + 1,
            undoCount: document.history.undoCount,
            undoLabel: document.history.undoLabel,
        };
    });
}

/** Runs commands of the app's registry by id, in order, as the menus do. */
export function runCommands(page: Page, ids: readonly string[]): Promise<void> {
    return page.evaluate((ids) => {
        for (const id of ids) {
            const command = window.__ngneTest!.commands.get(id);
            if (!command?.enabled()) throw new Error(`Command ${id} is not enabled`);
            void command.run();
        }
    }, ids);
}

/** The selected cells as "layer/frame" (frames from 1), sorted. */
export function selectedCells(page: Page): Promise<string[]> {
    return grid(page).evaluate((element) =>
        [...element.querySelectorAll('[role="gridcell"][aria-selected="true"]')]
            .map((selected) => {
                const row = selected.closest('[role="row"]');
                const name = row?.querySelector('[role="rowheader"]')?.getAttribute("aria-label");
                const cells = [...(row?.querySelectorAll('[role="gridcell"]') ?? [])];
                return `${name}/${cells.indexOf(selected) + 1}`;
            })
            .sort(),
    );
}

/** The selected frame numbers of the header. */
export function selectedFrames(page: Page): Promise<number[]> {
    return grid(page).evaluate((element) =>
        [...element.querySelectorAll(".timeline__frame")]
            .map((frame, index) => (frame.getAttribute("aria-selected") === "true" ? index + 1 : 0))
            .filter((index) => index > 0),
    );
}

/** The names of the selected layer rows, top first. */
export function selectedLayers(page: Page): Promise<string[]> {
    return grid(page).evaluate((element) =>
        [...element.querySelectorAll('[role="rowheader"][aria-selected="true"]')].map(
            (header) => header.getAttribute("aria-label") ?? "",
        ),
    );
}

/** Every cell of `layers` × `frames` as "layer/frame", sorted. */
export function cellsOf(layers: readonly string[], frames: readonly number[]): string[] {
    return layers.flatMap((layer) => frames.map((frame) => `${layer}/${frame}`)).sort();
}

/** Waits until the active cell is the cell of `layer` at `frame` and has the focus. */
export async function expectFocusOn(page: Page, layer: string, frame: number): Promise<void> {
    await expect(cell(page, layer, frame)).toHaveAttribute("tabindex", "0");
    await expect(cell(page, layer, frame)).toBeFocused();
}

/** The layer names the timeline shows, top first. */
export function rowNames(page: Page): Promise<string[]> {
    return grid(page)
        .getByRole("rowheader")
        .evaluateAll((headers) => headers.map((header) => header.getAttribute("aria-label") ?? ""));
}
