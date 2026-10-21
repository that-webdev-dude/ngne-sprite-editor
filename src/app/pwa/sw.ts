import {
    SKIP_WAITING,
    STARTED,
    cacheName,
    cacheable,
    mayDeleteStale,
    olderFile,
    precacheUrls,
    route,
    searchOrder,
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
// - Activate: the worker takes control of the open pages (on the first visit too, so the app
//   works offline from its first load on). The windows open then may run an older deployment:
//   their ids are kept (in this deployment's cache, as the worker may be stopped and started
//   again), and the caches of older deployments stay while one of them is open. With no
//   window open, they go at once; otherwise when a page this worker served starts (STARTED)
//   and none of those windows is left.
// - Fetch: cache first for the shell and every file of the build (`route`), from this
//   deployment's cache, then the older ones; a file of the scope that is not this build's may
//   be an older deployment's (`olderFile`): the older caches, then the network. Anything else
//   is left to the network.
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
    readonly clients: {
        claim(): Promise<void>;
        matchAll(options: {
            type: "window";
            includeUncontrolled: boolean;
        }): Promise<readonly { readonly id: string }[]>;
    };
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
/** Where the ids of the windows open when this worker took over are kept. */
const OLDER_WINDOWS = new URL("ngne-sprite-editor-older-windows", scope).href;

/** The ids of every window of the scope, whichever worker controls it. */
async function windowIds(): Promise<string[]> {
    const windows = await worker.clients.matchAll({ type: "window", includeUncontrolled: true });
    return windows.map((client) => client.id);
}

async function olderWindows(): Promise<string[]> {
    const kept = await (await caches.open(cache)).match(OLDER_WINDOWS);
    return kept ? ((await kept.json()) as string[]) : [];
}

/** Deletes the older deployments' caches unless a window may still run one of them. */
async function deleteStaleUnlessUsed(): Promise<void> {
    if (!mayDeleteStale(await windowIds(), await olderWindows())) return;
    const stale = staleCaches(await caches.keys(), cache);
    await Promise.all(stale.map((name) => caches.delete(name)));
    await (await caches.open(cache)).delete(OLDER_WINDOWS);
}

/** The cached copy of `url`: this deployment's cache first, then the older ones. */
async function cached(url: string, names: readonly string[]): Promise<Response | undefined> {
    for (const name of names) {
        const hit = await caches.match(url, { cacheName: name });
        if (hit) return hit;
    }
    return undefined;
}

worker.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const open = await caches.open(cache);
            // A file without a hash in its name (index.html, the manifest, the icons) comes
            // from the server, not from the HTTP cache, which may hold an older deployment's.
            // A redirected response is rebuilt before it is kept (`cacheable`).
            await Promise.all(
                entries.map(async (entry, index) => {
                    const request = new Request(
                        urls[index]!,
                        entry.revision ? { cache: "reload" } : {},
                    );
                    const response = await fetch(request);
                    if (!response.ok) {
                        throw new Error(`sw: ${request.url} answered ${response.status}`);
                    }
                    await open.put(request, await cacheable(response));
                }),
            );
        })(),
    );
});

worker.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const open = await windowIds();
            if (open.length > 0) {
                await (await caches.open(cache)).put(OLDER_WINDOWS, Response.json(open));
            }
            await deleteStaleUnlessUsed();
            await worker.clients.claim();
        })(),
    );
});

worker.addEventListener("message", (event) => {
    const type = (event.data as { type?: unknown } | null)?.type;
    if (type === SKIP_WAITING) void worker.skipWaiting();
    if (type === STARTED)
        (event as MessageEvent & ExtendableEvent).waitUntil(deleteStaleUnlessUsed());
});

worker.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = route(request, scope, precached)?.cached ?? olderFile(request, scope, precached);
    if (!url) return;
    event.respondWith(
        (async () => {
            const hit = await cached(url, searchOrder(await caches.keys(), cache));
            return hit ?? fetch(request);
        })(),
    );
});
