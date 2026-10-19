import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { encodePng } from "../../src/core/png";
import type { PixelBuffer } from "../../src/core/pixels";
import { menuItem, openMenu } from "./se-007-support";

// Shared helpers of the SE-044 specs: PNG files made in Node, the Import PNG dialog opened
// from the File menu, its controls, and what the document holds afterwards.

export interface PngFile {
    name: string;
    mimeType: string;
    buffer: Buffer;
    pixels: PixelBuffer;
}

/** A PNG file of these pixels. */
export function pngFile(name: string, pixels: PixelBuffer): PngFile {
    return { name, mimeType: "image/png", buffer: Buffer.from(encodePng(pixels)), pixels };
}

/** `width` × `height` pixels whose colour at (x, y) is `colour(x, y)`. */
export function image(
    width: number,
    height: number,
    colour: (x: number, y: number) => readonly number[],
): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) data.set(colour(x, y), (y * width + x) * 4);
    }
    return { width, height, data };
}

/** An opaque image of smooth colour: many colours, so a reduction has work to do. */
export function gradient(width: number, height: number, seed = 0): PixelBuffer {
    return image(width, height, (x, y) => [
        (x * 255) / (width - 1),
        (y * 255) / (height - 1),
        (seed * 60 + ((x + y) * 128) / (width + height)) % 256,
        255,
    ]);
}

/** One colour all over. */
export function flat(width: number, height: number, rgba: readonly number[]): PixelBuffer {
    return image(width, height, () => rgba);
}

export const importDialog = (page: Page): Locator =>
    page.getByRole("dialog", { name: "Import PNG" });

/** Runs File → Import PNG… and chooses `files` in the file input it opens. */
export async function importFromMenu(
    page: Page,
    files: readonly Pick<PngFile, "name" | "mimeType" | "buffer">[],
): Promise<Locator> {
    await openMenu(page, "File");
    const chooser = page.waitForEvent("filechooser");
    await menuItem(page, "file.importPng").click();
    await (
        await chooser
    ).setFiles(files.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    return dialog;
}

/** The result line once the preview shows a result. */
export async function settledSummary(dialog: Locator): Promise<string> {
    const summary = dialog.locator("[data-import-summary]");
    await expect(summary).toHaveText(/frames? ·/);
    await expect(dialog.locator("[data-import-result]")).toHaveAttribute("aria-busy", "false");
    return (await summary.textContent()) ?? "";
}

/** Clicks a choice of a segmented control of the dialog. */
export async function choose(dialog: Locator, group: string, option: string): Promise<void> {
    const radio = dialog
        .getByRole("radiogroup", { name: group, exact: true })
        .getByRole("radio", { name: option, exact: true });
    await radio.click();
    await expect(radio).toBeChecked();
}

/** Picks an option of a select of the dialog (Radix: waits for the list, then for it to close). */
export async function select(page: Page, dialog: Locator, name: string, option: string) {
    const trigger = dialog.getByRole("combobox", { name, exact: true });
    await trigger.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await listbox.getByRole("option", { name: option, exact: true }).click();
    await expect(listbox).toHaveCount(0);
    await expect(trigger).toHaveText(option);
}

/** Types a number into a field of the dialog and leaves it. */
export async function setField(dialog: Locator, name: string, value: number): Promise<void> {
    const field = dialog.getByRole("spinbutton", { name, exact: true });
    await field.fill(String(value));
    await field.blur();
    await expect(field).toHaveValue(String(value));
}

/** The active document as the import left it: layers, frames, palette, history. */
export function activeDocument(page: Page) {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        if (!document) return null;
        const { doc, activeFrameId, activeLayerId } = document.session;
        const cel = (layerId: string, frameId: string) => {
            const found = doc.cels.get(`${layerId}:${frameId}`);
            const image = found && doc.images.get(found.imageId);
            return image
                ? { width: image.width, height: image.height, data: [...image.data] }
                : null;
        };
        return {
            id: document.id,
            name: doc.name,
            width: doc.width,
            height: doc.height,
            layers: doc.layers.map((layer) => ({
                id: layer.id,
                kind: layer.kind,
                name: layer.name,
                ...(layer.kind === "reference" && {
                    x: layer.x,
                    y: layer.y,
                    scale: layer.scale,
                    placement: layer.placement,
                }),
                cels: doc.frames.map((frame) => cel(layer.id, frame.id)),
            })),
            frames: doc.frames.map((frame) => frame.id),
            palette: [...doc.palette.colors],
            activeFrame: doc.frames.findIndex((frame) => frame.id === activeFrameId),
            activeLayerId,
            undo: document.history.undoCount,
            undoLabel: document.history.undoLabel,
        };
    });
}

/** The distinct 0xRRGGBBAA colours of non-transparent pixels. */
export function coloursOf(data: readonly number[]): Set<number> {
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        colours.add(
            ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!) >>> 0,
        );
    }
    return colours;
}

/** Dispatches a drop of `files` on the viewport at a point; true when both events were taken. */
export function dropFiles(
    page: Page,
    files: readonly { name: string; buffer: Buffer }[],
    point: { x: number; y: number },
): Promise<boolean> {
    return page.evaluate(
        ({ files, point }) => {
            const transfer = new DataTransfer();
            for (const file of files) {
                transfer.items.add(
                    new File([Uint8Array.from(file.bytes)], file.name, { type: file.type }),
                );
            }
            const target = document.querySelector('[data-region="viewport"]')!;
            const init = {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true,
                clientX: point.x,
                clientY: point.y,
            };
            const over = new DragEvent("dragover", init);
            target.dispatchEvent(over);
            const dropped = new DragEvent("drop", init);
            target.dispatchEvent(dropped);
            return over.defaultPrevented && dropped.defaultPrevented;
        },
        {
            files: files.map((file) => ({
                name: file.name,
                bytes: [...file.buffer],
                type: file.name.endsWith(".png") ? "image/png" : "text/plain",
            })),
            point,
        },
    );
}
