import { expect, test } from "@playwright/test";
import { LICENCES_COMMAND } from "../../src/app/licences/licences.commands";
import { collectErrors } from "./se-006-support";
import { menuItem, menuTrigger, openEditor } from "./se-007-support";

// The Open Source Licences command (src/app/licences): View → Open Source Licences opens the
// licences file in a new tab as plain text. The development server answers the file with the
// runtime dependencies' licences (vite.config.ts); the build writes it (scripts/licences.ts).

test("View → Open Source Licences opens the licences file in a new tab", async ({
    page,
    context,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await menuTrigger(page, "View").click();
    const tabOpened = context.waitForEvent("page");
    await menuItem(page, LICENCES_COMMAND).click();
    const tab = await tabOpened;
    await expect(tab).toHaveURL(/^blob:/);
    const text = tab.locator("body");
    await expect(text).toContainText("NGNE Sprite Editor: open source licences");
    await expect(text).toContainText("Third-party notices (THIRD_PARTY_NOTICES.md)");
    await expect(text).toContainText("Copyright (c) 2020 zingl");
    await expect(text).toContainText(/\nreact \S+ \(MIT\)\n/);
    // The editor keeps the focus of its window and reports nothing.
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(errors).toEqual([]);
});
