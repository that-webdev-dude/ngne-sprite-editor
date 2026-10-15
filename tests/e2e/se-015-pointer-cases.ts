import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openDocument, openViewportEditor, readback, settle } from "./se-011-support";
import type { Rect } from "./se-011-support";
import { activeView, geometry, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlayCanvas, overlaySettled, setGrids } from "./se-013-support";
import { historyOf, texelClient, toolsState } from "./se-014-support";
import { celBytes, setColours, setToolOptions, texelsOf } from "./se-015-support";

// SE-015: the brush cursor at the device pixel ratios of SPEC §6.7 (each in a spec file of
// its own, se-015-pointer-*: a ratio needs a Chrome of its own, see `atDeviceRatio` in
// se-012-pointer-cases). Under the pointer the overlay outlines the footprint of the brush —
// a black ring of 1 device pixel just outside it, a white ring outside that — and a click
// paints exactly the pixels inside the outline, which the NGNE canvas then shows there. The
// system cursor is hidden over the document while a paint tool is active.

const WIDTH = 40;
const HEIGHT = 30;
const MAGENTA = [255, 0, 255, 255];
/** Pixels of each footprint, from the golden masks of se-015-brush.test.ts. */
const AREA: Record<"square" | "circle", Record<number, number>> = {
    square: { 1: 1, 2: 4, 3: 9, 8: 64 },
    circle: { 1: 1, 2: 4, 3: 5, 8: 52 },
};

type Seen = "black" | "white" | "clear" | "other";

/** What the overlay canvas shows in `rect` (device pixels of the canvas), row by row. */
function overlayIn(page: Page, rect: Rect): Promise<Seen[]> {
    return overlayCanvas(page).evaluate((canvas, rect) => {
        const context = (canvas as HTMLCanvasElement).getContext("2d");
        if (!context) throw new Error("se-015: no 2D context");
        const { data } = context.getImageData(rect.x, rect.y, rect.width, rect.height);
        const seen: string[] = [];
        for (let at = 0; at < data.length; at += 4) {
            const [r, g, b, a] = [data[at], data[at + 1], data[at + 2], data[at + 3]];
            if (a === 0) seen.push("clear");
            else if (a === 255 && r === 0 && g === 0 && b === 0) seen.push("black");
            else if (a === 255 && r === 255 && g === 255 && b === 255) seen.push("white");
            else seen.push("other");
        }
        return seen;
    }, rect) as Promise<Seen[]>;
}

/** Declares the brush cursor tests; the calling spec file has set Chrome up for `ratio`. */
export function brushCursorTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        test("the brush outline encloses exactly the pixels a click paints, for sizes 1, 2, 3 and 8 in both shapes; the system cursor is hidden over the document", async ({
            page,
        }) => {
            const errors = collectErrors(page);
            await openViewportEditor(page);
            // No view is given: the document starts fitted and centred.
            const document = await openDocument(page, { width: WIDTH, height: HEIGHT });
            // The overlay shows the outline alone: no grid under it.
            await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
            await setColours(page, 0xff00ffff, 0xffffffff);
            await settle(page);
            expect(await page.evaluate(() => devicePixelRatio)).toBe(Math.fround(ratio));
            const layout = await geometry(page);
            const view: View = await activeView(page);
            expect(view.scale).toBeGreaterThanOrEqual(4);
            const area = viewportArea(page);
            const cursor = () => area.evaluate((element) => getComputedStyle(element).cursor);

            // Beside the document the system cursor shows; over it, the outline alone.
            const beside = texelClient(layout, view, { x: -2, y: 15 });
            await page.mouse.move(beside.x, beside.y);
            await expect.poll(cursor).toBe("crosshair");
            const target: Point = { x: 20, y: 15 };
            // Where on the texel the pointer is: its first, last and centre device pixel.
            const places = ["first", "last", "centre"] as const;
            let index = 0;
            for (const shape of ["square", "circle"] as const) {
                for (const size of [1, 2, 3, 8]) {
                    const label = `${shape} ${size}`;
                    const where = places[index++ % places.length]!;
                    await setToolOptions(page, "pencil", { size, shape });
                    const client = texelClient(layout, view, target, where);
                    await page.mouse.move(client.x, client.y);
                    await expect.poll(cursor).toBe("none");
                    expect((await toolsState(page)).cursor).toBe("none");
                    await overlaySettled(page);
                    // A window of the canvas around the texel, wide enough for both rings.
                    const margin = 6 * view.scale;
                    const rect: Rect = {
                        x: view.originX + target.x * view.scale - margin,
                        y: view.originY + target.y * view.scale - margin,
                        width: 2 * margin + view.scale,
                        height: 2 * margin + view.scale,
                    };
                    const outline = await overlayIn(page, rect);

                    await page.mouse.down();
                    await page.mouse.up();
                    const pixels = await celBytes(page, document.id);
                    const painted = texelsOf(pixels!, WIDTH, MAGENTA);
                    expect(painted, label).toHaveLength(AREA[shape][size]!);
                    // The texel under the pointer is painted.
                    expect(painted, label).toContainEqual(target);

                    // The painted texels in device pixels of the window.
                    const inside = new Set<string>();
                    for (const texel of painted) {
                        for (let dy = 0; dy < view.scale; dy++) {
                            for (let dx = 0; dx < view.scale; dx++) {
                                const x = view.originX + texel.x * view.scale + dx - rect.x;
                                const y = view.originY + texel.y * view.scale + dy - rect.y;
                                inside.add(`${x},${y}`);
                            }
                        }
                    }
                    const distance = (x: number, y: number) => {
                        for (let d = 0; d <= 2; d++) {
                            for (let dy = -d; dy <= d; dy++) {
                                for (let dx = -d; dx <= d; dx++) {
                                    if (inside.has(`${x + dx},${y + dy}`)) return d;
                                }
                            }
                        }
                        return 3;
                    };
                    await settle(page);
                    const shown = await readback(page, rect);
                    const wrong: string[] = [];
                    for (let y = 0; y < rect.height; y++) {
                        for (let x = 0; x < rect.width; x++) {
                            const d = distance(x, y);
                            const expected = d === 1 ? "black" : d === 2 ? "white" : "clear";
                            const seen = outline[y * rect.width + x];
                            if (seen !== expected) {
                                wrong.push(`outline at ${x}, ${y}: ${seen}, not ${expected}`);
                            }
                            // The NGNE canvas shows the paint exactly inside the outline.
                            const at = (y * rect.width + x) * 4;
                            const colour = shown.crop.data.slice(at, at + 4);
                            const magenta = colour.every((value, c) => value === MAGENTA[c]);
                            if (magenta !== (d === 0)) {
                                wrong.push(`canvas at ${x}, ${y}: ${colour.join(" ")}`);
                            }
                        }
                    }
                    expect(wrong.slice(0, 10), label).toEqual([]);

                    // Taken back for the next brush.
                    await page.evaluate(() => window.__ngneTest!.commands.get("edit.undo")!.run());
                    expect(await historyOf(page, document.id)).toEqual({ undo: 0, open: false });
                }
            }
            expect(errors).toEqual([]);
        });
    });
}
