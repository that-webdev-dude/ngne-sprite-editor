import type { Page } from "@playwright/test";
import { geometry } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { texelClient } from "./se-014-support";

// Shared helpers of the SE-017 specs: the pointer moved over texels, the pixels a shape of a
// 1 px brush covers (written out here, not taken from `core/raster`), and image edits.

/** Moves the mouse onto the centre of each texel in turn (one move each, or `steps`). */
export async function moveOver(
    page: Page,
    view: View,
    texels: readonly Point[],
    steps = 1,
): Promise<void> {
    const layout = await geometry(page);
    for (const texel of texels) {
        const client = texelClient(layout, view, texel);
        await page.mouse.move(client.x, client.y, { steps });
    }
}

/** The texels of the Bresenham line from `a` to `b`. */
export function lineTexels(a: Point, b: Point): Point[] {
    const points: Point[] = [];
    const dx = Math.abs(b.x - a.x);
    const dy = -Math.abs(b.y - a.y);
    const sx = a.x < b.x ? 1 : -1;
    const sy = a.y < b.y ? 1 : -1;
    let error = dx + dy;
    let { x, y } = a;
    for (;;) {
        points.push({ x, y });
        if (x === b.x && y === b.y) return points;
        const doubled = 2 * error;
        if (doubled >= dy) {
            error += dy;
            x += sx;
        }
        if (doubled <= dx) {
            error += dx;
            y += sy;
        }
    }
}

/** The texels of the outline of the rectangle with corners `a` and `b`; with `filled`, all of it. */
export function rectangleTexels(a: Point, b: Point, filled = false): Point[] {
    const points: Point[] = [];
    const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [top, bottom] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
            if (filled || y === top || y === bottom || x === left || x === right) {
                points.push({ x, y });
            }
        }
    }
    return points;
}

/** The ellipse that fits a 9 × 9 box (SE-017's golden), as rows. */
export const ELLIPSE_9X9 = [
    "...###...",
    "..#...#..",
    ".#.....#.",
    "#.......#",
    "#.......#",
    "#.......#",
    ".#.....#.",
    "..#...#..",
    "...###...",
];

/** The texels `rows` mark with "#", their first at `origin`. */
export function texelsOfRows(rows: readonly string[], origin: Point): Point[] {
    const points: Point[] = [];
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            if (row[x] === "#") points.push({ x: origin.x + x, y: origin.y + y });
        }
    });
    return points;
}

/** Row-major order. */
export const rowMajor = (a: Point, b: Point) => a.y - b.y || a.x - b.x;

/** The texels of an image (RGBA rows of `width`) that differ between `before` and `after`. */
export function changedTexels(
    before: readonly number[],
    after: readonly number[],
    width: number,
): Point[] {
    const changed: Point[] = [];
    for (let at = 0; at < before.length; at += 4) {
        if (before.slice(at, at + 4).join() !== after.slice(at, at + 4).join()) {
            const index = at / 4;
            changed.push({ x: index % width, y: Math.floor(index / width) });
        }
    }
    return changed;
}

/** Holds back every upload of the viewport until `openUploads`. */
export function holdUploads(page: Page): Promise<void> {
    return page.evaluate(() => {
        let open = () => {};
        const gate = new Promise<void>((resolve) => (open = resolve));
        (window as unknown as { __se017Gate: { open(): void } }).__se017Gate = { open };
        window.__ngneTest!.viewport!.uploadGate = () => gate;
    });
}

/** Lets the held uploads and every later one through. */
export function openUploads(page: Page): Promise<void> {
    return page.evaluate(() => {
        window.__ngneTest!.viewport!.uploadGate = null;
        (window as unknown as { __se017Gate?: { open(): void } }).__se017Gate?.open();
    });
}
