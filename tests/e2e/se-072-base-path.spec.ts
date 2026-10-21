import { expect, test } from "@playwright/test";
import { goldenPath } from "./se-072-golden-path";
import { buildApp, builtDocumentSummary, openBuiltEditor, serve } from "./se-072-support";

// SE-072: the app works at a nested path. The build with Vite's `base` set to "/sub/path/" is
// served by `vite preview` there, and the SE-070 golden path runs against it (the build with
// the development test hooks, as in se-072-offline.spec.ts). The consumer game of its last step
// opens beside the editor on the dev server, the context's base URL.

const BASE = "/sub/path/";

test("base path: the SE-070 golden path passes against a preview server with base /sub/path/", async ({
    page,
}, testInfo) => {
    test.setTimeout(420_000);
    const served = await serve(await buildApp({ hooks: true, base: BASE }), BASE);
    try {
        expect(new URL(served.url).pathname).toBe(BASE);
        await openBuiltEditor(served.url)(page);
        // The manifest and the service worker are under the base, and the worker's scope is it.
        await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
            "href",
            `${BASE}manifest.webmanifest`,
        );
        const scope = await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.ready;
            return registration.scope;
        });
        expect(scope).toBe(served.url);

        await goldenPath(page, testInfo, {
            openEditor: openBuiltEditor(served.url),
            summary: builtDocumentSummary,
        });
        expect(new URL(page.url()).pathname).toBe(BASE);
    } finally {
        await served.close();
    }
});
