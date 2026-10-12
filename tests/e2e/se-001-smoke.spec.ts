import { expect, test } from "@playwright/test";

test("the app shell loads from the dev server", async ({ page }) => {
    await page.goto("/");
    await expect(
        page.getByRole("main").and(page.locator('[data-region="viewport"]')),
    ).toBeVisible();
});

test("NGNE draws a rect on a WebGPU canvas and readCanvas returns its pixels", async ({ page }) => {
    await page.goto("/tests/e2e/harness/smoke.html");
    const output = page.locator("#result");
    await expect(output).not.toBeEmpty();
    const { adapter, ...result } = JSON.parse((await output.textContent()) ?? "{}") as Record<
        string,
        unknown
    >;
    // Hardware locally, SwiftShader in CI; recorded with the result, not asserted.
    test.info().annotations.push({ type: "adapter", description: String(adapter) });
    console.log(`WebGPU adapter: ${String(adapter)}`);

    expect(result).toEqual({
        status: "ready",
        width: 64,
        height: 64,
        inside: [255, 0, 0, 255],
        insideEdge: [255, 0, 0, 255],
        outsideEdge: [0, 0, 255, 255],
        corner: [0, 0, 255, 255],
        errors: [],
    });
});
