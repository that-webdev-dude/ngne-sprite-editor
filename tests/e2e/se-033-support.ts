import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { region } from "./se-006-support";
import { openDocument, openViewportEditor, paint, pattern, settle } from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { clientAt, geometry, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { setGrids } from "./se-013-support";
import { toolsState } from "./se-014-support";
import { moveOver } from "./se-017-support";
import { setSelection } from "./se-030-support";

// Shared helpers of the SE-033 specs: a document with a pattern, RECT selected and lifted with
// the Move tool, document positions as client positions, and the context bar's transform
// fields.

export const WIDTH = 16;
export const HEIGHT = 12;
export const VIEW: View = { scale: 8, originX: 40, originY: 24 };
export const SOURCE = pattern(WIDTH, HEIGHT, 5);
export const RECT = { x: 3, y: 4, width: 4, height: 3 };

export function rows(rect: typeof RECT): string[] {
    return Array.from({ length: HEIGHT }, (_, y) =>
        Array.from({ length: WIDTH }, (_, x) =>
            x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
                ? "#"
                : ".",
        ).join(""),
    );
}

export async function setUp(page: Page): Promise<TestDocument> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    await paint(page, document.id, SOURCE);
    await settle(page);
    return document;
}

export async function pressToolKey(page: Page, key: string, id: string): Promise<void> {
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press(key);
    await expect.poll(async () => (await toolsState(page)).selected).toBe(id);
}

export function floating(page: Page): Promise<boolean> {
    return page.evaluate(() => window.__ngneTest!.keyContexts.getState().floating);
}

export function undoLabel(page: Page, id: string): Promise<string | null> {
    return page.evaluate(
        (id) =>
            window.__ngneTest!.sessions.getState().documents.find((entry) => entry.id === id)!
                .history.undoLabel,
        id,
    );
}

/** The client position of document position `point` (with its fraction). */
export async function docClient(page: Page, point: Point): Promise<Point> {
    const layout = await geometry(page);
    return clientAt(layout, {
        x: VIEW.originX + point.x * VIEW.scale,
        y: VIEW.originY + point.y * VIEW.scale,
    });
}

/** A press at document position `from`, moves through `through`, the release at the last. */
export async function dragAt(page: Page, from: Point, through: readonly Point[]): Promise<void> {
    const start = await docClient(page, from);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const point of through) {
        const client = await docClient(page, point);
        await page.mouse.move(client.x, client.y, { steps: 3 });
    }
    await page.mouse.up();
}

/** Selects RECT, takes the Move tool and lifts it with a click on one of its pixels. */
export async function lift(page: Page, document: TestDocument): Promise<void> {
    await setSelection(page, document.id, rows(RECT));
    await pressToolKey(page, "KeyV", "move");
    await moveOver(page, VIEW, [{ x: 4, y: 5 }]);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => floating(page)).toBe(true);
}

export const contextBar = (page: Page) => region(page, "context-bar");
export const transformGroup = (page: Page) =>
    contextBar(page).getByRole("group", { name: "Transform" });
export const field = (page: Page, name: string): Locator =>
    transformGroup(page).getByRole("spinbutton", { name, exact: true });

/** Types `value` into a field of the context bar and applies it with Enter. */
export async function typeField(page: Page, name: string, value: number): Promise<void> {
    const target = field(page, name);
    await target.click();
    await expect(target).toBeFocused();
    await target.fill(String(value));
    await target.press("Enter");
    await expect(target).toHaveValue(String(value));
}

/** Presses Ctrl+Z with the viewport focused. */
export async function undo(page: Page): Promise<void> {
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Control+KeyZ");
}

/**
 * A device pixel of the overlay inside the south-east handle of RECT's box, 2 px out from its
 * corner on each axis (the ants lie on the corner's own pixel). The handle's light square,
 * 7 CSS px less its 1 px border, covers it at a ratio of 1 and of 1.5.
 */
export function handleProbe(): Point {
    return {
        x: VIEW.originX + (RECT.x + RECT.width) * VIEW.scale + 2,
        y: VIEW.originY + (RECT.y + RECT.height) * VIEW.scale + 2,
    };
}
