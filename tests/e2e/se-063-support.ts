import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { menuItem, openMenu } from "./se-007-support";
// The page imports this module from the dev server; here it is needed for its types.
import type * as DocumentsModule from "./se-063-documents";

// Shared helpers of the SE-063 specs: the GIF fixtures opened in the editor, the Export GIF
// dialog, and the browser's own GIF decoder (`ImageDecoder`, WebCodecs) reading an export back.

/** Opens a document of se-063-documents.ts as the active session; returns its id. */
export function openGifFixture(page: Page, fixture: "fourFrames" | "manyColours"): Promise<string> {
    return page.evaluate(async (which) => {
        const path = "/tests/e2e/se-063-documents.ts";
        const documents = (await import(/* @vite-ignore */ path)) as typeof DocumentsModule;
        const doc = documents[which]();
        const session = {
            doc,
            selection: null,
            activeLayerId: doc.layers[0]!.id,
            activeFrameId: doc.frames[0]!.id,
        };
        return window.__ngneTest!.sessions.getState().open(session).id;
    }, fixture);
}

export const gifDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Export GIF" });

/** Opens Export GIF… from the File menu and waits until its dialog holds the focus. */
export async function openGifDialog(page: Page): Promise<Locator> {
    await openMenu(page, "File");
    await menuItem(page, "file.exportGif").click();
    const dialog = gifDialog(page);
    await expect(dialog).toBeVisible();
    await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
    return dialog;
}

/** Clicks the dialog's Export and returns the bytes and name of the GIF it downloads. */
export async function exportAndDownload(
    page: Page,
    dialog: Locator,
): Promise<{ name: string; bytes: Uint8Array }> {
    const downloading = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloading;
    return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

/** A GIF as Chrome's `ImageDecoder` reads it. */
export interface BrowserDecodedGif {
    frameCount: number;
    /** `repetitionCount` of the track: how often the animation repeats after its first play. */
    repetitionCount: number | "Infinity";
    /** Per frame: its duration in ms. */
    durations: number[];
    width: number;
    height: number;
    /** Per frame: the RGBA pixels Chrome shows, the frames before composed in (disposal). */
    images: number[][];
}

/** Decodes GIF bytes in the page with `ImageDecoder` ("image/gif"). */
export function decodeInBrowser(page: Page, bytes: Uint8Array): Promise<BrowserDecodedGif> {
    return page.evaluate(async (data) => {
        interface DecodedImage {
            displayWidth: number;
            displayHeight: number;
            duration: number | null;
            close(): void;
        }
        interface Decoder {
            tracks: {
                ready: Promise<void>;
                selectedTrack: { frameCount: number; repetitionCount: number } | null;
            };
            completed: Promise<void>;
            decode(options: { frameIndex: number }): Promise<{ image: DecodedImage }>;
            close(): void;
        }
        const ImageDecoderClass = (
            window as unknown as {
                ImageDecoder: new (init: { data: Uint8Array; type: string }) => Decoder;
            }
        ).ImageDecoder;
        const decoder = new ImageDecoderClass({ data: Uint8Array.from(data), type: "image/gif" });
        await decoder.tracks.ready;
        await decoder.completed;
        const track = decoder.tracks.selectedTrack!;
        const durations: number[] = [];
        const images: number[][] = [];
        let width = 0;
        let height = 0;
        for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
            const { image } = await decoder.decode({ frameIndex });
            width = image.displayWidth;
            height = image.displayHeight;
            durations.push((image.duration ?? 0) / 1000);
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext("2d")!;
            context.drawImage(image as unknown as CanvasImageSource, 0, 0);
            images.push(Array.from(context.getImageData(0, 0, width, height).data));
            image.close();
        }
        decoder.close();
        const repetitionCount = Number.isFinite(track.repetitionCount)
            ? track.repetitionCount
            : ("Infinity" as const);
        return { frameCount: track.frameCount, repetitionCount, durations, width, height, images };
    }, Array.from(bytes));
}

/**
 * What a GIF shows of a composite, scaled by `scale`: pixels of alpha 128 and above opaque
 * with their colour, every other pixel 0, 0, 0, 0 (SPEC §9.6).
 */
export function gifImage(composite: readonly number[], width: number, scale = 1): number[] {
    const height = composite.length / 4 / width;
    const out: number[] = [];
    for (let y = 0; y < height * scale; y++) {
        for (let x = 0; x < width * scale; x++) {
            const at = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
            const shown = composite[at + 3]! >= 128;
            out.push(
                ...(shown
                    ? [composite[at]!, composite[at + 1]!, composite[at + 2]!, 255]
                    : [0, 0, 0, 0]),
            );
        }
    }
    return out;
}
