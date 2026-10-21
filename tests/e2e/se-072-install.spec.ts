import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { decodePng } from "../../src/core/png";
import { collectErrors } from "./se-006-support";
import { openEditor } from "./se-007-support";
import { recoveryOffered } from "./se-042-support";
import { buildApp, serve, waitForWorkerControl } from "./se-072-support";
import type { Served } from "./se-072-support";

// SE-072: the production build is an installable app (its manifest, its icons, its service
// worker), and the dev server, which every other spec runs on, has none of it.

declare global {
    interface Window {
        /** The `beforeinstallprompt` events the page received. */
        __se072InstallPrompts?: number;
    }
}

interface WebManifest {
    id: string;
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
    file_handlers: { action: string; accept: Record<string, string[]> }[];
    launch_handler: { client_mode: string[] };
}

let served: Served;

test.beforeAll(async () => {
    test.setTimeout(120_000);
    served = await serve(await buildApp());
});

test.afterAll(async () => {
    await served?.close();
});

test("the production build is installable: Chrome fires beforeinstallprompt", async ({
    channel,
    headless,
    launchOptions,
}) => {
    // Chrome offers no install in an incognito profile, which every context of the `browser`
    // fixture is ("in-incognito" from Page.getInstallabilityErrors): the page opens in Chrome
    // with a profile of its own, launched as the configuration launches it.
    const profile = mkdtempSync(join(tmpdir(), "se-072-profile-"));
    const context = await chromium.launchPersistentContext(profile, {
        channel,
        headless,
        args: launchOptions?.args,
    });
    try {
        const page = context.pages()[0] ?? (await context.newPage());
        const errors = collectErrors(page);
        await page.addInitScript(() => {
            window.__se072InstallPrompts = 0;
            window.addEventListener("beforeinstallprompt", () => {
                window.__se072InstallPrompts!++;
            });
        });
        await page.goto(served.url);
        // The production build: no development test hook.
        await expect(page.locator('[data-region="viewport"]')).toBeVisible();
        expect(await page.evaluate(() => window.__ngneTest === undefined)).toBe(true);
        await waitForWorkerControl(page);
        await expect.poll(() => page.evaluate(() => window.__se072InstallPrompts)).toBe(1);
        const cdp = await context.newCDPSession(page);
        const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
            installabilityErrors: unknown[];
        };
        expect(installabilityErrors).toEqual([]);
        expect(errors).toEqual([]);
    } finally {
        await context.close();
        rmSync(profile, { recursive: true, force: true });
    }
});

test("the manifest names the app, opens it standalone, has its icons and its file handler", async ({
    page,
    request,
}) => {
    await page.goto(served.url);
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBe("/manifest.webmanifest");
    const manifestUrl = new URL(href!, served.url).href;
    const manifest = (await (await request.get(manifestUrl)).json()) as WebManifest;
    expect(manifest).toMatchObject({
        id: "./",
        name: "NGNE Sprite Editor",
        short_name: "NGNE Sprites",
        start_url: "./",
        scope: "./",
        display: "standalone",
        // DESIGN §3.1, dark (default) theme: the panel colour for the title bar, the
        // workspace colour behind the icon while the app starts.
        theme_color: "#18181a",
        background_color: "#0f0f10",
        file_handlers: [{ action: "./", accept: { "application/x-ngsprite": [".ngsprite"] } }],
        launch_handler: { client_mode: ["focus-existing", "auto"] },
    });
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#18181a");
    // Every icon is a PNG of its stated size; each size has an "any" and a "maskable" one.
    const purposes = new Map<string, string[]>();
    for (const icon of manifest.icons) {
        const response = await request.get(new URL(icon.src, manifestUrl).href);
        expect(response.ok(), icon.src).toBe(true);
        expect(icon.type).toBe("image/png");
        const image = await decodePng(new Uint8Array(await response.body()));
        expect(`${image.width}x${image.height}`, icon.src).toBe(icon.sizes);
        purposes.set(icon.sizes, [...(purposes.get(icon.sizes) ?? []), icon.purpose]);
    }
    expect(Object.fromEntries(purposes)).toEqual({
        "192x192": ["any", "maskable"],
        "512x512": ["any", "maskable"],
    });
});

test("the dev server registers no service worker and links no manifest", async ({ page }) => {
    await openEditor(page);
    // The launch check has run: the app has started everything it starts at launch.
    await recoveryOffered(page);
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    expect(
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(0);
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
});
