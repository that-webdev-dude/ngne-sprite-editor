import { test } from "@playwright/test";
import { goldenPath } from "./se-072-golden-path";

// SE-070: the golden path, one script through the editor's real interface and registered
// commands. Its steps are in se-072-golden-path.ts (moved there by SE-072, which runs them
// against the production build with its service worker as well); here they run on the dev
// server.

test("golden path: new sprite → two layers → frames → tag → PNG imported with its reference → select and transform → save → reload → open → export → the NGNE consumer game draws it", async ({
    page,
}, testInfo) => {
    // About 60 s on SwiftShader at one worker; the rest is margin.
    test.setTimeout(300_000);
    await goldenPath(page, testInfo);
});
