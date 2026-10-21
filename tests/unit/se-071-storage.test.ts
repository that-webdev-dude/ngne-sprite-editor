import { afterEach, describe, expect, it, vi } from "vitest";
import type * as NoticesModule from "../../src/app/notices/notices";
import type * as StorageModule from "../../src/app/platform/storage";
import type { KeyValueStorage } from "../../src/app/platform/storage";

// SE-071 (from the SE-064 review): a write to storage that fails — the store is full or the
// browser blocks it — is reported once, as an error notice (a toast in the interface), instead
// of being lost silently; for the preferences, the theme, the layout and the recent commands.

function memoryStorage(): KeyValueStorage {
    const items = new Map<string, string>();
    return {
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => void items.set(key, value),
        removeItem: (key) => void items.delete(key),
    };
}

/** A store that holds what it has and refuses every write, as a full one does. */
function fullStorage(): KeyValueStorage {
    const storage = memoryStorage();
    storage.setItem = () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
    return storage;
}

/** Fresh modules (one report per page is module state) and the notices they send. */
async function fresh() {
    vi.resetModules();
    const notices = (await import("../../src/app/notices/notices")) as typeof NoticesModule;
    const storage = (await import("../../src/app/platform/storage")) as typeof StorageModule;
    const sent: [string, string][] = [];
    notices.notices.attachSink((kind, message) => sent.push([kind, message]));
    return { storage, sent };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("storage failures", () => {
    it("reports the first failure only", async () => {
        const { storage } = await fresh();
        const notify = vi.fn();
        const failures = storage.createStorageFailures(notify);
        expect(failures.reported).toBe(false);
        failures.report(new Error("full"));
        failures.report(new Error("full again"));
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith(storage.STORAGE_WRITE_FAILED_MESSAGE);
        expect(failures.reported).toBe(true);
    });

    it("writeItem returns whether it wrote, and reports a write that threw", async () => {
        const { storage } = await fresh();
        const notify = vi.fn();
        const failures = storage.createStorageFailures(notify);
        const memory = memoryStorage();
        expect(storage.writeItem(memory, "key", "value", failures)).toBe(true);
        expect(memory.getItem("key")).toBe("value");
        expect(notify).not.toHaveBeenCalled();
        expect(storage.writeItem(fullStorage(), "key", "value", failures)).toBe(false);
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it("keeps values in memory without a store and reports nothing", async () => {
        const { storage, sent } = await fresh();
        expect(storage.writeItem(null, "key", "value")).toBe(false);
        expect(sent).toEqual([]);
    });

    it("treats a store the browser blocks as one whose writes fail", async () => {
        const { storage, sent } = await fresh();
        vi.stubGlobal("localStorage", undefined);
        expect(storage.browserStorage()).toBeNull();
        const blocked = new DOMException("Access is denied for this document.", "SecurityError");
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                throw blocked;
            },
        });
        try {
            const store = storage.browserStorage();
            expect(store).not.toBeNull();
            expect(storage.readItem(store, "key")).toBeNull();
            expect(storage.writeItem(store, "key", "value")).toBe(false);
            expect(sent).toEqual([["error", storage.STORAGE_WRITE_FAILED_MESSAGE]]);
        } finally {
            delete (globalThis as { localStorage?: unknown }).localStorage;
        }
    });
});

describe("every store kept in localStorage reports a failed write once, and keeps the value", () => {
    it("the theme", async () => {
        const { storage, sent } = await fresh();
        const { createThemeStore } = await import("../../src/ui/theme/theme");
        const store = createThemeStore(fullStorage());
        store.getState().setTheme("light");
        expect(store.getState().theme).toBe("light");
        store.getState().setTheme("dark");
        expect(sent).toEqual([["error", storage.STORAGE_WRITE_FAILED_MESSAGE]]);
    });

    it("the preferences", async () => {
        const { storage, sent } = await fresh();
        const { createPreferenceStore } = await import("../../src/app/preferences/preferences");
        const store = createPreferenceStore(fullStorage());
        store.set("autosave", { enabled: false });
        expect(store.get("autosave")).toEqual({ enabled: false });
        store.set("grid", { ...store.get("grid"), width: 8 });
        expect(sent).toEqual([["error", storage.STORAGE_WRITE_FAILED_MESSAGE]]);
    });

    it("the layout", async () => {
        const { storage, sent } = await fresh();
        const { createLayoutStore } = await import("../../src/ui/shell/layoutStore");
        const store = createLayoutStore(fullStorage());
        store.getState().setDockWidth(300);
        expect(store.getState().dockWidth).toBe(300);
        store.getState().setTimelineHeight(250);
        expect(sent).toEqual([["error", storage.STORAGE_WRITE_FAILED_MESSAGE]]);
    });

    it("the recent commands", async () => {
        const { storage, sent } = await fresh();
        const { createRecentCommandsStore } =
            await import("../../src/app/commandPalette/recentCommands");
        const store = createRecentCommandsStore(fullStorage());
        store.getState().record("edit.undo");
        expect(store.getState().ids).toEqual(["edit.undo"]);
        store.getState().record("edit.redo");
        expect(sent).toEqual([["error", storage.STORAGE_WRITE_FAILED_MESSAGE]]);
    });

    it("one report for the page, whichever stores fail", async () => {
        const { storage, sent } = await fresh();
        const { createThemeStore } = await import("../../src/ui/theme/theme");
        const { createLayoutStore } = await import("../../src/ui/shell/layoutStore");
        const { createRecentCommandsStore } =
            await import("../../src/app/commandPalette/recentCommands");
        createThemeStore(fullStorage()).getState().setTheme("light");
        createLayoutStore(fullStorage()).getState().setDockWidth(300);
        createRecentCommandsStore(fullStorage()).getState().record("edit.undo");
        expect(sent).toEqual([["error", storage.STORAGE_WRITE_FAILED_MESSAGE]]);
    });
});
