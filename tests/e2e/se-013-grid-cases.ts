import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { boxOf, collectErrors } from "./se-006-support";
import {
    hostDeviceSize,
    openDocument,
    openViewportEditor,
    paint,
    setView,
    settle,
    viewportHost,
} from "./se-011-support";
import { geometry, viewportArea } from "./se-012-support";
import {
    overlayCanvas,
    overlaySettled,
    setGrids,
    shot,
    startSampling,
    stopSampling,
} from "./se-013-support";
import type { Shot } from "./se-013-support";

// SE-013: the overlay's lines against the image NGNE draws, on the screen (SPEC §6.7: where
// overlay and NGNE canvas alignment matters, a screenshot of both canvases). The tests are
// declared by `gridTests`, once per device pixel ratio: a ratio other than the configured one
// needs its own Chrome, so it has its own spec file (se-013-grid-*).
//
// Every texel of the test document has a colour of its own, so the screenshot without the
// grids shows where NGNE starts each texel. With the grids, the pixels of a line must be
// exactly the first device pixels of the texels (of the tiles), the document's first texel
// included, tinted by the grid's ink; every other pixel of the canvases, inside the document
// and outside it, must be untouched.

const WIDTH = 12;
const HEIGHT = 8;
/** A tile grid with a line inside the document on both axes, and a negative offset. */
const TILES = { width: 5, height: 3, offsetX: 2, offsetY: -1 };
const TILE_COLUMNS = [2, 7];
const TILE_ROWS = [2, 5];
/** Dark theme (DESIGN §3.1, §6): white ink; the outline is `--border-strong`. */
const INK = 255;
const OUTLINE = [0x3a, 0x3a, 0x40, 255];
const WORKSPACE = [0x0f, 0x0f, 0x10, 255];
const PIXEL_ALPHA = 0.12;
const TILE_ALPHA = 0.25;
/**
 * The overlay stores its colour with 8-bit alpha and the compositor blends in 8 bits: a line
 * pixel is within 2 of the exact blend. Texel channels are at most 160, so a pixel grid line
 * changes each channel by at least 11.
 */
const TOLERANCE = 2;
/** At most this many differing pixels are listed. */
const LIMIT = 8;

/** Opaque, one colour per texel, every channel at most 160. */
function texels(): number[] {
    const pixels: number[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            pixels.push(16 + x * 11, 16 + y * 17, 40 + ((x * 3 + y * 5) % 16) * 7, 255);
        }
    }
    return pixels;
}
const PIXELS = texels();

function texelColour(x: number, y: number): number[] {
    const at = (y * WIDTH + x) * 4;
    return PIXELS.slice(at, at + 4);
}

const blend = (colour: readonly number[], alpha: number) =>
    colour.slice(0, 3).map((channel) => channel + (INK - channel) * alpha);

/** What kind of line covers a device pixel of the document, at `scale`. */
function lineAt(dx: number, dy: number, scale: number, tiles: boolean): "tile" | "pixel" | null {
    // The first device pixel of every texel, the first texel's included (the mockup's grid).
    const column = dx % scale === 0 ? dx / scale : null;
    const row = dy % scale === 0 ? dy / scale : null;
    if (tiles && (TILE_COLUMNS.includes(column ?? -1) || TILE_ROWS.includes(row ?? -1))) {
        return "tile";
    }
    return column !== null || row !== null ? "pixel" : null;
}

type View = { scale: number; originX: number; originY: number };

/** Where the canvases are on the screen and where the document is on them. */
interface Placement {
    /** The device pixel of the screen at the viewport element's corner. */
    left: number;
    top: number;
    /** The canvases' size in device pixels. */
    device: { width: number; height: number };
    view: View;
}

/** The screen pixel of a device pixel of the canvases. */
function at(shown: Shot, place: Placement, x: number, y: number): number[] {
    return shown.at(place.left + x, place.top + y);
}

/** Whether a device pixel of the canvases lies inside the document rectangle. */
function inDocument(place: Placement, x: number, y: number): boolean {
    const { scale, originX, originY } = place.view;
    return (
        x >= originX && x < originX + WIDTH * scale && y >= originY && y < originY + HEIGHT * scale
    );
}

/** Device pixels of the document rectangle where `test` fails, at most `LIMIT` of them. */
function mismatches(place: Placement, test: (dx: number, dy: number) => string | null): string[] {
    const { scale } = place.view;
    const found: string[] = [];
    for (let dy = 0; dy < HEIGHT * scale && found.length < LIMIT; dy++) {
        for (let dx = 0; dx < WIDTH * scale && found.length < LIMIT; dx++) {
            const problem = test(dx, dy);
            if (problem) found.push(`(${dx}, ${dy}) ${problem}`);
        }
    }
    return found;
}

/**
 * Device pixels of the canvases outside the document rectangle, the outline included, that
 * differ between two screenshots; at most `LIMIT` of them.
 */
function outsideMismatches(place: Placement, shown: Shot, plain: Shot): string[] {
    const found: string[] = [];
    const { width, height } = place.device;
    for (let y = 0; y < height && found.length < LIMIT; y++) {
        for (let x = 0; x < width && found.length < LIMIT; x++) {
            if (inDocument(place, x, y)) continue;
            const index = ((place.top + y) * shown.width + place.left + x) * 4;
            for (let channel = 0; channel < 4; channel++) {
                if (shown.data[index + channel] !== plain.data[index + channel]) {
                    found.push(
                        `(${x}, ${y}) ${at(plain, place, x, y)} shows ${at(shown, place, x, y)}`,
                    );
                    break;
                }
            }
        }
    }
    return found;
}

/** The ring 1 device pixel outside the document, as far as it lies on the canvases. */
function outlinePixels(place: Placement): [number, number][] {
    const { scale, originX, originY } = place.view;
    const right = originX + WIDTH * scale;
    const bottom = originY + HEIGHT * scale;
    const ring: [number, number][] = [];
    for (let x = originX - 1; x <= right; x++) ring.push([x, originY - 1], [x, bottom]);
    for (let y = originY; y < bottom; y++) ring.push([originX - 1, y], [right, y]);
    return ring.filter(
        ([x, y]) => x >= 0 && y >= 0 && x < place.device.width && y < place.device.height,
    );
}

/**
 * Takes the screen without grids, with the pixel grid and with both grids, for a document
 * painted with `PIXELS` at `view`, and checks every device pixel of the canvases: NGNE's
 * texels at their places, the outline all round, the lines on the first device pixel of each
 * texel and tile with their ink, and nothing else changed anywhere on the canvases.
 */
async function expectGridsOnScreen(page: Page, id: string, view: View): Promise<void> {
    const { scale } = view;
    await setGrids(page, id, { pixelGrid: false, grid: { ...TILES, visible: false } });
    // Nothing at the pointer is in the picture.
    await page.mouse.move(1, 1);
    await overlaySettled(page);
    const layout = await geometry(page);
    const place: Placement = {
        left: Math.round(layout.left * layout.ratio),
        top: Math.round(layout.top * layout.ratio),
        device: layout.device,
        view,
    };

    // No grid: NGNE's texels, each `scale` × `scale` device pixels from the view's origin,
    // and the outline just outside them, all round.
    const plain = await shot(page);
    const texel = (dx: number, dy: number) =>
        texelColour(Math.floor(dx / scale), Math.floor(dy / scale));
    const screenAt = (shown: Shot, dx: number, dy: number) =>
        at(shown, place, view.originX + dx, view.originY + dy);
    expect(
        mismatches(place, (dx, dy) => {
            const shown = screenAt(plain, dx, dy);
            const expected = texel(dx, dy);
            return shown.join() === expected.join() ? null : `shows ${shown} for texel ${expected}`;
        }),
    ).toEqual([]);
    const ring = outlinePixels(place);
    expect(ring.length).toBe(2 * (WIDTH * scale + 2) + 2 * HEIGHT * scale);
    expect(
        ring
            .filter(([x, y]) => at(plain, place, x, y).join() !== OUTLINE.join())
            .slice(0, LIMIT)
            .map(([x, y]) => `outline at ${x}, ${y}: ${at(plain, place, x, y)}`),
    ).toEqual([]);
    const right = WIDTH * scale;
    const bottom = HEIGHT * scale;
    for (const [dx, dy] of [
        [-1, -1],
        [-1, 5],
        [right, 0],
        [right, bottom],
        [7, -1],
        [3, bottom],
    ] as const) {
        expect(screenAt(plain, dx, dy), `outline at ${dx}, ${dy}`).toEqual(OUTLINE);
    }
    for (const [dx, dy] of [
        [-2, 0],
        [right + 1, 4],
        [0, -2],
        [9, bottom + 1],
    ] as const) {
        expect(screenAt(plain, dx, dy), `workspace at ${dx}, ${dy}`).toEqual(WORKSPACE);
    }

    /** Compares the document's pixels of a screenshot with the plain one. */
    const check = (shown: Shot, tiles: boolean) =>
        mismatches(place, (dx, dy) => {
            const under = screenAt(plain, dx, dy);
            const actual = screenAt(shown, dx, dy);
            const line = lineAt(dx, dy, scale, tiles);
            if (!line) {
                return actual.join() === under.join() ? null : `untouched ${under} shows ${actual}`;
            }
            const expected = blend(under, line === "tile" ? TILE_ALPHA : PIXEL_ALPHA);
            const close =
                actual[3] === 255 &&
                expected.every(
                    (value, channel) => Math.abs((actual[channel] ?? -99) - value) <= TOLERANCE,
                );
            return close
                ? null
                : `${line} line over ${under} shows ${actual}, not ${expected.map(Math.round)}`;
        });

    // The pixel grid: lines inside the document only; outside it, the outline included,
    // every pixel of the canvases as without grids.
    await setGrids(page, id, { pixelGrid: true });
    await overlaySettled(page);
    const pixelGrid = await shot(page);
    expect(check(pixelGrid, false)).toEqual([]);
    expect(outsideMismatches(place, pixelGrid, plain)).toEqual([]);

    // The pixel grid and the tile grid: a tile line shows its own strength, also where it
    // crosses a line of the pixel grid.
    await setGrids(page, id, { grid: { visible: true } });
    await overlaySettled(page);
    const both = await shot(page);
    expect(check(both, true)).toEqual([]);
    expect(outsideMismatches(place, both, plain)).toEqual([]);

    // The outline is the same with the grids.
    for (const [dx, dy] of [
        [-1, -1],
        [right, bottom],
    ] as const) {
        expect(screenAt(both, dx, dy)).toEqual(OUTLINE);
    }
}

/** Declares the grid tests; the calling spec file has set Chrome up for `ratio`. */
export function gridTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        test("the overlay has the device-pixel size of the NGNE canvas and lies over it", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            await openDocument(page, { width: WIDTH, height: HEIGHT });
            await overlaySettled(page);
            expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);

            const device = await hostDeviceSize(page);
            const sizes = await viewportArea(page).evaluate((element) => {
                const ngne = element.querySelector<HTMLCanvasElement>(
                    "[data-viewport-canvas] canvas",
                );
                const overlay = element.querySelector<HTMLCanvasElement>(
                    ":scope > canvas[data-viewport-overlay]",
                );
                return {
                    ngne: [ngne?.width, ngne?.height],
                    overlay: [overlay?.width, overlay?.height],
                };
            });
            expect(sizes).toEqual({
                ngne: [device.width, device.height],
                overlay: [device.width, device.height],
            });
            // The same box as the viewport element and the element NGNE fills.
            const box = await boxOf(overlayCanvas(page));
            expect(box).toEqual(await boxOf(viewportArea(page)));
            expect(box).toEqual(await boxOf(viewportHost(page)));
            // Stacked above the NGNE canvas: the pointer target over the whole viewport.
            const hits = await viewportArea(page).evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const points = [
                    [rect.left + 1, rect.top + 1],
                    [rect.left + rect.width / 2, rect.top + rect.height / 2],
                    // Clear of the splitters of the dock and the timeline, whose 8 px hit
                    // areas reach 4 px into the viewport (DESIGN §4).
                    [rect.right - 10, rect.bottom - 10],
                ];
                return points.map(([x, y]) =>
                    document
                        .elementFromPoint(x ?? 0, y ?? 0)
                        ?.hasAttribute("data-viewport-overlay"),
                );
            });
            expect(hits).toEqual([true, true, true]);
            expect(errors).toEqual([]);
        });

        for (const scale of [8, 12, 16]) {
            test(`at scale ${scale} the pixel and tile grid lines fall exactly on the texel boundaries of the NGNE image`, async ({
                page,
            }) => {
                const errors = collectErrors(page);
                await openViewportEditor(page);
                const view = { scale, originX: 37, originY: 23 };
                const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, view);
                await paint(page, document.id, PIXELS);
                await setView(page, document.id, view);
                await expectGridsOnScreen(page, document.id, view);
                expect(errors).toEqual([]);
            });
        }

        test("while NGNE stretches its old canvas after a resize, the overlay has that canvas's size and box; after the swap the grids line up", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            const view = { scale: 8, originX: 37, originY: 23 };
            const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, view);
            await paint(page, document.id, PIXELS);
            await setView(page, document.id, view);
            await setGrids(page, document.id, { pixelGrid: true, grid: { visible: true } });
            await page.mouse.move(1, 1);
            await overlaySettled(page);
            const before = await hostDeviceSize(page);

            // Every animation frame from before the resize until NGNE has its new canvas:
            // the sizes and boxes of both canvases, and the overlay's pixel on the outline
            // (1 device pixel left of the document), read together.
            await startSampling(page, { x: view.originX - 1, y: view.originY + 1 });
            await page.setViewportSize({ width: 1400, height: 800 });
            await settle(page);
            const samples = await stopSampling(page);
            const after = await hostDeviceSize(page);
            expect(after).not.toEqual(before);

            // NGNE kept its old canvas, stretched over the new box, for some frames; the CI
            // runner may show fewer of them than a fast machine, but not none (120 ms of quiet
            // and a renderer creation).
            const stretched = samples.filter(
                (sample) =>
                    sample.ngne !== null &&
                    (sample.ngne[0] !== sample.host[0] || sample.ngne[1] !== sample.host[1]),
            );
            expect(stretched.length).toBeGreaterThan(0);
            expect(
                stretched.some(
                    (sample) => sample.ngne?.join() === `${before.width},${before.height}`,
                ),
            ).toBe(true);
            // In every frame the overlay had the backing size of the NGNE canvas on screen,
            // filled its box, and showed the outline where NGNE's canvas has the document's
            // edge.
            for (const [index, sample] of samples.entries()) {
                expect(sample.overlay, `frame ${index}`).toEqual(sample.ngne);
                expect(sample.sameBox, `frame ${index}`).toBe(true);
                expect(sample.probe, `frame ${index}`).toEqual(OUTLINE);
            }

            // After the swap both have the new size, and the grids line up on the screen.
            await overlaySettled(page);
            const sizes = await viewportArea(page).evaluate((element) => {
                const ngne = element.querySelector<HTMLCanvasElement>(
                    "[data-viewport-canvas] canvas",
                );
                const overlay = element.querySelector<HTMLCanvasElement>(
                    ":scope > canvas[data-viewport-overlay]",
                );
                return {
                    ngne: [ngne?.width, ngne?.height],
                    overlay: [overlay?.width, overlay?.height],
                };
            });
            expect(sizes).toEqual({
                ngne: [after.width, after.height],
                overlay: [after.width, after.height],
            });
            await expectGridsOnScreen(page, document.id, view);
            expect(errors).toEqual([]);
        });
    });
}
