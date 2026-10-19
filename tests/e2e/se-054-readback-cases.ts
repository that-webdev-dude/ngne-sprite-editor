import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { addFrame, openDocument, paint } from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import {
    ALL_FRAMES,
    BACKGROUNDS,
    frameIdOf,
    openPreviewEditor,
    previewCanvas,
    previewMismatches,
    previewSettled,
    readPreview,
    setPreview,
} from "./se-054-support";

// SE-054: the preview canvas read back in `afterFrame` (SPEC §6.7) against the composite of the
// frame it is paused on: opaque texels exact, transparent ones the background exactly, others
// within ±1 of the blend over the background. This is the first GPU check of the sprite
// runtime with `pixelSnap` off and of its top-left placement at the canvas origin (SE-053
// review). The tests are declared once per device pixel ratio (se-054-readback-*.spec.ts).

/** A test image: every texel differs from its neighbours; alpha runs through 255, 0 and partial. */
export function texels(width: number, height: number, seed: number): number[] {
    const alphas = [255, 255, 0, 128, 255, 64, 255, 200, 1, 254];
    const pixels: number[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const alpha = alphas[(x * 3 + y * 7 + seed) % alphas.length]!;
            pixels.push((x * 37 + seed * 61 + 11) & 255, (y * 53 + seed * 17 + 7) & 255);
            pixels.push((seed * 23 + (x + y) * 2) & 255, alpha);
        }
    }
    return pixels;
}

/** Keeps colour under alpha 0 out of the expected image, as the composite does (SPEC §5.3). */
export function composite(pixels: readonly number[]): number[] {
    const result = [...pixels];
    for (let at = 0; at < result.length; at += 4) {
        if (result[at + 3] === 0) result.fill(0, at, at + 4);
    }
    return result;
}

/** Opens a document of `frames` frames, frame i painted with `texels(…, i + 1)`. */
export async function documentWithFrames(
    page: Page,
    name: string,
    width: number,
    height: number,
    frames: number,
): Promise<{ document: TestDocument; images: number[][]; frameIds: string[] }> {
    const document = await openDocument(page, { name, width, height });
    const images: number[][] = [];
    const frameIds = [document.frameId];
    for (let index = 0; index < frames; index++) {
        if (index > 0) frameIds.push(await addFrame(page, document.id));
        const pixels = texels(width, height, index + 1);
        await paint(page, document.id, pixels, frameIds[index]);
        images.push(composite(pixels));
    }
    return { document, images, frameIds };
}

/** Declares the readback tests; the calling spec file has set Chrome up for `ratio`. */
export function readbackTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        for (const size of [
            { width: 32, height: 32 },
            { width: 33, height: 17 },
        ]) {
            test(`paused on frame k, a ${size.width}×${size.height} preview equals the composite of frame k; its CSS size times the ratio is a whole multiple of the document's`, async ({
                page,
            }) => {
                const errors = collectErrors(page);
                await openPreviewEditor(page);
                const name = "readback";
                const { images } = await documentWithFrames(page, name, size.width, size.height, 3);
                await setPreview(page, { chosen: ALL_FRAMES, playing: false });
                await previewSettled(page);
                for (const [background, under] of [
                    ["dark", BACKGROUNDS.dark],
                    ["light", BACKGROUNDS.light],
                ] as const) {
                    await setPreview(page, { background });
                    // Frame k shows from 100 k ms to 100 (k + 1) ms (default durations).
                    for (const k of [0, 2, 1]) {
                        await page.evaluate(
                            (age) => window.__ngneTest!.preview!.seek(age),
                            k * 100 + 50,
                        );
                        const read = await readPreview(page, frameIdOf(name, k));
                        expect([read.width, read.height]).toEqual([size.width, size.height]);
                        expect(previewMismatches(read, images[k]!, under).slice(0, 5)).toEqual([]);
                    }
                }

                // The canvas is shown at a whole number of device pixels per texel.
                const box = await previewCanvas(page).evaluate((canvas) => {
                    const rect = canvas.getBoundingClientRect();
                    return {
                        width: rect.width * devicePixelRatio,
                        height: rect.height * devicePixelRatio,
                    };
                });
                const scale = Math.round(box.width / size.width);
                expect(scale).toBeGreaterThanOrEqual(1);
                expect(box.width).toBeCloseTo(scale * size.width, 1);
                expect(box.height).toBeCloseTo(scale * size.height, 1);
                expect(errors).toEqual([]);
            });
        }

        test("with trim on, a frame's rectangle is placed at its offset from the canvas origin", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openPreviewEditor(page);
            const [width, height] = [33, 17];
            const document = await openDocument(page, { name: "trimmed", width, height });
            await page.evaluate((id) => {
                window.__ngneTest!.sessions.getState().updateExportSettings(id, (settings) => {
                    settings.trim = true;
                });
            }, document.id);
            // Content from (5, 3) to (19, 10): the rectangle is trimmed to it, an odd width
            // padded to an even one (SPEC §9.2).
            const full = texels(width, height, 4);
            const pixels = full.map((value, at) => {
                const x = (at >> 2) % width;
                const y = Math.floor((at >> 2) / width);
                return x >= 5 && x <= 19 && y >= 3 && y <= 10 ? value : 0;
            });
            await paint(page, document.id, pixels);
            await setPreview(page, { chosen: ALL_FRAMES, playing: false, background: "mid" });
            await previewSettled(page);
            const read = await readPreview(page, frameIdOf("trimmed", 0));
            expect(previewMismatches(read, composite(pixels), BACKGROUNDS.mid).slice(0, 5)).toEqual(
                [],
            );
            // The atlas holds the trimmed rectangle, not the whole frame.
            const size = await page.evaluate(() => window.__ngneTest!.preview!.publishedSize);
            expect(size!.width).toBeLessThan(width);
            expect(errors).toEqual([]);
        });
    });
}
