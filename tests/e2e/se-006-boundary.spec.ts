import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { boxOf, region, regionBoxes, REGIONS } from "./se-006-support";
import type { Region } from "./se-006-support";

// SE-006: a component that throws inside a region shows the boundary message while the other
// regions keep working (DESIGN §4). The harness page mounts the real shell with one failing
// region.

const HARNESS = "/tests/e2e/harness/se-006-boundary.html";
const NAMES: Record<Region, string> = {
    "menu-bar": "Menu bar",
    "tool-rail": "Tool rail",
    "context-bar": "Context bar",
    viewport: "Viewport",
    dock: "Panels",
    timeline: "Timeline",
    "status-bar": "Status bar",
};

/** Uncaught errors only: React reports the error a boundary caught on the console itself. */
function uncaughtErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
}

/** What the unaffected regions still do: resize, collapse, respond to the keyboard. */
async function expectOthersWork(page: Page, failed: Region | "dock-panel") {
    for (const id of REGIONS) await expect(region(page, id)).toBeVisible();

    if (failed !== "timeline") {
        const before = (await boxOf(region(page, "timeline"))).height;
        await page.getByRole("separator", { name: "Resize timeline" }).focus();
        await page.keyboard.press("ArrowUp");
        expect((await boxOf(region(page, "timeline"))).height).toBe(before + 8);
        await page.keyboard.press("Enter");
    }
    if (failed !== "dock" && failed !== "dock-panel") {
        const palette = region(page, "dock").getByRole("button", { name: "Palette" });
        const expanded = await palette.getAttribute("aria-expanded");
        await palette.click();
        await expect(palette).not.toHaveAttribute("aria-expanded", expanded ?? "");
    }
    if (failed !== "tool-rail") {
        await expect(region(page, "tool-rail").getByRole("button")).toHaveCount(13);
    }
    if (failed !== "viewport") {
        await expect(region(page, "viewport")).toHaveText("New sprite");
    }
}

for (const id of REGIONS) {
    test(`a component that throws in the ${NAMES[id]} region shows the boundary message while the other regions keep working`, async ({
        page,
    }) => {
        const uncaught = uncaughtErrors(page);
        await page.goto(HARNESS);
        await expect(region(page, "viewport")).toBeVisible();
        const healthy = await regionBoxes(page);

        await page.goto(`${HARNESS}?region=${id}`);
        const failed = region(page, id);
        const message = `${NAMES[id]} failed to render.`;
        const alert = failed.getByRole("alert");
        await expect(alert).toBeVisible();
        // The rail is too narrow for a line of text: its Reload button carries the message.
        const reload =
            id === "tool-rail"
                ? alert.getByRole("button", { name: `${message} Reload` })
                : alert.getByRole("button", { name: "Reload" });
        if (id !== "tool-rail") await expect(alert).toHaveText(`${message}Reload`);
        await expect(reload).toBeVisible();
        await expect(page.getByRole("alert")).toHaveCount(1);

        // The layout holds: every region is where it is without the failure.
        expect(await regionBoxes(page)).toEqual(healthy);
        await expectOthersWork(page, id);

        // Reload mounts the content again: it fails while broken, recovers once repaired.
        await reload.click();
        await expect(alert).toBeVisible();
        await page.evaluate(() => {
            (window as unknown as { se006Repaired: boolean }).se006Repaired = true;
        });
        await reload.click();
        await expect(failed.locator("[data-fragile]")).toHaveText("Content restored");
        await expect(page.getByRole("alert")).toHaveCount(0);
        expect(uncaught).toEqual([]);
    });
}

test("a dock panel that throws shows the boundary message while the other panels keep working", async ({
    page,
}) => {
    const uncaught = uncaughtErrors(page);
    await page.goto(`${HARNESS}?region=dock-panel`);
    const dock = region(page, "dock");
    const fragile = dock.locator('[data-dock-panel="fragile"]');
    await expect(fragile.getByRole("alert")).toHaveText("Fragile failed to render.Reload");
    await expect(fragile.getByRole("button", { name: "Fragile" })).toBeVisible();
    await expect(dock.locator("[data-steady]")).toHaveText("Steady content");
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expectOthersWork(page, "dock-panel");

    await page.evaluate(() => {
        (window as unknown as { se006Repaired: boolean }).se006Repaired = true;
    });
    await fragile.getByRole("button", { name: "Reload" }).click();
    await expect(fragile.locator("[data-fragile]")).toHaveText("Content restored");
    expect(uncaught).toEqual([]);
});
