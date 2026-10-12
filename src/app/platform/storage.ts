/** The part of `Storage` the interface uses; tests pass an in-memory implementation. */
export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** `localStorage`, or null where it is missing or blocked (private mode, Node). */
export function browserStorage(): KeyValueStorage | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

export function readItem(storage: KeyValueStorage | null, key: string): string | null {
    try {
        return storage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

/** Writes are best effort: a full or blocked store must not break the interface. */
export function writeItem(storage: KeyValueStorage | null, key: string, value: string): void {
    try {
        storage?.setItem(key, value);
    } catch {
        // Ignored on purpose.
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
