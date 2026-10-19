import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, settleTimers } from "./se-006-support";
import { hex8, swatches } from "./se-016-support";
import {
    arrangeFiles,
    errorToast,
    fileSystem,
    removeFileSystemAccess,
    stubFileSystemAccess,
} from "./se-041-support";
import { COLOURS, history, openPalettePanel, palette, shownColours } from "./se-060-support";
import { viewportArea } from "./se-012-support";
import { chooseInPaletteMenu } from "./se-066-support";

// SE-066: palette files and sort from the palette's overflow menu (DESIGN §5.4) — a GIMP
// palette imported in one undo step, a malformed file reported by an error toast that changes
// nothing, the palette exported through the save picker (a file input and a download without
// File System Access), and a sort that is one undo step with
// "Original Order" putting back the order held before the first sort.

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));

/** Ctrl+Z on the viewport, which a press elsewhere may have left without the focus. */
async function undo(page: Page): Promise<void> {
    await settleTimers(page);
    await viewportArea(page).focus();
    await expect(viewportArea(page)).toBeFocused();
    await page.keyboard.press("Control+z");
}

test("Import Palette… replaces the palette by a GIMP palette in one undo step", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openPalettePanel(page);
    await arrangeFiles(page, {
        nextOpen: ["sunset.gpl"],
        files: {
            "sunset.gpl": bytes(
                "GIMP Palette\nName: Sunset\nColumns: 4\n#\n255 128   0\tOrange\n 64  0 128\tPurple\n",
            ),
        },
    });
    await chooseInPaletteMenu(page, "Import Palette…");
    await expect
        .poll(() => palette(page))
        .toEqual({
            name: "Sunset",
            colors: [0xff8000ff, 0x400080ff],
        });
    await expect(swatches(page)).toHaveCount(2);
    await expect.poll(() => shownColours(page)).toEqual([hex8(0xff8000ff), hex8(0x400080ff)]);
    expect(await history(page)).toEqual({ undo: 1, label: "Import Palette" });
    await expect(page.locator(".ui-toast").filter({ hasText: "Imported 2 colours" })).toBeVisible();

    await undo(page);
    expect(await palette(page)).toEqual({ name: "Test", colors: COLOURS });
    await expect(swatches(page)).toHaveCount(COLOURS.length);
    expect(errors).toEqual([]);
});

test("a malformed palette file is an error toast and changes nothing", async ({ page }) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openPalettePanel(page);
    await arrangeFiles(page, {
        nextOpen: ["broken.pal"],
        files: {
            "broken.pal": bytes("JASC-PAL\r\n0100\r\n3\r\n255 0 0\r\n0 999 0\r\n0 0 255\r\n"),
        },
    });
    await chooseInPaletteMenu(page, "Import Palette…");
    await expect(errorToast(page)).toContainText("Could not import “broken.pal”.");
    await expect(errorToast(page)).toContainText("Line 5");
    expect(await palette(page)).toEqual({ name: "Test", colors: COLOURS });
    expect(await history(page)).toEqual({ undo: 0, label: null });
    expect(await shownColours(page)).toEqual(COLOURS.map(hex8));
    expect((await fileSystem(page)).openPickers).toBe(1);
    expect(errors).toEqual([]);
});

test("Export Palette as .gpl… writes the palette through the save picker", async ({ page }) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openPalettePanel(page);
    await arrangeFiles(page, { nextSave: ["Test.gpl"] });
    await chooseInPaletteMenu(page, "Export Palette as .gpl…");
    await expect.poll(async () => (await fileSystem(page)).writes).toEqual(["Test.gpl"]);
    const written = await fileSystem(page);
    expect(written.saveSuggestions).toEqual(["test.gpl"]);
    const lines = new TextDecoder().decode(Uint8Array.from(written.files["Test.gpl"]!)).split("\n");
    // COLOURS holds a colour that is not opaque: the file has four values per colour.
    expect(lines.slice(0, 5)).toEqual([
        "GIMP Palette",
        "Name: Test",
        "Columns: 16",
        "Channels: RGBA",
        "#",
    ]);
    expect(lines.slice(5, 5 + COLOURS.length).map((line) => line.split("\t")[1])).toEqual(
        COLOURS.map(hex8),
    );
    expect(await history(page)).toEqual({ undo: 0, label: null });
    expect(errors).toEqual([]);
});

test("without File System Access, import takes a file input and export downloads", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await removeFileSystemAccess(page);
    await openPalettePanel(page);
    const chooser = page.waitForEvent("filechooser");
    await chooseInPaletteMenu(page, "Import Palette…");
    await (
        await chooser
    ).setFiles({
        name: "Strip.hex",
        mimeType: "text/plain",
        buffer: Buffer.from("102030\n405060\n"),
    });
    await expect
        .poll(() => palette(page))
        .toEqual({
            name: "Strip",
            colors: [0x102030ff, 0x405060ff],
        });
    expect(await history(page)).toEqual({ undo: 1, label: "Import Palette" });

    const download = page.waitForEvent("download");
    await chooseInPaletteMenu(page, "Export Palette as .pal…");
    const file = await download;
    expect(file.suggestedFilename()).toBe("strip.pal");
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(
        "JASC-PAL\r\n0100\r\n2\r\n16 32 48\r\n64 80 96\r\n",
    );
    expect(errors).toEqual([]);
});

test("each sort is one undo step; Original Order restores the order held before the first sort", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openPalettePanel(page);
    // COLOURS: black, red, green, blue, white, grey at half alpha.
    await chooseInPaletteMenu(page, "Sort by Hue");
    const byHue = [0x000000ff, 0x80808080, 0xffffffff, 0xff0000ff, 0x00ff00ff, 0x0000ffff];
    await expect.poll(async () => (await palette(page)).colors).toEqual(byHue);
    await expect.poll(() => shownColours(page)).toEqual(byHue.map(hex8));
    expect(await history(page)).toEqual({ undo: 1, label: "Sort Palette by Hue" });

    await chooseInPaletteMenu(page, "Sort by Lightness");
    const byLightness = [0x000000ff, 0x0000ffff, 0x80808080, 0xff0000ff, 0x00ff00ff, 0xffffffff];
    await expect.poll(async () => (await palette(page)).colors).toEqual(byLightness);
    expect(await history(page)).toEqual({ undo: 2, label: "Sort Palette by Lightness" });

    await chooseInPaletteMenu(page, "Original Order");
    await expect.poll(async () => (await palette(page)).colors).toEqual(COLOURS);
    await expect.poll(() => shownColours(page)).toEqual(COLOURS.map(hex8));
    expect(await history(page)).toEqual({ undo: 3, label: "Original Palette Order" });

    await undo(page);
    expect((await palette(page)).colors).toEqual(byLightness);
    expect(errors).toEqual([]);
});
