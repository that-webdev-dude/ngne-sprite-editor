import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { boxOf } from "./se-006-support";
import { openEditor, openSession } from "./se-007-support";
import { frameHeader, grid, runCommands } from "./se-022-support";

// Shared helpers of the SE-026 specs: a document whose cels can be told apart, what each cell
// holds, and drags with the mouse.

/**
 * Opens the editor with a document of `layers` layers ("Layer 1" at the bottom) and `frames`
 * frames. `filled` names the cels that get an image of their own, as "layer/frame" with frames
 * from 1 ("Layer 1/2"); the images are put in the document outside the history.
 */
export async function openCels(
    page: Page,
    layers: number,
    frames: number,
    filled: readonly string[] = [],
): Promise<void> {
    await openEditor(page);
    await openSession(page, { name: "drag", width: 4, height: 4 });
    await runCommands(page, [
        ...Array.from({ length: layers - 1 }, () => "layer.new"),
        ...Array.from({ length: frames - 1 }, () => "frame.newEmpty"),
        "frame.first",
    ]);
    await page.evaluate((filled) => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const { doc } = document.session;
        for (const [index, name] of filled.entries()) {
            const [layerName, frame] = name.split("/");
            const layer = doc.layers.find((entry) => entry.name === layerName)!;
            const frameId = doc.frames[Number(frame) - 1]!.id;
            const imageId = `image-${name.replace("Layer ", "")}`;
            const data = new Uint8ClampedArray(doc.width * doc.height * 4).fill(index + 1);
            doc.images.set(imageId, { width: doc.width, height: doc.height, data });
            doc.cels.set(`${layer.id}:${frameId}`, { imageId, opacity: 255 });
        }
        state.touch(document.id);
    }, filled);
    await expect(grid(page).getByRole("rowheader")).toHaveCount(layers);
    // The frame numbers are virtualized: the grid's column count tells the frames drawn.
    await expect(grid(page)).toHaveAttribute("aria-colcount", String(frames + 1));
    await expect(frameHeader(page, 1)).toBeAttached();
}

/**
 * What each cell holds, the top layer first: one line per layer, a cell per frame — the name
 * its image was given (`openCels`), "+" for an image made since, "." for an empty cell.
 */
export function celGrid(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const { doc } = document.session;
        return doc.layers
            .filter((layer) => layer.kind === "pixel")
            .reverse()
            .map((layer) =>
                doc.frames
                    .map((frame) => {
                        const imageId = doc.cels.get(`${layer.id}:${frame.id}`)?.imageId;
                        if (imageId === undefined) return ".";
                        return imageId.startsWith("image-") ? imageId.slice(6) : "+";
                    })
                    .join(" "),
            );
    });
}

/** The centre of a locator, in page coordinates. */
export async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await boxOf(locator);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Presses the left button at the centre of `from` and moves in steps to `to`, the button held.
 * The caller releases it (`page.mouse.up()`).
 */
export async function dragFrom(
    page: Page,
    from: Locator,
    to: { x: number; y: number },
): Promise<void> {
    const start = await centreOf(from);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
}

/** The drop indicator of a drag in the timeline. */
export const dropIndicator = (page: Page) => grid(page).locator(".timeline__drop");
