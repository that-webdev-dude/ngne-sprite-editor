import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports these modules from the dev server; here they are needed for their types.
import type * as DialogRequestsModule from "../../src/app/dialogs/dialogRequests";
import type * as SpriteDialogsModule from "../../src/app/sprite/dialogs";
import type * as SessionsModule from "../../src/app/state/sessions";
import { region } from "./se-006-support";
import { openMenu } from "./se-007-support";
import { dialogButton, nameField, newSpriteDialog, setNumber, field } from "./se-008-support";

// SE-034 (REVIEW.md B11): the host of the command dialogs is at the root of the app, inside a
// boundary of its own, so a failed menu-bar region no longer takes New sprite with it.

const HARNESS = "/tests/e2e/harness/se-006-boundary.html";

/** The active document of the page's session store, read through the module itself. */
function activeDocument(page: Page) {
    return page.evaluate(async () => {
        const path = "/src/app/state/sessions.ts";
        const sessions = (await import(/* @vite-ignore */ path)) as typeof SessionsModule;
        const document = sessions.activeDocument(sessions.sessionsStore.getState());
        if (!document) return null;
        const { doc } = document.session;
        return { name: doc.name, width: doc.width, height: doc.height };
    });
}

test("with the menu-bar region failed, New sprite from the empty state still opens its dialog and creates the document", async ({
    page,
}) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto(`${HARNESS}?region=menu-bar`);
    const alert = region(page, "menu-bar").getByRole("alert");
    await expect(alert).toHaveText("Menu bar failed to render.Reload");

    await region(page, "viewport").getByRole("button", { name: "New sprite", exact: true }).click();
    const dialog = newSpriteDialog(page);
    await expect(dialog).toBeVisible();
    await expect(nameField(dialog)).toBeFocused();
    await nameField(dialog).fill("hero");
    await setNumber(field(dialog, "Width"), 24);
    await setNumber(field(dialog, "Height"), 16);
    await dialogButton(dialog, "Create").click();
    await expect(dialog).toHaveCount(0);

    expect(await activeDocument(page)).toEqual({ name: "hero", width: 24, height: 16 });
    // The menu bar is still the one failed region.
    await expect(alert).toHaveText("Menu bar failed to render.Reload");
    await expect(page.getByRole("alert").filter({ hasText: "failed to render" })).toHaveCount(1);
    expect(uncaught).toEqual([]);
});

test("a request opened right after another was answered gets a dialog of its own, with its initial values", async ({
    page,
}) => {
    await page.goto("/");
    await expect(region(page, "viewport")).toBeVisible();
    const path = "/src/app/sprite/dialogs.ts";
    await page.evaluate(async (path) => {
        const module = (await import(/* @vite-ignore */ path)) as typeof SpriteDialogsModule;
        void module.spriteDialogs.canvasSize({
            initial: { width: 11, height: 12, anchor: { x: 0, y: 0 } },
        });
    }, path);
    const dialog = page.getByRole("dialog", { name: "Canvas size" });
    await expect(field(dialog, "Width")).toHaveValue("11");

    // Answered and asked again in one task: React never renders the empty state in between.
    await page.evaluate(async (path) => {
        const module = (await import(/* @vite-ignore */ path)) as typeof SpriteDialogsModule;
        module.spriteDialogs.store.getState().request?.answer(null);
        void module.spriteDialogs.canvasSize({
            initial: { width: 21, height: 22, anchor: { x: 1, y: 1 } },
        });
    }, path);
    await expect(field(dialog, "Width")).toHaveValue("21");
    await expect(field(dialog, "Height")).toHaveValue("22");
    await expect(
        dialog.getByRole("radiogroup", { name: "Anchor" }).getByRole("radio", { checked: true }),
    ).toHaveAccessibleName("Bottom right");
    await dialogButton(dialog, "Cancel").click();
    await expect(dialog).toHaveCount(0);
});

test("the dialog host is mounted at the root, outside the menu-bar region, and hosts the requests", async ({
    page,
}) => {
    await page.goto("/");
    await expect(region(page, "viewport")).toBeVisible();
    const hosted = await page.evaluate(async () => {
        const path = "/src/app/dialogs/dialogRequests.ts";
        const module = (await import(/* @vite-ignore */ path)) as typeof DialogRequestsModule;
        return module.commandDialogs.hosted;
    });
    expect(hosted).toBe(true);

    // A dialog opened from the File menu is not part of the menu bar's subtree.
    await openMenu(page, "File");
    await page.locator('[role="menuitem"][data-command="file.new"]').click();
    const dialog = newSpriteDialog(page);
    await expect(dialog).toBeVisible();
    await expect(region(page, "menu-bar").getByRole("dialog")).toHaveCount(0);
    await expect(nameField(dialog)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
});
