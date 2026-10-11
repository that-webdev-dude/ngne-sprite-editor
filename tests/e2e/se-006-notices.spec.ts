import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, openShell, region, REGIONS } from "./se-006-support";

// SE-006: the two full-window notices (DESIGN §2, §7).

const webGpuNotice = (page: Page) => page.locator('[data-notice="webgpu-required"]');
const tooSmallNotice = (page: Page) => page.locator('[data-notice="window-too-small"]');

async function expectWebGpuNotice(page: Page, reason: "no-api" | "no-adapter") {
    const notice = webGpuNotice(page);
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("heading", { name: "WebGPU required" })).toBeVisible();
    // DESIGN §7: what is missing, supported browsers, how to enable acceleration.
    await expect(notice.getByRole("heading", { name: "What is missing" })).toBeVisible();
    await expect(notice.locator("[data-notice-reason]")).toHaveAttribute(
        "data-notice-reason",
        reason,
    );
    await expect(notice.getByRole("heading", { name: "Supported browsers" })).toBeVisible();
    await expect(notice).toContainText("Desktop Chrome or Edge");
    await expect(notice.getByRole("heading", { name: "How to enable acceleration" })).toBeVisible();
    await expect(notice.getByRole("listitem")).toHaveCount(3);

    // Full window, and the editor is not there at all.
    const size = page.viewportSize();
    expect(await notice.boundingBox()).toEqual({ x: 0, y: 0, ...size });
    await expect(page.locator("[data-region]")).toHaveCount(0);
}

test("with navigator.gpu removed the WebGPU notice renders and no uncaught error is logged", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
        delete (Navigator.prototype as { gpu?: unknown }).gpu;
    });
    await page.goto("/");

    expect(await page.evaluate(() => "gpu" in navigator)).toBe(false);
    await expectWebGpuNotice(page, "no-api");
    await expect(webGpuNotice(page)).toContainText("navigator.gpu is missing");

    // Give a late rejection or effect error the chance to surface.
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
});

test("when no adapter can be acquired the WebGPU notice renders and no uncaught error is logged", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "gpu", {
            configurable: true,
            get: () => ({ requestAdapter: () => Promise.resolve(null) }),
        });
    });
    await page.goto("/");

    await expectWebGpuNotice(page, "no-adapter");
    await expect(webGpuNotice(page)).toContainText("no graphics adapter is available");
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
});

test("when adapter acquisition fails the WebGPU notice shows the browser's error", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "gpu", {
            configurable: true,
            get: () => ({
                requestAdapter: () => Promise.reject(new Error("adapter request blocked")),
            }),
        });
    });
    await page.goto("/");

    await expectWebGpuNotice(page, "no-adapter");
    await expect(webGpuNotice(page)).toContainText("adapter request blocked");
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
});

test("with WebGPU available the shell renders without a notice or an error", async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);
    await expect(webGpuNotice(page)).toHaveCount(0);
    await expect(tooSmallNotice(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
});

test("below 1280×720 the window-too-small notice replaces the layout", async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page, { width: 1280, height: 720 });
    await expect(tooSmallNotice(page)).toHaveCount(0);

    for (const size of [
        { width: 1279, height: 720 },
        { width: 1280, height: 719 },
        { width: 800, height: 600 },
    ]) {
        await page.setViewportSize(size);
        const notice = tooSmallNotice(page);
        await expect(notice).toBeVisible();
        await expect(notice.getByRole("heading", { name: "Window too small" })).toBeVisible();
        await expect(notice).toContainText("at least 1280 × 720");
        await expect(notice).toContainText(`this one is ${size.width} × ${size.height}`);
        expect(await notice.boundingBox()).toEqual({ x: 0, y: 0, ...size });
        for (const id of REGIONS) await expect(region(page, id)).toBeHidden();
        // One main landmark at a time: the notice, not the hidden viewport.
        await expect(page.getByRole("main")).toHaveAttribute("data-notice", "window-too-small");
    }

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(tooSmallNotice(page)).toHaveCount(0);
    for (const id of REGIONS) await expect(region(page, id)).toBeVisible();
    expect(errors).toEqual([]);
});

test("the shell keeps its state while the window is too small", async ({ page }) => {
    await openShell(page, { width: 1280, height: 720 });
    const palette = region(page, "dock").getByRole("button", { name: "Palette" });
    await palette.click();
    await expect(palette).toHaveAttribute("aria-expanded", "true");

    await page.setViewportSize({ width: 1000, height: 700 });
    await expect(tooSmallNotice(page)).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(palette).toHaveAttribute("aria-expanded", "true");
});
