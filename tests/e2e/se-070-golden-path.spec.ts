import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { PixelBuffer } from "../../src/core/model";
import { collectErrors, settleTimers } from "./se-006-support";
import { menuItem, openEditor, openMenu } from "./se-007-support";
import {
    dialogButton,
    field,
    nameField,
    newSpriteButton,
    newSpriteDialog,
    setNumber,
} from "./se-008-support";
import { settle } from "./se-011-support";
import { viewportArea } from "./se-012-support";
import { toolsState } from "./se-014-support";
import { setColours } from "./se-015-support";
import { cell, frameHeader, selectedFrames } from "./se-022-support";
import { floating, pressToolKey } from "./se-033-support";
import {
    arrangeFiles,
    documentName,
    fileSystem,
    infoToast,
    stubFileSystemAccess,
    unsavedMarker,
} from "./se-041-support";
import { choose, importDialog, importFromMenu, pngFile, select, setField } from "./se-044-support";
import { tabOf } from "./se-047-support";
import { arrangeFolders, folderFiles, openExportDialog, stubExportFolders } from "./se-052-support";
import { ANCHOR, compareCanvas, expectedCanvas } from "./se-053-expected";
import type { DrawCommand } from "./se-053-expected";
import { advance, draw, expectHealthy, play, readAtlas } from "./se-053-support";
import {
    activeDocumentId,
    documentSummary,
    imageOf,
    mirroredIn,
    openConsumerOn,
    painted,
    run,
    strokeThrough,
} from "./se-070-support";
import type { DocumentSummary, Rgba } from "./se-070-support";

// SE-070: the golden path, one script through the editor's real interface and registered
// commands, in order: a new sprite; drawing on two layers; more frames; a tag; a PNG imported
// as a sprite with its source kept as a reference layer; a selection and a transform; save;
// reload; open; export of the bundle; and the SE-053 consumer game (tests/fixtures/
// ngne-consumer) drawing what was exported. File System Access is the in-memory stub of
// SE-041 for documents and the folder stub of SE-052 for exports, as the specs of those
// tickets use them.
//
// Every image is held against one painted here by hand from the strokes, the source and the
// transform, not against what the app computes: the cels after each step, the documents after
// the open, the exported atlas and each frame the consumer game draws (exact, every pixel of
// its canvas: the art is opaque, so nothing is blended).

const WIDTH = 32;
const HEIGHT = 24;
const RED: Rgba = [208, 48, 48, 255];
const BLUE: Rgba = [40, 72, 216, 255];
const GREEN: Rgba = [32, 176, 72, 255];
const YELLOW: Rgba = [232, 200, 40, 255];
const hex = ([r, g, b, a]: Rgba) => ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;

/** The strokes, by layer and frame (from 1). */
const A = { texels: run({ x: 2, y: 4 }, { x: 12, y: 4 }), rgba: RED };
const B = { texels: run({ x: 8, y: 1 }, { x: 8, y: 10 }), rgba: BLUE };
const C = { texels: run({ x: 14, y: 14 }, { x: 20, y: 20 }), rgba: GREEN };
const D = { texels: run({ x: 3, y: 20 }, { x: 28, y: 20 }), rgba: YELLOW };

/** Layer 1 and Layer 2 of each frame, as the strokes leave them. */
const HERO_CELS = [
    [painted(WIDTH, HEIGHT, [A]), painted(WIDTH, HEIGHT, [B])],
    // New Frame copies frame 1; C goes on its Layer 2.
    [painted(WIDTH, HEIGHT, [A]), painted(WIDTH, HEIGHT, [B, C])],
    // New Empty Frame; D on Layer 1, Layer 2 empty.
    [painted(WIDTH, HEIGHT, [D]), null],
];
/** Each frame's composite: Layer 2 over Layer 1, all opaque. */
const HERO_FRAMES = [
    painted(WIDTH, HEIGHT, [A, B]),
    painted(WIDTH, HEIGHT, [A, B, C]),
    painted(WIDTH, HEIGHT, [D]),
];

/** The source PNG: 64 × 48, tiles of 8 × 8 in four colours; imported at 32 × 24. */
const TILES: readonly Rgba[] = [RED, BLUE, GREEN, YELLOW];
const SOURCE = imageOf(64, 48, (x, y) => TILES[((x >> 3) + (y >> 3)) % 4]!);
/** The source fitted to 32 × 24 with the area filter: each 2 × 2 block is one tile colour. */
const FITTED = imageOf(WIDTH, HEIGHT, (x, y) => TILES[((x >> 2) + (y >> 2)) % 4]!);
/** The marquee's rectangle in the imported sprite, from (2, 3) to (13, 10). */
const SELECTED = { x: 2, y: 3, width: 12, height: 8 };
const PHOTO_FRAME = mirroredIn(FITTED, SELECTED);

const bytesOf = (image: PixelBuffer | null) => (image ? Array.from(image.data) : null);

/** The active document's cel pixels by layer (bottom to top) and frame; null when empty. */
async function cels(page: Page): Promise<(number[] | null)[][]> {
    return (await documentSummary(page, await activeDocumentId(page))).cels;
}

/** Makes a cel of the timeline active with a click. */
async function activate(page: Page, layer: string, frame: number): Promise<void> {
    await cell(page, layer, frame).click();
    await expect.poll(() => activeCel(page)).toEqual({ layer, frame });
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
}

function activeCel(page: Page) {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const { session } = state.documents.find((entry) => entry.id === state.activeId)!;
        const { doc } = session;
        return {
            layer: doc.layers.find((layer) => layer.id === session.activeLayerId)?.name,
            frame: doc.frames.findIndex((frame) => frame.id === session.activeFrameId) + 1,
        };
    });
}

/** Runs a command from its menu of the menu bar. */
async function fromMenu(page: Page, menu: string, command: string): Promise<void> {
    const opened = await openMenu(page, menu);
    await expect(opened).toBeFocused();
    await menuItem(page, command).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await settleTimers(page);
}

/** Saves the active document with Ctrl+S into the stub's file `name`. */
async function save(page: Page, name: string): Promise<void> {
    await arrangeFiles(page, { nextSave: [name] });
    await viewportArea(page).focus();
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, `Saved ${name}`)).toBeVisible();
    await expect(unsavedMarker(page)).toHaveCount(0);
}

/** Opens the stub's file `name` with Ctrl+O; returns the new document's id. */
async function open(page: Page, name: string, documentTitle: string): Promise<string> {
    await arrangeFiles(page, { nextOpen: [name] });
    await page.keyboard.press("Control+KeyO");
    await expect(infoToast(page, `Opened ${name}`)).toBeVisible();
    await expect(documentName(page)).toHaveText(documentTitle);
    await settle(page);
    return activeDocumentId(page);
}

/** Exports the active document into the OPFS folder `folder` from the Export dialog. */
async function exportInto(page: Page, folder: string): Promise<Map<string, Uint8Array>> {
    await arrangeFolders(page, { nextFolder: [folder] });
    const dialog = await openExportDialog(page);
    await dialogButton(dialog, "Choose folder…").click();
    await expect(dialog.locator("[data-export-folder]")).toHaveText(folder);
    await dialogButton(dialog, "Export").click();
    const toast = page.locator(".ui-toast:not(.ui-toast--error)", {
        hasText: new RegExp(`Exported \\d+ files to “${folder}”`),
    });
    await expect(toast).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return folderFiles(page, folder);
}

/**
 * The consumer game draws every frame of the bundle in `files` exactly as `frames` painted
 * here, at the anchor in the middle and mirrored; `name` is the document's.
 */
async function expectConsumerDraws(
    consumer: Page,
    testInfo: Parameters<typeof openConsumerOn>[1],
    files: Map<string, Uint8Array>,
    name: { camel: string; pascal: string },
    frames: readonly PixelBuffer[],
    animation?: { id: string; durations: readonly number[] },
): Promise<void> {
    const bundle = [...files].map(([fileName, bytes]) => ({ name: fileName, bytes }));
    for (const ending of [".png", ".atlas.json", ".sprites.ts"]) {
        expect(bundle.map((file) => file.name)).toContain(`${name.camel}${ending}`);
    }
    const directory = await openConsumerOn(consumer, testInfo, bundle, name);
    // SPEC §9.7 condition 1: the atlas validates and its rectangles lie inside the PNG.
    const { meta } = await readAtlas(directory, name.camel);
    const ids = frames.map((_, index) => `${name.camel}-${index}`);
    expect(Object.keys(meta.frames)).toEqual(ids);
    const pivot = { x: 0.5, y: 0.5 };
    for (const [index, id] of ids.entries()) {
        for (const command of [
            { frame: id, x: ANCHOR[0], y: ANCHOR[1] },
            { frame: id, x: 20, y: 17, flipX: true },
        ] satisfies DrawCommand[]) {
            const expected = expectedCanvas(frames[index]!, pivot, command);
            expect(compareCanvas(await draw(consumer, [command]), expected), id).toEqual([]);
        }
    }
    if (animation) {
        expect(Object.keys(meta.animations)).toContain(animation.id);
        // The tag plays forward: each entry for its duration, on the game's own clock.
        let shown = await play(consumer, animation.id, ANCHOR[0], ANCHOR[1]);
        for (const [index, duration] of animation.durations.entries()) {
            expect(shown.frame).toBe(ids[index]);
            const command = { frame: ids[index]!, x: ANCHOR[0], y: ANCHOR[1] };
            expect(
                compareCanvas(shown.canvas, expectedCanvas(frames[index]!, pivot, command)),
            ).toEqual([]);
            if (index < animation.durations.length - 1) shown = await advance(consumer, duration);
        }
    }
    await expectHealthy(consumer);
}

function expectSameDocument(after: DocumentSummary, before: DocumentSummary): void {
    // Each part on its own, so a difference names it.
    for (const key of Object.keys(before) as (keyof DocumentSummary)[]) {
        expect(after[key], key).toEqual(before[key]);
    }
}

const importButton = (dialog: Locator) =>
    dialog.getByRole("button", { name: "Import", exact: true });

test("golden path: new sprite → two layers → frames → tag → PNG imported with its reference → select and transform → save → reload → open → export → the NGNE consumer game draws it", async ({
    page,
}, testInfo) => {
    // About 60 s on SwiftShader at one worker; the rest is margin.
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await stubExportFolders(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEditor(page);

    // 1. New sprite, from the empty state.
    await newSpriteButton(page).click();
    const dialog = newSpriteDialog(page);
    await expect(dialog).toBeVisible();
    await nameField(dialog).fill("hero");
    await setNumber(field(dialog, "Width"), WIDTH);
    await setNumber(field(dialog, "Height"), HEIGHT);
    await dialogButton(dialog, "Create").click();
    await expect(dialog).toHaveCount(0);
    await expect(documentName(page)).toHaveText("hero");
    await settle(page);
    const hero = await activeDocumentId(page);

    // 2. Draw on two layers with the pencil.
    await pressToolKey(page, "KeyB", "pencil");
    await setColours(page, hex(RED), 0xffffffff);
    await strokeThrough(page, A.texels);
    await fromMenu(page, "Layer", "layer.new");
    await expect.poll(() => activeCel(page)).toEqual({ layer: "Layer 2", frame: 1 });
    await viewportArea(page).focus();
    await setColours(page, hex(BLUE), 0xffffffff);
    await strokeThrough(page, B.texels);
    expect(await cels(page)).toEqual([[bytesOf(HERO_CELS[0]![0]!)], [bytesOf(HERO_CELS[0]![1]!)]]);

    // 3. Frames: New Frame copies frame 1, New Empty Frame adds an empty one.
    await fromMenu(page, "Frame", "frame.new");
    await expect.poll(() => activeCel(page)).toEqual({ layer: "Layer 2", frame: 2 });
    await viewportArea(page).focus();
    await setColours(page, hex(GREEN), 0xffffffff);
    await strokeThrough(page, C.texels);
    await fromMenu(page, "Frame", "frame.newEmpty");
    await expect.poll(() => activeCel(page)).toEqual({ layer: "Layer 2", frame: 3 });
    await activate(page, "Layer 1", 3);
    await setColours(page, hex(YELLOW), 0xffffffff);
    await strokeThrough(page, D.texels);
    expect(await cels(page)).toEqual([
        HERO_CELS.map((frame) => bytesOf(frame[0]!)),
        HERO_CELS.map((frame) => bytesOf(frame[1]!)),
    ]);

    // 4. A tag over the three frames: select them in the header, Frame → New Tag….
    await frameHeader(page, 1).click();
    await frameHeader(page, 3).click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedFrames(page)).toEqual([1, 2, 3]);
    await fromMenu(page, "Frame", "frame.newTag");
    const tagDialog = page.getByRole("dialog", { name: "New tag" });
    await expect(tagDialog).toBeVisible();
    await expect(nameField(tagDialog)).toBeFocused();
    await nameField(tagDialog).fill("walk");
    await dialogButton(tagDialog, "Create").click();
    await expect(tagDialog).toHaveCount(0);
    const heroBefore = await documentSummary(page, hero);
    expect(heroBefore.tags).toEqual([
        { name: "walk", from: 1, to: 3, direction: "forward", repeat: 0 },
    ]);
    expect(heroBefore.composites).toEqual(HERO_FRAMES.map(bytesOf));

    // 5. File → Import PNG… as a new sprite of 32 × 24, colours kept, the source kept as a
    // reference layer behind it.
    const imported = await importFromMenu(page, [pngFile("photo.png", SOURCE)]);
    await choose(imported, "Place", "New sprite");
    await setField(imported, "Width", WIDTH);
    await setField(imported, "Height", HEIGHT);
    await select(page, imported, "Colours", "Keep");
    const keep = imported.getByRole("button", { name: "Keep source as reference" });
    await keep.click();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    await expect(imported.locator("[data-import-summary]")).toHaveText(
        "1 frame · 32 × 24 · 4 colours",
    );
    await expect(imported.locator("[data-import-result]")).toHaveAttribute("aria-busy", "false");
    await importButton(imported).click();
    await expect(importDialog(page)).toHaveCount(0);
    await expect(documentName(page)).toHaveText("photo");
    await settle(page);
    const photo = await activeDocumentId(page);
    expect(photo).not.toBe(hero);
    const importedState = await documentSummary(page, photo);
    expect(importedState.layers).toEqual([
        expect.objectContaining({ kind: "reference", placement: "behind", x: 0, y: 0, scale: 0.5 }),
        expect.objectContaining({ kind: "pixel", visible: true }),
    ]);
    expect(importedState.cels[1]).toEqual([bytesOf(FITTED)]);
    // The reference keeps the source image, and the composite leaves it out.
    expect(importedState.sources).toHaveLength(1);
    expect(importedState.composites).toEqual([bytesOf(FITTED)]);

    // 6. Select with the rectangular marquee, then Edit → Flip Horizontal and Enter.
    await pressToolKey(page, "KeyM", "marquee");
    await strokeThrough(page, [
        { x: SELECTED.x, y: SELECTED.y },
        { x: SELECTED.x + 5, y: SELECTED.y + 3 },
        { x: SELECTED.x + SELECTED.width - 1, y: SELECTED.y + SELECTED.height - 1 },
    ]);
    await fromMenu(page, "Edit", "edit.flipHorizontal");
    await expect.poll(() => floating(page)).toBe(true);
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => floating(page)).toBe(false);
    expect((await toolsState(page)).selected).toBe("move");
    const photoBefore = await documentSummary(page, photo);
    expect(photoBefore.cels[1]).toEqual([bytesOf(PHOTO_FRAME)]);
    expect(photoBefore.composites).toEqual([bytesOf(PHOTO_FRAME)]);

    // 7. Save both: the imported sprite, then the hero after a click on its tab.
    await save(page, "photo.ngsprite");
    await tabOf(page, hero).click();
    await expect(documentName(page)).toHaveText("hero");
    await save(page, "hero.ngsprite");
    const { files, writes } = await fileSystem(page);
    expect(writes).toEqual(["photo.ngsprite", "hero.ngsprite"]);

    // 8. Reload: the stub's files are put back into the new page's memory.
    await page.reload();
    await openEditor(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await arrangeFiles(page, { files });

    // 9. Open both files: each document is what was saved.
    const heroAgain = await open(page, "hero.ngsprite", "hero");
    const photoAgain = await open(page, "photo.ngsprite", "photo");
    expectSameDocument(await documentSummary(page, heroAgain), heroBefore);
    expectSameDocument(await documentSummary(page, photoAgain), photoBefore);

    // 10. Export each bundle into a folder of its own.
    const photoFiles = await exportInto(page, "photo-bundle");
    await tabOf(page, heroAgain).click();
    await expect(documentName(page)).toHaveText("hero");
    const heroFiles = await exportInto(page, "hero-bundle");
    expect(errors).toEqual([]);

    // 11. The consumer game imports each generated module and draws every frame, and the
    // hero's tag plays as its animation. The reference layer is not in the photo's frame.
    const consumer = await page.context().newPage();
    const consumerErrors = collectErrors(consumer);
    await expectConsumerDraws(
        consumer,
        testInfo,
        heroFiles,
        { camel: "hero", pascal: "Hero" },
        HERO_FRAMES,
        {
            id: "walk",
            durations: heroBefore.durations,
        },
    );
    await expectConsumerDraws(consumer, testInfo, photoFiles, { camel: "photo", pascal: "Photo" }, [
        PHOTO_FRAME,
    ]);
    expect(consumerErrors).toEqual([]);
});
