import { expect, test } from "@playwright/test";
import type { LaunchOptions } from "@playwright/test";
import { collectErrors, region } from "./se-006-support";
import {
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    setView,
    settle,
} from "./se-011-support";
import {
    activeView,
    clientAt,
    cursorField,
    deviceAt,
    devicePixel,
    EXACT_STEPS,
    fittedView,
    geometry,
    pixelAt,
    texel,
    viewAtScale,
    wheel,
} from "./se-012-support";
import type { Point } from "./se-012-support";

// SE-012: what depends on the mapping between the pointer and the document — the zoom about
// the cursor and the cursor readout. The tests are declared by `pointerTests`, once per
// device pixel ratio: a ratio other than the configured one needs its own Chrome, so it has
// its own spec file (se-012-pointer-*). At 1.25 and 1.5 a whole device pixel is a fraction of
// a CSS pixel, which is where a mapping goes wrong: Chrome reports the position of a mouse on
// a device pixel as a 32-bit float of CSS pixels, at 1.25 often just short of that pixel, and
// a wheel event reports whole CSS pixels only.

const WIDTH = 64;
const HEIGHT = 48;

/**
 * Starts the Chrome of the calling spec file at `ratio`. As in se-011-readback-dpr15:
 * `devicePixelContentBoxSize`, which sizes the canvas, follows the browser's own scale factor
 * and not the emulated one (SE-002 finding 7.1), so the configured launch arguments are kept
 * and only `--force-device-scale-factor` is replaced. Launch options belong to the worker,
 * which is why they are set for the whole file.
 */
export function atDeviceRatio(ratio: number): void {
    test.use({
        deviceScaleFactor: ratio,
        launchOptions: [
            async (
                { launchOptions }: { launchOptions: LaunchOptions },
                use: (options: LaunchOptions) => Promise<void>,
            ) => {
                const kept = (launchOptions.args ?? []).filter(
                    (argument) => !argument.startsWith("--force-device-scale-factor"),
                );
                await use({
                    ...launchOptions,
                    args: [...kept, `--force-device-scale-factor=${ratio}`],
                });
            },
            { scope: "worker" },
        ],
    });
}

/** Declares the pointer tests; the calling spec file has set Chrome up for `ratio`. */
export function pointerTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        test("zooming with the wheel keeps the document pixel under the cursor fixed, for every step ≥ 1", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            // No view is given: the document starts fitted and centred.
            const document = await openDocument(page, { width: WIDTH, height: HEIGHT });
            const pixels = pattern(WIDTH, HEIGHT, 3);
            await paint(page, document.id, pixels);
            await settle(page);
            expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);

            const layout = await geometry(page);
            const start = await activeView(page);
            expect(start).toEqual(fittedView(document, layout.device));
            const at = EXACT_STEPS.indexOf(start.scale);
            expect(at).toBeGreaterThan(0);
            const down = EXACT_STEPS.slice(0, at).reverse();
            const up = EXACT_STEPS.slice(1);
            const backDown = EXACT_STEPS.slice(0, -1).reverse();

            // Cursors on whole device pixels over the document, off its centre; at a ratio of
            // 1.5 two of them are fractions of a CSS pixel.
            const centre = { x: layout.device.width / 2, y: layout.device.height / 2 };
            const cursors: Point[] = [
                { x: Math.floor(centre.x) + 37, y: Math.floor(centre.y) - 21 },
                { x: Math.floor(centre.x) - 110, y: Math.floor(centre.y) + 52 },
                { x: Math.floor(centre.x) + 200, y: Math.floor(centre.y) - 149 },
            ];

            for (const [index, device] of cursors.entries()) {
                const client = clientAt(layout, device);
                expect(deviceAt(layout, client).x).toBeCloseTo(device.x, 6);
                await setView(page, document.id, start);
                await page.mouse.move(client.x, client.y);

                const pixel = pixelAt(layout, start, client);
                expect(pixel.x).toBeGreaterThanOrEqual(0);
                expect(pixel.x).toBeLessThan(WIDTH);
                expect(pixel.y).toBeGreaterThanOrEqual(0);
                expect(pixel.y).toBeLessThan(HEIGHT);
                const colour = texel(pixels, WIDTH, pixel.x, pixel.y);
                await expect(cursorField(page)).toHaveText(`${pixel.x}, ${pixel.y}`);

                /** One notch of the wheel: the next step, and the same pixel under the cursor. */
                const step = async (direction: 1 | -1, scale: number, readback: boolean) => {
                    await wheel(page, direction);
                    const view = await viewAtScale(page, scale);
                    expect(pixelAt(layout, view, client), `to ${scale}×`).toEqual(pixel);
                    expect(Number.isInteger(view.originX) && Number.isInteger(view.originY)).toBe(
                        true,
                    );
                    // The readout of the app agrees …
                    await expect(cursorField(page)).toHaveText(`${pixel.x}, ${pixel.y}`);
                    // … and so does the image: the device pixel under the cursor shows that
                    // texel. This is read from the canvas, not worked out from the view.
                    if (readback) {
                        await settle(page);
                        expect(await devicePixel(page, device), `image at ${scale}×`).toEqual(
                            colour,
                        );
                    }
                };

                for (const scale of down) await step(-1, scale, false);
                // Every step from 1 to 64; the image is read at each one for the first cursor.
                for (const scale of up) await step(1, scale, index === 0);
                for (const scale of backDown) await step(-1, scale, index === 0 && scale <= 3);
                expect((await activeView(page)).scale).toBe(1);
            }
            expect(errors).toEqual([]);
        });

        test("the status bar shows the document pixel under the cursor in whole numbers, and nothing outside the document", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            const width = 5;
            const height = 3;
            const document = await openDocument(page, { width, height });
            await settle(page);
            const layout = await geometry(page);
            const field = cursorField(page);

            const move = async (device: Point) => {
                const client = clientAt(layout, device);
                await page.mouse.move(client.x, client.y);
            };

            for (const view of [
                // At 1× every device pixel is a document pixel.
                { scale: 1, originX: 201, originY: 99 },
                { scale: 3, originX: 17, originY: 9 },
                { scale: 16, originX: 40, originY: 24 },
            ]) {
                await setView(page, document.id, view);
                const { scale, originX, originY } = view;
                for (const [x, y] of [
                    [0, 0],
                    [width - 1, 0],
                    [0, height - 1],
                    [width - 1, height - 1],
                    [2, 1],
                ] as const) {
                    // The first and the last device pixel of the document pixel.
                    for (const inset of [0, scale - 1]) {
                        await move({
                            x: originX + x * scale + inset,
                            y: originY + y * scale + inset,
                        });
                        await expect(field, `${scale}×, pixel ${x}, ${y}`).toHaveText(`${x}, ${y}`);
                        expect(await field.textContent()).toMatch(/^\d+, \d+$/);
                    }
                }

                // One device pixel outside each edge of the document: no cursor field.
                const right = originX + width * scale;
                const bottom = originY + height * scale;
                for (const outside of [
                    { x: originX - 1, y: originY },
                    { x: originX, y: originY - 1 },
                    { x: right, y: bottom - 1 },
                    { x: right - 1, y: bottom },
                    { x: originX - 1, y: originY - 1 },
                    { x: right, y: bottom },
                ]) {
                    // Inside first, so the field is seen to go.
                    await move({ x: originX, y: originY });
                    await expect(field).toHaveText("0, 0");
                    await move(outside);
                    await expect(field, `${scale}×, outside`).toHaveCount(0);
                }
            }

            // Over the workspace, far from the document, and outside the viewport: nothing.
            await move({ x: layout.device.width - 5, y: layout.device.height - 5 });
            await expect(field).toHaveCount(0);
            await move({ x: 40, y: 24 });
            await expect(field).toHaveText("0, 0");
            const dock = await region(page, "dock").boundingBox();
            await page.mouse.move((dock?.x ?? 0) + 40, (dock?.y ?? 0) + 200);
            await expect(field).toHaveCount(0);
            expect(errors).toEqual([]);
        });

        test("the readout names the pixel under the mouse on every device pixel of a row", async ({
            page,
        }) => {
            await openViewportEditor(page);
            const document = await openDocument(page, { width: WIDTH, height: HEIGHT });
            await settle(page);
            const layout = await geometry(page);
            const field = cursorField(page);
            // A view whose device pixels are odd and even, whole and fractional CSS pixels.
            const originX = 101;
            const originY = 61;

            // At 1× a device pixel is a document pixel: one device pixel off is one pixel off.
            await setView(page, document.id, { scale: 1, originX, originY });
            for (let x = 0; x < WIDTH; x++) {
                const y = (x * 7) % HEIGHT;
                const client = clientAt(layout, { x: originX + x, y: originY + y });
                await page.mouse.move(client.x, client.y);
                await expect(field, `device pixel ${originX + x}`).toHaveText(`${x}, ${y}`);
            }

            // At 3× the first device pixel of each document pixel is where it would slip.
            await setView(page, document.id, { scale: 3, originX, originY });
            for (let x = 0; x < WIDTH; x += 3) {
                const y = (x * 5) % HEIGHT;
                const client = clientAt(layout, { x: originX + x * 3, y: originY + y * 3 });
                await page.mouse.move(client.x, client.y);
                await expect(field, `pixel ${x} at 3×`).toHaveText(`${x}, ${y}`);
            }
        });
    });
}
