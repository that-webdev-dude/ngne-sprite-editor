import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { browserStorage, readJson, writeItem } from "../platform/storage";
import type { KeyValueStorage } from "../platform/storage";

/**
 * The commands last run from the command palette, newest first. The palette lists them before
 * the others (SE-064). They are kept in `localStorage` under a key of their own, so the list
 * survives a reload; it is not a preference and the Preferences dialog does not show it.
 */
export const RECENT_COMMANDS_STORAGE_KEY = "ngne-sprite-editor.recent-commands";
export const MAX_RECENT_COMMANDS = 8;

export interface RecentCommandsState {
    /** Command ids, newest first, each once, at most `MAX_RECENT_COMMANDS`. */
    ids: readonly string[];
    /** Puts a command at the front of the list. */
    record(id: string): void;
}

/** Reads a stored list. Anything that is not a list of ids gives an empty one; never throws. */
export function parseRecentCommands(stored: unknown): string[] {
    if (!Array.isArray(stored)) return [];
    const ids = stored.filter((id): id is string => typeof id === "string" && id !== "");
    return [...new Set(ids)].slice(0, MAX_RECENT_COMMANDS);
}

/** A list bound to `storage`; `null` keeps it in memory only. */
export function createRecentCommandsStore(
    storage: KeyValueStorage | null,
): StoreApi<RecentCommandsState> {
    return createStore<RecentCommandsState>((set, get) => ({
        ids: parseRecentCommands(readJson(storage, RECENT_COMMANDS_STORAGE_KEY)),
        record(id) {
            const ids = parseRecentCommands([id, ...get().ids]);
            set({ ids });
            writeItem(storage, RECENT_COMMANDS_STORAGE_KEY, JSON.stringify(ids));
        },
    }));
}

/** The recent commands of the app, persisted in `localStorage`. */
export const recentCommands = createRecentCommandsStore(browserStorage());
