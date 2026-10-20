import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares the stroke echo's probe on `window.__ngneTest` (SE-015).
import type {} from "../../src/app/tools/strokeEcho.overlay";
import { collectErrors } from "./se-006-support";
import {
    compare,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
} from "./se-011-support";
import type { Checker, Crop, Rect, TestDocument } from "./se-011-support";
import { geometry, twoFrames } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlayCanvas, setGrids } from "./se-013-support";
import { historyOf, texelClient } from "./se-014-support";
import { celBytes, setColours } from "./se-015-support";
import { holdUploads, openUploads } from "./se-017-support";

// SE-062: tiled mode in the viewport, at the device pixel ratios of the spec files that call
// these cases (se-062-tiled-dpr*). A stroke that leaves the document on the right goes on over
// the copy there and paints from the left edge; NGNE draws the checkerboard and the frame nine
// times, every copy exactly where the document's texels repeat; with X or Y only, three. While
// the uploads are held the overlay's stroke echo shows the stroke in every copy as well.

const WIDTH = 6;
const HEIGHT = 4;
/** Room for a copy on every side of the document. */
const VIEW: View = { scale: 8, originX: 96, originY: 64 };
const MAGENTA = [255, 0, 255, 255];
// Squares of two document pixels: both checkerboard colours lie under every copy.
const CHECKER: Checker = { a: [0x20, 0x60, 0xa0], b: [0xe0, 0xc0, 0x40], size: 2 };
const WORKSPACE = [0x0f, 0x0f, 0x10] as const;

type Tiled = "none" | "x" | "y" | "both";

function setTiled(page: Page, id: string, tiled: Tiled): Promise<void> {
    return page.evaluate(
        ({ id, tiled }) =>
            window.__ngneTest!.sessions.getState().updateDocSettings(id, (settings) => {
                settings.tiled = tiled;
            }),
        { id, tiled },
    );
}

/** The copies of `tiled` around the document, the document's own (0, 0) included. */
function copiesOf(tiled: Tiled): Point[] {
    const across = tiled === "x" || tiled === "both" ? [-1, 0, 1] : [0];
    const down = tiled === "y" || tiled === "both" ? [-1, 0, 1] : [0];
    return down.flatMap((y) => across.map((x) => ({ x, y })));
}

/** The device rectangle of the copy `copy` of the document. */
function copyRect(copy: Point): Rect {
    return {
        x: VIEW.originX + copy.x * WIDTH * VIEW.scale,
        y: VIEW.originY + copy.y * HEIGHT * VIEW.scale,
        width: WIDTH * VIEW.scale,
        height: HEIGHT * VIEW.scale,
    };
}

/** The rectangle of the copies of `tiled`, the document's included. */
function blockRect(tiled: Tiled): Rect {
    const copies = copiesOf(tiled);
    const left = Math.min(...copies.map((copy) => copy.x));
    const top = Math.min(...copies.map((copy) => copy.y));
    const right = Math.max(...copies.map((copy) => copy.x)) + 1;
    const bottom = Math.max(...copies.map((copy) => copy.y)) + 1;
    return {
        x: VIEW.originX + left * WIDTH * VIEW.scale,
        y: VIEW.originY + top * HEIGHT * VIEW.scale,
        width: (right - left) * WIDTH * VIEW.scale,
        height: (bottom - top) * HEIGHT * VIEW.scale,
    };
}

/** The canvas read back once: a crop of each copy, and what lies outside them all. */
function readCopies(
    page: Page,
    tiled: Tiled,
): Promise<{ crops: { copy: Point; crop: Crop }[]; outside: number }> {
    const copies = copiesOf(tiled).map((copy) => ({ copy, rect: copyRect(copy) }));
    return page.evaluate(
        ({ copies, block, workspace }) => {
            const image = window.__ngneTest!.viewport!.readCanvas();
            if (!image) throw new Error("se-062: the viewport has no ready renderer");
            return {
                crops: copies.map(({ copy, rect }) => ({
                    copy,
                    crop: window.__se011.crop(image, rect),
                })),
                outside: window.__se011.outside(image, block, [...workspace]),
            };
        },
        { copies, block: blockRect(tiled), workspace: WORKSPACE },
    );
}

/** Asserts that NGNE shows `pixels` in every copy of `tiled` and nothing outside them. */
async function expectCopies(page: Page, tiled: Tiled, pixels: readonly number[]): Promise<void> {
    const { crops, outside } = await readCopies(page, tiled);
    expect(crops).toHaveLength(copiesOf(tiled).length);
    for (const { copy, crop } of crops) {
        expect(
            compare(crop, pixels, WIDTH, VIEW.scale, CHECKER).slice(0, 3),
            `copy ${copy.x}, ${copy.y}`,
        ).toEqual([]);
    }
    expect(outside).toBe(0);
}

/** A copy of `pixels` (RGBA rows of `width`) with the texels at `points` set to `rgba`. */
function withTexels(pixels: readonly number[], points: readonly Point[], rgba: readonly number[]) {
    const result = [...pixels];
    for (const { x, y } of points) result.splice((y * WIDTH + x) * 4, 4, ...rgba);
    return result;
}

async function openTiled(page: Page): Promise<{ document: TestDocument; before: number[] }> {
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
    // The pencil (the default tool) in magenta; no pixel grid over the echo.
    await setColours(page, 0xff00ffff, 0xffffffff);
    await setGrids(page, document.id, { pixelGrid: false });
    const before = pattern(WIDTH, HEIGHT, 5);
    await paint(page, document.id, before);
    await setTiled(page, document.id, "both");
    await settle(page);
    return { document, before };
}

/** The pointer's path of the stroke: from texel (W - 2, 1) over the right edge to (W + 1, 1). */
const PATH: readonly Point[] = [
    { x: WIDTH - 2, y: 1 },
    { x: WIDTH - 1, y: 1 },
    { x: WIDTH, y: 1 },
    { x: WIDTH + 1, y: 1 },
];
/** What it paints: the two texels left of the edge, then the two right of the left edge. */
const PAINTED: readonly Point[] = [
    { x: WIDTH - 2, y: 1 },
    { x: WIDTH - 1, y: 1 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
];

/** Declares the tiled-mode tests; the calling spec file has set Chrome up for `ratio`. */
export function tiledTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        test("in tiled mode a stroke crossing the right edge continues from the left edge; readback shows the nine copies aligned", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            const { document, before } = await openTiled(page);
            expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);
            // Before the stroke: the document's image in all nine places.
            await expectCopies(page, "both", before);

            const layout = await geometry(page);
            const [first, ...rest] = PATH;
            const start = texelClient(layout, VIEW, first!);
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            for (const texel of rest) {
                const client = texelClient(layout, VIEW, texel);
                await page.mouse.move(client.x, client.y);
            }
            await page.mouse.up();

            const after = withTexels(before, PAINTED, MAGENTA);
            expect(await celBytes(page, document.id)).toEqual(after);
            expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
            await settle(page);
            await expectCopies(page, "both", after);

            // X or Y only: three copies in a row or a column, nothing else around them.
            await setTiled(page, document.id, "x");
            await settle(page);
            await expectCopies(page, "x", after);
            await setTiled(page, document.id, "y");
            await settle(page);
            await expectCopies(page, "y", after);
            await setTiled(page, document.id, "none");
            await settle(page);
            await expectCopies(page, "none", after);
            expect(errors).toEqual([]);
        });

        test("in tiled mode the stroke echo draws the stroke in every copy while the uploads are held", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            const { document, before } = await openTiled(page);
            await holdUploads(page);
            const layout = await geometry(page);
            const [first, ...rest] = PATH;
            const start = texelClient(layout, VIEW, first!);
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            for (const texel of rest) {
                const client = texelClient(layout, VIEW, texel);
                await page.mouse.move(client.x, client.y);
            }
            await expect
                .poll(() => celBytes(page, document.id))
                .toEqual(withTexels(before, PAINTED, MAGENTA));
            await page.waitForFunction(
                () => window.__ngneTest?.overlay?.pending === false,
                undefined,
                { polling: 20 },
            );
            await twoFrames(page);
            expect(
                await page.evaluate(() => window.__ngneTest!.strokeEcho!.regions),
            ).toBeGreaterThan(0);

            // Each painted texel in each copy: the echo's opaque magenta, inside the texel (its
            // first and last device pixels may hold the document's outline). The pointer's
            // texel and its neighbours in the copy it is over hold the brush cursor.
            const pointer = PATH[PATH.length - 1]!;
            const probes: { label: string; x: number; y: number }[] = [];
            for (const copy of copiesOf("both")) {
                for (const texel of PAINTED) {
                    const absolute = { x: texel.x + copy.x * WIDTH, y: texel.y + copy.y * HEIGHT };
                    if (
                        Math.max(
                            Math.abs(absolute.x - pointer.x),
                            Math.abs(absolute.y - pointer.y),
                        ) <= 1
                    ) {
                        continue;
                    }
                    for (const [dx, dy] of [
                        [2, 2],
                        [VIEW.scale - 3, VIEW.scale - 3],
                    ] as const) {
                        probes.push({
                            label: `copy ${copy.x}, ${copy.y} texel ${texel.x}, ${texel.y}`,
                            x: VIEW.originX + absolute.x * VIEW.scale + dx,
                            y: VIEW.originY + absolute.y * VIEW.scale + dy,
                        });
                    }
                }
            }
            const read = await overlayCanvas(page).evaluate((canvas, probes) => {
                const context = (canvas as HTMLCanvasElement).getContext("2d");
                if (!context) throw new Error("se-062: no overlay");
                return probes.map(({ label, x, y }) => ({
                    label,
                    rgba: Array.from(context.getImageData(x, y, 1, 1).data),
                }));
            }, probes);
            expect(probes.length).toBeGreaterThan(20);
            expect(read.filter(({ rgba }) => rgba.join() !== MAGENTA.join())).toEqual([]);

            // Let through and released: NGNE shows the stroke in every copy.
            await openUploads(page);
            await page.mouse.up();
            await settle(page);
            await expectCopies(page, "both", withTexels(before, PAINTED, MAGENTA));
            expect(errors).toEqual([]);
        });
    });
}
