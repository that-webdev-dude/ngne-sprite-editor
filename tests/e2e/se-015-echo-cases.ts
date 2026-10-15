import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares the stroke echo's probe on `window.__ngneTest` (SE-015).
import type {} from "../../src/app/tools/strokeEcho.overlay";
import { collectErrors } from "./se-006-support";
import {
    DARK_CHECKER,
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
} from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { activeView, geometry, texel, twoFrames } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlaySettled, setGrids } from "./se-013-support";
import { historyOf, texelClient } from "./se-014-support";
import { celBytes, setColours } from "./se-015-support";

// SE-015: the overlay stroke echo of SPEC §6.6, at the device pixel ratios of the spec files
// that call these cases (se-015-echo-dpr*). While the button is held and the viewport's
// uploads are held back (its probe's `uploadGate`), the overlay shows the stroke at once,
// pixel for pixel what NGNE shows once the upload is let through; after that the overlay is
// clear again and NGNE's readback shows the stroke. Escape clears the echo at once. The
// canvases are compared in the page, device pixel by device pixel: exactly, but within 1 per
// channel where the document's pixel is semi-transparent (SE-011's tolerance, SPEC §9.7).

const WIDTH = 40;
const HEIGHT = 30;
const MAGENTA = [255, 0, 255, 255];
/** Magenta at alpha 128, 0xRRGGBBAA. */
const HALF_MAGENTA = 0xff00ff80;
/** Above this many regions the echo keeps their bounding rectangle (`MAX_ECHO_REGIONS`). */
const MAX_REGIONS = 16;

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
    /** The alpha of each texel of the document's composite, row by row. */
    alphas: number[];
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
 * otherwise than the echo (the uploads are held), and any other texel the echo drew (inside
 * a bounding rectangle of regions) as the echo does. Returns the first mismatches.
 */
function compareEchoWithNgne(page: Page, placement: Placement, stale = false): Promise<string[]> {
    return page.evaluate(
        ({ view, width, height, changed, last, alphas, stale }) => {
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
                    const alpha = alphas[ty * width + tx] ?? 0;
                    // Exact for an opaque or transparent texel, within 1 otherwise (SE-011).
                    const tolerance = alpha > 0 && alpha < 255 ? 1 : 0;
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
                                held[at + 3] === image.data[ng + 3] &&
                                [0, 1, 2].every(
                                    (channel) =>
                                        Math.abs(
                                            (held[at + channel] ?? -9) -
                                                (image.data[ng + channel] ?? 99),
                                        ) <= tolerance,
                                );
                            // Stale: a changed texel is not on screen through NGNE yet, and
                            // an unchanged one the echo drew must be on screen already.
                            if (stale ? texelChanged === same : !same) {
                                wrong.push(
                                    `texel ${tx}, ${ty} at ${ox}, ${oy}` +
                                        `${texelChanged ? "" : " (unchanged)"}: echo ` +
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

/** The texels of `texels` (`x,y`) with an echoed device pixel in the captured overlay. */
function echoedOf(page: Page, view: View, texels: readonly string[]): Promise<string[]> {
    return page.evaluate(
        ({ view, width, texels }) => {
            const held = window.__se015Held;
            if (!held) throw new Error("se-015: nothing captured");
            const rowBytes = width * view.scale * 4;
            return texels.filter((key) => {
                const [tx, ty] = key.split(",").map(Number) as [number, number];
                for (let dy = 0; dy < view.scale; dy++) {
                    for (let dx = 0; dx < view.scale; dx++) {
                        const at = (ty * view.scale + dy) * rowBytes + (tx * view.scale + dx) * 4;
                        if (held[at + 3] !== 0) return true;
                    }
                }
                return false;
            });
        },
        { view, width: WIDTH, texels: [...texels] },
    );
}

/**
 * Where NGNE, read back now, does not show the document image `pixels` over the dark
 * checkerboard, by SE-011's rule (`compare`, which `expectImage` applies outside the page):
 * opaque and transparent texels exactly, others within 1 per channel. Compared in the page,
 * as `expectImage` is too slow to repeat within one test. Returns the first mismatches.
 */
function ngneShows(page: Page, view: View, pixels: readonly number[]): Promise<string[]> {
    return page.evaluate(
        ({ view, width, height, pixels, checker }) => {
            const image = window.__ngneTest!.viewport!.readCanvas();
            if (!image) throw new Error("se-015: the viewport has no ready renderer");
            const wrong: string[] = [];
            for (let y = 0; y < height * view.scale && wrong.length < 10; y++) {
                for (let x = 0; x < width * view.scale && wrong.length < 10; x++) {
                    const tx = Math.floor(x / view.scale);
                    const ty = Math.floor(y / view.scale);
                    const at = (ty * width + tx) * 4;
                    const alpha = pixels[at + 3] ?? 0;
                    const first =
                        (Math.floor(tx / checker.size) + Math.floor(ty / checker.size)) % 2 === 0;
                    const under = first ? checker.a : checker.b;
                    const tolerance = alpha === 255 || alpha === 0 ? 0 : 1;
                    const ng = ((view.originY + y) * image.width + view.originX + x) * 4;
                    const right =
                        image.data[ng + 3] === 255 &&
                        [0, 1, 2].every((channel) => {
                            const expected =
                                ((pixels[at + channel] ?? 0) * alpha +
                                    (under[channel] ?? 0) * (255 - alpha)) /
                                255;
                            return (
                                Math.abs((image.data[ng + channel] ?? -9) - expected) <= tolerance
                            );
                        });
                    if (!right) {
                        wrong.push(
                            `texel ${tx}, ${ty} at ${x}, ${y}: NGNE ` +
                                `${Array.from(image.data.subarray(ng, ng + 4))}`,
                        );
                    }
                }
            }
            return wrong;
        },
        { view, width: WIDTH, height: HEIGHT, pixels: [...pixels], checker: DARK_CHECKER },
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

/** The alpha of each texel of an RGBA image of the document. */
function alphasOf(pixels: readonly number[]): number[] {
    return Array.from({ length: WIDTH * HEIGHT }, (_, index) => pixels[index * 4 + 3] ?? 0);
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

/**
 * Moves the mouse, button held, through `texels`: in three steps to each, or with `oneByOne`
 * in one step each, waiting two animation frames after it, so that each move is composited
 * and echoed as a region of its own.
 */
async function moveThrough(
    page: Page,
    setup: Setup,
    texels: readonly Point[],
    oneByOne = false,
): Promise<void> {
    for (const point of texels) {
        const client = setup.clientOf(point);
        await page.mouse.move(client.x, client.y, { steps: oneByOne ? 1 : 3 });
        if (oneByOne) await twoFrames(page);
    }
}

/** What a stroke made while the uploads were held back. */
interface HeldStroke {
    /** The active cel during the stroke. */
    during: number[];
    placement: Placement;
}

/**
 * Presses at `path[0]` with the uploads held back and moves through the rest of `path`, button
 * held; then compares the echo with NGNE, which has not had the stroke. The uploads stay held.
 */
async function strokeWithUploadsHeld(
    page: Page,
    setup: Setup,
    path: readonly Point[],
    oneByOne = false,
): Promise<HeldStroke> {
    const { document, view } = setup;
    const before = (await celBytes(page, document.id))!;
    const last = path.at(-1)!;
    await holdUploads(page);
    const start = setup.clientOf(path[0]!);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await moveThrough(page, setup, path.slice(1), oneByOne);
    await overlayDrawn(page);
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
    expect(await echoedRegions(page)).toBeGreaterThan(0);
    const during = (await celBytes(page, document.id))!;
    const changed = changedTexels(before, during);
    expect(changed.length).toBeGreaterThan(30);
    const placement: Placement = {
        view,
        width: WIDTH,
        height: HEIGHT,
        changed,
        last,
        alphas: alphasOf(during),
    };
    await captureOverlay(page, view);
    // NGNE has not had the stroke yet: the echo alone shows it.
    expect(await compareEchoWithNgne(page, placement, true)).toEqual([]);
    return { during, placement };
}

/**
 * Lets the uploads through: NGNE shows what the echo showed, and the echo is gone. Then the
 * button comes up: one history entry, the overlay still clear, NGNE showing the cel. NGNE's
 * image is checked with `expectImage`, or with `inPage` by the same rule in the page
 * (`ngneShows`), which leaves out `expectImage`'s check of the workspace around the document.
 */
async function drawnThenReleased(
    page: Page,
    setup: Setup,
    stroke: HeldStroke,
    inPage = false,
): Promise<void> {
    const { document, view } = setup;
    const { during, placement } = stroke;
    const shows = async (pixels: readonly number[]) => {
        if (inPage) expect(await ngneShows(page, view, pixels)).toEqual([]);
        else await expectImage(page, document, view, pixels);
    };
    await openUploads(page);
    await settle(page);
    await overlayDrawn(page);
    expect(await echoedRegions(page)).toBe(0);
    expect(await compareEchoWithNgne(page, placement)).toEqual([]);
    expect(await overlayClear(page, placement)).toEqual([]);
    await shows(during);

    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    await settle(page);
    await overlayDrawn(page);
    expect(await echoedRegions(page)).toBe(0);
    expect(await overlayClear(page, placement)).toEqual([]);
    await shows((await celBytes(page, document.id))!);
}

/** The pixel of texel `key` (`x,y`) in the captured overlay. */
function heldTexel(page: Page, view: View, key: string): Promise<number[]> {
    const [x, y] = key.split(",").map(Number) as [number, number];
    return page.evaluate(
        ({ x, y, view, width }) => {
            const offset = (y * view.scale * width * view.scale + x * view.scale) * 4;
            return Array.from(window.__se015Held!.subarray(offset, offset + 4));
        },
        { x, y, view, width: WIDTH },
    );
}

/** Declares the echo tests; the calling spec file has set Chrome up for `ratio`. */
export function strokeEchoTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        // Each `expectImage` brings the document's rectangle at the fitted zoom back to Node,
        // seconds beside other workers: these tests get three times the time limit.
        test.slow();

        const PATH: readonly Point[] = [
            { x: 4, y: 4 },
            { x: 16, y: 6 },
            { x: 16, y: 18 },
            { x: 30, y: 24 },
        ];

        for (const tool of ["pencil", "eraser"] as const) {
            test(`with the uploads held back, the ${tool}'s stroke shows on the overlay as NGNE then shows it; drawn, the overlay is clear again`, async ({
                page,
            }) => {
                const errors = collectErrors(page);
                const setup = await setUp(page, ratio);
                await page.evaluate(
                    (tool) => window.__ngneTest!.editor.getState().setTool(tool),
                    tool,
                );
                const stroke = await strokeWithUploadsHeld(page, setup, PATH);
                if (tool === "pencil") {
                    const first = stroke.placement.changed[0]!;
                    expect(await heldTexel(page, setup.view, first)).toEqual(MAGENTA);
                }
                await drawnThenReleased(page, setup, stroke);
                expect(errors).toEqual([]);
            });
        }

        test("a half-transparent stroke is echoed as NGNE blends it over the checkerboard, within 1", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            const setup = await setUp(page, ratio);
            await setColours(page, HALF_MAGENTA, 0xffffffff);
            const stroke = await strokeWithUploadsHeld(page, setup, PATH);
            // Simple ink puts the colour in place: every changed texel is semi-transparent.
            for (const key of stroke.placement.changed) {
                const [x, y] = key.split(",").map(Number) as [number, number];
                expect(texel(stroke.during, WIDTH, x, y), key).toEqual([255, 0, 255, 128]);
            }
            await drawnThenReleased(page, setup, stroke, true);
            expect(errors).toEqual([]);
        });

        test(`a stroke of more than ${MAX_REGIONS} regions held back is echoed as their bounding rectangle, as NGNE then shows it`, async ({
            page,
        }) => {
            const errors = collectErrors(page);
            const setup = await setUp(page, ratio);
            // Around a rectangle, two texels a move: the pattern inside is unchanged, and the
            // bounding rectangle the echo draws shows it as NGNE does.
            const path: Point[] = [];
            for (let x = 8; x <= 32; x += 2) path.push({ x, y: 6 });
            for (let y = 8; y <= 24; y += 2) path.push({ x: 32, y });
            for (let x = 30; x >= 8; x -= 2) path.push({ x, y: 24 });
            for (let y = 22; y >= 10; y -= 2) path.push({ x: 8, y });
            const stroke = await strokeWithUploadsHeld(page, setup, path, true);
            expect(await echoedRegions(page)).toBeGreaterThan(MAX_REGIONS);
            // Inside the rectangle, texels the stroke did not change are echoed: the first
            // bounding rectangle (17 regions) spans the top row and the right side to row 14.
            const inside = ["20,10", "12,8", "28,14"];
            expect(stroke.placement.changed.filter((key) => inside.includes(key))).toEqual([]);
            expect(await echoedOf(page, setup.view, inside)).toEqual(inside);
            await drawnThenReleased(page, setup, stroke, true);
            expect(errors).toEqual([]);
        });

        test("what NGNE has drawn of a stroke under way is no longer echoed; what it has not is", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            const setup = await setUp(page, ratio);
            const { document, view } = setup;
            const before = (await celBytes(page, document.id))!;
            const junction = { x: 16, y: 4 };
            // Part 1, along a row, with the uploads held back.
            await holdUploads(page);
            const start = setup.clientOf({ x: 4, y: 4 });
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            await moveThrough(page, setup, [junction]);
            await overlayDrawn(page);
            expect(await echoedRegions(page)).toBeGreaterThan(0);
            const first = (await celBytes(page, document.id))!;
            const part1 = changedTexels(before, first);
            expect(part1.length).toBeGreaterThanOrEqual(12);
            // NGNE draws it, the button still held: the echo of part 1 is gone.
            await openUploads(page);
            await settle(page);
            await overlayDrawn(page);
            expect(await echoedRegions(page)).toBe(0);
            const afterPart1: Placement = {
                view,
                width: WIDTH,
                height: HEIGHT,
                changed: part1,
                last: junction,
                alphas: alphasOf(first),
            };
            expect(await overlayClear(page, afterPart1)).toEqual([]);
            expect(await ngneShows(page, view, first)).toEqual([]);

            // Part 2, down a column and on, with the uploads held back again.
            await holdUploads(page);
            const last = { x: 30, y: 24 };
            await moveThrough(page, setup, [{ x: 16, y: 20 }, last]);
            await overlayDrawn(page);
            expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: true });
            expect(await echoedRegions(page)).toBeGreaterThan(0);
            const second = (await celBytes(page, document.id))!;
            const part2 = changedTexels(first, second);
            expect(part2.length).toBeGreaterThan(20);
            await captureOverlay(page, view);
            // Part 1 is on screen through NGNE alone, but where part 2's first region
            // starts (the junction, painted again).
            const near = (key: string) => {
                const [x, y] = key.split(",").map(Number) as [number, number];
                return Math.max(Math.abs(x - junction.x), Math.abs(y - junction.y)) <= 1;
            };
            const part1Away = part1.filter((key) => !near(key));
            expect(part1Away.length).toBeGreaterThanOrEqual(10);
            expect(await echoedOf(page, view, part1Away)).toEqual([]);
            expect(await ngneShows(page, view, first)).toEqual([]);
            expect(await ngneShows(page, view, second)).not.toEqual([]);
            // Part 2 is echoed, and NGNE does not show it yet.
            const placement: Placement = {
                view,
                width: WIDTH,
                height: HEIGHT,
                changed: part2,
                last,
                alphas: alphasOf(second),
            };
            expect(await echoedOf(page, view, part2)).toEqual(part2);
            expect(await compareEchoWithNgne(page, placement, true)).toEqual([]);

            await drawnThenReleased(page, setup, { during: second, placement }, true);
            expect(errors).toEqual([]);
        });

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
            const placement: Placement = {
                view,
                width: WIDTH,
                height: HEIGHT,
                changed: [],
                last,
                alphas: alphasOf(before!),
            };
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
