import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { menuTrigger, openMenu } from "./se-007-support";
import {
    activeState,
    documentName,
    drawStroke,
    emptyState,
    errorToast,
    frameComposites,
    infoToast,
    openHero,
} from "./se-041-support";
import {
    arrangePickers,
    fileStub,
    permissionAfterReload,
    stubProjectFiles,
} from "./se-047-support";

// SE-047: recent files (File System Access handles kept in IndexedDB) on the empty state and in
// File → Open Recent: a saved file is first after a reload and opens from there, asking for
// read permission once; an entry whose permission is refused is taken off the list.

const STROKE = [
    { x: 1, y: 1 },
    { x: 9, y: 6 },
];
const MORE = [
    { x: 3, y: 9 },
    { x: 12, y: 9 },
];

/** The recent files listed on the empty state, in order. */
const recentButtons = (page: Page) => emptyState(page).locator("[data-recent-file]");

/** Saves a drawn "hero" as old.ngsprite, then, drawn on, as hero.ngsprite; closes it. */
async function saveTwoFiles(page: Page): Promise<number[][]> {
    await openHero(page);
    await drawStroke(page, STROKE);
    await arrangePickers(page, { nextSave: ["old.ngsprite"] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved old.ngsprite")).toBeVisible();
    await drawStroke(page, MORE);
    await arrangePickers(page, { nextSave: ["hero.ngsprite"] });
    await page.keyboard.press("Control+Shift+KeyS");
    await expect(infoToast(page, "Saved hero.ngsprite")).toBeVisible();
    const saved = await frameComposites(page);
    await page.keyboard.press("Alt+KeyW");
    await expect(emptyState(page)).toBeVisible();
    return saved;
}

/** Reloads the page, the file stub starting with `permission`. */
async function reload(page: Page, permission: "prompt" | "revoked"): Promise<void> {
    await permissionAfterReload(page, permission);
    await page.reload();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    await expect(emptyState(page)).toBeVisible();
}

test("a saved file appears first in the recent list after reload and reopens from it, after one permission prompt", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubProjectFiles(page);
    const saved = await saveTwoFiles(page);
    // Listed at once, newest first.
    await expect(recentButtons(page)).toHaveText(["hero.ngsprite", "old.ngsprite"]);

    await reload(page, "prompt");
    await expect(recentButtons(page)).toHaveText(["hero.ngsprite", "old.ngsprite"]);
    await expect(emptyState(page).getByText("Recent files")).toBeVisible();

    // File → Open Recent lists the same files, in the same order; the first opens, after the
    // browser asked for read permission once.
    const file = await openMenu(page, "File");
    await file.locator('[data-submenu="Open Recent"]').hover();
    const submenu = page.getByRole("menu", { name: "Open Recent", exact: true });
    await expect(submenu.getByRole("menuitem")).toHaveText([
        "hero.ngsprite",
        "old.ngsprite",
        "Clear Recent Files",
    ]);
    await submenu.getByRole("menuitem", { name: "hero.ngsprite" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(infoToast(page, "Opened hero.ngsprite")).toBeVisible();
    await expect(documentName(page)).toHaveText("hero");
    expect((await fileStub(page)).permissionRequests).toBe(1);
    expect(await frameComposites(page)).toEqual(saved);
    expect(await activeState(page)).toMatchObject({ undo: 0, dirty: false });

    // Closed and opened again from the empty state: the permission holds, nothing is asked.
    await expect(menuTrigger(page, "File")).toBeFocused();
    await page.keyboard.press("Alt+KeyW");
    await expect(emptyState(page)).toBeVisible();
    await expect(recentButtons(page)).toHaveText(["hero.ngsprite", "old.ngsprite"]);
    await recentButtons(page).first().click();
    await expect(documentName(page)).toHaveText("hero");
    expect(await frameComposites(page)).toEqual(saved);
    expect((await fileStub(page)).permissionRequests).toBe(1);
    expect(errors).toEqual([]);
});

test("an entry whose permission is refused prompts once, then is removed from the list", async ({
    page,
}) => {
    await stubProjectFiles(page);
    await saveTwoFiles(page);
    await reload(page, "revoked");
    await expect(recentButtons(page)).toHaveText(["hero.ngsprite", "old.ngsprite"]);

    await recentButtons(page).first().click();
    await expect(errorToast(page)).toHaveText(
        "Could not open “hero.ngsprite”. No permission to read the file. It was removed from " +
            "the recent files.",
    );
    expect((await fileStub(page)).permissionRequests).toBe(1);
    await expect(recentButtons(page)).toHaveText(["old.ngsprite"]);
    expect(await activeState(page)).toBeNull();

    // Gone for good: also after the next reload.
    await reload(page, "revoked");
    await expect(recentButtons(page)).toHaveText(["old.ngsprite"]);
});
