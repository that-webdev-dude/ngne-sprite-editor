import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { defaultDocSettings } from "../../core/model";
import type { OnionSettings } from "../../core/model";
import { browserStorage, readJson, writeItem } from "../../ui/platform/storage";
import type { KeyValueStorage } from "../../ui/platform/storage";

/**
 * User preferences: one versioned record in `localStorage`, with defaults, typed access and
 * change notification. Each consumer reads its section in its own ticket; the Preferences
 * dialog (SE-064) edits them. The theme is not here: it has its own store (ui/theme).
 */
export const PREFERENCES_STORAGE_KEY = "ngne-sprite-editor.preferences";
/** Raised when the meaning of a stored value changes; other versions fall back to defaults. */
export const PREFERENCES_VERSION = 1;

/** Transparency checkerboard of the viewport (DESIGN §3.1). */
export interface CheckerboardPreference {
    /** "theme": the two colours of the current theme. Otherwise two colours as 0xRRGGBB. */
    readonly colors: "theme" | { readonly a: number; readonly b: number };
    /** Side of one square in document pixels, 1..64. */
    readonly size: number;
}

/** Grid of a new document (SE-008), in document pixels, 1..1024. */
export interface GridPreference {
    readonly width: number;
    readonly height: number;
}

/** Onion-skin settings of a new document (SE-025). */
export type OnionPreference = Readonly<OnionSettings>;

/** Defaults of the Import PNG dialog; the options and their defaults are those of SPEC §8. */
export interface ImportPreference {
    /** Step 4: target sprite size when no document is open, 1..1024. */
    readonly targetWidth: number;
    readonly targetHeight: number;
    /** Step 5. */
    readonly resample: "nearest" | "area" | "dominant";
    /** Step 6: alpha threshold used when the smart default thresholds, 1..255. */
    readonly alphaThreshold: number;
    /** Step 7: colour count used when the smart default reduces, 2..256. */
    readonly colors: number;
    /** Step 8. */
    readonly dither: "none" | "ordered" | "floyd-steinberg";
}

/** Autosave to IndexedDB (SPEC §10). */
export interface AutosavePreference {
    readonly enabled: boolean;
}

export interface Preferences {
    readonly checkerboard: CheckerboardPreference;
    readonly grid: GridPreference;
    readonly onion: OnionPreference;
    readonly import: ImportPreference;
    readonly autosave: AutosavePreference;
}
export type PreferenceKey = keyof Preferences;

/** Called after a preference changed, with its key and all current values. */
export type PreferenceListener = (key: PreferenceKey, preferences: Preferences) => void;

export interface PreferenceStore {
    get<Key extends PreferenceKey>(key: Key): Preferences[Key];
    all(): Preferences;
    /** Stores a value and notifies subscribers. Throws `RangeError` for an invalid value. */
    set<Key extends PreferenceKey>(key: Key, value: Preferences[Key]): void;
    /** Returns one preference, or all of them, to the default. */
    reset(key?: PreferenceKey): void;
    subscribe(listener: PreferenceListener): () => void;
    /** The values as a store, for `usePreference`. */
    readonly values: StoreApi<Preferences>;
}

export function defaultPreferences(): Preferences {
    return {
        checkerboard: { colors: "theme", size: 8 },
        grid: { width: 16, height: 16 },
        onion: defaultDocSettings(1, 1).onion,
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
}

// --- Validation -------------------------------------------------------------------------

/** Returns `value` when it is valid, otherwise `fallback`. */
type Parser<Value> = (value: unknown, fallback: Value) => Value;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Equality of two preference values: plain data, whatever the order of their fields. */
function sameValue(a: unknown, b: unknown): boolean {
    if (!isRecord(a) || !isRecord(b)) return a === b;
    const names = Object.keys(a);
    return (
        names.length === Object.keys(b).length && names.every((name) => sameValue(a[name], b[name]))
    );
}

function integer(min: number, max: number): Parser<number> {
    return (value, fallback) =>
        typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
            ? value
            : fallback;
}

function fraction(min: number, max: number): Parser<number> {
    return (value, fallback) =>
        typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
            ? value
            : fallback;
}

const flag: Parser<boolean> = (value, fallback) => (typeof value === "boolean" ? value : fallback);

function oneOf<Option extends string>(...options: Option[]): Parser<Option> {
    return (value, fallback) => (options.includes(value as Option) ? (value as Option) : fallback);
}

/** An object checked field by field: an invalid field takes its default, the rest are kept. */
function fields<Value extends object>(parsers: {
    [Field in keyof Value]-?: Parser<Value[Field]>;
}): Parser<Value> {
    return (value, fallback) => {
        const source = isRecord(value) ? value : {};
        const result: Record<string, unknown> = {};
        for (const field of Object.keys(parsers) as (keyof Value & string)[]) {
            result[field] = parsers[field](source[field], fallback[field]);
        }
        return result as Value;
    };
}

const colour = integer(0, 0xffffff);
const checkerColours: Parser<CheckerboardPreference["colors"]> = (value, fallback) => {
    if (value === "theme") return value;
    if (!isRecord(value)) return fallback;
    const a = colour(value.a, -1);
    const b = colour(value.b, -1);
    return a < 0 || b < 0 ? fallback : { a, b };
};

const side = integer(1, 1024);

const PARSERS: { [Key in PreferenceKey]: Parser<Preferences[Key]> } = {
    checkerboard: fields<CheckerboardPreference>({ colors: checkerColours, size: integer(1, 64) }),
    grid: fields<GridPreference>({ width: side, height: side }),
    onion: fields<OnionPreference>({
        enabled: flag,
        before: integer(0, 3),
        after: integer(0, 3),
        opacity: integer(0, 255),
        falloff: fraction(0, 1),
        tint: flag,
        placement: oneOf("behind", "front"),
        withinTag: flag,
    }),
    import: fields<ImportPreference>({
        targetWidth: side,
        targetHeight: side,
        resample: oneOf("nearest", "area", "dominant"),
        alphaThreshold: integer(1, 255),
        colors: integer(2, 256),
        dither: oneOf("none", "ordered", "floyd-steinberg"),
    }),
    autosave: fields<AutosavePreference>({ enabled: flag }),
};

function parseSection<Key extends PreferenceKey>(
    key: Key,
    value: unknown,
    fallback: Preferences[Key],
): Preferences[Key] {
    return PARSERS[key](value, fallback);
}

const KEYS = Object.keys(PARSERS) as PreferenceKey[];

/**
 * Reads a stored record. Anything that is not a record of the current version gives the
 * defaults; inside a current record every invalid field falls back to its default. Never
 * throws.
 */
export function parsePreferences(stored: unknown): Preferences {
    const defaults = defaultPreferences();
    if (!isRecord(stored) || stored.version !== PREFERENCES_VERSION) return defaults;
    const values = isRecord(stored.values) ? stored.values : {};
    const section = <Key extends PreferenceKey>(key: Key) =>
        parseSection(key, values[key], defaults[key]);
    return {
        checkerboard: section("checkerboard"),
        grid: section("grid"),
        onion: section("onion"),
        import: section("import"),
        autosave: section("autosave"),
    };
}

// --- Store ------------------------------------------------------------------------------

/** A preference store bound to `storage`; `null` keeps the values in memory only. */
export function createPreferenceStore(storage: KeyValueStorage | null): PreferenceStore {
    const values = createStore<Preferences>(() =>
        parsePreferences(readJson(storage, PREFERENCES_STORAGE_KEY)),
    );
    const listeners = new Set<PreferenceListener>();

    const write = <Key extends PreferenceKey>(key: Key, value: Preferences[Key]) => {
        if (sameValue(values.getState()[key], value)) return;
        values.setState({ ...values.getState(), [key]: value });
        writeItem(
            storage,
            PREFERENCES_STORAGE_KEY,
            JSON.stringify({ version: PREFERENCES_VERSION, values: values.getState() }),
        );
        for (const listener of [...listeners]) listener(key, values.getState());
    };

    return {
        get: (key) => values.getState()[key],
        all: () => values.getState(),
        set(key, value) {
            const valid = parseSection(key, value, defaultPreferences()[key]);
            if (!sameValue(valid, value)) {
                throw new RangeError(`Invalid value for the preference "${key}".`);
            }
            write(key, valid);
        },
        reset(key) {
            const defaults = defaultPreferences();
            for (const each of key ? [key] : KEYS) write(each, defaults[each]);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        values,
    };
}

/** The preferences of the app, persisted in `localStorage`. */
export const preferences = createPreferenceStore(browserStorage());

/** The current value of one preference; the component renders again when it changes. */
export function usePreference<Key extends PreferenceKey>(key: Key): Preferences[Key] {
    return useStore(preferences.values, (state) => state[key]);
}
