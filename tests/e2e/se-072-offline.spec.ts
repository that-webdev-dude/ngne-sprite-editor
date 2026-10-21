import { expect, test } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import { goldenPath } from "./se-072-golden-path";
import {
    buildApp,
    builtDocumentSummary,
    consumerOnDevServer,
    openBuiltEditor,
    serve,
    waitForWorkerControl,
} from "./se-072-support";

// SE-072: after its first load the app works with the network disabled. The page loads the
// build once while online; once its service worker controls it (every file of the build is in
// the worker's cache), the preview server is stopped and the page's context goes offline, and
// the SE-070 golden path runs from the start: its loads and its reload of the editor are
// answered by the worker alone.
//
// The golden path reads the stores through the development test hooks, so the build is the one
// with the hooks (se-072-support: `vite build --mode development`), served and cached as the
// production build is. Its last step, the SE-053 consumer game that draws the exported bundle,
// is a fixture of the dev server and no part of the app: it runs in a context of its own, online.

test("offline: the SE-070 golden path passes with the network disabled after the first load", async ({
    page,
    browser,
}, testInfo) => {
    // The golden path takes about 60 s on SwiftShader at one worker, the build a few seconds.
    test.setTimeout(420_000);
    const served = await serve(await buildApp({ hooks: true }));
    const contexts: BrowserContext[] = [];
    try {
        await openBuiltEditor(served.url)(page);
        await waitForWorkerControl(page);
        await served.close();
        await page.context().setOffline(true);
        // Nothing reaches a server now: a file the build does not have fails to load.
        expect(
            await page.evaluate(async () => {
                try {
                    await fetch("se-072-not-in-the-build.txt");
                    return "loaded";
                } catch {
                    return "failed";
                }
            }),
        ).toBe("failed");

        await goldenPath(page, testInfo, {
            openEditor: openBuiltEditor(served.url),
            summary: builtDocumentSummary,
            consumerPage: consumerOnDevServer(browser, testInfo, contexts),
        });
        // Still offline, still the worker's page.
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    } finally {
        for (const context of contexts) await context.close();
        await served.close();
    }
});
