import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { projectFileHandleFrom } from "../platform/projectFiles";
import type { ProjectFileHandle } from "../platform/projectFiles";

/**
 * The recent files (SE-047): the project files last opened or saved with File System Access,
 * newest first, shown on the empty state and in File → Open Recent. Each is kept as its
 * handle in IndexedDB (a native `FileSystemFileHandle` is structured-cloneable), so the list
 * and the files outlive a reload. Without File System Access there are no handles and the
 * list stays empty.
 *
 * Storage is best effort, as for the export folders (`app/export/exportFolders.ts`): where
 * IndexedDB is missing or fails (private windows, Node, a handle that cannot be cloned) the
 * list lives in memory for the session only, and nothing is reported.
 */

/** The menu path of the recent files (File → Open Recent, `recent.commands.ts`). */
export const OPEN_RECENT_PATH = ["File", "Open Recent"] as const;

/** The id of the command that opens a recent entry. */
export function openRecentId(entry: Pick<RecentEntry, "key">): string {
    return `file.openRecent.${entry.key}`;
}

/** How many files the list keeps; an older one makes way for a newer one. */
export const RECENT_FILES_LIMIT = 10;

/** One file of the list. */
export interface RecentEntry {
    /** Stable for the session: names the entry's command and its row. */
    readonly key: string;
    /** The file's name, "hero.ngsprite". */
    readonly name: string;
    readonly handle: ProjectFileHandle;
}

export interface RecentFilesState {
    /** Newest first. */
    readonly entries: readonly RecentEntry[];
}

/** Where the list is kept: the stored values of its handles, newest first. */
export interface RecentFileStorage {
    /** The kept list, or null when there is none (or it cannot be read). */
    load(): Promise<readonly unknown[] | null>;
    /** Replaces the kept list; failures are ignored. */
    save(stored: readonly unknown[]): Promise<void>;
}

export interface RecentFiles {
    readonly store: StoreApi<RecentFilesState>;
    /** Reads the kept list once; later calls return the same promise. */
    load(): Promise<void>;
    /**
     * Puts the file of `handle` first: a file the list holds already moves up. A handle that
     * cannot be kept (`stored` absent) is not listed.
     */
    add(handle: ProjectFileHandle): Promise<void>;
    /** Takes the entry `key` off the list. */
    remove(key: string): Promise<void>;
    /** Empties the list. */
    clear(): Promise<void>;
}

export interface RecentFilesOptions {
    storage?: RecentFileStorage;
    /** A handle from its stored value; the default is the page's (`projectFileHandleFrom`). */
    handleFrom?(stored: unknown): ProjectFileHandle | null;
    limit?: number;
}

const DATABASE = "ngne-sprite-editor-recent";
const STORE = "files";
const KEY = "list";

function request<Result>(task: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        task.onsuccess = () => resolve(task.result);
        task.onerror = () => reject(task.error ?? new Error("IndexedDB request failed."));
    });
}

/** How long the list waits for IndexedDB to open, in milliseconds; then it keeps nothing. */
export const RECENT_OPEN_TIMEOUT_MS = 3000;

export interface IndexedDbRecentOptions {
    /** The IndexedDB to use; the default is the page's (`indexedDB`). */
    factory?: Pick<IDBFactory, "open">;
    timeoutMs?: number;
}

/**
 * The list in the page's IndexedDB; a storage that keeps nothing where there is none. An open
 * that another tab blocks, or that does not answer within the timeout, gives up: the list is
 * kept in memory for the session, and nothing waits for storage for ever.
 */
export function indexedDbRecentFiles(options: IndexedDbRecentOptions = {}): RecentFileStorage {
    const timeoutMs = options.timeoutMs ?? RECENT_OPEN_TIMEOUT_MS;
    let opened: Promise<IDBDatabase | null> | null = null;
    const database = (): Promise<IDBDatabase | null> => {
        opened ??= (async () => {
            const factory =
                options.factory ?? (typeof indexedDB === "undefined" ? null : indexedDB);
            if (!factory) return null;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const opening = factory.open(DATABASE, 1);
                opening.onupgradeneeded = () => {
                    if (!opening.result.objectStoreNames.contains(STORE)) {
                        opening.result.createObjectStore(STORE);
                    }
                };
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    opening.onsuccess = () => resolve(opening.result);
                    opening.onerror = () => reject(opening.error ?? new Error("Not opened."));
                    // Another tab holds an older version open: no waiting for it.
                    opening.onblocked = () => reject(new Error("The database is blocked."));
                    timer = setTimeout(() => {
                        // An answer after the timeout is not used: the database is let go.
                        opening.onsuccess = () => opening.result.close();
                        reject(new Error("No answer."));
                    }, timeoutMs);
                }).finally(() => clearTimeout(timer));
                // A newer version elsewhere: let it go, and open again next time.
                db.onversionchange = () => {
                    db.close();
                    opened = null;
                };
                return db;
            } catch {
                opened = null;
                return null;
            }
        })();
        return opened;
    };
    return {
        async load() {
            const db = await database();
            if (!db) return null;
            try {
                const value: unknown = await request(
                    db.transaction(STORE, "readonly").objectStore(STORE).get(KEY),
                );
                return Array.isArray(value) ? value : null;
            } catch {
                return null;
            }
        },
        async save(stored) {
            const db = await database();
            if (!db) return;
            try {
                await request(
                    db
                        .transaction(STORE, "readwrite")
                        .objectStore(STORE)
                        .put([...stored], KEY),
                );
            } catch {
                // Ignored on purpose: the list stays in memory for the session.
            }
        },
    };
}

export function createRecentFiles(options: RecentFilesOptions = {}): RecentFiles {
    const storage = options.storage ?? indexedDbRecentFiles();
    const handleFrom = options.handleFrom ?? projectFileHandleFrom;
    const limit = options.limit ?? RECENT_FILES_LIMIT;
    const store = createStore<RecentFilesState>(() => ({ entries: [] }));
    let keys = 0;
    let loading: Promise<void> | null = null;
    /** Changes run one after the other, each on the list the one before left. */
    let queue: Promise<void> = Promise.resolve();

    const entryOf = (handle: ProjectFileHandle): RecentEntry => ({
        key: `recent-${++keys}`,
        name: handle.name,
        handle,
    });
    const keep = (entries: readonly RecentEntry[]) => {
        store.setState({ entries });
        return storage.save(entries.map((entry) => entry.handle.stored));
    };
    /** Runs `change` after the list was read and every change before it ran. */
    const later = (change: () => Promise<void>): Promise<void> => {
        const next = queue.then(() => load()).then(change);
        queue = next.catch(() => {});
        return next;
    };
    const sameFile = async (a: ProjectFileHandle, b: ProjectFileHandle) =>
        a.stored === b.stored || ((await a.isSame?.(b)) ?? false);

    const load = (): Promise<void> => {
        loading ??= (async () => {
            const stored = (await storage.load()) ?? [];
            const handles = stored.map(handleFrom).filter((handle) => handle !== null);
            store.setState({ entries: handles.map(entryOf).slice(0, limit) });
        })();
        return loading;
    };

    return {
        store,
        load,
        add: (handle) =>
            later(async () => {
                if (handle.stored === undefined) return;
                const rest: RecentEntry[] = [];
                for (const entry of store.getState().entries) {
                    if (!(await sameFile(entry.handle, handle))) rest.push(entry);
                }
                await keep([entryOf(handle), ...rest].slice(0, limit));
            }),
        remove: (key) =>
            later(async () => {
                const { entries } = store.getState();
                if (!entries.some((entry) => entry.key === key)) return;
                await keep(entries.filter((entry) => entry.key !== key));
            }),
        clear: () => later(() => keep([])),
    };
}

/** The recent files of the app. */
export const recentFiles = createRecentFiles();
