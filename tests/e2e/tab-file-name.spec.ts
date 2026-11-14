import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openEditor } from "./se-007-support";
import {
    activeState,
    arrangeFiles,
    documentName,
    errorToast,
    fileSystem,
    infoToast,
    openHero,
    stubFileSystemAccess,
} from "./se-041-support";
import { activeId, openTab, overflowButton, settleSize, tabOf, tabs } from "./se-047-support";

// Issue #6: once a document has a file, its tab shows that file's name without the project
// extension; until then, its sprite name. The tooltip names both; the close control and the
// overflow menu use the tab's label. Save As uses the in-memory File System Access stub.

const viewportFocus = (page: Page) => page.locator("[data-viewport-focus]");

/** Runs File → Save As… with its key while the viewport has the focus. */
async function saveAs(page: Page): Promise<void> {
    await viewportFocus(page).focus();
    await expect(viewportFocus(page)).toBeFocused();
    await page.keyboard.press("Control+Shift+KeyS");
}

/** The close control's title on the tab of the active document. */
async function closeTitle(page: Page): Promise<string | null> {
    const id = await activeId(page);
    return tabOf(page, id!).locator("[data-tab-close]").getAttribute("title");
}

test("Save As names the tab after the new file at once; a second Save As follows it; a cancelled one changes nothing", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openHero(page);
    // Never saved: the sprite name, alone in the tooltip.
    await expect(documentName(page)).toHaveText("hero");
    await expect(documentName(page)).toHaveAttribute("title", "hero");
    expect(await closeTitle(page)).toBe("Close hero");

    await arrangeFiles(page, { nextSave: ["saveas_hero.ngsprite"] });
    await saveAs(page);
    await expect(infoToast(page, "Saved saveas_hero.ngsprite")).toBeVisible();
    await expect(documentName(page)).toHaveText("saveas_hero");
    await expect(documentName(page)).toHaveAttribute(
        "title",
        "saveas_hero.ngsprite — sprite: hero",
    );
    expect(await closeTitle(page)).toBe("Close saveas_hero");
    // The sprite name, the export identity, is the same.
    expect((await activeState(page))?.name).toBe("hero");

    // Save As to a second file: a new id, and the tab follows the latest file.
    const first = await activeId(page);
    await arrangeFiles(page, { nextSave: ["second.ngsprite"] });
    await saveAs(page);
    await expect(infoToast(page, "Saved second.ngsprite")).toBeVisible();
    await expect(documentName(page)).toHaveText("second");
    expect(await activeId(page)).not.toBe(first);
    await expect(documentName(page)).toHaveAttribute("title", "second.ngsprite — sprite: hero");

    // A cancelled picker: no toast, and the label stays.
    await saveAs(page);
    await expect.poll(async () => (await fileSystem(page)).saveSuggestions.length).toBe(3);
    await expect(documentName(page)).toHaveText("second");
    await expect(errorToast(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("a write that fails leaves the label as it was", async ({ page }) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openHero(page);
    await arrangeFiles(page, {
        nextSave: ["full.ngsprite"],
        failWrite: {
            "full.ngsprite": {
                name: "QuotaExceededError",
                message: "The quota has been exceeded.",
            },
        },
    });
    await saveAs(page);
    await expect(errorToast(page)).toHaveText(
        "Could not save “full.ngsprite”. The quota has been exceeded.",
    );
    await expect(documentName(page)).toHaveText("hero");
    await expect(documentName(page)).toHaveAttribute("title", "hero");
    expect(errors).toEqual([]);
});

test("a project opened from a file whose name differs from its sprite name shows the file name", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await openHero(page);
    await arrangeFiles(page, { nextSave: ["hero.ngsprite"] });
    await saveAs(page);
    await expect(infoToast(page, "Saved hero.ngsprite")).toBeVisible();
    const bytes = (await fileSystem(page)).files["hero.ngsprite"]!;

    await arrangeFiles(page, {
        nextOpen: ["level-1.ngsprite"],
        files: { "level-1.ngsprite": bytes },
    });
    await page.keyboard.press("Control+KeyO");
    await expect(infoToast(page, "Opened level-1.ngsprite")).toBeVisible();
    await expect(tabs(page)).toHaveCount(2);
    await expect(documentName(page)).toHaveText("level-1");
    await expect(documentName(page)).toHaveAttribute("title", "level-1.ngsprite — sprite: hero");
    expect(errors).toEqual([]);
});

test("the overflow menu lists the same labels as the tabs", async ({ page }) => {
    const errors = collectErrors(page);
    await stubFileSystemAccess(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditor(page);
    await settleSize(page);
    for (let index = 1; index <= 12; index++) await openTab(page, `sprite ${index}`);
    await expect(overflowButton(page)).toBeVisible();
    await arrangeFiles(page, { nextSave: ["twelfth-file.ngsprite"] });
    await saveAs(page);
    await expect(infoToast(page, "Saved twelfth-file.ngsprite")).toBeVisible();
    await expect(documentName(page)).toHaveText("twelfth-file");

    const labels = await tabs(page).locator(".document-tab__name").allTextContents();
    expect(labels).toContain("twelfth-file");
    expect(labels).not.toContain("sprite 12");
    await overflowButton(page).click();
    const menu = page.getByRole("menu", { name: "All documents" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio")).toHaveText(labels);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    expect(errors).toEqual([]);
});
