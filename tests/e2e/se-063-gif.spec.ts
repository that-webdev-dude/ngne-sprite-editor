import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { collectErrors, settleTimers } from "./se-006-support";
import { openEditor } from "./se-007-support";
import { field } from "./se-008-support";
import { errorToast, frameComposites, infoToast } from "./se-041-support";
import { choose, removeExportPickers } from "./se-052-support";
import { FOUR_FRAME_DELAYS } from "./se-063-documents";
import {
    decodeInBrowser,
    exportAndDownload,
    gifImage,
    openGifDialog,
    openGifFixture,
} from "./se-063-support";

// SE-063: Export GIF… as the user runs it (SPEC §9.6, DESIGN §7). The GIF downloads (no save
// picker) and Chrome's own decoder, `ImageDecoder`, reads it back: the number of frames, each
// frame's duration, the loop count and the exact colours it shows.

/** Whether the GIF's images are those of the frames `order`, composites as the GIF shows them. */
async function expectFrames(
    page: Page,
    images: number[][],
    order: readonly number[],
    width: number,
    scale = 1,
): Promise<void> {
    const composites = await frameComposites(page);
    expect(images).toHaveLength(order.length);
    order.forEach((frameIndex, position) => {
        const expected = gifImage(composites[frameIndex]!, width, scale);
        expect(
            Buffer.from(Uint8Array.from(images[position]!)).equals(
                Buffer.from(Uint8Array.from(expected)),
            ),
            `GIF frame ${position} (document frame ${frameIndex})`,
        ).toBe(true);
    });
}

/** The number of different RGBA values of an image. */
function colourCount(image: readonly number[]): number {
    const colours = new Set<string>();
    for (let at = 0; at < image.length; at += 4) colours.add(image.slice(at, at + 4).join());
    return colours.size;
}

async function dialogsClosed(page: Page): Promise<void> {
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await settleTimers(page);
}

/** The dialog's Frames select. */
const frames = (dialog: Locator): Locator =>
    dialog.getByRole("combobox", { name: "Frames", exact: true });

/**
 * Chooses an entry of the Frames select, then waits until the closed list has given the focus
 * back to the select (Radix does it after the list closes), before the next key or field.
 */
async function chooseFrames(page: Page, dialog: Locator, option: string): Promise<void> {
    await choose(page, dialog, "Frames", option);
    await expect(frames(dialog)).toBeFocused();
}

test("a GIF of the 4-frame fixture decodes to 4 frames with their delays and exact colours", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await removeExportPickers(page);
    await openEditor(page);
    await openGifFixture(page, "fourFrames");

    const dialog = await openGifDialog(page);
    await expect(frames(dialog)).toHaveText("All frames");
    await expect(field(dialog, "Scale")).toHaveValue("1");
    await expect(dialog.locator("[data-gif-result]")).toHaveText(
        "four-frames.gif · 16 × 16 px · 4 frames · loops forever",
    );
    const { name, bytes } = await exportAndDownload(page, dialog);
    expect(name).toBe("four-frames.gif");
    await expect(infoToast(page, "Exported 1 file to “four-frames.gif”")).toBeVisible();

    const gif = await decodeInBrowser(page, bytes);
    expect(gif.frameCount).toBe(4);
    expect([gif.width, gif.height]).toEqual([16, 16]);
    expect(gif.durations).toEqual([...FOUR_FRAME_DELAYS]);
    expect(gif.repetitionCount).toBe("Infinity");
    await expectFrames(page, gif.images, [0, 1, 2, 3], 16);
    // The fixture holds 256 colours in frame 0, and transparent pixels in frames 1 to 3.
    expect(colourCount(gif.images[0]!)).toBe(256);
    expect(gif.images[3]!.every((value) => value === 0)).toBe(true);
    await dialogsClosed(page);
    await expect(errorToast(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("a ping-pong tag exports its expanded sequence, scaled", async ({ page }) => {
    const errors = collectErrors(page);
    await removeExportPickers(page);
    await openEditor(page);
    await openGifFixture(page, "fourFrames");

    const dialog = await openGifDialog(page);
    await chooseFrames(page, dialog, "Bounce (1–4)");
    const scale = field(dialog, "Scale");
    await scale.fill("2");
    await scale.blur();
    await expect(dialog.locator("[data-gif-result]")).toHaveText(
        "four-frames-bounce@2x.gif · 32 × 32 px · 6 frames · loops forever",
    );
    const { name, bytes } = await exportAndDownload(page, dialog);
    expect(name).toBe("four-frames-bounce@2x.gif");

    const gif = await decodeInBrowser(page, bytes);
    const order = [0, 1, 2, 3, 2, 1];
    expect(gif.frameCount).toBe(6);
    expect([gif.width, gif.height]).toEqual([32, 32]);
    expect(gif.durations).toEqual(order.map((index) => FOUR_FRAME_DELAYS[index]));
    expect(gif.repetitionCount).toBe("Infinity");
    await expectFrames(page, gif.images, order, 16, 2);
    expect(errors).toEqual([]);
});

test("a tag played twice loops once more; one played once does not loop", async ({ page }) => {
    const errors = collectErrors(page);
    await removeExportPickers(page);
    await openEditor(page);
    await openGifFixture(page, "fourFrames");

    let dialog = await openGifDialog(page);
    await chooseFrames(page, dialog, "Twice (3–4)");
    const scale = field(dialog, "Scale");
    await scale.fill("3");
    await scale.blur();
    await expect(dialog.locator("[data-gif-result]")).toHaveText(
        "four-frames-twice@3x.gif · 48 × 48 px · 2 frames · plays 2 times",
    );
    let gif = await decodeInBrowser(page, (await exportAndDownload(page, dialog)).bytes);
    expect(gif.repetitionCount).toBe(1);
    await expectFrames(page, gif.images, [2, 3], 16, 3);
    await dialogsClosed(page);

    dialog = await openGifDialog(page);
    // The dialog opens with the scale last chosen; the frames are the export settings' again.
    await expect(frames(dialog)).toHaveText("All frames");
    await expect(field(dialog, "Scale")).toHaveValue("3");
    await chooseFrames(page, dialog, "Back (2–4)");
    await expect(dialog.locator("[data-gif-result]")).toHaveText(
        "four-frames-back@3x.gif · 48 × 48 px · 3 frames · plays once",
    );
    gif = await decodeInBrowser(page, (await exportAndDownload(page, dialog)).bytes);
    expect(gif.repetitionCount).toBe(0);
    expect(gif.durations).toEqual([3, 2, 1].map((index) => FOUR_FRAME_DELAYS[index]));
    await expectFrames(page, gif.images, [3, 2, 1], 16, 3);
    expect(errors).toEqual([]);
});

test("frames with more than 256 colours export with a quantization warning toast, not a failure", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await removeExportPickers(page);
    await openEditor(page);
    await openGifFixture(page, "manyColours");

    const dialog = await openGifDialog(page);
    const { name, bytes } = await exportAndDownload(page, dialog);
    expect(name).toBe("many-colours.gif");
    await expect(infoToast(page, "Exported 1 file to “many-colours.gif”")).toBeVisible();
    await expect(
        infoToast(
            page,
            "Colours reduced in 1 of the document's frames: a GIF frame holds at most 256.",
        ),
    ).toBeVisible();
    await expect(errorToast(page)).toHaveCount(0);

    const gif = await decodeInBrowser(page, bytes);
    expect(gif.frameCount).toBe(3);
    expect(colourCount(gif.images[1]!)).toBeLessThanOrEqual(256);
    expect(colourCount(gif.images[1]!)).toBeGreaterThan(200);
    // The frames within the limit keep their colours exactly.
    const composites = await frameComposites(page);
    expect(gif.images[0]).toEqual(gifImage(composites[0]!, 24));
    expect(gif.images[2]).toEqual(gifImage(composites[2]!, 24));
    expect(errors).toEqual([]);
});
