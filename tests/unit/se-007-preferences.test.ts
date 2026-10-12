import { afterEach, describe, expect, it, vi } from "vitest";
import {
    createPreferenceStore,
    defaultPreferences,
    parsePreferences,
    PREFERENCES_STORAGE_KEY,
    PREFERENCES_VERSION,
} from "../../src/app/preferences/preferences";
import type { PreferenceKey, Preferences } from "../../src/app/preferences/preferences";
import { defaultDocSettings } from "../../src/core/model";
import { memoryStorage } from "./se-007-support";

// SE-007: preference store — versioned localStorage record, defaults, typed access, change
// subscription; corrupt or older stored values fall back to defaults without an error.

/** The store's own defaults: what every fallback is compared with. */
const DEFAULTS = defaultPreferences();

/** The default values this ticket documents, written out. */
const DOCUMENTED: Preferences = {
    checkerboard: { colors: "theme", size: 8 },
    grid: { width: 16, height: 16 },
    onion: {
        enabled: false,
        before: 1,
        after: 1,
        opacity: 128,
        falloff: 0.5,
        tint: false,
        placement: "behind",
        withinTag: false,
    },
    import: {
        targetWidth: 32,
        targetHeight: 32,
        resample: "area",
        alphaThreshold: 128,
        colors: 16,
        dither: "none",
    },
    autosave: { enabled: true },
};

/** A stored record of the current version with the given values. */
function record(values: unknown, version: unknown = PREFERENCES_VERSION): string {
    return JSON.stringify({ version, values });
}

function stored(text: string) {
    return memoryStorage({ [PREFERENCES_STORAGE_KEY]: text });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("preference defaults", () => {
    it("has the documented defaults", () => {
        expect(defaultPreferences()).toMatchObject(DOCUMENTED);
        expect(PREFERENCES_VERSION).toBeGreaterThanOrEqual(1);
    });

    it("takes the onion-skin defaults from the document model", () => {
        expect(defaultPreferences().onion).toEqual(defaultDocSettings(32, 32).onion);
        expect(defaultPreferences().grid).toMatchObject({
            width: defaultDocSettings(32, 32).grid.width,
            height: defaultDocSettings(32, 32).grid.height,
        });
    });

    it("returns a new object on every call", () => {
        expect(defaultPreferences()).not.toBe(defaultPreferences());
        expect(defaultPreferences().onion).not.toBe(defaultPreferences().onion);
    });
});

describe("preference store", () => {
    it("starts with the defaults when nothing is stored, or there is no storage", () => {
        expect(createPreferenceStore(memoryStorage()).all()).toEqual(DEFAULTS);
        expect(createPreferenceStore(null).all()).toEqual(DEFAULTS);
    });

    it("gives typed access to each preference", () => {
        const store = createPreferenceStore(null);
        const grid: { width: number; height: number } = store.get("grid");
        const enabled: boolean = store.get("autosave").enabled;
        const resample: "nearest" | "area" | "dominant" = store.get("import").resample;
        expect(grid).toEqual({ width: 16, height: 16 });
        expect(enabled).toBe(true);
        expect(resample).toBe("area");
        expect(store.get("checkerboard")).toEqual({ colors: "theme", size: 8 });
        expect(store.get("onion").placement).toBe("behind");
    });

    it("stores a value in a versioned record and restores it in a new store", () => {
        const storage = memoryStorage();
        const store = createPreferenceStore(storage);
        store.set("grid", { width: 8, height: 12 });
        store.set("checkerboard", { colors: { a: 0x112233, b: 0xffffff }, size: 4 });
        store.set("autosave", { enabled: false });

        const written = JSON.parse(storage.data.get(PREFERENCES_STORAGE_KEY) ?? "null") as {
            version: number;
            values: Preferences;
        };
        expect(written.version).toBe(PREFERENCES_VERSION);
        expect(written.values.grid).toEqual({ width: 8, height: 12 });
        expect(Object.keys(written.values).sort()).toEqual(Object.keys(DEFAULTS).sort());

        const reopened = createPreferenceStore(storage);
        expect(reopened.get("grid")).toEqual({ width: 8, height: 12 });
        expect(reopened.get("checkerboard")).toEqual({
            colors: { a: 0x112233, b: 0xffffff },
            size: 4,
        });
        expect(reopened.get("autosave")).toEqual({ enabled: false });
        expect(reopened.get("onion")).toEqual(DEFAULTS.onion);
    });

    it("notifies subscribers of every changed preference, and not of an equal value", () => {
        const store = createPreferenceStore(memoryStorage());
        const seen: [PreferenceKey, unknown][] = [];
        const stop = store.subscribe((key, all) => seen.push([key, all[key]]));
        const changes: Partial<Preferences> = {
            checkerboard: { colors: { a: 1, b: 2 }, size: 16 },
            grid: { width: 24, height: 24 },
            onion: { ...DEFAULTS.onion, enabled: true, before: 3, falloff: 0.25 },
            import: { ...DEFAULTS.import, resample: "nearest", dither: "ordered", colors: 4 },
            autosave: { enabled: false },
        };
        for (const key of Object.keys(changes) as PreferenceKey[]) {
            store.set(key, changes[key] as never);
        }
        expect(seen).toEqual(Object.entries(changes));
        expect(store.all()).toMatchObject(changes);

        // The same value again, with its fields in another order, is no change.
        store.set("grid", { height: 24, width: 24 });
        expect(seen).toHaveLength(5);

        stop();
        store.set("grid", { width: 1, height: 1 });
        expect(seen).toHaveLength(5);
    });

    it("also notifies through the value store used by React", () => {
        const store = createPreferenceStore(null);
        const sizes: number[] = [];
        store.values.subscribe((state) => sizes.push(state.checkerboard.size));
        store.set("checkerboard", { colors: "theme", size: 32 });
        expect(sizes).toEqual([32]);
        expect(store.values.getState()).toBe(store.all());
    });

    it("rejects an invalid value and keeps the current one", () => {
        const storage = memoryStorage();
        const store = createPreferenceStore(storage);
        const invalid: [PreferenceKey, unknown][] = [
            ["grid", { width: 0, height: 16 }],
            ["grid", { width: 16.5, height: 16 }],
            ["grid", { width: 16 }],
            ["grid", { width: 16, height: 16, depth: 1 }],
            ["checkerboard", { colors: "blue", size: 8 }],
            ["checkerboard", { colors: { a: -1, b: 0 }, size: 8 }],
            ["checkerboard", { colors: "theme", size: 65 }],
            ["onion", { ...DEFAULTS.onion, before: 4 }],
            ["onion", { ...DEFAULTS.onion, placement: "middle" }],
            ["import", { ...DEFAULTS.import, colors: 1 }],
            ["import", { ...DEFAULTS.import, dither: "random" }],
            ["autosave", { enabled: "yes" }],
            ["autosave", null],
        ];
        for (const [key, value] of invalid) {
            expect(() => store.set(key, value as never), JSON.stringify(value)).toThrow(RangeError);
        }
        expect(store.all()).toEqual(DEFAULTS);
        expect(storage.data.size).toBe(0);
    });

    it("resets one preference or all of them", () => {
        const storage = memoryStorage();
        const store = createPreferenceStore(storage);
        store.set("grid", { width: 8, height: 8 });
        store.set("autosave", { enabled: false });
        const seen: PreferenceKey[] = [];
        store.subscribe((key) => seen.push(key));

        store.reset("grid");
        expect(store.get("grid")).toEqual(DEFAULTS.grid);
        expect(store.get("autosave")).toEqual({ enabled: false });
        store.reset();
        expect(store.all()).toEqual(DEFAULTS);
        expect(seen).toEqual(["grid", "autosave"]);
        expect(createPreferenceStore(storage).all()).toEqual(DEFAULTS);
    });

    it("keeps working when the storage refuses to write", () => {
        const store = createPreferenceStore({
            getItem: () => null,
            removeItem: () => {},
            setItem() {
                throw new Error("QuotaExceededError");
            },
        });
        expect(() => store.set("grid", { width: 8, height: 8 })).not.toThrow();
        expect(store.get("grid")).toEqual({ width: 8, height: 8 });
    });
});

describe("corrupt or older stored preferences", () => {
    const corrupt: [name: string, text: string][] = [
        ["text that is not JSON", "{not json"],
        ["an empty string", ""],
        ["null", "null"],
        ["a number", "42"],
        ["a string", '"dark"'],
        ["an array", "[1, 2, 3]"],
        [
            "a record without a version",
            JSON.stringify({ values: { grid: { width: 8, height: 8 } } }),
        ],
        ["an older, unversioned shape", JSON.stringify({ grid: { width: 8, height: 8 } })],
        ["an older version", record({ grid: { width: 8, height: 8 } }, 0)],
        ["a newer version", record({ grid: { width: 8, height: 8 } }, PREFERENCES_VERSION + 1)],
        ["a version of the wrong type", record({ grid: { width: 8, height: 8 } }, "1")],
        ["a record without values", JSON.stringify({ version: PREFERENCES_VERSION })],
        ["values of the wrong type", record("everything")],
        ["values that are an array", record([{ width: 8 }])],
    ];

    for (const [name, text] of corrupt) {
        it(`falls back to the defaults for ${name}, without an error`, () => {
            const error = vi.spyOn(console, "error");
            const warn = vi.spyOn(console, "warn");
            const storage = stored(text);
            // Creating the store reads the record; a throw here fails the test.
            const store = createPreferenceStore(storage);
            expect(store.all()).toEqual(DEFAULTS);
            expect(error).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
            // The store is usable: the next change replaces the bad record.
            store.set("grid", { width: 4, height: 4 });
            expect(createPreferenceStore(storage).get("grid")).toEqual({ width: 4, height: 4 });
        });
    }

    it("falls back per field inside a record of the current version", () => {
        const store = createPreferenceStore(
            stored(
                record({
                    checkerboard: { colors: { a: 0x101010, b: "white" }, size: 2 },
                    grid: { width: 8, height: "tall" },
                    onion: { before: 3, after: 9, opacity: 300, tint: true, placement: "front" },
                    import: { resample: "bicubic", colors: 64, targetWidth: 0 },
                    autosave: { enabled: 0 },
                    unknownSection: { anything: true },
                }),
            ),
        );
        expect(store.all()).toEqual({
            ...DEFAULTS,
            // An unusable colour pair goes back to the default; the valid size is kept.
            checkerboard: { colors: DEFAULTS.checkerboard.colors, size: 2 },
            grid: { width: 8, height: DEFAULTS.grid.height },
            onion: { ...DEFAULTS.onion, before: 3, tint: true, placement: "front" },
            import: { ...DEFAULTS.import, colors: 64 },
            autosave: DEFAULTS.autosave,
        });
    });

    it("falls back for sections of the wrong type", () => {
        const store = createPreferenceStore(
            stored(
                record({ grid: null, onion: 7, import: "fast", autosave: [], checkerboard: true }),
            ),
        );
        expect(store.all()).toEqual(DEFAULTS);
    });

    it("survives a storage that throws on read", () => {
        const store = createPreferenceStore({
            getItem() {
                throw new Error("SecurityError");
            },
            setItem: () => {},
            removeItem: () => {},
        });
        expect(store.all()).toEqual(DEFAULTS);
    });

    it("parses any value without throwing", () => {
        const version = PREFERENCES_VERSION;
        for (const value of [undefined, null, 0, "", [], {}, { version, values: null }]) {
            expect(parsePreferences(value)).toEqual(DEFAULTS);
        }
        expect(parsePreferences({ version, values: { autosave: { enabled: false } } })).toEqual({
            ...DEFAULTS,
            autosave: { enabled: false },
        });
    });
});
