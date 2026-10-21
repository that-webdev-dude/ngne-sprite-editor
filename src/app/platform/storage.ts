import { notices } from "../notices/notices";

/** The part of `Storage` the interface uses; tests pass an in-memory implementation. */
export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/**
 * Storage the browser has but refuses to give (site data blocked, a sandbox): it reads as
 * empty, and every write fails with the error the browser gave, so that the write is reported
 * like a full store's (SE-071).
 */
function blockedStorage(error: unknown): KeyValueStorage {
    return {
        getItem: () => null,
        setItem() {
            throw error;
        },
        removeItem() {},
    };
}

/**
 * `localStorage`; a store whose writes fail where the browser blocks it; null where it does
 * not exist (Node), where the values are kept in memory only and nothing is reported.
 */
export function browserStorage(): KeyValueStorage | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch (error) {
        return blockedStorage(error);
    }
}

export function readItem(storage: KeyValueStorage | null, key: string): string | null {
    try {
        return storage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

/**
 * The toast of a write that failed (DESIGN §4: an asynchronous failure is reported by a
 * toast). The values stay in effect for the page; only keeping them across a reload failed.
 */
export const STORAGE_WRITE_FAILED_MESSAGE =
    "Settings could not be saved: the browser's storage is full or blocked. Changes last until the page is closed.";

/**
 * Reports failed writes of the stores kept in `localStorage` — preferences, theme, layout,
 * recent commands — once: the first failure is reported, later ones (of any store) are not,
 * so a full store does not raise a toast at every change.
 */
export interface StorageFailures {
    /** A write failed with `error`. */
    report(error: unknown): void;
    /** True once a failure has been reported. */
    readonly reported: boolean;
}

export function createStorageFailures(notify: (message: string) => void): StorageFailures {
    let reported = false;
    return {
        report() {
            if (reported) return;
            reported = true;
            notify(STORAGE_WRITE_FAILED_MESSAGE);
        },
        get reported() {
            return reported;
        },
    };
}

/**
 * The failed writes of the app, reported as an error notice: a toast, or, for a write that
 * fails before the interface shows notices, a toast once it does (`untilShown`).
 */
export const storageFailures: StorageFailures = createStorageFailures((message) =>
    notices.error(message, { untilShown: true }),
);

/**
 * Writes are best effort: a full or blocked store must not break the interface. A write that
 * fails is reported through `failures` (once per page, `StorageFailures`). Returns whether
 * the value was written; without a store it is not, and nothing is reported.
 */
export function writeItem(
    storage: KeyValueStorage | null,
    key: string,
    value: string,
    failures: StorageFailures = storageFailures,
): boolean {
    if (!storage) return false;
    try {
        storage.setItem(key, value);
        return true;
    } catch (error) {
        failures.report(error);
        return false;
    }
}

export function readJson(storage: KeyValueStorage | null, key: string): unknown {
    const text = readItem(storage, key);
    if (text === null) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}
