import { describe, expect, it } from "vitest";
import {
    createPreferenceStore,
    defaultPreferences,
    PREFERENCE_RANGES,
    PREFERENCES_STORAGE_KEY,
} from "../../src/app/preferences/preferences";
import type { PreferenceKey, Preferences } from "../../src/app/preferences/preferences";
import { formatHexColour, parseHexColour } from "../../src/ui/preferences/hexColour";
import { createThemeStore, DEFAULT_THEME, THEME_STORAGE_KEY } from "../../src/ui/theme/theme";
import { memoryStorage } from "./se-007-support";

// SE-064: what the Preferences dialog relies on in the stores it edits — the ranges it offers
// are the ranges the preference store accepts, every field notifies a subscriber and
// persists, a record written before this ticket still loads, and the theme stays with the
// theme store.

const DEFAULTS = defaultPreferences();

/** Every numeric field of the preference store with the range the dialog offers for it. */
const NUMERIC_FIELDS: [key: PreferenceKey, field: string, range: { min: number; max: number }][] = [
    ["checkerboard", "size", PREFERENCE_RANGES.checkerboardSize],
    ["grid", "width", PREFERENCE_RANGES.side],
    ["grid", "height", PREFERENCE_RANGES.side],
    ["onion", "before", PREFERENCE_RANGES.onionFrames],
    ["onion", "after", PREFERENCE_RANGES.onionFrames],
    ["onion", "opacity", PREFERENCE_RANGES.onionOpacity],
    ["onion", "falloff", PREFERENCE_RANGES.onionFalloff],
    ["import", "targetWidth", PREFERENCE_RANGES.side],
    ["import", "targetHeight", PREFERENCE_RANGES.side],
    ["import", "alphaThreshold", PREFERENCE_RANGES.alphaThreshold],
    ["import", "colors", PREFERENCE_RANGES.importColors],
];

/** One change of every field of the store: the section it is in and the section's new value. */
const FIELD_CHANGES: [field: string, key: PreferenceKey, value: Preferences[PreferenceKey]][] = [
    [
        "checkerboard.colors",
        "checkerboard",
        { ...DEFAULTS.checkerboard, colors: { a: 0x112233, b: 0xddeeff } },
    ],
    ["checkerboard.size", "checkerboard", { ...DEFAULTS.checkerboard, size: 16 }],
    ["grid.width", "grid", { ...DEFAULTS.grid, width: 8 }],
    ["grid.height", "grid", { ...DEFAULTS.grid, height: 24 }],
    ["onion.enabled", "onion", { ...DEFAULTS.onion, enabled: true }],
    ["onion.before", "onion", { ...DEFAULTS.onion, before: 3 }],
    ["onion.after", "onion", { ...DEFAULTS.onion, after: 0 }],
    ["onion.opacity", "onion", { ...DEFAULTS.onion, opacity: 64 }],
    ["onion.falloff", "onion", { ...DEFAULTS.onion, falloff: 0.25 }],
    ["onion.tint", "onion", { ...DEFAULTS.onion, tint: true }],
    ["onion.placement", "onion", { ...DEFAULTS.onion, placement: "front" }],
    ["onion.withinTag", "onion", { ...DEFAULTS.onion, withinTag: true }],
    ["import.targetWidth", "import", { ...DEFAULTS.import, targetWidth: 64 }],
    ["import.targetHeight", "import", { ...DEFAULTS.import, targetHeight: 48 }],
    ["import.resample", "import", { ...DEFAULTS.import, resample: "nearest" }],
    ["import.alphaThreshold", "import", { ...DEFAULTS.import, alphaThreshold: 200 }],
    ["import.colors", "import", { ...DEFAULTS.import, colors: 32 }],
    ["import.dither", "import", { ...DEFAULTS.import, dither: "floyd-steinberg" }],
    ["autosave.enabled", "autosave", { enabled: false }],
];

/** The names of every field of the store, as "section.field". */
function fieldNames(preferences: Preferences): string[] {
    return (Object.keys(preferences) as PreferenceKey[]).flatMap((key) =>
        Object.keys(preferences[key]).map((field) => `${key}.${field}`),
    );
}

describe("preference ranges", () => {
    for (const [key, field, range] of NUMERIC_FIELDS) {
        it(`${key}.${field} accepts ${range.min}..${range.max} and nothing outside`, () => {
            const store = createPreferenceStore(null);
            const withField = (value: number) =>
                ({ ...DEFAULTS[key], [field]: value }) as Preferences[typeof key];
            for (const value of [range.min, range.max]) {
                store.set(key, withField(value));
                expect(store.get(key)).toEqual(withField(value));
            }
            for (const value of [range.min - 1, range.max + 1]) {
                expect(() => store.set(key, withField(value)), String(value)).toThrow(RangeError);
            }
            expect(store.get(key)).toEqual(withField(range.max));
        });
    }

    it("covers every numeric field of the store", () => {
        const numeric = (Object.keys(DEFAULTS) as PreferenceKey[]).flatMap((key) =>
            Object.entries(DEFAULTS[key])
                .filter(([, value]) => typeof value === "number")
                .map(([field]) => `${key}.${field}`),
        );
        expect(NUMERIC_FIELDS.map(([key, field]) => `${key}.${field}`).sort()).toEqual(
            numeric.sort(),
        );
    });

    it("the defaults lie inside their ranges", () => {
        for (const [key, field, range] of NUMERIC_FIELDS) {
            const value = (DEFAULTS[key] as unknown as Record<string, number>)[field] ?? NaN;
            expect(value, `${key}.${field}`).toBeGreaterThanOrEqual(range.min);
            expect(value, `${key}.${field}`).toBeLessThanOrEqual(range.max);
        }
    });
});

describe("changing a preference", () => {
    it("has a change for every field of the store", () => {
        expect(FIELD_CHANGES.map(([field]) => field).sort()).toEqual(fieldNames(DEFAULTS).sort());
    });

    for (const [field, key, value] of FIELD_CHANGES) {
        it(`${field}: updates the store, notifies a subscriber and persists`, () => {
            const storage = memoryStorage();
            const store = createPreferenceStore(storage);
            const seen: [PreferenceKey, unknown][] = [];
            store.subscribe((changed, all) => seen.push([changed, all[changed]]));

            store.set(key, value);
            // The store holds the value at once, and the subscriber was told which one.
            expect(store.get(key)).toEqual(value);
            expect(store.get(key)).not.toEqual(DEFAULTS[key]);
            expect(seen).toEqual([[key, value]]);
            // The other preferences are untouched.
            expect(store.all()).toEqual({ ...DEFAULTS, [key]: value });
            // What a reload reads: a new store on the same storage.
            expect(createPreferenceStore(storage).all()).toEqual({ ...DEFAULTS, [key]: value });
        });
    }
});

describe("records written before SE-064", () => {
    /** The record as SE-007 wrote it after a change of the grid: every section in full. */
    const SE_007_RECORD = JSON.stringify({
        version: 1,
        values: {
            checkerboard: { colors: { a: 0x101010, b: 0x202020 }, size: 4 },
            grid: { width: 8, height: 12 },
            onion: {
                enabled: true,
                before: 2,
                after: 3,
                opacity: 200,
                falloff: 0.75,
                tint: true,
                placement: "front",
                withinTag: true,
            },
            import: {
                targetWidth: 48,
                targetHeight: 64,
                resample: "dominant",
                alphaThreshold: 1,
                colors: 256,
                dither: "ordered",
            },
            autosave: { enabled: false },
        },
    });

    it("still load, value for value", () => {
        const store = createPreferenceStore(
            memoryStorage({ [PREFERENCES_STORAGE_KEY]: SE_007_RECORD }),
        );
        expect({ version: 1, values: store.all() }).toEqual(JSON.parse(SE_007_RECORD));
    });

    it("an invalid field falls back alone", () => {
        const record = JSON.parse(SE_007_RECORD) as { values: Record<string, object> };
        record.values.onion = { ...record.values.onion, opacity: 256 };
        record.values.import = { ...record.values.import, dither: "bayer" };
        const store = createPreferenceStore(
            memoryStorage({ [PREFERENCES_STORAGE_KEY]: JSON.stringify(record) }),
        );
        const stored = JSON.parse(SE_007_RECORD) as { values: Preferences };
        expect(store.all()).toEqual({
            ...stored.values,
            onion: { ...stored.values.onion, opacity: DEFAULTS.onion.opacity },
            import: { ...stored.values.import, dither: DEFAULTS.import.dither },
        });
    });
});

describe("the theme and the preference store", () => {
    it("the preference store holds no theme: the theme store is its only owner", () => {
        expect(Object.keys(DEFAULTS)).not.toContain("theme");
        expect(fieldNames(DEFAULTS).filter((field) => /theme/i.test(field))).toEqual([]);
        expect(PREFERENCES_STORAGE_KEY).not.toBe(THEME_STORAGE_KEY);
    });

    it("a change of theme and a change of preference do not touch each other's record", () => {
        const storage = memoryStorage();
        const theme = createThemeStore(storage);
        const store = createPreferenceStore(storage);
        theme.getState().setTheme("light");
        expect([...storage.data.keys()]).toEqual([THEME_STORAGE_KEY]);
        store.set("autosave", { enabled: false });
        expect(storage.data.get(THEME_STORAGE_KEY)).toBe("light");
        // Restore defaults in the dialog: both stores go back, each by its own means.
        store.reset();
        theme.getState().setTheme(DEFAULT_THEME);
        expect(createPreferenceStore(storage).all()).toEqual(DEFAULTS);
        expect(createThemeStore(storage).getState().theme).toBe("dark");
    });
});

describe("hex colour text", () => {
    it("writes a colour as #rrggbb", () => {
        expect(formatHexColour(0x3a3a3a)).toBe("#3a3a3a");
        expect(formatHexColour(0)).toBe("#000000");
        expect(formatHexColour(0xff)).toBe("#0000ff");
        expect(formatHexColour(0xffffff)).toBe("#ffffff");
    });

    it("reads #rrggbb, rrggbb and the short form, in either case", () => {
        expect(parseHexColour("#3a3a3a")).toBe(0x3a3a3a);
        expect(parseHexColour("C8C8C8")).toBe(0xc8c8c8);
        expect(parseHexColour(" #FfFfFf ")).toBe(0xffffff);
        expect(parseHexColour("#1af")).toBe(0x11aaff);
        expect(parseHexColour("000")).toBe(0);
    });

    it("rejects text that is not a colour", () => {
        for (const text of ["", "#", "#12", "#12345", "#1234567", "red", "#gggggg", "12 34 56"]) {
            expect(parseHexColour(text), text).toBeNull();
        }
    });

    it("round-trips every colour it writes", () => {
        for (const colour of [0, 1, 0x00ff00, 0x4a4a4a, 0xabcdef, 0xffffff]) {
            expect(parseHexColour(formatHexColour(colour))).toBe(colour);
        }
    });
});
