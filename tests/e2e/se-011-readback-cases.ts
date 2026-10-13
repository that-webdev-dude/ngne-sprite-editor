import { expect, test } from "@playwright/test";
import { boxOf, collectErrors } from "./se-006-support";
import {
    compare,
    DARK,
    documentRect,
    expectImage,
    hostDeviceSize,
    openDocument,
    openViewportEditor,
    paint,
    readback,
    settle,
    viewportHost,
} from "./se-011-support";
import type { Checker } from "./se-011-support";

// SE-011: the image NGNE draws, read back from the canvas in the page (SPEC §6.7). The tests
// are declared by `readbackTests`, once per device pixel ratio: a ratio other than the
// configured one needs its own Chrome, so it has its own spec file (se-011-readback-*).

// A 5×3 document with every kind of texel. Opaque texels differ from all their neighbours.
const WIDTH = 5;
const HEIGHT = 3;
// prettier-ignore
const TEXELS: readonly (readonly [number, number, number, number])[] = [
    [255, 0, 0, 255],   [0, 255, 0, 255],     [0, 0, 255, 255],     [255, 255, 0, 255],   [255, 255, 255, 255],
    [200, 40, 90, 128], [10, 220, 130, 64],   [250, 250, 250, 200], [0, 0, 0, 1],         [33, 66, 99, 254],
    [0, 0, 0, 255],     [0, 0, 0, 0],         [17, 34, 51, 255],    [255, 128, 0, 77],    [128, 0, 255, 255],
];
const PIXELS = TEXELS.flat();
const VIEW = { scale: 8, originX: 40, originY: 24 };
// Squares of two document pixels: both checkerboard colours lie under the document.
const CHECKER: Checker = { a: [0x20, 0x60, 0xa0], b: [0xe0, 0xc0, 0x40], size: 2 };

/** Declares the readback tests; the calling spec file has set Chrome up for `ratio`. */
export function readbackTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        test("a 5×3 document at scale 8: every texel is 8×8 device pixels, in place, with exact colours", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            await page.evaluate(
                (checker) =>
                    window.__ngneTest!.preferences.set("checkerboard", {
                        size: checker.size,
                        colors: { a: checker.a, b: checker.b },
                    }),
                { size: CHECKER.size, a: 0x2060a0, b: 0xe0c040 },
            );
            const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
            await paint(page, document.id, PIXELS);
            await settle(page);

            // The canvas backing size is the viewport element's size in device pixels, as a
            // `ResizeObserver` reports it. That is the element's CSS size times the ratio, up
            // to the half pixel a track of odd CSS size leaves at 1.5: with the emulated
            // ratio alone it would be the CSS size (SE-002 finding 7.1).
            expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);
            const host = await boxOf(viewportHost(page));
            const backing = await hostDeviceSize(page);
            expect(Math.abs(backing.width - host.width * ratio)).toBeLessThan(1);
            expect(Math.abs(backing.height - host.height * ratio)).toBeLessThan(1);
            const rect = documentRect(document, VIEW);
            const result = await readback(page, rect);
            expect(result.size).toEqual(backing);
            expect(
                await viewportHost(page)
                    .locator("canvas")
                    .evaluateAll((all) =>
                        (all as HTMLCanvasElement[]).map((canvas) => [canvas.width, canvas.height]),
                    ),
            ).toEqual([[backing.width, backing.height]]);

            // 40×24 device pixels at (40, 24); nothing of the document outside them.
            expect(rect).toEqual({ x: 40, y: 24, width: 40, height: 24 });
            expect(compare(result.crop, PIXELS, WIDTH, VIEW.scale, CHECKER)).toEqual([]);
            expect(result.outside).toBe(0);

            // Opaque texels are exact, the transparent one is the bare checkerboard.
            const texel = (x: number, y: number) => {
                const at = ((y * VIEW.scale + 3) * rect.width + x * VIEW.scale + 3) * 4;
                return result.crop.data.slice(at, at + 4);
            };
            expect(texel(0, 0)).toEqual([255, 0, 0, 255]);
            expect(texel(4, 0)).toEqual([255, 255, 255, 255]);
            expect(texel(0, 2)).toEqual([0, 0, 0, 255]);
            expect(texel(4, 2)).toEqual([128, 0, 255, 255]);
            expect(texel(1, 2)).toEqual([...CHECKER.b, 255]);
            expect(errors).toEqual([]);
        });

        test("semi-transparent texels show the checkerboard blended within ±1 per channel", async ({
            page,
        }) => {
            await openViewportEditor(page);
            // The theme's checkerboard in squares of 8: the 16×16 document covers four.
            const view = { scale: 3, originX: 17, originY: 9 };
            const size = 16;
            const pixels: number[] = [];
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    // Every alpha from 0 to 255 once, over colours that use all channels.
                    pixels.push((x * 16 + 7) & 255, (y * 16 + 3) & 255, (x * y * 5) & 255);
                    pixels.push(y * size + x);
                }
            }
            const document = await openDocument(page, { width: size, height: size }, view);
            await paint(page, document.id, pixels);
            await settle(page);

            const result = await readback(page, documentRect(document, view));
            expect(compare(result.crop, pixels, size, view.scale).slice(0, 5)).toEqual([]);
            expect(result.outside).toBe(0);

            // The comparison is not vacuous: a blended texel is neither its own colour nor
            // the checkerboard.
            const at = ((5 * view.scale + 1) * result.crop.width + 9 * view.scale + 1) * 4;
            const blended = result.crop.data.slice(at, at + 3);
            expect(blended).not.toEqual([...DARK.checkerA]);
            expect(blended).not.toEqual(pixels.slice((5 * size + 9) * 4, (5 * size + 9) * 4 + 3));
            await expectImage(page, document, view, pixels);
        });
    });
}
