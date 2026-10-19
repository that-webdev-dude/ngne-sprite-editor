import { expect, test } from "@playwright/test";
import { compositeFrame } from "../../src/core/composite";
import { collectErrors } from "./se-006-support";
import { openEditor } from "./se-007-support";
import { infoToast } from "./se-041-support";
import {
    arrangeFolders,
    byName,
    choose,
    expectSameFiles,
    expectedBundle,
    folderFiles,
    openExportDialog,
    openFixture,
    stubExportFolders,
} from "./se-052-support";
import { FIXTURES, animationsOf, rectanglesOf } from "./se-053-documents";
import type { FileBytes } from "./se-053-documents";
import {
    alphaCounts,
    compareCanvas,
    expectedAtlas,
    expectedCanvas,
    frameDraws,
    imageDifference,
} from "./se-053-expected";
import { draw, expectHealthy, openConsumer, readAtlas } from "./se-053-support";

// SE-052: exporting one tag (SPEC §9.3: `exportSettings.frames = { tagId }`) from the Export
// dialog writes only that tag's frames, under their document indices, and its animation; and
// SE-053's consumer game, importing the exported module, draws each of those frames as its
// composite (SPEC §9.7, condition 3). SE-053 proves the bundle of all frames; here the frame
// IDs of the atlas do not start at 0.

test("exporting one tag writes only its frames and animation, and an NGNE game draws them as their composites", async ({
    page,
}, testInfo) => {
    const errors = collectErrors(page);
    await stubExportFolders(page);
    await openEditor(page);
    // Fixture (a): four frames; the tag "Blink" spans frames 3 and 4 and plays twice.
    await openFixture(page, "a");
    await arrangeFolders(page, { nextFolder: ["blink"] });

    const dialog = await openExportDialog(page);
    await choose(page, dialog, "Frames", "Blink (3–4)");
    await expect(dialog.getByRole("list", { name: /^Frame IDs/ }).getByRole("listitem")).toHaveText(
        ["walker-2", "walker-3"],
    );
    await expect(
        dialog.getByRole("list", { name: /^Animation IDs/ }).getByRole("listitem"),
    ).toHaveText(["blink"]);
    await dialog.getByRole("button", { name: "Choose folder…", exact: true }).click();
    await expect(dialog.locator("[data-export-folder]")).toHaveText("blink");
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(infoToast(page, "Exported 4 files to “blink”")).toBeVisible();

    const expected = await expectedBundle(page);
    const written = await folderFiles(page, "blink");
    expectSameFiles(written, byName(expected));
    const files: FileBytes[] = expected.map(({ name }) => ({ name, bytes: written.get(name)! }));

    // Condition 1 of SPEC §9.7 on the files as written, and what they state.
    await openConsumer(page, testInfo, FIXTURES.a, files);
    const directory = testInfo.outputPath("bundle");
    const { meta, image } = await readAtlas(directory, "walker");
    expect(Object.keys(meta.frames)).toEqual(["walker-2", "walker-3"]);
    expect(animationsOf(meta)).toEqual(["blink once 460: 2:150 3:80 2:150 3:80"]);
    // Two untrimmed 32 × 32 rectangles side by side, padding 1.
    expect([meta.width, meta.height]).toEqual([67, 34]);
    expect(rectanglesOf(meta)).toEqual(["1,1 32×32 @0,0", "34,1 32×32 @0,0"]);

    // The image holds those frames' composites in their rectangles, and nothing else.
    const doc = FIXTURES.a.build();
    const composites = new Map(
        ["walker-2", "walker-3"].map((id, index) => [
            id,
            compositeFrame(doc, doc.frames[index + 2]!.id),
        ]),
    );
    expect(
        imageDifference(image, expectedAtlas(meta, composites, doc.exportSettings.extrude)),
    ).toBeNull();

    // Condition 3: the game draws each frame, at an anchor, turned, mirrored and scaled.
    let compared = 0;
    for (const [frame, composite] of composites) {
        const draws = frameDraws(frame);
        for (const command of [
            ...draws.anchored,
            ...draws.turned,
            ...draws.mirrored,
            ...draws.scaled,
        ]) {
            const wanted = expectedCanvas(composite, doc.pivot, command);
            compared += alphaCounts(wanted).opaque;
            const canvas = await draw(page, [command]);
            expect(compareCanvas(canvas, wanted), JSON.stringify(command)).toEqual([]);
        }
    }
    expect(compared).toBeGreaterThan(0);
    await expectHealthy(page);
    expect(errors).toEqual([]);
});
