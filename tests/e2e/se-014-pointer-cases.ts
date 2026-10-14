import { expect, test } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openDocument, openViewportEditor, paint, pattern, settle } from "./se-011-support";
import {
    activeView,
    cursorField,
    deviceAt,
    devicePixel,
    EXACT_STEPS,
    geometry,
    pixelAt,
    texel,
    viewAtScale,
} from "./se-012-support";
import type { Point } from "./se-012-support";
import { celPixel, historyOf, selectTool, texelClient } from "./se-014-support";

// SE-014: where a stroke lands and what the zoom tool keeps under the pointer, at the device
// pixel ratios of SPEC §6.7 (each in a spec file of its own, se-014-pointer-*: a ratio needs a
// Chrome of its own, see `atDeviceRatio` in se-012-pointer-cases). At 1.25 Chrome reports a
// mouse on a device pixel just short of it; at 1.1 the viewport element starts between two
// device pixels.

const WIDTH = 40;
const HEIGHT = 30;
const BLACK = [0, 0, 0, 255];

/** Declares the pointer tests of the tools; the calling spec file set Chrome up for `ratio`. */
export function toolPointerTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        test("a dot lands on the texel under the pointer, on the first and the last device pixel of a texel", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            // No view is given: the document starts fitted and centred.
            const document = await openDocument(page, { width: WIDTH, height: HEIGHT });
            const pixels = pattern(WIDTH, HEIGHT, 6);
            await paint(page, document.id, pixels);
            await selectTool(page, "dot");
            await settle(page);
            expect(await page.evaluate(() => devicePixelRatio)).toBe(Math.fround(ratio));
            const layout = await geometry(page);
            const view = await activeView(page);
            expect(view.scale).toBeGreaterThanOrEqual(8);

            const cases: [Point, "first" | "last" | "centre"][] = [
                [{ x: 5, y: 4 }, "first"],
                [{ x: 7, y: 4 }, "last"],
                [{ x: 8, y: 4 }, "first"],
                [{ x: 0, y: 0 }, "first"],
                [{ x: 20, y: 15 }, "centre"],
                [{ x: WIDTH - 1, y: HEIGHT - 1 }, "last"],
            ];
            for (const [index, [target, where]] of cases.entries()) {
                const client = texelClient(layout, view, target, where);
                const device = deviceAt(layout, client);
                // The test's own arithmetic names the texel; the app's readout agrees.
                expect(
                    pixelAt(layout, view, client),
                    `${where} of ${target.x}, ${target.y}`,
                ).toEqual(target);
                await page.mouse.move(client.x, client.y);
                await expect(cursorField(page)).toHaveText(`${target.x}, ${target.y}`);
                await page.mouse.down();
                await page.mouse.up();
                expect(await historyOf(page, document.id)).toEqual({
                    undo: 2 + index,
                    open: false,
                });
                // The texel under the pointer, and no other, was written …
                expect(await celPixel(page, document.id, target)).toEqual(BLACK);
                for (const [dx, dy] of [
                    [1, 0],
                    [0, 1],
                ]) {
                    const beside = { x: target.x + dx, y: target.y + dy };
                    if (beside.x >= WIDTH || beside.y >= HEIGHT) continue;
                    if (
                        cases
                            .slice(0, index)
                            .some(([done]) => done.x === beside.x && done.y === beside.y)
                    ) {
                        continue;
                    }
                    expect(await celPixel(page, document.id, beside), `beside ${index}`).toEqual(
                        texel(pixels, WIDTH, beside.x, beside.y),
                    );
                }
                // … and it is the one the viewport shows under the pointer.
                await settle(page);
                expect(
                    await devicePixel(page, { x: Math.floor(device.x), y: Math.floor(device.y) }),
                ).toEqual(BLACK);
            }
            expect(errors).toEqual([]);
        });

        test("the zoom tool keeps the clicked document pixel under the pointer at every step from 1× up", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            const document = await openDocument(page, { width: WIDTH, height: HEIGHT });
            await paint(page, document.id, pattern(WIDTH, HEIGHT, 2));
            await selectTool(page, "zoom");
            await settle(page);
            const layout = await geometry(page);
            const start = await activeView(page);
            // The last device pixel of a texel off the document's centre.
            const client = texelClient(layout, start, { x: 23, y: 13 }, "last");
            const pixel = pixelAt(layout, start, client);
            expect(pixel).toEqual({ x: 23, y: 13 });
            await page.mouse.move(client.x, client.y);

            const at = EXACT_STEPS.indexOf(start.scale);
            expect(at).toBeGreaterThan(0);
            const up = EXACT_STEPS.slice(at + 1);
            const down = EXACT_STEPS.slice(0, -1).reverse();
            for (const scale of up) {
                await page.mouse.down();
                await page.mouse.up();
                const view = await viewAtScale(page, scale);
                expect(pixelAt(layout, view, client), `in to ${scale}×`).toEqual(pixel);
                await expect(cursorField(page)).toHaveText(`${pixel.x}, ${pixel.y}`);
            }
            await page.keyboard.down("Alt");
            for (const scale of down) {
                await page.mouse.down();
                await page.mouse.up();
                const view = await viewAtScale(page, scale);
                expect(pixelAt(layout, view, client), `out to ${scale}×`).toEqual(pixel);
            }
            await page.keyboard.up("Alt");
            expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
            expect(errors).toEqual([]);
        });
    });
}
