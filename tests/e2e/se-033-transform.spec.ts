import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { collectErrors, region } from "./se-006-support";
import { menuItem, openMenu } from "./se-007-support";
import { openDocument, openViewportEditor, paint, pattern, settle } from "./se-011-support";
import type { TestDocument } from "./se-011-support";
import { clientAt, geometry, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlayPixels, overlaySettled, setGrids } from "./se-013-support";
import { historyOf, toolsState } from "./se-014-support";
import { celBytes } from "./se-015-support";
import { moveOver } from "./se-017-support";
import { setSelection } from "./se-030-support";

// SE-033: selection transforms as the user works with them (SPEC §7.2; DESIGN §5.2, §6).
// While a selection floats, the context bar shows X, Y, W, H and the angle with Apply and
// Cancel, and the overlay shows its box and handles. A drag of a handle scales it and a drag
// outside its box turns it; typing the same values in the context bar gives the very same
// cel. Apply is one undo step; Cancel and Escape put back the pixels from before the lift.
// Flip and Rotate in the Edit menu lift the selection into such a float.

const WIDTH = 16;
const HEIGHT = 12;
const VIEW: View = { scale: 8, originX: 40, originY: 24 };
const SOURCE = pattern(WIDTH, HEIGHT, 5);
const RECT = { x: 3, y: 4, width: 4, height: 3 };

function rows(rect: typeof RECT): string[] {
    return Array.from({ length: HEIGHT }, (_, y) =>
        Array.from({ length: WIDTH }, (_, x) =>
            x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
                ? "#"
                : ".",
        ).join(""),
    );
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

async function pressToolKey(page: Page, key: string, id: string): Promise<void> {
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press(key);
    await expect.poll(async () => (await toolsState(page)).selected).toBe(id);
}

function floating(page: Page): Promise<boolean> {
    return page.evaluate(() => window.__ngneTest!.keyContexts.getState().floating);
}

function undoLabel(page: Page, id: string): Promise<string | null> {
    return page.evaluate(
        (id) =>
            window.__ngneTest!.sessions.getState().documents.find((entry) => entry.id === id)!
                .history.undoLabel,
        id,
    );
}

/** The client position of document position `point` (with its fraction). */
async function docClient(page: Page, point: Point): Promise<Point> {
    const layout = await geometry(page);
    return clientAt(layout, {
        x: VIEW.originX + point.x * VIEW.scale,
        y: VIEW.originY + point.y * VIEW.scale,
    });
}

/** A press at document position `from`, moves through `through`, the release at the last. */
async function dragAt(page: Page, from: Point, through: readonly Point[]): Promise<void> {
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
async function lift(page: Page, document: TestDocument): Promise<void> {
    await setSelection(page, document.id, rows(RECT));
    await pressToolKey(page, "KeyV", "move");
    await moveOver(page, VIEW, [{ x: 4, y: 5 }]);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => floating(page)).toBe(true);
}

const contextBar = (page: Page) => region(page, "context-bar");
const transformGroup = (page: Page) => contextBar(page).getByRole("group", { name: "Transform" });
const field = (page: Page, name: string): Locator =>
    transformGroup(page).getByRole("spinbutton", { name, exact: true });

/** Types `value` into a field of the context bar and applies it with Enter. */
async function typeField(page: Page, name: string, value: number): Promise<void> {
    const target = field(page, name);
    await target.click();
    await expect(target).toBeFocused();
    await target.fill(String(value));
    await target.press("Enter");
    await expect(target).toHaveValue(String(value));
}

/** Presses Ctrl+Z with the viewport focused. */
async function undo(page: Page): Promise<void> {
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Control+KeyZ");
}

test("while a selection floats the context bar shows X, Y, W, H and the angle with Apply and Cancel, and the overlay its box and handles", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await pressToolKey(page, "KeyV", "move");
    await expect(transformGroup(page)).toHaveCount(0);
    await lift(page, document);
    await expect(transformGroup(page)).toBeVisible();
    for (const [name, value] of [
        ["X", "3"],
        ["Y", "4"],
        ["W", "4"],
        ["H", "3"],
        ["Angle", "0"],
    ] as const) {
        await expect(field(page, name)).toHaveValue(value);
    }
    await expect(transformGroup(page).getByRole("button", { name: "Apply" })).toBeVisible();
    await expect(transformGroup(page).getByRole("button", { name: "Cancel" })).toBeVisible();

    // The south-east handle: a white square about the box's corner, 2 device pixels in from its
    // edge (the ants lie on the corner pixel itself).
    await overlaySettled(page);
    const corner = {
        x: VIEW.originX + (RECT.x + RECT.width) * VIEW.scale,
        y: VIEW.originY + (RECT.y + RECT.height) * VIEW.scale,
    };
    const probe = { x: corner.x + 2, y: corner.y + 2 };
    expect(await overlayPixels(page, [probe])).toEqual([[255, 255, 255, 255]]);

    await transformGroup(page).getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => floating(page)).toBe(false);
    await expect(transformGroup(page)).toHaveCount(0);
    await overlaySettled(page);
    expect(await overlayPixels(page, [probe])).toEqual([[0, 0, 0, 0]]);
    expect(errors).toEqual([]);
});

test("a drag of the south-east handle scales the float; W and H typed in the context bar give the same cel; Apply is one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    const before = (await celBytes(page, document.id))!;

    await lift(page, document);
    const steps = (await historyOf(page, document.id)).undo;
    // From the box's corner (7, 7) to (11, 9): 8 × 5 from its top-left.
    await dragAt(page, { x: 7, y: 7 }, [
        { x: 9.3, y: 8.2 },
        { x: 11, y: 9 },
    ]);
    await expect(field(page, "W")).toHaveValue("8");
    await expect(field(page, "H")).toHaveValue("5");
    await expect(field(page, "X")).toHaveValue("3");
    await expect(field(page, "Y")).toHaveValue("4");
    expect(await historyOf(page, document.id)).toEqual({ undo: steps, open: true });
    await transformGroup(page).getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => floating(page)).toBe(false);
    expect(await historyOf(page, document.id)).toEqual({ undo: steps + 1, open: false });
    expect(await undoLabel(page, document.id)).toBe("Transform");
    const dragged = (await celBytes(page, document.id))!;
    expect(dragged).not.toEqual(before);

    await undo(page);
    await expect.poll(() => celBytes(page, document.id)).toEqual(before);
    expect(await historyOf(page, document.id)).toEqual({ undo: steps, open: false });

    await lift(page, document);
    await typeField(page, "W", 8);
    await typeField(page, "H", 5);
    await transformGroup(page).getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => floating(page)).toBe(false);
    expect(await celBytes(page, document.id)).toEqual(dragged);
    expect(await historyOf(page, document.id)).toEqual({ undo: steps + 1, open: false });
    expect(errors).toEqual([]);
});

test("a drag outside the box with Shift turns it in 15° steps; the angle typed gives the same cel", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await lift(page, document);
    // The box's centre is (5, 5.5). Press 1 px right of its right side, sweep a quarter turn
    // clockwise to below it, Shift held.
    await page.keyboard.down("Shift");
    await dragAt(page, { x: 8, y: 5.5 }, [
        { x: 7.5, y: 7.5 },
        { x: 5.3, y: 9 },
    ]);
    await page.keyboard.up("Shift");
    await expect(field(page, "Angle")).toHaveValue("90");
    await transformGroup(page).getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => floating(page)).toBe(false);
    const dragged = (await celBytes(page, document.id))!;

    await undo(page);
    await expect.poll(() => celBytes(page, document.id)).toEqual(SOURCE);
    await lift(page, document);
    await typeField(page, "Angle", 90);
    await transformGroup(page).getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => floating(page)).toBe(false);
    expect(await celBytes(page, document.id)).toEqual(dragged);
    expect(errors).toEqual([]);
});

test("Cancel and Escape put back the pixels from before the lift, after transforms", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    const before = (await celBytes(page, document.id))!;
    await lift(page, document);
    const steps = (await historyOf(page, document.id)).undo;
    await dragAt(page, { x: 7, y: 7 }, [{ x: 12, y: 11 }]);
    await typeField(page, "Angle", 30);
    expect(await celBytes(page, document.id)).not.toEqual(before);
    await transformGroup(page).getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => floating(page)).toBe(false);
    expect(await celBytes(page, document.id)).toEqual(before);
    expect(await historyOf(page, document.id)).toEqual({ undo: steps, open: false });

    await lift(page, document);
    await dragAt(page, { x: 3, y: 4 }, [{ x: 1, y: 2 }]);
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect.poll(() => floating(page)).toBe(false);
    expect(await celBytes(page, document.id)).toEqual(before);
    expect(await historyOf(page, document.id)).toEqual({ undo: steps, open: false });
    expect(errors).toEqual([]);
});

test("Flip Horizontal in the Edit menu lifts the selection mirrored into a float; Escape cancels it, Enter applies one step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    const before = (await celBytes(page, document.id))!;
    await setSelection(page, document.id, rows(RECT));
    const steps = (await historyOf(page, document.id)).undo;

    const flip = async () => {
        const menu = await openMenu(page, "Edit");
        await expect(menu).toBeFocused();
        await menuItem(page, "edit.flipHorizontal").click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect.poll(() => floating(page)).toBe(true);
        await viewportArea(page).focus();
        await expect(viewportArea(page)).toBeFocused();
    };
    const mirrored = [...before];
    for (let y = RECT.y; y < RECT.y + RECT.height; y++) {
        for (let x = RECT.x; x < RECT.x + RECT.width; x++) {
            const from = (y * WIDTH + (2 * RECT.x + RECT.width - 1 - x)) * 4;
            mirrored.splice((y * WIDTH + x) * 4, 4, ...before.slice(from, from + 4));
        }
    }

    await flip();
    expect((await toolsState(page)).selected).toBe("move");
    expect(await celBytes(page, document.id)).toEqual(mirrored);
    await page.keyboard.press("Escape");
    await expect.poll(() => floating(page)).toBe(false);
    expect(await celBytes(page, document.id)).toEqual(before);

    await flip();
    await page.keyboard.press("Enter");
    await expect.poll(() => floating(page)).toBe(false);
    expect(await celBytes(page, document.id)).toEqual(mirrored);
    expect(await historyOf(page, document.id)).toEqual({ undo: steps + 1, open: false });
    expect(await undoLabel(page, document.id)).toBe("Transform");
    expect(errors).toEqual([]);
});
