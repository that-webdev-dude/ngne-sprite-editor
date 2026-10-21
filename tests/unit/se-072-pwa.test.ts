import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ICONS, ICONS_DIR, drawIcon, iconPng, pwaColours } from "../../scripts/icons";
import {
    CACHE_PREFIX,
    SKIP_WAITING,
    cacheName,
    precacheUrls,
    route,
    staleCaches,
    uniqueEntries,
} from "../../src/app/pwa/precache";
import type { PrecacheEntry } from "../../src/app/pwa/precache";
import { installLaunchQueue, launchedFile } from "../../src/app/pwa/launchQueue";
import { registerAppUpdates } from "../../src/app/pwa/updates";
import type { ContainerLike, RegistrationLike, WorkerLike } from "../../src/app/pwa/updates";
import { createToastService, INFO_TOAST_MS } from "../../src/ui/toast/toast";

// SE-072: the parts of the installable app that run without a browser: the service worker's
// cache and routing rules, the page's update flow over a fake service worker container, the
// toast with an action, and the icons (the committed files are the generator's output).

const SCOPE = "https://example.test/sub/path/";
const ENTRIES: PrecacheEntry[] = [
    { url: "index.html", revision: "a1" },
    { url: "assets/index-abc.js", revision: null },
    { url: "manifest.webmanifest", revision: "m1" },
    { url: "assets/index-abc.js", revision: null },
];

describe("service worker precache (src/app/pwa/precache.ts)", () => {
    it("keeps each URL once, the first entry", () => {
        expect(uniqueEntries(ENTRIES)).toEqual(ENTRIES.slice(0, 3));
    });

    it("names one cache per build, the same name for the same build", () => {
        const name = cacheName(ENTRIES);
        expect(name.startsWith(CACHE_PREFIX)).toBe(true);
        expect(cacheName([...ENTRIES])).toBe(name);
        const changed = [{ url: "index.html", revision: "a2" }, ...ENTRIES.slice(1)];
        expect(cacheName(changed)).not.toBe(name);
    });

    it("resolves the entries in the worker's scope, the app's base", () => {
        expect(precacheUrls(ENTRIES.slice(0, 2), SCOPE)).toEqual([
            "https://example.test/sub/path/index.html",
            "https://example.test/sub/path/assets/index-abc.js",
        ]);
    });

    it("deletes only its own older caches", () => {
        const current = cacheName(ENTRIES);
        expect(staleCaches([current, `${CACHE_PREFIX}00000000`, "other-app"], current)).toEqual([
            `${CACHE_PREFIX}00000000`,
        ]);
    });

    it("answers navigations to the app with the cached shell and build files from the cache", () => {
        const precached = new Set(precacheUrls(uniqueEntries(ENTRIES), SCOPE));
        const shell = { cached: `${SCOPE}index.html` };
        const get = (url: string, mode = "cors") =>
            route({ url, method: "GET", mode }, SCOPE, precached);
        expect(get(SCOPE, "navigate")).toEqual(shell);
        expect(get(`${SCOPE}?from=launch#x`, "navigate")).toEqual(shell);
        expect(get(`${SCOPE}index.html`, "navigate")).toEqual(shell);
        expect(get(`${SCOPE}assets/index-abc.js`)).toEqual({
            cached: `${SCOPE}assets/index-abc.js`,
        });
        // Not the app's: the network, as without a worker.
        expect(get(`${SCOPE}other.html`, "navigate")).toBeNull();
        expect(get("https://example.test/", "navigate")).toBeNull();
        expect(get(`${SCOPE}assets/missing.js`)).toBeNull();
        expect(
            route({ url: `${SCOPE}index.html`, method: "POST", mode: "cors" }, SCOPE, precached),
        ).toBeNull();
    });
});

/** A fake `ServiceWorker` whose state the test moves on. */
class FakeWorker implements WorkerLike {
    state = "installing";
    messages: unknown[] = [];
    private listeners: (() => void)[] = [];
    postMessage(message: unknown) {
        this.messages.push(message);
    }
    addEventListener(_type: "statechange", listener: () => void) {
        this.listeners.push(listener);
    }
    become(state: string) {
        this.state = state;
        for (const listener of this.listeners) listener();
    }
}

class FakeRegistration implements RegistrationLike {
    installing: FakeWorker | null = null;
    waiting: FakeWorker | null = null;
    updates = 0;
    private found: (() => void)[] = [];
    async update() {
        this.updates++;
    }
    addEventListener(_type: "updatefound", listener: () => void) {
        this.found.push(listener);
    }
    /** A new worker starts installing. */
    install(worker: FakeWorker) {
        this.installing = worker;
        for (const listener of this.found) listener();
    }
}

class FakeContainer implements ContainerLike {
    registered: { url: string; scope: string }[] = [];
    private changes: (() => void)[] = [];
    constructor(
        public controller: unknown,
        public registration = new FakeRegistration(),
    ) {}
    async register(url: string, options: { scope: string }) {
        this.registered.push({ url, ...options });
        return this.registration;
    }
    addEventListener(_type: "controllerchange", listener: () => void) {
        this.changes.push(listener);
    }
    /** A new worker controls the page. */
    change(controller: unknown) {
        this.controller = controller;
        for (const listener of this.changes) listener();
    }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("update flow (src/app/pwa/updates.ts)", () => {
    function start(controller: unknown) {
        const container = new FakeContainer(controller);
        const reload = vi.fn();
        const updates = registerAppUpdates({
            container,
            url: "/sub/path/sw.js",
            scope: "/sub/path/",
            reload,
        });
        return { container, registration: container.registration, reload, updates };
    }

    it("registers the worker at the base, and the first visit is no update", async () => {
        const { container, registration, reload, updates } = start(null);
        await flush();
        expect(container.registered).toEqual([{ url: "/sub/path/sw.js", scope: "/sub/path/" }]);
        const worker = new FakeWorker();
        registration.install(worker);
        worker.become("installed");
        worker.become("activated");
        container.change(worker);
        expect(updates.store.getState().ready).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it("offers a new deployment once its worker waits, and activates it only on apply", async () => {
        const { container, registration, reload, updates } = start({});
        await flush();
        await updates.check();
        expect(registration.updates).toBe(1);
        const worker = new FakeWorker();
        registration.install(worker);
        expect(updates.store.getState().ready).toBe(false);
        worker.become("installed");
        expect(updates.store.getState().ready).toBe(true);
        expect(worker.messages).toEqual([]);

        updates.apply();
        expect(worker.messages).toEqual([{ type: SKIP_WAITING }]);
        expect(reload).not.toHaveBeenCalled();
        container.change(worker);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("offers a worker already waiting when the page starts", async () => {
        const container = new FakeContainer({});
        const waiting = new FakeWorker();
        waiting.state = "installed";
        container.registration.waiting = waiting;
        const updates = registerAppUpdates({
            container,
            url: "sw.js",
            scope: "/",
            reload: vi.fn(),
        });
        await flush();
        expect(updates.store.getState().ready).toBe(true);
        updates.apply();
        expect(waiting.messages).toEqual([{ type: SKIP_WAITING }]);
    });

    it("offers a reload when another window applied the update", async () => {
        const { container, reload, updates } = start({});
        await flush();
        container.change({});
        expect(updates.store.getState().ready).toBe(true);
        expect(reload).not.toHaveBeenCalled();
        updates.apply();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("reports a registration that fails and keeps the page as it is", async () => {
        const container = new FakeContainer(null);
        container.register = () => Promise.reject(new Error("no worker"));
        const report = vi.fn();
        const updates = registerAppUpdates({
            container,
            url: "sw.js",
            scope: "/",
            reload: vi.fn(),
            report,
        });
        await updates.check();
        expect(report).toHaveBeenCalledWith(new Error("no worker"));
        expect(updates.store.getState().ready).toBe(false);
    });
});

describe("toast with an action (SE-072)", () => {
    it("keeps an information toast with an action until it is dismissed", () => {
        vi.useFakeTimers();
        try {
            const service = createToastService();
            const run = vi.fn();
            const id = service.info("A new version is ready.", {
                action: { label: "Reload", run },
            });
            vi.advanceTimersByTime(INFO_TOAST_MS * 3);
            const [item] = service.store.getState().toasts;
            expect(item).toMatchObject({ id, kind: "info", action: { label: "Reload" } });
            item!.action!.run();
            expect(run).toHaveBeenCalledTimes(1);
            service.dismiss(id);
            expect(service.store.getState().toasts).toEqual([]);
            // Without an action it still goes after 4 s.
            service.info("Saved");
            vi.advanceTimersByTime(INFO_TOAST_MS);
            expect(service.store.getState().toasts).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("icons (scripts/icons.ts)", () => {
    it("takes the manifest colours from the design tokens", () => {
        expect(pwaColours()).toEqual({
            theme: "#18181a",
            background: "#0f0f10",
            accent: "#83e8e1",
        });
    });

    it("commits exactly what the generator draws", () => {
        for (const spec of ICONS) {
            const committed = new Uint8Array(readFileSync(new URL(spec.file, ICONS_DIR)));
            expect(Buffer.from(committed).equals(Buffer.from(iconPng(spec))), spec.file).toBe(true);
        }
    });

    it("draws the maskable icons to every edge and the others with transparent corners", () => {
        for (const spec of ICONS) {
            const data = drawIcon(spec);
            const cornerAlpha = data[3];
            expect(cornerAlpha, spec.file).toBe(spec.purpose === "maskable" ? 255 : 0);
            const centre = ((spec.size / 2) * spec.size + spec.size / 2) * 4;
            expect(data[centre + 3], spec.file).toBe(255);
        }
    });
});

describe("launch queue (src/app/pwa/launchQueue.ts)", () => {
    const handle = (name: string, bytes: number[]) => ({
        kind: "file",
        name,
        getFile: async () => new File([Uint8Array.from(bytes)], name),
        createWritable: async () => ({}),
    });

    it("hands launched file handles to the open path as chosen files with their handle", async () => {
        const file = await launchedFile(handle("hero.ngsprite", [1, 2, 3]));
        expect(file).toMatchObject({ name: "hero.ngsprite", size: 3 });
        expect(Array.from(await file!.read())).toEqual([1, 2, 3]);
        expect((await file!.handle())?.name).toBe("hero.ngsprite");
        expect(await launchedFile({ kind: "directory", name: "x" })).toBeNull();
    });

    it("sets the consumer once and keeps launches while no install is there", async () => {
        let consumer: ((params: { files?: unknown[] }) => void) | null = null;
        const queue = { setConsumer: vi.fn((next: typeof consumer) => void (consumer = next)) };
        const opened: string[][] = [];
        const open = async (files: readonly { name: string }[]) => {
            opened.push(files.map((file) => file.name));
        };
        const stop = installLaunchQueue({ queue, open });
        consumer!({ files: [handle("a.ngsprite", [1])] });
        await flush();
        expect(opened).toEqual([["a.ngsprite"]]);
        stop();
        // While none is installed (React runs an effect's cleanup and the effect again).
        consumer!({ files: [handle("b.ngsprite", [1]), { kind: "directory", name: "d" }] });
        consumer!({ files: [] });
        await flush();
        expect(opened).toEqual([["a.ngsprite"]]);
        installLaunchQueue({ queue, open });
        await flush();
        expect(opened).toEqual([["a.ngsprite"], ["b.ngsprite"]]);
        expect(queue.setConsumer).toHaveBeenCalledTimes(1);
    });
});
