import { expect, test } from "@playwright/test";
import { LICENCES_COMMAND } from "../../src/app/licences/licences.commands";
import { collectErrors } from "./se-006-support";
import { menuItem, menuTrigger, openEditor } from "./se-007-support";

// The Open Source Licences command (src/app/licences): View → Open Source Licences… shows the
// licences file in a dialog of the app. The development server answers the file with the
// runtime dependencies' licences (vite.config.ts); the build writes it (scripts/licences.ts).
// No tab is opened: a tab the page opens would hold the editor's heap (the SE-070 soak).

test("View → Open Source Licences… shows the licences file in a dialog and opens no tab", async ({
    page,
    context,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await menuTrigger(page, "View").click();
    await menuItem(page, LICENCES_COMMAND).click();
    const dialog = page.getByRole("dialog", { name: "Open Source Licences" });
    await expect(dialog).toBeVisible();
    const text = dialog.getByRole("region", { name: "Licence text" });
    await expect(text).toContainText("NGNE Sprite Editor: open source licences");
    await expect(text).toContainText("Third-party notices (THIRD_PARTY_NOTICES.md)");
    await expect(text).toContainText("Copyright (c) 2020 zingl");
    await expect(text).toContainText(/\nreact \S+ \(MIT\)\n/);
    expect(context.pages()).toEqual([page]);
    // Escape closes it, as every dialog.
    await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(context.pages()).toEqual([page]);
    expect(errors).toEqual([]);
});
