import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares the stroke echo's probe on `window.__ngneTest` (SE-015).
import type {} from "../../src/app/tools/strokeEcho.overlay";
import { collectErrors } from "./se-006-support";
import {
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
} from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { activeView, geometry, twoFrames } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlaySettled, setGrids } from "./se-013-support";
import { historyOf, texelClient } from "./se-014-support";
import { celBytes, setColours } from "./se-015-support";

// SE-015: the overlay stroke echo of SPEC §6.6, at the device pixel ratios of the spec files
// that call these cases (se-015-echo-dpr*). While the button is held and the viewport's
// uploads are held back (its probe's `uploadGate`), the overlay shows the stroke at once,
// pixel for pixel what NGNE shows once the upload is let through; after that the overlay is
// clear again and NGNE's readback shows the stroke. Escape clears the echo at once. The
// canvases are compared in the page, device pixel by device pixel.

const WIDTH = 40;
const HEIGHT = 30;
const MAGENTA = [255, 0, 255, 255];

declare global {
    interface Window {
        __se015Gate?: { open(): void };
        /** The overlay's pixels over the document, captured while the uploads were held. */
        __se015Held?: Uint8ClampedArray;
    }
}

/** What the page needs to find the document's texels on both canvases. */
interface Placement {
    view: View;
    width: number;
    height: number;
    /** Texels the stroke changed, `x,y`. */
    changed: string[];
    /** The texel under the pointer: the brush cursor's rings cover its neighbours. */
    last: Point;
}

/** Holds back every upload of the viewport until `openUploads`. */
function holdUploads(page: Page): Promise<void> {
    return page.evaluate(() => {
        let open = () => {};
        const gate = new Promise<void>((resolve) => (open = resolve));
        window.__se015Gate = { open };
        window.__ngneTest!.viewport!.uploadGate = () => gate;
    });
}

/** Lets the held uploads and every later one through. */
function openUploads(page: Page): Promise<void> {
    return page.evaluate(() => {
        window.__ngneTest!.viewport!.uploadGate = null;
        window.__se015Gate?.open();
    });
}

/** Waits until the overlay has drawn what was asked of it, and two frames more. */
async function overlayDrawn(page: Page): Promise<void> {
    await page.waitForFunction(() => window.__ngneTest?.overlay?.pending === false, undefined, {
        polling: 20,
    });
    await twoFrames(page);
}

function echoedRegions(page: Page): Promise<number> {
    return page.evaluate(() => window.__ngneTest!.strokeEcho!.regions);
}

/** Keeps the overlay's pixels over the document in the page (`__se015Held`). */
function captureOverlay(page: Page, view: View): Promise<void> {
    return page.evaluate(
        ({ view, width, height }) => {
            const canvas = document.querySelector<HTMLCanvasElement>(
                "[data-viewport] > canvas[data-viewport-overlay]",
            );
            const context = canvas?.getContext("2d");
            if (!context) throw new Error("se-015: no overlay");
            window.__se015Held = context.getImageData(
                view.originX,
                view.originY,
                width * view.scale,
                height * view.scale,
            ).data;
        },
        { view, width: WIDTH, height: HEIGHT },
    );
}

/**
 * Compares the overlay as captured with NGNE now, at every device pixel of the document but
 * the brush cursor's: a changed texel must have been echoed, and wherever the echo drew it
 * must be what NGNE shows now. With `stale`, NGNE is expected to show the changed texels
 * otherwise than the echo (the uploads are held). Returns the first mismatches.
 */
function compareEchoWithNgne(page: Page, placement: Placement, stale = false): Promise<string[]> {
    return page.evaluate(
        ({ view, width, height, changed, last, stale }) => {
            const held = window.__se015Held;
            const image = window.__ngneTest!.viewport!.readCanvas();
            if (!held || !image) throw new Error("se-015: nothing to compare");
            const isChanged = new Set(changed);
            const rowBytes = width * view.scale * 4;
            const wrong: string[] = [];
            for (let ty = 0; ty < height && wrong.length < 10; ty++) {
                for (let tx = 0; tx < width && wrong.length < 10; tx++) {
                    if (Math.max(Math.abs(tx - last.x), Math.abs(ty - last.y)) === 1) continue;
                    const texelChanged = isChanged.has(`${tx},${ty}`);
                    for (let dy = 0; dy < view.scale; dy++) {
                        for (let dx = 0; dx < view.scale; dx++) {
                            const ox = tx * view.scale + dx;
                            const oy = ty * view.scale + dy;
                            const at = oy * rowBytes + ox * 4;
                            if (!texelChanged && held[at + 3] === 0) continue;
                            if (texelChanged && held[at + 3] === 0) {
                                wrong.push(`texel ${tx}, ${ty} changed and not echoed`);
                                continue;
                            }
                            const ng = ((view.originY + oy) * image.width + view.originX + ox) * 4;
                            const same =
                                held[at] === image.data[ng] &&
                                held[at + 1] === image.data[ng + 1] &&
                                held[at + 2] === image.data[ng + 2] &&
                                held[at + 3] === image.data[ng + 3];
                            if (stale ? texelChanged && same : !same) {
                                wrong.push(
                                    `texel ${tx}, ${ty} at ${ox}, ${oy}: echo ` +
                                        `${Array.from(held.subarray(at, at + 4))}, NGNE ` +
                                        `${Array.from(image.data.subarray(ng, ng + 4))}`,
                                );
                            }
                        }
                    }
                }
            }
            return wrong;
        },
        { ...placement, stale },
    );
}

/** The overlay over the document is clear, but at the brush cursor. Returns the mismatches. */
function overlayClear(page: Page, placement: Placement): Promise<string[]> {
    return page.evaluate(({ view, width, height, last }) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
            "[data-viewport] > canvas[data-viewport-overlay]",
        );
        const context = canvas?.getContext("2d");
        if (!context) throw new Error("se-015: no overlay");
        const { data } = context.getImageData(
            view.originX,
            view.originY,
            width * view.scale,
            height * view.scale,
        );
        const rowBytes = width * view.scale * 4;
        const wrong: string[] = [];
        for (let y = 0; y < height * view.scale; y++) {
            for (let x = 0; x < width * view.scale; x++) {
                const tx = Math.floor(x / view.scale);
                const ty = Math.floor(y / view.scale);
                if (Math.max(Math.abs(tx - last.x), Math.abs(ty - last.y)) <= 1) continue;
                const alpha = data[y * rowBytes + x * 4 + 3];
                if (alpha !== 0 && wrong.length < 10) wrong.push(`${x}, ${y}: alpha ${alpha}`);
            }
        }
        return wrong;
    }, placement);
}

/** The texels of two RGBA images of the document that differ, as `x,y`. */
function changedTexels(before: readonly number[], after: readonly number[]): string[] {
    const changed: string[] = [];
    for (let index = 0; index < WIDTH * HEIGHT; index++) {
        const at = index * 4;
        if (before.slice(at, at + 4).join() !== after.slice(at, at + 4).join()) {
            changed.push(`${index % WIDTH},${Math.floor(index / WIDTH)}`);
        }
    }
    return changed;
}

interface Setup {
    document: TestDocument;
    view: View;
    clientOf(texel: Point): Point;
}

async function setUp(page: Page, ratio: number): Promise<Setup> {
    await openViewportEditor(page);
    // No view is given: the document starts fitted and centred.
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT });
    await paint(page, document.id, pattern(WIDTH, HEIGHT, 4));
    // The overlay shows the echo and the brush cursor alone: no grid.
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    await setColours(page, 0xff00ffff, 0xffffffff);
    await settle(page);
    await overlaySettled(page);
    expect(await page.evaluate(() => devicePixelRatio)).toBe(Math.fround(ratio));
    const layout = await geometry(page);
    const view = await activeView(page);
    expect(view.scale).toBeGreaterThanOrEqual(4);
    expect(await page.evaluate(() => window.__ngneTest!.strokeEcho!.enabled)).toBe(true);
    return { document, view, clientOf: (texel) => texelClient(layout, view, texel) };
}

/** Declares the echo tests; the calling spec file has set Chrome up for `ratio`. */
export function strokeEchoTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        for (const tool of ["pencil", "eraser"] as const) {
            test(`with the uploads held back, the ${tool}'s stroke shows on the overlay as NGNE then shows it; drawn, the overlay is clear again`, async ({
                page,
            }) => {
                const errors = collectErrors(page);
                const { document, view, clientOf } = await setUp(page, ratio);
                await page.evaluate(
                    (tool) => window.__ngneTest!.editor.getState().setTool(tool),
                    tool,
                );
                const before = await celBytes(page, document.id);
                const path: Point[] = [
                    { x: 4, y: 4 },
                    { x: 16, y: 6 },
                    { x: 16, y: 18 },
                    { x: 30, y: 24 },
                ];
                const last = path.at(-1)!;
                await holdUploads(page);
                const start = clientOf(path[0]!);
                await page.mouse.move(start.x, start.y);
                await page.mouse.down();
                for (const texel of path.slice(1)) {
                    const client = clientOf(texel);
                    await page.mouse.move(client.x, client.y, { steps: 3 });
                }
                await overlayDrawn(page);
                expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
                expect(await echoedRegions(page)).toBeGreaterThan(0);
                const during = (await celBytes(page, document.id))!;
                const changed = changedTexels(before!, during);
                expect(changed.length).toBeGreaterThan(30);
                const placement: Placement = { view, width: WIDTH, height: HEIGHT, changed, last };
                await captureOverlay(page, view);
                // NGNE has not had the stroke yet: the echo alone shows it.
                expect(await compareEchoWithNgne(page, placement, true)).toEqual([]);
                if (tool === "pencil") {
                    const [x, y] = changed[0]!.split(",").map(Number) as [number, number];
                    const at = await page.evaluate(
                        ({ x, y, view, width }) => {
                            const offset =
                                (y * view.scale * width * view.scale + x * view.scale) * 4;
                            return Array.from(window.__se015Held!.subarray(offset, offset + 4));
                        },
                        { x, y, view, width: WIDTH },
                    );
                    expect(at).toEqual(MAGENTA);
                }

                // The uploads go through: NGNE shows what the echo showed, the echo is gone.
                await openUploads(page);
                await settle(page);
                await overlayDrawn(page);
                expect(await echoedRegions(page)).toBe(0);
                expect(await compareEchoWithNgne(page, placement)).toEqual([]);
                expect(await overlayClear(page, placement)).toEqual([]);
                await expectImage(page, document, view, during);

                await page.mouse.up();
                expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
                await settle(page);
                await overlayDrawn(page);
                expect(await echoedRegions(page)).toBe(0);
                expect(await overlayClear(page, placement)).toEqual([]);
                await expectImage(page, document, view, (await celBytes(page, document.id))!);
                expect(errors).toEqual([]);
            });
        }

        test("Escape clears the echo at once, and NGNE shows the pixels as they were", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            const { document, view, clientOf } = await setUp(page, ratio);
            const before = await celBytes(page, document.id);
            await holdUploads(page);
            const last = { x: 26, y: 20 };
            const start = clientOf({ x: 6, y: 6 });
            const end = clientOf(last);
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            await page.mouse.move(end.x, end.y, { steps: 4 });
            await overlayDrawn(page);
            expect(await echoedRegions(page)).toBeGreaterThan(0);
            await page.keyboard.press("Escape");
            expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
            expect(await echoedRegions(page)).toBe(0);
            // The next redraw of the overlay has no echo, though NGNE has had no upload.
            await overlayDrawn(page);
            const placement: Placement = { view, width: WIDTH, height: HEIGHT, changed: [], last };
            expect(await overlayClear(page, placement)).toEqual([]);
            await page.mouse.up();
            await openUploads(page);
            await settle(page);
            expect(await celBytes(page, document.id)).toEqual(before);
            await expectImage(page, document, view, before!);
            expect(errors).toEqual([]);
        });
    });
}
