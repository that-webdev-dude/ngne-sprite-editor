import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as CompositesModule from "../../src/app/state/composites";
import type * as ViewportLinkModule from "../../src/app/viewport/viewportLink";
import { collectErrors, region } from "./se-006-support";
import {
    addFrame,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
} from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { devicePixel, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { setGrids } from "./se-013-support";
import { historyOf, railButton, toolsState } from "./se-014-support";
import { celBytes } from "./se-015-support";
import { moveOver } from "./se-017-support";
import { cell } from "./se-022-support";
import { selectionState, setSelection } from "./se-030-support";

// SE-032: the Move tool and the floating selection as the user works with them (SPEC §5.2,
// §7.1, §7.2, §7.8). A drag with the Move tool lifts the selected pixels and moves them; they
// float, shown by the viewport, until Enter or a press outside applies them as one undo step,
// or Escape or undo cancels them and the cel is byte-identical. The arrows change the frame
// without a selection and nudge with one. A frame switch applies the float to its own frame
// first. The float stays on screen however long it lasts, whatever the composite cache does.

const WIDTH = 16;
const HEIGHT = 10;
const VIEW: View = { scale: 8, originX: 40, originY: 24 };
const SOURCE = pattern(WIDTH, HEIGHT, 3);

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The rows of a selection of `rect` ("#" selected). */
function rows(rect: Rect): string[] {
    return Array.from({ length: HEIGHT }, (_, y) =>
        Array.from({ length: WIDTH }, (_, x) =>
            x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
                ? "#"
                : ".",
        ).join(""),
    );
}

/** `before` with the pixels of `rect` moved by `dx`, `dy`: the source transparent, clipped. */
function moved(before: readonly number[], rect: Rect, dx: number, dy: number): number[] {
    const inside = (x: number, y: number) =>
        x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
    const after = [...before];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (inside(x, y)) after.fill(0, (y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4);
        }
    }
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const tx = x + dx;
            const ty = y + dy;
            if (!inside(x, y) || tx < 0 || ty < 0 || tx >= WIDTH || ty >= HEIGHT) continue;
            const from = (y * WIDTH + x) * 4;
            after.splice((ty * WIDTH + tx) * 4, 4, ...before.slice(from, from + 4));
        }
    }
    return after;
}

function rgbaOf(pixels: readonly number[], at: Point): number[] {
    const from = (at.y * WIDTH + at.x) * 4;
    return pixels.slice(from, from + 4);
}

async function setUp(page: Page): Promise<TestDocument> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    await paint(page, document.id, SOURCE);
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

/** Whether the active document holds a floating selection: the keymap's `floating` context. */
function floating(page: Page): Promise<boolean> {
    return page.evaluate(() => window.__ngneTest!.keyContexts.getState().floating);
}

/** The colour NGNE shows at the centre of a texel, read back from its canvas once at rest. */
async function shown(page: Page, texel: Point): Promise<number[]> {
    await settle(page);
    return devicePixel(page, {
        x: VIEW.originX + texel.x * VIEW.scale + VIEW.scale / 2,
        y: VIEW.originY + texel.y * VIEW.scale + VIEW.scale / 2,
    });
}

async function activeFrame(page: Page): Promise<number> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        const { doc, activeFrameId } = document.session;
        return doc.frames.findIndex((frame) => frame.id === activeFrameId) + 1;
    });
}

async function undoLabel(page: Page, id: string): Promise<string | null> {
    return page.evaluate(
        (id) =>
            window.__ngneTest!.sessions.getState().documents.find((entry) => entry.id === id)!
                .history.undoLabel,
        id,
    );
}

test("the Move slot of the rail holds the Move tool: V selects it, the status bar shows its hint", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await setUp(page);
    const button = region(page, "tool-rail").locator('[data-tool="move"]');
    await expect(button).toBeEnabled();
    await pressToolKey(page, "KeyV", "move");
    await expect(railButton(page, "Move")).toHaveAttribute("aria-pressed", "true");
    expect((await toolsState(page)).cursor).toBe("move");
    await expect(region(page, "status-bar").locator('[data-status="message"]')).toHaveText(
        "Drag to move · Arrows: nudge · Enter: apply · Escape: cancel",
    );
    expect(errors).toEqual([]);
});

test("a drag lifts the selection and moves it by (3, −2): it floats, shown by the viewport, until Enter applies it as one undo step with the source transparent", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    const rect = { x: 3, y: 4, width: 4, height: 3 };
    await setSelection(page, document.id, rows(rect));
    await pressToolKey(page, "KeyV", "move");
    const before = (await celBytes(page, document.id))!;

    await drag(page, [
        { x: 4, y: 5 },
        { x: 6, y: 4 },
        { x: 7, y: 3 },
    ]);
    const expected = moved(before, rect, 3, -2);
    expect(await floating(page)).toBe(true);
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: true });
    expect(await celBytes(page, document.id)).toEqual(expected);
    // The viewport shows the float: a moved pixel where it went, the checkerboard where the
    // source was and nothing covers it.
    expect(await shown(page, { x: 6, y: 2 })).toEqual(rgbaOf(before, { x: 3, y: 4 }));
    expect(await shown(page, { x: 9, y: 4 })).toEqual(rgbaOf(before, { x: 6, y: 6 }));
    expect(await shown(page, { x: 3, y: 6 })).not.toEqual(rgbaOf(before, { x: 3, y: 6 }));
    // The ants follow the float.
    expect((await selectionState(page, document.id))?.bounds).toEqual({
        x: 6,
        y: 2,
        width: 4,
        height: 3,
    });

    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Enter");
    expect(await floating(page)).toBe(false);
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    expect(await undoLabel(page, document.id)).toBe("Move");
    expect(await celBytes(page, document.id)).toEqual(expected);
    expect(rgbaOf(expected, { x: 3, y: 6 })).toEqual([0, 0, 0, 0]);
    expect(await shown(page, { x: 6, y: 2 })).toEqual(rgbaOf(before, { x: 3, y: 4 }));

    await page.keyboard.press("Control+KeyZ");
    expect(await celBytes(page, document.id)).toEqual(before);
    expect((await selectionState(page, document.id))?.bounds).toEqual(rect);
    expect(await shown(page, { x: 3, y: 4 })).toEqual(rgbaOf(before, { x: 3, y: 4 }));
    expect(errors).toEqual([]);
});

test("Escape cancels the float and the cel is byte-identical; so does Ctrl+Z while floating", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await setSelection(page, document.id, rows({ x: 2, y: 2, width: 5, height: 5 }));
    await pressToolKey(page, "KeyV", "move");
    const before = (await celBytes(page, document.id))!;

    await drag(page, [
        { x: 3, y: 3 },
        { x: 9, y: 6 },
    ]);
    expect(await celBytes(page, document.id)).not.toEqual(before);
    await page.keyboard.press("Escape");
    expect(await floating(page)).toBe(false);
    expect(await celBytes(page, document.id)).toEqual(before);
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    expect(await shown(page, { x: 9, y: 6 })).toEqual(rgbaOf(before, { x: 9, y: 6 }));

    await drag(page, [
        { x: 3, y: 3 },
        { x: 1, y: 8 },
    ]);
    expect(await floating(page)).toBe(true);
    await page.keyboard.press("Control+KeyZ");
    expect(await floating(page)).toBe(false);
    expect(await celBytes(page, document.id)).toEqual(before);
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: false });
    expect(errors).toEqual([]);
});

test("a press outside the floating pixels applies them; moved partly off the canvas they are clipped", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    const rect = { x: 10, y: 6, width: 4, height: 3 };
    await setSelection(page, document.id, rows(rect));
    await pressToolKey(page, "KeyV", "move");
    const before = (await celBytes(page, document.id))!;

    // Over the bottom-right corner, then back to the middle and off again: nothing is lost
    // while it floats.
    await drag(page, [
        { x: 11, y: 7 },
        { x: 15, y: 9 },
    ]);
    await drag(page, [
        { x: 15, y: 9 },
        { x: 11, y: 7 },
    ]);
    expect(await celBytes(page, document.id)).toEqual(before);
    await drag(page, [
        { x: 11, y: 7 },
        { x: 14, y: 9 },
    ]);
    // A press outside the float: it is applied, and that press does nothing more.
    await drag(page, [
        { x: 1, y: 1 },
        { x: 4, y: 4 },
    ]);
    expect(await floating(page)).toBe(false);
    const expected = moved(before, rect, 3, 2);
    expect(await celBytes(page, document.id)).toEqual(expected);
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    // Only what lies on the canvas stays selected.
    expect((await selectionState(page, document.id))?.bounds).toEqual({
        x: 13,
        y: 8,
        width: 3,
        height: 2,
    });
    expect(errors).toEqual([]);
});

test("with no selection ← and → change the frame; with a selection they lift and nudge; floating, they nudge (keymap contexts)", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await addFrame(page, document.id);
    await page.evaluate((id) => {
        const sessions = window.__ngneTest!.sessions.getState();
        const { session } = sessions.documents.find((entry) => entry.id === id)!;
        session.activeFrameId = session.doc.frames[0]!.id;
        sessions.touch(id);
    }, document.id);
    await settle(page);
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect.poll(() => activeFrame(page)).toBe(2);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => activeFrame(page)).toBe(1);
    expect(await floating(page)).toBe(false);

    const rect = { x: 4, y: 3, width: 3, height: 3 };
    await setSelection(page, document.id, rows(rect));
    const before = (await celBytes(page, document.id))!;
    await page.keyboard.press("ArrowRight");
    expect(await floating(page)).toBe(true);
    expect(await activeFrame(page)).toBe(1);
    // The float is the Move tool's.
    expect((await toolsState(page)).selected).toBe("move");
    await page.keyboard.press("ArrowRight");
    // Off the canvas altogether and back: nothing is lost while it floats.
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("ArrowDown");
    expect(await activeFrame(page)).toBe(1);
    expect(await celBytes(page, document.id)).toEqual(moved(before, rect, 2, 1));
    await page.keyboard.press("Enter");
    expect(await floating(page)).toBe(false);
    expect(await undoLabel(page, document.id)).toBe("Move");
    expect(await celBytes(page, document.id)).toEqual(moved(before, rect, 2, 1));
    // With the selection still there, the arrows nudge again and do not change the frame.
    await page.keyboard.press("ArrowLeft");
    expect(await activeFrame(page)).toBe(1);
    expect(await floating(page)).toBe(true);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
});

test("a click on frame 2 in the timeline while floating applies the float to frame 1 first", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    const second = await addFrame(page, document.id);
    await paint(page, document.id, pattern(WIDTH, HEIGHT, 9), second);
    await page.evaluate((id) => {
        const sessions = window.__ngneTest!.sessions.getState();
        const { session } = sessions.documents.find((entry) => entry.id === id)!;
        session.activeFrameId = session.doc.frames[0]!.id;
        sessions.touch(id);
    }, document.id);
    await settle(page);
    const rect = { x: 0, y: 0, width: 5, height: 4 };
    await setSelection(page, document.id, rows(rect));
    await pressToolKey(page, "KeyV", "move");
    const first = (await celBytes(page, document.id))!;
    const steps = (await historyOf(page, document.id)).undo;

    await drag(page, [
        { x: 1, y: 1 },
        { x: 5, y: 3 },
    ]);
    expect(await floating(page)).toBe(true);
    await cell(page, "Layer 1", 2).click();
    await expect.poll(() => activeFrame(page)).toBe(2);
    expect(await floating(page)).toBe(false);
    expect(await historyOf(page, document.id)).toEqual({ undo: steps + 1, open: false });
    expect(await undoLabel(page, document.id)).toBe("Move");
    // Frame 2 is untouched; frame 1 holds the moved pixels.
    expect(await celBytes(page, document.id)).toEqual(pattern(WIDTH, HEIGHT, 9));
    expect(await shown(page, { x: 4, y: 2 })).toEqual(
        rgbaOf(pattern(WIDTH, HEIGHT, 9), { x: 4, y: 2 }),
    );
    await cell(page, "Layer 1", 1).click();
    await expect.poll(() => activeFrame(page)).toBe(1);
    expect(await celBytes(page, document.id)).toEqual(moved(first, rect, 4, 2));
    expect(errors).toEqual([]);
});

test("a float that outlives its drags stays on screen when the cache drops the frame and another frame is composited", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    const second = await addFrame(page, document.id);
    await paint(page, document.id, pattern(WIDTH, HEIGHT, 5), second);
    await page.evaluate((id) => {
        const sessions = window.__ngneTest!.sessions.getState();
        const { session } = sessions.documents.find((entry) => entry.id === id)!;
        session.activeFrameId = session.doc.frames[0]!.id;
        sessions.touch(id);
    }, document.id);
    await settle(page);
    const rect = { x: 1, y: 1, width: 3, height: 3 };
    await setSelection(page, document.id, rows(rect));
    await pressToolKey(page, "KeyV", "move");
    const before = (await celBytes(page, document.id))!;
    await drag(page, [
        { x: 2, y: 2 },
        { x: 6, y: 5 },
    ]);
    await drag(page, [
        { x: 6, y: 5 },
        { x: 9, y: 6 },
    ]);
    const at = { x: 8, y: 5 };
    const expected = rgbaOf(before, { x: 1, y: 1 });
    expect(await shown(page, at)).toEqual(expected);

    // The cache drops every composite, another frame is composited (as the preview does), and
    // the viewport reads the active frame again.
    await page.evaluate(
        async ({ second }) => {
            const compositesPath = "/src/app/state/composites.ts";
            const composites = (await import(
                /* @vite-ignore */ compositesPath
            )) as typeof CompositesModule;
            const linkPath = "/src/app/viewport/viewportLink.ts";
            const link = (await import(/* @vite-ignore */ linkPath)) as typeof ViewportLinkModule;
            const cache = composites.activeComposites.cache!;
            cache.clear();
            cache.get(second);
            link.viewportLink.invalidate("all");
        },
        { second },
    );
    expect(await floating(page)).toBe(true);
    expect(await shown(page, at)).toEqual(expected);
    // Nudged afterwards: the live composite is the cache's again, and shows the move.
    await viewportArea(page).focus();
    await page.keyboard.press("ArrowLeft");
    expect(await shown(page, { x: 7, y: 5 })).toEqual(expected);
    await page.keyboard.press("Enter");
    expect(await shown(page, { x: 7, y: 5 })).toEqual(expected);
    expect(await celBytes(page, document.id)).toEqual(moved(before, rect, 6, 4));
    expect(errors).toEqual([]);
});
