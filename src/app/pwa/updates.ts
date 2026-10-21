import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { SKIP_WAITING } from "./precache";

// SE-072: the page's side of the service worker (sw.ts). It registers the worker and finds a
// new deployment: a worker that has installed while an older one controls the page waits, and
// `ready` says so; the update toast (ui/pwa) offers Reload, which is `apply`: the waiting
// worker takes over (SKIP_WAITING), and when it controls the page, the page reloads from the
// new deployment's cache. Nothing activates without that choice, so a page is never switched
// to new files under its feet; documents with unsaved changes are kept by autosave and the
// browser asks before the reload leaves them (SPEC §10).
//
// When another window of the app applied the update, this page is controlled by the new
// worker while it still runs the old files: `ready` is true here too, and Reload just reloads.
// A worker that takes control of a page that had none (the first visit) is no update.

/** The parts of a `ServiceWorker` used here. */
export interface WorkerLike {
    readonly state: string;
    postMessage(message: unknown): void;
    addEventListener(type: "statechange", listener: () => void): void;
}

/** The parts of a `ServiceWorkerRegistration` used here. */
export interface RegistrationLike {
    readonly installing: WorkerLike | null;
    readonly waiting: WorkerLike | null;
    update(): Promise<unknown>;
    addEventListener(type: "updatefound", listener: () => void): void;
}

/** The parts of `navigator.serviceWorker` used here. */
export interface ContainerLike {
    readonly controller: unknown;
    register(url: string, options: { scope: string }): Promise<RegistrationLike>;
    addEventListener(type: "controllerchange", listener: () => void): void;
}

export interface UpdateState {
    /** A new version is there: Reload (`apply`) runs it. */
    ready: boolean;
}

export interface AppUpdates {
    store: StoreApi<UpdateState>;
    /** Asks the server whether a new deployment is there. */
    check(): Promise<void>;
    /** Runs the new version: the waiting worker takes over, then the page reloads. */
    apply(): void;
}

export interface AppUpdateOptions {
    container: ContainerLike;
    /** The worker's script and scope: `sw.js` at the app's base. */
    url: string;
    scope: string;
    reload(): void;
    /** Where a failed registration is reported; the default is the console. */
    report?(error: unknown): void;
}

/** How often an open page asks for a new deployment, besides when it is shown again. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Registers the worker at `url` and follows its updates. */
export function registerAppUpdates(options: AppUpdateOptions): AppUpdates {
    const { container, url, scope, reload } = options;
    const report = options.report ?? ((error: unknown) => console.warn(error));
    const store = createStore<UpdateState>(() => ({ ready: false }));
    let registration: RegistrationLike | null = null;
    let waiting: WorkerLike | null = null;
    let accepted = false;
    let controlled = container.controller !== null && container.controller !== undefined;

    const wait = (worker: WorkerLike) => {
        waiting = worker;
        store.setState({ ready: true });
    };
    // A worker that has installed waits only when an older one controls the page; without
    // one it activates at once and takes control (the first visit).
    const follow = (worker: WorkerLike | null) => {
        if (!worker) return;
        const settle = () => {
            if (worker.state === "installed" && controlled) wait(worker);
        };
        settle();
        worker.addEventListener("statechange", settle);
    };

    container.addEventListener("controllerchange", () => {
        if (accepted) {
            reload();
            return;
        }
        if (controlled) store.setState({ ready: true });
        controlled = true;
        waiting = null;
    });

    const registered = container.register(url, { scope }).then(
        (found) => {
            registration = found;
            if (found.waiting && controlled) wait(found.waiting);
            follow(found.installing);
            found.addEventListener("updatefound", () => follow(found.installing));
        },
        (error: unknown) => report(error),
    );

    return {
        store,
        async check() {
            await registered;
            await registration?.update().catch(() => {});
        },
        apply() {
            accepted = true;
            if (waiting) waiting.postMessage({ type: SKIP_WAITING });
            else reload();
        },
    };
}
