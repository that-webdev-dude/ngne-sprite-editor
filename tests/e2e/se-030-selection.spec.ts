import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares the stroke echo's probe on `window.__ngneTest` (SE-015).
import type {} from "../../src/app/tools/strokeEcho.overlay";
import type * as CoreLayers from "../../src/core/layers";
import { collectErrors, region } from "./se-006-support";
import { addTextField, closeMenu, menuItem, openMenu, statusBar } from "./se-007-support";
import {
    addFrame,
    expectImage,
    openDocument,
    openViewportEditor,
    paint,
    pattern,
    settle,
    showFrame,
} from "./se-011-support";
import { geometry, twoFrames, viewportArea } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlayPixels, overlaySettled, setGrids } from "./se-013-support";
import { historyOf, texelClient } from "./se-014-support";
import { celBytes, setColours } from "./se-015-support";
import { maskBytes, selectionState, setSelection } from "./se-030-support";

// SE-030: the selection as the user meets it — Select All, Deselect and Invert Selection from
// their keys (SPEC §7.8) and the Select menu, the selection size in the status bar, undo that
// restores the previous mask exactly, paint clipped to the selection (also on the overlay's
// stroke echo), and a mask that frame and layer switches leave alone. The ants stand still
// (reduced motion); se-030-motion tests their timer.

const WIDTH = 12;
const HEIGHT = 8;
const VIEW: View = { scale: 8, originX: 40, originY: 24 };
/** A selection with a hole: its mask is not a rectangle, so "exactly" means every bit. */
const HOLED = [
    "............",
    "..#####.....",
    "..##.##.....",
    "..#####..##.",
    "..#####..##.",
    "............",
    "............",
    "............",
];
const ALL = Array.from({ length: HEIGHT }, () => "#".repeat(WIDTH));
const INVERTED = HOLED.map((row) => [...row].map((cell) => (cell === "#" ? "." : "#")).join(""));

async function setUp(page: Page) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    await settle(page);
    return document;
}

/** Moves the focus to the viewport element and waits until it has it. */
async function focusViewport(page: Page): Promise<void> {
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
}

test("Ctrl+A, Ctrl+I and Ctrl+D change the selection, the status bar shows its size, and undo restores the previous mask exactly", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    const selectionField = region(page, "status-bar").locator('[data-status="selection"]');
    await expect(selectionField).toHaveCount(0);
    await focusViewport(page);

    // Select All: every pixel, the document's size in the status bar.
    await page.keyboard.press("Control+KeyA");
    await expect(selectionField).toHaveText(`Selection ${WIDTH} × ${HEIGHT}`);
    expect(await selectionState(page, document.id)).toEqual({
        width: WIDTH,
        height: HEIGHT,
        bytes: maskBytes(ALL),
        bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    });

    // A selection with a hole, as a selection tool makes it; then Invert.
    await setSelection(page, document.id, HOLED);
    await expect(selectionField).toHaveText("Selection 9 × 4");
    const holed = await selectionState(page, document.id);
    expect(holed).toEqual({
        width: WIDTH,
        height: HEIGHT,
        bytes: maskBytes(HOLED),
        bounds: { x: 2, y: 1, width: 9, height: 4 },
    });
    await page.keyboard.press("Control+KeyI");
    await expect(selectionField).toHaveText(`Selection ${WIDTH} × ${HEIGHT}`);
    expect((await selectionState(page, document.id))?.bytes).toEqual(maskBytes(INVERTED));
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });

    // Undo restores the mask before Invert exactly; redo brings the inverse back.
    await page.keyboard.press("Control+KeyZ");
    expect(await selectionState(page, document.id)).toEqual(holed);
    await expect(selectionField).toHaveText("Selection 9 × 4");
    await page.keyboard.press("Control+KeyY");
    expect((await selectionState(page, document.id))?.bytes).toEqual(maskBytes(INVERTED));
    await page.keyboard.press("Control+KeyZ");

    // Deselect: no selection, no field; undo brings the very mask back.
    await page.keyboard.press("Control+KeyD");
    expect(await selectionState(page, document.id)).toBeNull();
    await expect(selectionField).toHaveCount(0);
    await page.keyboard.press("Control+KeyZ");
    expect(await selectionState(page, document.id)).toEqual(holed);
    await expect(selectionField).toHaveText("Selection 9 × 4");

    // In a text field Ctrl+A selects the field's text and leaves the selection alone.
    const field = await addTextField(page);
    await field.focus();
    await field.fill("text");
    await page.keyboard.press("Control+KeyA");
    expect(await field.evaluate((input) => (input as HTMLInputElement).selectionEnd)).toBe(4);
    expect(await selectionState(page, document.id)).toEqual(holed);
    expect(errors).toEqual([]);
});

test("the Select menu runs the three commands, enabled as the selection allows", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);

    // No selection: Deselect is disabled, the other two are not, each with its key.
    const select = await openMenu(page, "Select");
    await expect(menuItem(page, "select.all")).toHaveText("Select AllCtrl+A");
    await expect(menuItem(page, "select.none")).toHaveText("DeselectCtrl+D");
    await expect(menuItem(page, "select.invert")).toHaveText("Invert SelectionCtrl+I");
    await expect(menuItem(page, "select.none")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "select.all")).not.toHaveAttribute("aria-disabled", "true");
    // Invert with no selection selects every pixel.
    await expect(select).toBeVisible();
    await menuItem(page, "select.invert").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect((await selectionState(page, document.id))?.bytes).toEqual(maskBytes(ALL));

    await openMenu(page, "Select");
    await expect(menuItem(page, "select.none")).not.toHaveAttribute("aria-disabled", "true");
    await menuItem(page, "select.none").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await selectionState(page, document.id)).toBeNull();
    expect((await statusBar(page)).selection).toBeUndefined();

    await openMenu(page, "Select");
    await expect(menuItem(page, "select.none")).toHaveAttribute("aria-disabled", "true");
    await menuItem(page, "select.all").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect((await selectionState(page, document.id))?.bytes).toEqual(maskBytes(ALL));
    await expect(region(page, "status-bar").locator('[data-status="selection"]')).toHaveText(
        `Selection ${WIDTH} × ${HEIGHT}`,
    );

    // Each was one step; the Edit menu names the one undo would take back.
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });
    const edit = await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toHaveText(/^Undo Select All/);
    // The menu takes the focus a moment after it opens; Escape is its key from then on.
    await expect
        .poll(() =>
            edit.evaluate((element) => element.contains(element.ownerDocument.activeElement)),
        )
        .toBe(true);
    await closeMenu(page);
    expect(errors).toEqual([]);
});

const STROKE_WIDTH = 24;
const STROKE_HEIGHT = 16;
/** The selection of the clipping test: columns 6 to 13, rows 4 to 9. */
const SELECTED = { x: 6, y: 4, width: 8, height: 6 };
const MAGENTA = [255, 0, 255, 255];

const isSelected = ({ x, y }: Point) =>
    x >= SELECTED.x &&
    x < SELECTED.x + SELECTED.width &&
    y >= SELECTED.y &&
    y < SELECTED.y + SELECTED.height;

declare global {
    interface Window {
        __se030Gate?: { open(): void };
        /** Texels the stroke echo drew outside the selection, with the colour it drew. */
        __se030Echoed?: { x: number; y: number; rgba: number[] }[];
    }
}

test("with a selection, a pencil stroke crossing its edge changes pixels only inside, on the stroke echo as in NGNE's image after the stroke", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openViewportEditor(page);
    const view: View = { scale: 8, originX: 32, originY: 24 };
    const document = await openDocument(page, { width: STROKE_WIDTH, height: STROKE_HEIGHT }, view);
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    const original = pattern(STROKE_WIDTH, STROKE_HEIGHT, 5);
    await paint(page, document.id, original);
    await setColours(page, 0xff00ffff, 0xffffffff);
    await setSelection(
        page,
        document.id,
        Array.from({ length: STROKE_HEIGHT }, (_, y) =>
            Array.from({ length: STROKE_WIDTH }, (_, x) => (isSelected({ x, y }) ? "#" : ".")).join(
                "",
            ),
        ),
    );
    await settle(page);
    await overlaySettled(page);
    const layout = await geometry(page);
    const before = (await celBytes(page, document.id))!;

    // While the button is held, NGNE gets no upload: the overlay's stroke echo alone shows
    // the stroke. Record what the echo draws outside the selection.
    await page.evaluate(
        ({ selected, width }) => {
            let open = () => {};
            const gate = new Promise<void>((resolve) => (open = resolve));
            window.__se030Gate = { open };
            window.__ngneTest!.viewport!.uploadGate = () => gate;
            const echoed: { x: number; y: number; rgba: number[] }[] = [];
            window.__se030Echoed = echoed;
            window.__ngneTest!.strokeEcho!.onDraw = (rects, buffer) => {
                for (const rect of rects) {
                    for (let y = rect.y; y < rect.y + rect.height; y++) {
                        for (let x = rect.x; x < rect.x + rect.width; x++) {
                            const inside =
                                x >= selected.x &&
                                x < selected.x + selected.width &&
                                y >= selected.y &&
                                y < selected.y + selected.height;
                            if (inside) continue;
                            const at = (y * width + x) * 4;
                            echoed.push({ x, y, rgba: Array.from(buffer.data.slice(at, at + 4)) });
                        }
                    }
                }
            };
        },
        { selected: SELECTED, width: STROKE_WIDTH },
    );
    // A row across the selection's left and right edges, then down across its bottom.
    const path: Point[] = [
        { x: 2, y: 6 },
        { x: 20, y: 6 },
        { x: 10, y: 6 },
        { x: 10, y: 14 },
    ];
    const clientOf = (texel: Point) => texelClient(layout, view, texel);
    await page.mouse.move(clientOf(path[0]!).x, clientOf(path[0]!).y);
    await page.mouse.down();
    for (const point of path.slice(1)) {
        await page.mouse.move(clientOf(point).x, clientOf(point).y, { steps: 6 });
    }
    await page.waitForFunction(() => window.__ngneTest?.overlay?.pending === false);
    await twoFrames(page);
    expect(await historyOf(page, document.id)).toEqual({ undo: 2, open: true });
    expect(await page.evaluate(() => window.__ngneTest!.strokeEcho!.regions)).toBeGreaterThan(0);

    // The echo draws nothing outside the selection: of each change only the part within the
    // selection's bounds (here the selection itself) is composited and echoed.
    const echoed = await page.evaluate(() => window.__se030Echoed ?? []);
    expect(echoed).toEqual([]);
    // And on the overlay: the middle device pixel of each texel outside the selection is
    // clear or shows the texel as it was, never the stroke; inside, the stroke's texels show
    // magenta. The texels next to the pointer carry the brush cursor and are left out.
    const last = path.at(-1)!;
    const texels: Point[] = [];
    for (let y = 0; y < STROKE_HEIGHT; y++) {
        for (let x = 0; x < STROKE_WIDTH; x++) {
            if (Math.max(Math.abs(x - last.x), Math.abs(y - last.y)) > 1) texels.push({ x, y });
        }
    }
    const middles = await overlayPixels(
        page,
        texels.map(({ x, y }) => ({
            x: view.originX + x * view.scale + view.scale / 2,
            y: view.originY + y * view.scale + view.scale / 2,
        })),
    );
    const during = (await celBytes(page, document.id))!;
    const wrong: string[] = [];
    texels.forEach((texel, index) => {
        const shown = middles[index]!;
        const at = (texel.y * STROKE_WIDTH + texel.x) * 4;
        const painted = during.slice(at, at + 4).join() === MAGENTA.join();
        if (isSelected(texel)) {
            if (painted && shown.join() !== MAGENTA.join()) {
                wrong.push(`${texel.x}, ${texel.y} painted, overlay ${shown}`);
            }
        } else if (shown[3] !== 0 && shown.join() !== original.slice(at, at + 4).join()) {
            wrong.push(`${texel.x}, ${texel.y} outside, overlay ${shown}`);
        }
    });
    expect(wrong.slice(0, 8)).toEqual([]);

    // NGNE draws, the button comes up: one history entry, the overlay's echo is gone.
    await page.evaluate(() => {
        window.__ngneTest!.strokeEcho!.onDraw = null;
        window.__ngneTest!.viewport!.uploadGate = null;
        window.__se030Gate?.open();
    });
    await page.mouse.up();
    expect(await historyOf(page, document.id)).toEqual({ undo: 3, open: false });

    // After the stroke: pixels changed only inside the selection, on every row the path crossed.
    const after = (await celBytes(page, document.id))!;
    const changed: Point[] = [];
    for (let y = 0; y < STROKE_HEIGHT; y++) {
        for (let x = 0; x < STROKE_WIDTH; x++) {
            const at = (y * STROKE_WIDTH + x) * 4;
            if (after.slice(at, at + 4).join() !== before.slice(at, at + 4).join()) {
                changed.push({ x, y });
            }
        }
    }
    expect(changed.filter((point) => !isSelected(point))).toEqual([]);
    for (const point of [
        { x: 6, y: 6 },
        { x: 13, y: 6 },
        { x: 10, y: 9 },
    ]) {
        expect(changed, `${point.x}, ${point.y}`).toContainEqual(point);
    }
    // NGNE's image is the cel's: the stroke inside, the pattern outside.
    await settle(page);
    await expectImage(page, document, view, after);
    await expect.poll(() => page.evaluate(() => window.__ngneTest!.strokeEcho!.regions)).toBe(0);
    expect(errors).toEqual([]);
});

test("switching the active frame or layer keeps the mask unchanged, and the ants with it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    await setSelection(page, document.id, HOLED);
    const kept = await selectionState(page, document.id);
    expect(kept?.bytes).toEqual(maskBytes(HOLED));
    await page.mouse.move(1, 1);
    await overlaySettled(page);
    // A pixel of the ants: just left of the selection's left edge, on row 2 of the document.
    const antsPixel = { x: VIEW.originX + 2 * VIEW.scale - 1, y: VIEW.originY + 2 * VIEW.scale };
    const [shownBefore] = await overlayPixels(page, [antsPixel]);
    expect(shownBefore?.[3]).toBe(255);

    const unchanged = async (step: string) => {
        expect(await selectionState(page, document.id), step).toEqual(kept);
        expect((await statusBar(page)).selection, step).toBe("Selection 9 × 4");
        await overlaySettled(page);
        expect(await overlayPixels(page, [antsPixel]), step).toEqual([shownBefore]);
    };

    // A new frame becomes the active one (through the history), then the first again (as the
    // timeline switches frames).
    const second = await addFrame(page, document.id);
    expect(second).not.toBe(document.frameId);
    await unchanged("new frame");
    await showFrame(page, document.id, document.frameId);
    await unchanged("first frame again");
    await showFrame(page, document.id, second);
    await unchanged("second frame again");

    // A new layer becomes the active one, then the first again.
    const added = await page.evaluate(async (id) => {
        const path = "/src/core/layers/index.ts";
        const layers = (await import(/* @vite-ignore */ path)) as typeof CoreLayers;
        const { documents } = window.__ngneTest!.sessions.getState();
        const { session, history } = documents.find((entry) => entry.id === id)!;
        history.execute(layers.addLayerCommand(session));
        return session.activeLayerId;
    }, document.id);
    expect(added).not.toBe(document.layerId);
    await unchanged("new layer");
    await page.evaluate(
        ({ id, layerId }) => {
            const sessions = window.__ngneTest!.sessions.getState();
            const { session } = sessions.documents.find((entry) => entry.id === id)!;
            session.activeLayerId = layerId;
            sessions.touch(id);
        },
        { id: document.id, layerId: document.layerId },
    );
    await unchanged("first layer again");

    // Undoing the frame and the layer leaves it as well.
    await focusViewport(page);
    await page.keyboard.press("Control+KeyZ");
    await page.keyboard.press("Control+KeyZ");
    expect(await historyOf(page, document.id)).toEqual({ undo: 1, open: false });
    await unchanged("frame and layer undone");
    expect(errors).toEqual([]);
});
