import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fitRect, runImport } from "../../src/core/import";
import type { ImportSettings } from "../../src/core/import";
import { collectErrors } from "./se-006-support";
import { menuItem, openEditor, openMenu, openSession } from "./se-007-support";
import { addFrame, openViewportEditor, paint, setView, settle, solid } from "./se-011-support";
import type * as FloatingStateModule from "../../src/app/selection/floatingState";
import { setVisible } from "./se-045-support";
import { emptyState, errorToast } from "./se-041-support";
import {
    activeDocument,
    choose,
    coloursOf,
    dropFiles,
    flat,
    gradient,
    image,
    importDialog,
    importFromMenu,
    pngFile,
    select,
    setField,
    settledSummary,
} from "./se-044-support";

// SE-044: the Import PNG dialog (SPEC §8, DESIGN §7): File → Import PNG with one sheet or
// several files, the empty state, a drop and a paste; the settings as form controls, the live
// preview, and where the frames go: a new sprite, new frames or a new layer of the open one,
// one undo step there, with "Keep source as reference".

const RED = [230, 20, 30, 255] as const;
const GREEN = [20, 200, 40, 255] as const;

const importButton = (dialog: ReturnType<typeof importDialog>) =>
    dialog.getByRole("button", { name: "Import", exact: true });

/** The settings of a 4 × 1 grid without offset, spacing or skipping. */
function grid4(): NonNullable<ImportSettings["cells"]> {
    return {
        mode: "grid",
        grid: {
            cell: { columns: 4, rows: 1 },
            offset: { x: 0, y: 0 },
            spacing: { x: 0, y: 0 },
            skipEmpty: false,
        },
    };
}

/** Cuts the sheet into a 4 × 1 grid of 32 × 32 frames. */
async function sliceIntoFour(dialog: ReturnType<typeof importDialog>) {
    await choose(dialog, "Cells", "Grid");
    await choose(dialog, "Grid by", "Columns × rows");
    await setField(dialog, "Columns", 4);
    await setField(dialog, "Rows", 1);
}

test("a 256 × 64 sheet imported as 4 frames of 32 × 32 with 8 colours equals runImport's output", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const sheet = pngFile("walk.png", gradient(256, 64));
    const dialog = await importFromMenu(page, [sheet]);
    await settledSummary(dialog);

    await sliceIntoFour(dialog);
    await setField(dialog, "Width", 32);
    await setField(dialog, "Height", 32);
    await choose(dialog, "Alpha", "Keep");
    await select(page, dialog, "Colours", "Reduce");
    await setField(dialog, "Count", 8);
    await expect(dialog.locator("[data-import-summary]")).toHaveText(
        "4 frames · 32 × 32 · 8 colours",
    );
    // The grid shows over the source: four cells; the result pane shows four frames.
    await expect(dialog.locator("[data-import-cell]")).toHaveCount(4);
    await expect(dialog.locator("[data-import-frame]")).toHaveCount(4);
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);

    const document = (await activeDocument(page))!;
    expect(document).toMatchObject({ name: "walk", width: 32, height: 32 });
    expect(document.frames).toHaveLength(4);
    const settings: ImportSettings = {
        cells: grid4(),
        size: { width: 32, height: 32, fit: "contain" },
        resample: "area",
        alpha: {},
        colors: { mode: "reduce", count: 8 },
        dither: "none",
    };
    const expected = runImport([{ name: sheet.name, pixels: sheet.pixels }], settings);
    const [layer] = document.layers;
    const used = new Set<number>();
    layer!.cels.forEach((cel, index) => {
        expect(cel).not.toBeNull();
        expect([cel!.width, cel!.height]).toEqual([32, 32]);
        expect(cel!.data).toEqual([...expected.frames[index]!.data]);
        for (const colour of coloursOf(cel!.data)) used.add(colour);
    });
    expect(used.size).toBeLessThanOrEqual(8);
    // A new sprite: its palette is the imported one ("Replace"), and it has no history.
    expect(document.palette).toEqual(expected.palette.colors);
    expect(document.undo).toBe(0);
    expect(errors).toEqual([]);
});

test("three PNG files selected at once give three frames in natural filename order", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const files = [
        pngFile("a10.png", flat(8, 8, [10, 10, 200, 255])),
        pngFile("a2.png", flat(8, 8, [10, 200, 10, 255])),
        pngFile("a1.png", flat(8, 8, [200, 10, 10, 255])),
    ];
    // From the empty state's Import PNG.
    const chooser = page.waitForEvent("filechooser");
    await emptyState(page).getByRole("button", { name: "Import PNG", exact: true }).click();
    await (
        await chooser
    ).setFiles(files.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await setField(dialog, "Width", 8);
    await setField(dialog, "Height", 8);
    // Smart defaults for same-size, binary-alpha, three-colour cells: Keep and Keep.
    await expect(await settledSummary(dialog)).toBe("3 frames · 8 × 8 · 3 colours");
    await expect(
        dialog.getByRole("radiogroup", { name: "Alpha" }).getByRole("radio", { name: "Keep" }),
    ).toBeChecked();
    await expect(dialog.getByRole("combobox", { name: "Colours" })).toHaveText("Keep");
    // Several files: one cell each, no grid, no reference.
    await expect(dialog.getByRole("radiogroup", { name: "Cells" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Keep source as reference" })).toBeDisabled();
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);

    const document = (await activeDocument(page))!;
    expect(document.name).toBe("a1");
    const firstPixels = document.layers[0]!.cels.map((cel) => cel!.data.slice(0, 4));
    expect(firstPixels).toEqual([
        [200, 10, 10, 255],
        [10, 200, 10, 255],
        [10, 10, 200, 255],
    ]);
    expect(errors).toEqual([]);
});

/** The bounds of the device pixels where the red reference shows, read back from the canvas. */
function redBounds(page: Page) {
    return page.evaluate(() => {
        const image = window.__ngneTest!.viewport!.readCanvas()!;
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < image.width; x++) {
                const at = (y * image.width + x) * 4;
                if (image.data[at]! - image.data[at + 1]! > 60) {
                    left = Math.min(left, x);
                    top = Math.min(top, y);
                    right = Math.max(right, x + 1);
                    bottom = Math.max(bottom, y + 1);
                }
            }
        }
        return { left, top, right, bottom };
    });
}

/**
 * Imports `source` as a single sprite into a new 32 × 32 sprite with "Keep source as
 * reference", hides the pixel layer and returns where the reference shows on screen and where
 * the fitted image lies, in device pixels.
 */
async function importWithReference(
    page: Page,
    source: ReturnType<typeof pngFile>,
    crop: { x: number; y: number; width: number; height: number } | null,
    /** Into an open 32 × 32 sprite as new frames, instead of a new sprite (review F). */
    into = false,
) {
    const dialog = await importFromMenu(page, [source]);
    await settledSummary(dialog);
    if (into) await choose(dialog, "Place", "New frames");
    if (crop) {
        await choose(dialog, "Region", "Crop");
        await setField(dialog, "W", crop.width);
        await setField(dialog, "H", crop.height);
        await setField(dialog, "X", crop.x);
        await setField(dialog, "Y", crop.y);
        await expect(dialog.locator("[data-import-crop]")).toHaveAttribute(
            "data-import-crop",
            `${crop.x},${crop.y},${crop.width},${crop.height}`,
        );
    }
    await setField(dialog, "Width", 32);
    await setField(dialog, "Height", 32);
    const keep = dialog.getByRole("button", { name: "Keep source as reference" });
    await keep.click();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    await settledSummary(dialog);
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);

    const document = (await activeDocument(page))!;
    const reference = document.layers.find((layer) => layer.kind === "reference");
    const pixel = document.layers.find((layer) => layer.kind === "pixel")!;
    const view = { scale: 4, originX: 12, originY: 10 };
    await setView(page, document.id, view);
    // The pixel layer, which shows the same image, is hidden: what is red is the reference.
    await setVisible(page, pixel.id, false);
    await settle(page);
    const region = crop ?? { x: 0, y: 0, width: source.pixels.width, height: source.pixels.height };
    const fitted = fitRect(region.width, region.height, 32, 32, "contain").target;
    return {
        document,
        reference,
        shown: await redBounds(page),
        expected: {
            left: view.originX + fitted.x * view.scale,
            top: view.originY + fitted.y * view.scale,
            right: view.originX + (fitted.x + fitted.width) * view.scale,
            bottom: view.originY + (fitted.y + fitted.height) * view.scale,
        },
    };
}

function expectWithin(
    shown: Record<"left" | "top" | "right" | "bottom", number>,
    expected: Record<"left" | "top" | "right" | "bottom", number>,
) {
    for (const side of ["left", "top", "right", "bottom"] as const) {
        expect(Math.abs(shown[side] - expected[side]), side).toBeLessThanOrEqual(1);
    }
}

test("keep source as reference: the reference layer sits behind and covers the canvas for a source of its aspect ratio", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const { document, reference, shown, expected } = await importWithReference(
        page,
        pngFile("square.png", flat(64, 64, RED)),
        null,
    );
    expect(reference).toMatchObject({ placement: "behind", x: 0, y: 0, scale: 0.5 });
    // Behind: the reference layer is below the pixel layer.
    expect(document.layers.map((layer) => layer.kind)).toEqual(["reference", "pixel"]);
    expect(document.undo).toBe(0);
    expect(expected).toEqual({ left: 12, top: 10, right: 12 + 128, bottom: 10 + 128 });
    expectWithin(shown, expected);
    expect(errors).toEqual([]);
});

test("keep source as reference: a cropped region of another aspect ratio overlays the fitted image", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    // Red inside the region that is imported, green around it.
    const crop = { x: 8, y: 8, width: 64, height: 32 };
    const source = pngFile(
        "wide.png",
        image(80, 48, (x, y) =>
            x >= crop.x && y >= crop.y && x < crop.x + crop.width && y < crop.y + crop.height
                ? RED
                : GREEN,
        ),
    );
    const { shown, expected } = await importWithReference(page, source, crop);
    // Contain: 32 × 16 in the middle of the canvas.
    expect(expected).toEqual({ left: 12, top: 10 + 32, right: 12 + 128, bottom: 10 + 96 });
    expectWithin(shown, expected);
    expect(errors).toEqual([]);
});

test("keep source as reference into an open sprite: the reference of a cropped region overlays the fitted image (review F)", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    const id = await openSession(page, { name: "hero", width: 32, height: 32 });
    const crop = { x: 8, y: 8, width: 64, height: 32 };
    const source = pngFile(
        "wide.png",
        image(80, 48, (x, y) =>
            x >= crop.x && y >= crop.y && x < crop.x + crop.width && y < crop.y + crop.height
                ? RED
                : GREEN,
        ),
    );
    const { document, reference, shown, expected } = await importWithReference(
        page,
        source,
        crop,
        true,
    );
    // The sprite that was open, with one step for the frame and the reference.
    expect(document.id).toBe(id);
    expect(document.undo).toBe(1);
    expect(reference).toMatchObject({ placement: "behind" });
    expect(expected).toEqual({ left: 12, top: 10 + 32, right: 12 + 128, bottom: 10 + 96 });
    expectWithin(shown, expected);
    expect(errors).toEqual([]);
});

test("keep source as reference is disabled while a grid cuts the source into several cells", async ({
    page,
}) => {
    await openEditor(page);
    const dialog = await importFromMenu(page, [pngFile("walk.png", gradient(256, 64))]);
    await settledSummary(dialog);
    const keep = dialog.getByRole("button", { name: "Keep source as reference" });
    await expect(keep).toBeEnabled();
    await keep.click();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    await sliceIntoFour(dialog);
    await expect(dialog.locator("[data-import-cell]")).toHaveCount(4);
    await expect(keep).toBeDisabled();
    await expect(keep).toHaveAttribute("aria-pressed", "false");
    // Back to a single sprite, the choice made before is there again.
    await choose(dialog, "Cells", "Single sprite");
    await expect(keep).toBeEnabled();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
});

test("dropping one PNG shows the chooser at the drop point; Add as reference adds only a reference layer", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const id = await openSession(page, { name: "hero", width: 16, height: 16 });
    const before = (await activeDocument(page))!;
    const point = { x: 400, y: 300 };
    expect(await dropFiles(page, [pngFile("photo.png", flat(20, 10, RED))], point)).toBe(true);

    const chooser = page.getByRole("dialog", { name: "Drop photo.png" });
    await expect(chooser).toBeVisible();
    const box = (await chooser.boundingBox())!;
    expect(Math.abs(box.x - point.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(box.y - point.y)).toBeLessThanOrEqual(8);
    const add = chooser.getByRole("button", { name: "Add as reference" });
    await add.click();
    await expect(chooser).toHaveCount(0);
    await expect(importDialog(page)).toHaveCount(0);

    await expect
        .poll(async () => (await activeDocument(page))!.layers.length)
        .toBe(before.layers.length + 1);
    const after = (await activeDocument(page))!;
    expect(after.id).toBe(id);
    expect(after.layers.filter((layer) => layer.kind === "reference")).toHaveLength(1);
    expect(after.layers.find((layer) => layer.kind === "reference")!.name).toBe("photo");
    expect(after.frames).toEqual(before.frames);
    expect(after.layers.filter((layer) => layer.kind === "pixel")).toEqual(
        before.layers.filter((layer) => layer.kind === "pixel"),
    );
    expect(after.undo).toBe(before.undo + 1);
    expect(errors).toEqual([]);
});

test("a drop of one PNG with no sprite open offers no reference; Import as sprite opens the dialog", async ({
    page,
}) => {
    await openEditor(page);
    expect(
        await dropFiles(page, [pngFile("hero.png", flat(16, 16, RED))], { x: 300, y: 200 }),
    ).toBe(true);
    const chooser = page.getByRole("dialog", { name: "Drop hero.png" });
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole("button", { name: "Add as reference" })).toBeDisabled();
    await chooser.getByRole("button", { name: "Import as sprite" }).click();
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(await settledSummary(dialog)).toMatch(/^1 frame · 32 × 32/);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(emptyState(page)).toBeVisible();
});

test("a new layer into a 2-frame sprite from a 4-cell import gives 4 frames and one new layer, one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const id = await openSession(page, { name: "hero", width: 32, height: 32 });
    await addFrame(page, id);
    await page.evaluate((id) => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === id)!;
        document.session.activeFrameId = document.session.doc.frames[0]!.id;
        state.touch(id);
    }, id);
    const before = (await activeDocument(page))!;
    expect(before.frames).toHaveLength(2);

    const dialog = await importFromMenu(page, [pngFile("walk.png", gradient(256, 64))]);
    await settledSummary(dialog);
    // The target size is the sprite's.
    await expect(dialog.getByRole("spinbutton", { name: "Width", exact: true })).toHaveValue("32");
    await sliceIntoFour(dialog);
    await choose(dialog, "Place", "New layer");
    await choose(dialog, "Palette", "Append new colours");
    await expect(await settledSummary(dialog)).toMatch(/^4 frames · 32 × 32/);
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);

    const after = (await activeDocument(page))!;
    expect(after.id).toBe(id);
    expect(after.frames).toHaveLength(4);
    expect(after.frames.slice(0, 2)).toEqual(before.frames);
    expect(after.layers).toHaveLength(before.layers.length + 1);
    const added = after.layers.find((layer) => !before.layers.some((old) => old.id === layer.id))!;
    expect(added.cels.every((cel) => cel !== null)).toBe(true);
    // Append: the sprite's colours first, then only colours it did not hold.
    expect(after.palette.slice(0, before.palette.length)).toEqual(before.palette);
    const appended = after.palette.slice(before.palette.length);
    expect(appended.length).toBeGreaterThan(0);
    expect(appended.some((colour) => before.palette.includes(colour))).toBe(false);
    expect(new Set(after.palette).size).toBe(after.palette.length);
    // One undo step: Edit → Undo takes all of it back.
    expect(after.undo).toBe(before.undo + 1);
    expect(after.undoLabel).toBe("Import PNG");
    await page.evaluate(() => void window.__ngneTest!.commands.get("edit.undo")!.run());
    const undone = (await activeDocument(page))!;
    expect(undone.frames).toEqual(before.frames);
    expect(undone.layers).toEqual(before.layers);
    expect(undone.palette).toEqual(before.palette);
    expect(errors).toEqual([]);
});

test("new frames with the source kept as reference are one undo step in an open sprite", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openSession(page, { name: "hero", width: 16, height: 16 });
    const before = (await activeDocument(page))!;
    const dialog = await importFromMenu(page, [pngFile("idle.png", flat(16, 16, RED))]);
    await settledSummary(dialog);
    await choose(dialog, "Place", "New frames");
    await dialog.getByRole("button", { name: "Keep source as reference" }).click();
    await settledSummary(dialog);
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(async () => (await activeDocument(page))!.undo).toBe(before.undo + 1);
    const after = (await activeDocument(page))!;
    expect(after.frames).toHaveLength(before.frames.length + 1);
    expect(after.activeFrame).toBe(before.frames.length);
    expect(after.layers.map((layer) => layer.kind)).toEqual(["reference", "pixel"]);
    expect(after.layers[1]!.cels[1]!.data.slice(0, 4)).toEqual([...RED]);
    await page.evaluate(() => void window.__ngneTest!.commands.get("edit.undo")!.run());
    const undone = (await activeDocument(page))!;
    expect(undone.frames).toEqual(before.frames);
    expect(undone.layers).toEqual(before.layers);
    expect(errors).toEqual([]);
});

test("while a selection floats the dialog opens; the import applies the float first, then is its own step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const id = await openSession(page, { name: "hero", width: 8, height: 8 });
    await paint(page, id, solid(8, 8, [0, 0, 255, 255]));
    await page.evaluate(async () => {
        const path = "/src/app/selection/floatingState.ts";
        const { floatingState } = (await import(
            /* @vite-ignore */ path
        )) as typeof FloatingStateModule;
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        floatingState.lift(document, { whole: true });
        floatingState.moveBy(2, 0);
    });
    await expect
        .poll(() => page.evaluate(() => window.__ngneTest!.keyContexts.getState().floating))
        .toBe(true);
    const before = (await activeDocument(page))!;

    // The dialog reads the sprite while the float holds its history open.
    const dialog = await importFromMenu(page, [pngFile("idle.png", flat(8, 8, RED))]);
    await expect(dialog.getByRole("spinbutton", { name: "Width", exact: true })).toHaveValue("8");
    await choose(dialog, "Place", "New frames");
    await settledSummary(dialog);
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(async () => (await activeDocument(page))!.undo).toBe(before.undo + 2);
    expect(await page.evaluate(() => window.__ngneTest!.keyContexts.getState().floating)).toBe(
        false,
    );
    const after = (await activeDocument(page))!;
    expect(after.undoLabel).toBe("Import PNG");
    // The moved pixels were applied in the first frame: two columns of it are now empty.
    const first = after.layers[0]!.cels[0]!.data;
    expect(first.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(first.slice(8, 12)).toEqual([0, 0, 255, 255]);
    expect(after.layers[0]!.cels[1]!.data.slice(0, 4)).toEqual([...RED]);
    expect(errors).toEqual([]);
});

test("appending to a sprite of another size is blocked with an inline message", async ({
    page,
}) => {
    await openEditor(page);
    await openSession(page, { name: "hero", width: 16, height: 16 });
    const dialog = await importFromMenu(page, [pngFile("big.png", gradient(64, 64))]);
    await settledSummary(dialog);
    await choose(dialog, "Place", "New frames");
    const message = dialog.locator("[data-import-message]");
    await expect(message).toHaveCount(0);
    await expect(importButton(dialog)).toBeEnabled();

    await setField(dialog, "Width", 32);
    await expect(message).toHaveText(
        "Appending frames needs the target size to equal the sprite size, 16 × 16.",
    );
    await expect(importButton(dialog)).toBeDisabled();
    await choose(dialog, "Place", "New layer");
    await expect(message).toContainText("16 × 16");
    await expect(importButton(dialog)).toBeDisabled();
    // A new sprite takes any size.
    await choose(dialog, "Place", "New sprite");
    await expect(message).toHaveCount(0);
    await expect(importButton(dialog)).toBeEnabled();
});

test("a non-PNG or corrupt file shows an inline error and leaves the dialog usable", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const notes = {
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("not an image"),
    };
    const good = pngFile("good.png", flat(8, 8, RED));
    const broken = {
        name: "broken.png",
        mimeType: "image/png",
        buffer: Buffer.concat([good.buffer.subarray(0, 40), Buffer.alloc(12)]),
    };
    await openMenu(page, "File");
    const chooser = page.waitForEvent("filechooser");
    await menuItem(page, "file.importPng").click();
    await (await chooser).setFiles([notes, broken]);
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    const lines = dialog.locator("[data-import-file-errors] li");
    await expect(lines).toHaveCount(2);
    // The files are read in natural order of their names (review D).
    await expect(lines.nth(0)).toContainText("“broken.png” could not be read as a PNG image.");
    await expect(lines.nth(1)).toContainText("“notes.txt” could not be read as a PNG image.");
    await expect(importButton(dialog)).toBeDisabled();

    // Still usable: other files replace them.
    const again = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: "Choose files…" }).click();
    await (
        await again
    ).setFiles([{ name: good.name, mimeType: good.mimeType, buffer: good.buffer }]);
    await expect(lines).toHaveCount(0);
    await expect(await settledSummary(dialog)).toMatch(/^1 frame/);
    await expect(importButton(dialog)).toBeEnabled();
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    expect((await activeDocument(page))!.name).toBe("good");
    // Reported in the dialog, not as page errors.
    expect(errors).toEqual([]);
});

test("Import clicked at once after a change to a grid that does not fit keeps the dialog open with the error (review B)", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const dialog = await importFromMenu(page, [pngFile("small.png", flat(16, 16, RED))]);
    await choose(dialog, "Cells", "Grid");
    await setField(dialog, "Cell W", 8);
    await setField(dialog, "Cell H", 8);
    await expect(await settledSummary(dialog)).toMatch(/^4 frames/);
    await expect(importButton(dialog)).toBeEnabled();

    // In one task, as fast as a user cannot be: the field changes, then Import is clicked.
    const field = await dialog
        .getByRole("spinbutton", { name: "Cell W", exact: true })
        .elementHandle();
    const button = await importButton(dialog).elementHandle();
    await page.evaluate(
        ([input, importer]) => {
            const element = input as HTMLInputElement;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
            element.focus();
            setter.set!.call(element, "32");
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.blur();
            (importer as HTMLButtonElement).click();
        },
        [field, button] as const,
    );
    await expect(dialog.locator("[data-import-error]")).toContainText("No grid cell fits");
    await expect(dialog).toBeVisible();
    await expect(importButton(dialog)).toBeDisabled();
    expect(await activeDocument(page)).toBeNull();
    await expect(errorToast(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("a grid that does not fit shows the import's error in the result pane and blocks Import", async ({
    page,
}) => {
    await openEditor(page);
    const dialog = await importFromMenu(page, [pngFile("small.png", flat(16, 16, RED))]);
    await settledSummary(dialog);
    await choose(dialog, "Cells", "Grid");
    await setField(dialog, "Cell W", 32);
    await expect(dialog.locator("[data-import-error]")).toContainText("No grid cell fits");
    await expect(importButton(dialog)).toBeDisabled();
    await setField(dialog, "Cell W", 8);
    await setField(dialog, "Cell H", 8);
    await expect(await settledSummary(dialog)).toMatch(/^4 frames/);
    await expect(importButton(dialog)).toBeEnabled();
});

test("Ctrl+V with no sprite open imports the clipboard's image through the dialog", async ({
    page,
    context,
}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors = collectErrors(page);
    await openEditor(page);
    const source = pngFile("x.png", flat(12, 6, GREEN));
    await page.evaluate(
        async (bytes) => {
            const blob = new Blob([Uint8Array.from(bytes)], { type: "image/png" });
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        },
        [...source.buffer],
    );
    await expect(emptyState(page)).toBeVisible();
    // Nothing has the focus: the key goes to the keymap's global context.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+KeyV");
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-import-file]")).toHaveText("Pasted image.png · 12 × 6");
    await setField(dialog, "Width", 12);
    await setField(dialog, "Height", 6);
    await settledSummary(dialog);
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    const pasted = (await activeDocument(page))!;
    expect(pasted).toMatchObject({ name: "Pasted image", width: 12, height: 6 });
    expect(pasted.layers[0]!.cels[0]!.data.slice(0, 4)).toEqual([...GREEN]);
    await expect(errorToast(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});
