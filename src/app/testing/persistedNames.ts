import {
    createRecentCommandsStore as recentCommandsStore,
    persistedNames,
    createThemeStore as themeStore,
} from "@ngne/editor-ui";
import type { KeyValueStorage } from "@ngne/editor-ui/platform";
import { createLayoutStore as layoutStore } from "@ngne/editor-ui/shell";
import { EDITOR_ID } from "../editorId";

// What the unit tests of the persisted names import (SPEC §5 of @ngne/editor-ui): the names the
// package derives from the editor's id, and its store factories over a storage the test passes,
// each with the editor's key, under the names the editor's own modules gave them before they
// moved to the package. The editor UI instance builds its stores with the same factories and
// keys; this module creates no instance.

const names = persistedNames(EDITOR_ID);

export { DEFAULT_THEME } from "@ngne/editor-ui";

/** The theme's key in `localStorage`. */
export const THEME_STORAGE_KEY = names.theme;

/** The shell layout's key in `localStorage`. */
export const LAYOUT_STORAGE_KEY = names.layout;

/** The recent commands' key in `localStorage`. */
export const RECENT_COMMANDS_STORAGE_KEY = names.recentCommands;

/** The prefix of the service worker's caches. */
export const CACHE_PREFIX = names.cachePrefix;

/** The message that tells a waiting service worker to take over. */
export const SKIP_WAITING = names.skipWaiting;

/** The message a service worker sends once it controls the page. */
export const STARTED = names.started;

/** The theme store kept in `storage` under the editor's key; `null` keeps it in memory. */
export function createThemeStore(storage: KeyValueStorage | null) {
    return themeStore(storage, THEME_STORAGE_KEY);
}

/** The layout store kept in `storage` under the editor's key; `null` keeps it in memory. */
export function createLayoutStore(storage: KeyValueStorage | null) {
    return layoutStore(storage, LAYOUT_STORAGE_KEY);
}

/** The recent commands kept in `storage` under the editor's key; `null` keeps them in memory. */
export function createRecentCommandsStore(storage: KeyValueStorage | null) {
    return recentCommandsStore(storage, RECENT_COMMANDS_STORAGE_KEY);
}
