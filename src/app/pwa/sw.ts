import {
    SKIP_WAITING,
    cacheName,
    precacheUrls,
    route,
    staleCaches,
    uniqueEntries,
} from "./precache";
import type { PrecacheEntry } from "./precache";

// SE-072: the app's service worker. `vite build` compiles this file on its own into `sw.js`
// beside `index.html` and puts the list of the build's files where `self.__WB_MANIFEST` stands
// (vite-plugin-pwa, `injectManifest`); the dev server has no worker.
//
// - Install: every file of the build goes into this deployment's cache. A worker that installs
//   while an older one controls pages waits: the pages show the update toast, and the worker
//   takes over only when the user chooses Reload there (the page posts SKIP_WAITING).
// - Activate: the caches of older deployments go, and the worker takes control of the open
//   pages (on the first visit too, so the app works offline from its first load on).
// - Fetch: cache first for the shell and every file of the build (`route`); anything else is
//   left to the network.
//
// The program is compiled with the DOM library, as the rest of `src`; the few parts of the
// service worker scope it uses are declared here.

interface ExtendableEvent extends Event {
    waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
    readonly request: Request;
    respondWith(response: Promise<Response>): void;
}

interface ServiceWorkerScope {
    readonly registration: { readonly scope: string };
    readonly clients: { claim(): Promise<void> };
    skipWaiting(): Promise<void>;
    addEventListener(
        type: "install" | "activate",
        listener: (event: ExtendableEvent) => void,
    ): void;
    addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

const worker = self as unknown as ServiceWorkerScope;
// The build replaces `self.__WB_MANIFEST`, written exactly so, with the list of its files.
const entries = uniqueEntries(
    (self as unknown as { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST,
);
const scope = worker.registration.scope;
const cache = cacheName(entries);
const urls = precacheUrls(entries, scope);
const precached = new Set(urls);

worker.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const open = await caches.open(cache);
            // A file without a hash in its name (index.html, the manifest, the icons) comes
            // from the server, not from the HTTP cache, which may hold an older deployment's.
            await open.addAll(
                entries.map(
                    (entry, index) =>
                        new Request(urls[index]!, entry.revision ? { cache: "reload" } : {}),
                ),
            );
        })(),
    );
});

worker.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const stale = staleCaches(await caches.keys(), cache);
            await Promise.all(stale.map((name) => caches.delete(name)));
            await worker.clients.claim();
        })(),
    );
});

worker.addEventListener("message", (event) => {
    if ((event.data as { type?: unknown } | null)?.type === SKIP_WAITING) {
        void worker.skipWaiting();
    }
});

worker.addEventListener("fetch", (event) => {
    const { request } = event;
    const answer = route(request, scope, precached);
    if (!answer) return;
    event.respondWith(
        (async () => {
            const hit = await caches.match(answer.cached, { cacheName: cache });
            return hit ?? fetch(request);
        })(),
    );
});
