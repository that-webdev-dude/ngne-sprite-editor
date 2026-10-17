import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, region } from "./se-006-support";
import { openDocument, openViewportEditor, paint, settle } from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { geometry, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlayPixels, overlaySettled, setGrids } from "./se-013-support";
import { historyOf, texelClient, toolsState } from "./se-014-support";
import { setToolOptions } from "./se-015-support";
import { moveOver } from "./se-017-support";
import { darkAt, maskBytes, selectionState, setSelection } from "./se-030-support";

// SE-031: the selection tools as the user works with them (SPEC §7.1, Selection tools). For
// each tool a scripted gesture with the mouse and the keys makes a selection whose mask must
// equal the one drawn here by hand; each completed gesture is one undo step, Escape during a
// gesture changes nothing, the modifiers at the press set the mode, the polygon lasso closes
// on Enter (which then reaches no `canvas` binding) and on a double click, and the overlay
// shows the pending shape while the button is held.

const WIDTH = 16;
const HEIGHT = 10;
const VIEW: View = { scale: 8, originX: 40, originY: 24 };
const EMPTY = Array.from({ length: HEIGHT }, () => ".".repeat(WIDTH));

/** The rows of the rectangle `x0..x1` × `y0..y1` (both included). */
function rect(x0: number, y0: number, x1: number, y1: number): string[] {
    return EMPTY.map((row, y) =>
        [...row].map((_, x) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? "#" : ".")).join(""),
    );
}

/** The pixels set in `a` or in `b`, or with `op` another rule. */
function combine(
    a: readonly string[],
    b: readonly string[],
    op: (a: boolean, b: boolean) => boolean,
): string[] {
    return a.map((row, y) =>
        [...row].map((cell, x) => (op(cell === "#", b[y]![x] === "#") ? "#" : ".")).join(""),
    );
}

async function setUp(page: Page): Promise<TestDocument> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    await settle(page);
    return document;
}

/** Selects a tool with its key from the viewport, and waits until it is the selected one. */
async function pressToolKey(page: Page, key: string, id: string): Promise<void> {
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press(key);
    await expect.poll(async () => (await toolsState(page)).selected).toBe(id);
}

/** A press on the first texel, the mouse over each texel after it, a release on the last. */
async function drag(page: Page, texels: readonly Point[]): Promise<void> {
    await moveOver(page, VIEW, texels.slice(0, 1));
    await page.mouse.down();
    await moveOver(page, VIEW, texels.slice(1));
    await page.mouse.up();
}

async function click(page: Page, texel: Point): Promise<void> {
    await moveOver(page, VIEW, [texel]);
    await page.mouse.down();
    await page.mouse.up();
}

/** The selection's mask as rows, or null. */
async function selectedRows(page: Page, id: string): Promise<string[] | null> {
    const state = await selectionState(page, id);
    if (!state) return null;
    return Array.from({ length: state.height }, (_, y) =>
        Array.from({ length: state.width }, (_, x) => {
            const bit = y * state.width + x;
            return state.bytes[bit >> 3]! & (1 << (bit & 7)) ? "#" : ".";
        }).join(""),
    );
}

async function expectSelection(page: Page, id: string, rows: readonly string[] | null) {
    if (rows === null) {
        expect(await selectionState(page, id)).toBeNull();
        return;
    }
    expect(await selectedRows(page, id)).toEqual(rows);
    expect((await selectionState(page, id))?.bytes).toEqual(maskBytes(rows));
}

test("rectangular marquee: M, a drag selects the rectangle of its corners as one undo step, which Ctrl+Z takes back", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await pressToolKey(page, "KeyM", "marquee");
    await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText(
        "Rectangular marquee",
    );
    expect((await toolsState(page)).cursor).toBe("crosshair");
    await expect(region(page, "status-bar").locator('[data-status="message"]')).toHaveText(
        "Shift: add · Alt: subtract · Shift+Alt: intersect",
    );

    await drag(page, [
        { x: 9, y: 6 },
        { x: 6, y: 4 },
        { x: 3, y: 2 },
    ]);
    await expectSelection(page, document.id, rect(3, 2, 9, 6));
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    await expect(region(page, "status-bar").locator('[data-status="selection"]')).toHaveText(
        "Selection 7 × 5",
    );

    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Control+KeyZ");
    await expectSelection(page, document.id, null);
    // A click selects nothing: with nothing selected it records nothing.
    await click(page, { x: 5, y: 5 });
    expect(await historyOf(page, document.id)).toEqual({ undo: 0, open: false });
    expect(errors).toEqual([]);
});

test("elliptical marquee: Shift+M, a drag selects the filled ellipse that fits it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await pressToolKey(page, "Shift+KeyM", "ellipse-marquee");
    await drag(page, [
        { x: 2, y: 1 },
        { x: 6, y: 5 },
        { x: 10, y: 9 },
    ]);
    // SE-017's 9 × 9 outline, filled, at (2, 1).
    const ellipse = [
        "...###...",
        "..#####..",
        ".#######.",
        "#########",
        "#########",
        "#########",
        ".#######.",
        "..#####..",
        "...###...",
    ];
    const expected = EMPTY.map((row, y) =>
        [...row].map((_, x) => (ellipse[y - 1]?.[x - 2] === "#" ? "#" : ".")).join(""),
    );
    await expectSelection(page, document.id, expected);
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    expect(errors).toEqual([]);
});

test("the modifiers at the press add, subtract and intersect; the context bar's Mode does without them", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await pressToolKey(page, "KeyM", "marquee");
    const first = rect(1, 1, 6, 5);
    await drag(page, [
        { x: 1, y: 1 },
        { x: 6, y: 5 },
    ]);
    await expectSelection(page, document.id, first);

    await page.keyboard.down("Shift");
    await drag(page, [
        { x: 4, y: 3 },
        { x: 10, y: 8 },
    ]);
    await page.keyboard.up("Shift");
    const added = combine(first, rect(4, 3, 10, 8), (a, b) => a || b);
    await expectSelection(page, document.id, added);

    await page.keyboard.down("Alt");
    await drag(page, [
        { x: 0, y: 0 },
        { x: 15, y: 1 },
    ]);
    await page.keyboard.up("Alt");
    const subtracted = combine(added, rect(0, 0, 15, 1), (a, b) => a && !b);
    await expectSelection(page, document.id, subtracted);

    await page.keyboard.down("Shift");
    await page.keyboard.down("Alt");
    await drag(page, [
        { x: 5, y: 0 },
        { x: 15, y: 9 },
    ]);
    await page.keyboard.up("Alt");
    await page.keyboard.up("Shift");
    const intersected = combine(subtracted, rect(5, 0, 15, 9), (a, b) => a && b);
    await expectSelection(page, document.id, intersected);
    expect(await historyOf(page, document.id)).toEqual({ undo: 4, open: false });

    // The Mode of the context bar: Add, chosen with the pointer.
    const bar = region(page, "context-bar");
    await expect(bar.getByRole("radio", { name: "Replace" })).toBeChecked();
    await bar.getByRole("radio", { name: "Add" }).click();
    await expect(bar.getByRole("radio", { name: "Add" })).toBeChecked();
    await expect(viewportArea(page)).toBeFocused();
    await drag(page, [
        { x: 0, y: 9 },
        { x: 1, y: 8 },
    ]);
    await expectSelection(
        page,
        document.id,
        combine(intersected, rect(0, 8, 1, 9), (a, b) => a || b),
    );
    expect(errors).toEqual([]);
});

test("Escape during a marquee drag changes nothing; the overlay shows the pending shape while the button is held", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    const before = rect(12, 7, 14, 8);
    await setSelection(page, document.id, before);
    await pressToolKey(page, "KeyM", "marquee");
    await overlaySettled(page);

    // The ring 1 device pixel outside the pending rectangle (3, 2)–(8, 5): dashes at phase 0.
    const ringPoints = (x0: number, y0: number, x1: number, y1: number) => {
        const left = VIEW.originX + x0 * VIEW.scale - 1;
        const top = VIEW.originY + y0 * VIEW.scale - 1;
        const right = VIEW.originX + (x1 + 1) * VIEW.scale;
        const bottom = VIEW.originY + (y1 + 1) * VIEW.scale;
        const points: Point[] = [];
        for (let x = left; x <= right; x++) points.push({ x, y: top }, { x, y: bottom });
        for (let y = top + 1; y < bottom; y++) points.push({ x: left, y }, { x: right, y });
        return points;
    };
    const ring = ringPoints(3, 2, 8, 5);
    const clear = await overlayPixels(page, ring);
    expect(clear.every((rgba) => rgba[3] === 0)).toBe(true);

    await moveOver(page, VIEW, [{ x: 3, y: 2 }]);
    await page.mouse.down();
    await moveOver(page, VIEW, [{ x: 8, y: 5 }]);
    await overlaySettled(page);
    const shown = await overlayPixels(page, ring);
    for (const [index, point] of ring.entries()) {
        const dark = darkAt(point.x, point.y, 0);
        expect(shown[index], `${point.x}, ${point.y}`).toEqual(
            dark ? [0, 0, 0, 255] : [255, 255, 255, 255],
        );
    }
    // Inside the shape the overlay draws nothing.
    const inside = await overlayPixels(page, [
        { x: VIEW.originX + 5 * VIEW.scale, y: VIEW.originY + 3 * VIEW.scale },
    ]);
    expect(inside[0]![3]).toBe(0);

    await page.keyboard.press("Escape");
    expect((await toolsState(page)).stroking).toBe(false);
    await page.mouse.up();
    await expectSelection(page, document.id, before);
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    await overlaySettled(page);
    expect((await overlayPixels(page, ring)).every((rgba) => rgba[3] === 0)).toBe(true);
    expect(errors).toEqual([]);
});

test("lasso: Q, a drag selects the polygon of its path; a path of fewer than 3 points deselects", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await pressToolKey(page, "KeyQ", "lasso");
    await drag(page, [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
        { x: 7, y: 1 },
        { x: 1, y: 7 },
    ]);
    // The sides (1, 1)–(7, 1), the diagonal (7, 1)–(1, 7) and (1, 7)–(1, 1), and the inside.
    const triangle = EMPTY.map((row, y) =>
        [...row].map((_, x) => (y >= 1 && y <= 7 && x >= 1 && x <= 8 - y ? "#" : ".")).join(""),
    );
    await expectSelection(page, document.id, triangle);
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });

    await drag(page, [
        { x: 10, y: 3 },
        { x: 13, y: 3 },
    ]);
    await expectSelection(page, document.id, null);
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    expect(errors).toEqual([]);
});

/** Makes what the `canvas` bindings of Enter (play/pause, once it exists) run a record. */
function recordCanvasEnter(page: Page): Promise<void> {
    return page.evaluate(() => {
        const calls: string[] = [];
        (window as unknown as { __se031Enter: string[] }).__se031Enter = calls;
        const { commands } = window.__ngneTest!;
        const record = () => void calls.push("enter");
        const bound = commands.bindings("canvas", "Enter");
        if (bound.length > 0) {
            // Play/pause may be disabled on a one-frame document: enabled here, as the probe.
            const kept = bound.map((command) => ({ run: command.run, enabled: command.enabled }));
            (window as unknown as { __se031Restore: () => void }).__se031Restore = () =>
                bound.forEach((command, index) => {
                    command.run = kept[index]!.run;
                    command.enabled = kept[index]!.enabled;
                });
            for (const command of bound) {
                command.run = record;
                command.enabled = () => true;
            }
            return;
        }
        const remove = commands.register({
            id: "se031.play",
            title: "SE-031 play probe",
            shortcut: "Enter",
            context: "canvas",
            run: record,
        });
        (window as unknown as { __se031Restore: () => void }).__se031Restore = remove;
    });
}

/** Gives the `canvas` bindings of Enter their own run and enabled back (or removes the probe). */
function restoreCanvasEnter(page: Page): Promise<void> {
    return page.evaluate(() =>
        (window as unknown as { __se031Restore: () => void }).__se031Restore(),
    );
}

const canvasEnters = (page: Page) =>
    page.evaluate(() => (window as unknown as { __se031Enter: string[] }).__se031Enter.length);

const gestureContext = (page: Page) =>
    page.evaluate(() => window.__ngneTest!.keyContexts.getState().gesture);

test("polygon lasso: Shift+Q, clicks add vertices; Enter closes and does not reach play/pause; a double click closes too", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await recordCanvasEnter(page);
    await pressToolKey(page, "Shift+KeyQ", "polygon-lasso");
    // Without a gesture, Enter is the canvas's.
    await page.keyboard.press("Enter");
    expect(await canvasEnters(page)).toBe(1);

    for (const texel of [
        { x: 2, y: 1 },
        { x: 9, y: 1 },
        { x: 9, y: 6 },
    ]) {
        await click(page, texel);
    }
    expect(await gestureContext(page)).toBe(true);
    expect((await toolsState(page)).stroking).toBe(true);
    // The pointer moves between the clicks with no button held, and the pending polygon runs
    // on to it: the ring reaches the device row under texel (5, 8), clear until then.
    const underHovered = Array.from({ length: VIEW.scale }, (_, k) => ({
        x: VIEW.originX + 5 * VIEW.scale + k,
        y: VIEW.originY + 9 * VIEW.scale,
    }));
    await overlaySettled(page);
    expect((await overlayPixels(page, underHovered)).every((rgba) => rgba[3] === 0)).toBe(true);
    await moveOver(page, VIEW, [{ x: 5, y: 8 }]);
    await overlaySettled(page);
    const ring = await overlayPixels(page, underHovered);
    for (const [index, point] of underHovered.entries()) {
        expect(ring[index], `${point.x}, ${point.y}`).toEqual(
            darkAt(point.x, point.y, 0) ? [0, 0, 0, 255] : [255, 255, 255, 255],
        );
    }
    await moveOver(page, VIEW, [{ x: 2, y: 6 }]);
    await click(page, { x: 2, y: 6 });
    await expectSelection(page, document.id, null);
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expectSelection(page, document.id, rect(2, 1, 9, 6));
    expect(await canvasEnters(page)).toBe(1);
    expect(await gestureContext(page)).toBe(false);
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });

    // A double click on its last vertex closes the polygon (11, 2), (14, 2), (14, 5), added to
    // the selection by Shift at its first click.
    await page.keyboard.down("Shift");
    await click(page, { x: 11, y: 2 });
    await page.keyboard.up("Shift");
    await click(page, { x: 14, y: 2 });
    await moveOver(page, VIEW, [{ x: 14, y: 5 }]);
    const layout = await geometry(page);
    const last = texelClient(layout, VIEW, { x: 14, y: 5 });
    await page.mouse.dblclick(last.x, last.y);
    expect(await gestureContext(page)).toBe(false);
    // The triangle (11, 2), (14, 2), (14, 5): its sides and the inside, added.
    const triangle = EMPTY.map((row, y) =>
        [...row].map((_, x) => (y >= 2 && y <= 5 && x >= 9 + y && x <= 14 ? "#" : ".")).join(""),
    );
    await expectSelection(
        page,
        document.id,
        combine(rect(2, 1, 9, 6), triangle, (a, b) => a || b),
    );
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    await restoreCanvasEnter(page);
    expect(errors).toEqual([]);
});

test("polygon lasso: fewer than 3 vertices select nothing, and Escape takes an open polygon back", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await pressToolKey(page, "Shift+KeyQ", "polygon-lasso");
    await click(page, { x: 1, y: 1 });
    await click(page, { x: 8, y: 1 });
    await page.keyboard.press("Enter");
    await expectSelection(page, document.id, null);
    expect(await historyOf(page, document.id)).toEqual({ undo: 0, open: false });

    await setSelection(page, document.id, rect(12, 6, 14, 8));
    for (const texel of [
        { x: 1, y: 1 },
        { x: 8, y: 1 },
        { x: 8, y: 5 },
    ]) {
        await click(page, texel);
    }
    expect(await gestureContext(page)).toBe(true);
    await page.keyboard.press("Escape");
    expect(await gestureContext(page)).toBe(false);
    expect((await toolsState(page)).stroking).toBe(false);
    await expectSelection(page, document.id, rect(12, 6, 14, 8));
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });

    // Another tool's key also takes it back.
    await click(page, { x: 1, y: 1 });
    await click(page, { x: 8, y: 1 });
    await click(page, { x: 8, y: 5 });
    await page.keyboard.press("KeyM");
    await expect.poll(async () => (await toolsState(page)).selected).toBe("marquee");
    expect(await gestureContext(page)).toBe(false);
    await expectSelection(page, document.id, rect(12, 6, 14, 8));
    expect(errors).toEqual([]);
});

test("magic wand: W, a click selects the area of its colour; Contiguous off selects every pixel of it, Tolerance near colours", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    // Red blocks on white, one of them a shade off red.
    const colourAt = (x: number, y: number) => {
        if (x >= 1 && x <= 4 && y >= 1 && y <= 3) return [255, 0, 0, 255];
        if (x >= 8 && x <= 10 && y >= 5 && y <= 8) return [255, 0, 0, 255];
        if (x >= 12 && x <= 14 && y >= 1 && y <= 2) return [250, 3, 0, 255];
        return [255, 255, 255, 255];
    };
    const pixels: number[] = [];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) pixels.push(...colourAt(x, y));
    await paint(page, document.id, pixels);
    await pressToolKey(page, "KeyW", "wand");
    const bar = region(page, "context-bar");
    expect(
        await bar
            .locator("[data-tool-option]")
            .evaluateAll((items) => items.map((item) => item.getAttribute("data-tool-option"))),
    ).toEqual(["mode", "contiguous", "sample", "tolerance"]);

    await click(page, { x: 2, y: 2 });
    await expectSelection(page, document.id, rect(1, 1, 4, 3));
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });

    // Contiguous off, with the pointer: the focus goes back to the viewport.
    await bar.getByRole("button", { name: "Contiguous" }).click();
    await expect(bar.getByRole("button", { name: "Contiguous" })).toHaveAttribute(
        "aria-pressed",
        "false",
    );
    await click(page, { x: 2, y: 2 });
    await expectSelection(
        page,
        document.id,
        combine(rect(1, 1, 4, 3), rect(8, 5, 10, 8), (a, b) => a || b),
    );

    await setToolOptions(page, "wand", { tolerance: 5 });
    await click(page, { x: 9, y: 6 });
    const reds = combine(rect(1, 1, 4, 3), rect(8, 5, 10, 8), (a, b) => a || b);
    await expectSelection(
        page,
        document.id,
        combine(reds, rect(12, 1, 14, 2), (a, b) => a || b),
    );
    // A click outside the document deselects.
    await click(page, { x: -2, y: 4 });
    await expectSelection(page, document.id, null);
    expect(await historyOf(page, document.id)).toEqual({ undo: 5, open: false });
    expect(errors).toEqual([]);
});
