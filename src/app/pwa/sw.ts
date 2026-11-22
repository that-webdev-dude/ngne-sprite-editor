import { installServiceWorker } from "@ngne/editor-ui/pwa/worker";
import type { PrecacheEntry } from "@ngne/editor-ui/pwa/worker";

// SE-072: the app's service worker. `vite build` compiles this file on its own into `sw.js`
// beside `index.html` and puts the list of the build's files where `self.__WB_MANIFEST` stands
// (vite-plugin-pwa, `injectManifest`); the dev server has no worker. What the worker does
// (precache at install, older caches kept while a window runs them, cache first for the build)
// is the package's `installServiceWorker`, under the editor's id, so the cache prefix and the
// messages keep their names (`ngne-sprite-editor-`, `ngne-sprite-editor:skip-waiting`,
// `ngne-sprite-editor:started`).

installServiceWorker({
    id: "ngne-sprite-editor",
    // The build replaces `self.__WB_MANIFEST`, written exactly so, with the list of its files.
    manifest: (self as unknown as { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST,
});
