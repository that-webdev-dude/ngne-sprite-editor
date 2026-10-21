// SE-072: what the service worker (sw.ts) keeps and how it answers, apart from the worker's
// events, so it can be tested in Node.
//
// The build puts the list of its files into the worker (`self.__WB_MANIFEST`, vite-plugin-pwa
// with `injectManifest`): each file's URL relative to the app's base, with a revision for a
// file whose name has no content hash. One deployment's files go into one cache, named after a
// hash of that list, so a new deployment fills a cache of its own while the running one keeps
// answering from the old cache, which goes when the new worker takes over.

/** One file of the build, as the plugin lists it. */
export interface PrecacheEntry {
    url: string;
    revision: string | null;
}

/** The prefix of every cache the worker makes; caches with it and another name are old. */
export const CACHE_PREFIX = "ngne-sprite-editor-";

/** The message the page sends a waiting worker to take over (the update toast's Reload). */
export const SKIP_WAITING = "ngne-sprite-editor:skip-waiting";

/**
 * The entries with each URL once, the first kept: the plugin lists the manifest (and would list
 * its icons) beside the files its patterns find, and a cache refuses to add one URL twice.
 */
export function uniqueEntries(entries: readonly PrecacheEntry[]): PrecacheEntry[] {
    const seen = new Set<string>();
    return entries.filter((entry) => !seen.has(entry.url) && seen.add(entry.url));
}

/** FNV-1a over the entries in order: the same build always gives the same name. */
export function cacheName(entries: readonly PrecacheEntry[]): string {
    let hash = 0x811c9dc5;
    for (const { url, revision } of entries) {
        for (const char of `${url} ${revision ?? ""}\n`) {
            hash ^= char.codePointAt(0)!;
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
    }
    return `${CACHE_PREFIX}${hash.toString(16).padStart(8, "0")}`;
}

/** The absolute URL of each entry, in the worker's scope (the app's base). */
export function precacheUrls(entries: readonly PrecacheEntry[], scope: string): string[] {
    return entries.map((entry) => new URL(entry.url, scope).href);
}

/** The caches a worker of `current` deletes once it is active: the worker's own older ones. */
export function staleCaches(names: readonly string[], current: string): string[] {
    return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current);
}

/** What the worker answers a request with: the cached `url`, or nothing (the network). */
export type Route = { cached: string } | null;

/**
 * How the worker answers a GET request (cache first): a navigation to the app (its base, or
 * `index.html` there, whatever the query) gets the cached shell; a file of the build gets its
 * cached copy. Everything else goes to the network as if no worker were there.
 */
export function route(
    request: { url: string; method: string; mode: string },
    scope: string,
    precached: ReadonlySet<string>,
): Route {
    if (request.method !== "GET") return null;
    const url = new URL(request.url);
    url.hash = "";
    const shell = new URL("index.html", scope).href;
    if (request.mode === "navigate") {
        url.search = "";
        const isApp = url.href === scope || url.href === shell;
        return isApp && precached.has(shell) ? { cached: shell } : null;
    }
    return precached.has(url.href) ? { cached: url.href } : null;
}
