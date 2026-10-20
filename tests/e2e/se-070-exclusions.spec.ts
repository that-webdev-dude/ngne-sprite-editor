import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import type * as CoreModel from "../../src/core/model";
import type { PixelBuffer } from "../../src/core/model";
import { collectErrors } from "./se-006-support";
import { DARK, openViewportEditor, settle } from "./se-011-support";
import { overlayCanvas, overlaySettled } from "./se-013-support";
import { runCommands } from "./se-022-support";
import { infoToast } from "./se-041-support";
import { arrangeFolders, folderFiles, openExportDialog, stubExportFolders } from "./se-052-support";
import { expectedAtlas, imageDifference } from "./se-053-expected";
import { readAtlas, writeBundle } from "./se-053-support";
import {
    ALL_FRAMES,
    BACKGROUNDS,
    frameIdOf,
    previewMismatches,
    previewSettled,
    readPreview,
    setPreview,
} from "./se-054-support";
import { addReference, changeReference, setOpacity } from "./se-045-support";
import { imageOf } from "./se-070-support";
import type { Rgba } from "./se-070-support";

// SE-070: what the viewport shows besides the frame stays out of what is exported and out of
// the preview panel (SE-054): reference layers (behind and in front), onion skins (before and
// after), the symmetry axes and the tiled copies (SE-062). One document has all of them on,
// each checked to be on screen first; then the exported sprite sheet and the preview's
// canvas, read back in its `afterFrame` (SPEC §6.7), are compared exactly with the frames as
// painted here: every pixel of the art is opaque or transparent.

const WIDTH = 16;
const HEIGHT = 12;
const NAME = "layers";
const VIEW = { scale: 8, originX: 200, originY: 160 };

const FRAME_COLOURS: readonly Rgba[] = [
    [220, 60, 40, 255],
    [40, 180, 90, 255],
    [70, 90, 230, 255],
];
const REFERENCE_BEHIND: Rgba = [250, 240, 10, 255];
const REFERENCE_FRONT: Rgba = [250, 0, 250, 255];

/** Frame i: a block of its colour that moves to the right with i, the rest transparent. */
const FRAMES: PixelBuffer[] = FRAME_COLOURS.map((rgba, index) =>
    imageOf(WIDTH, HEIGHT, (x, y) =>
        x >= 2 + index * 3 && x < 8 + index * 3 && y >= 2 && y < 9 ? rgba : [0, 0, 0, 0],
    ),
);

/** Opens the document with the three frames, frame 2 active, at `VIEW`; returns its id. */
function openLayers(page: Page): Promise<string> {
    return page.evaluate(
        async ({ frames, width, height, name, view }) => {
            const path = "/src/core/model/index.ts";
            const core = (await import(/* @vite-ignore */ path)) as typeof CoreModel;
            const session = core.createDocument({ name, width, height });
            const { doc } = session;
            const first = doc.frames[0]!;
            doc.frames = frames.map((_, index) => ({
                id: index === 0 ? first.id : `frame-${index + 1}`,
                durationMs: 100,
            }));
            frames.forEach((pixels, index) => {
                const imageId = `image-${index + 1}`;
                doc.images.set(imageId, { width, height, data: Uint8ClampedArray.from(pixels) });
                doc.cels.set(core.celKey(session.activeLayerId, doc.frames[index]!.id), {
                    imageId,
                    opacity: 255,
                });
            });
            session.activeFrameId = doc.frames[1]!.id;
            doc.settings.pixelGrid = false;
            doc.settings.grid.visible = false;
            doc.settings.onion = {
                ...doc.settings.onion,
                before: 1,
                after: 1,
                opacity: 255,
                tint: false,
            };
            const id = window.__ngneTest!.sessions.getState().open(session, { view }).id;
            window.__ngneTest!.assertInvariants();
            return id;
        },
        {
            frames: FRAMES.map((frame) => Array.from(frame.data)),
            width: WIDTH,
            height: HEIGHT,
            name: NAME,
            view: VIEW,
        },
    );
}

/**
 * The document with everything on: a reference behind it and one in front (opaque, covering
 * the canvas), onion skin with the frames before and after at full opacity, both symmetry
 * axes and tiling in X and Y, from their registered commands. Checks that each is on screen.
 */
async function openWithEverything(page: Page): Promise<void> {
    await openLayers(page);
    for (const [rgba, placement] of [
        [REFERENCE_BEHIND, "behind"],
        [REFERENCE_FRONT, "front"],
    ] as const) {
        const id = await addReference(page, { kind: "flat", width: 4, height: 3, rgba });
        expect(id).not.toBeNull();
        await setOpacity(page, id!, 255);
        if (placement === "front") {
            // In front over the right half of the canvas only: the frame shows beside it.
            expect(await changeReference(page, id!, { placement, x: 10, y: 0, scale: 1.5 })).toBe(
                true,
            );
        }
    }
    await runCommands(page, [
        "view.onionSkin",
        "view.symmetryX",
        "view.symmetryY",
        "view.tiledX",
        "view.tiledY",
    ]);
    await settle(page);
    await overlaySettled(page);

    const shown = await page.evaluate(
        ({ view, width, height }) => {
            const probe = window.__ngneTest!.viewport!;
            const image = probe.readCanvas()!;
            const at = (x: number, y: number) =>
                Array.from(
                    image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3),
                );
            const state = window.__ngneTest!.sessions.getState();
            const { settings } = state.documents.find((entry) => entry.id === state.activeId)!
                .session.doc;
            return {
                ghosts: probe.onion.length,
                references: probe.references.filter((slot) => slot !== null).length,
                // The middle of texel (1, 1), of texel (14, 1), and of the copy of texel (1, 1)
                // to the left of the canvas.
                behindOnly: at(view.originX + 12, view.originY + 12),
                front: at(view.originX + 14 * view.scale + 4, view.originY + 12),
                tiledCopy: at(view.originX - (width - 1) * view.scale + 4, view.originY + 12),
                symmetry: settings.symmetry.mode,
                tiled: settings.tiled,
                height,
            };
        },
        { view: VIEW, width: WIDTH, height: HEIGHT },
    );
    expect(shown).toMatchObject({ ghosts: 2, references: 2, symmetry: "both", tiled: "both" });
    // The reference behind shows where no frame and no ghost has a pixel; the one in front
    // covers its part; the tiled copy is drawn left of the canvas, not the workspace.
    expect(shown.behindOnly).toEqual(REFERENCE_BEHIND.slice(0, 3));
    expect(shown.front).toEqual(REFERENCE_FRONT.slice(0, 3));
    expect(shown.tiledCopy).not.toEqual([...DARK.workspace]);
    // The symmetry axes are on the overlay, through the middle of the canvas.
    const axes = await overlayCanvas(page).evaluate((canvas, view) => {
        const context = (canvas as HTMLCanvasElement).getContext("2d")!;
        const alpha = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3]!;
        return {
            vertical: [-1, 0].map((dx) =>
                alpha(view.originX + 8 * view.scale + dx, view.originY + 20),
            ),
            horizontal: [-1, 0].map((dy) =>
                alpha(view.originX + 20, view.originY + 6 * view.scale + dy),
            ),
        };
    }, VIEW);
    expect(Math.max(...axes.vertical)).toBeGreaterThan(0);
    expect(Math.max(...axes.horizontal)).toBeGreaterThan(0);
}

/** The frames by their atlas ID. */
const COMPOSITES = new Map(FRAMES.map((frame, index) => [frameIdOf(NAME, index), frame]));

test("reference layers, onion skins, symmetry axes and tiled copies are on the viewport and absent from the exported sprite sheet", async ({
    page,
}, testInfo: TestInfo) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openViewportEditor(page);
    await openWithEverything(page);

    await arrangeFolders(page, { nextFolder: ["layers-out"] });
    const dialog = await openExportDialog(page);
    await dialog.getByRole("button", { name: "Choose folder…", exact: true }).click();
    await expect(dialog.locator("[data-export-folder]")).toHaveText("layers-out");
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(infoToast(page, "files to “layers-out”")).toBeVisible();
    const files = await folderFiles(page, "layers-out");
    const directory = testInfo.outputPath("bundle");
    writeBundle(
        directory,
        [...files].map(([name, bytes]) => ({ name, bytes })),
    );

    // The sheet holds the three frames as painted, each in its rectangle, and nothing else.
    const { meta, image } = await readAtlas(directory, NAME);
    expect(Object.keys(meta.frames)).toEqual([...COMPOSITES.keys()]);
    expect(imageDifference(image, expectedAtlas(meta, COMPOSITES, 0))).toBeNull();
    expect(errors).toEqual([]);
});

test("reference layers, onion skins, symmetry axes and tiled copies are on the viewport and absent from the preview panel", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openViewportEditor(page);
    await openWithEverything(page);
    await setPreview(page, { chosen: ALL_FRAMES, playing: false, background: "mid" });
    await previewSettled(page);
    for (const [index, frame] of FRAMES.entries()) {
        // Frame k shows from 100 k ms to 100 (k + 1) ms.
        await page.evaluate((age) => window.__ngneTest!.preview!.seek(age), index * 100 + 50);
        const read = await readPreview(page, frameIdOf(NAME, index));
        expect([read.width, read.height]).toEqual([WIDTH, HEIGHT]);
        expect(
            previewMismatches(read, Array.from(frame.data), BACKGROUNDS.mid).slice(0, 5),
            `frame ${index + 1}`,
        ).toEqual([]);
    }
    expect(errors).toEqual([]);
});
