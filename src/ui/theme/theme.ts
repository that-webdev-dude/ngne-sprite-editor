import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { browserStorage, readItem, writeItem } from "../platform/storage";
import type { KeyValueStorage } from "../platform/storage";

/** DESIGN §3: dark is the default, light is the second full token set. */
export type Theme = "dark" | "light";

export const DEFAULT_THEME: Theme = "dark";
export const THEME_STORAGE_KEY = "ngne-sprite-editor.theme";

export interface ThemeState {
    theme: Theme;
    setTheme(theme: Theme): void;
    toggleTheme(): void;
}

function parseTheme(value: string | null): Theme {
    return value === "light" || value === "dark" ? value : DEFAULT_THEME;
}

/** A theme store bound to `storage`; anything but a stored "dark" or "light" is the default. */
export function createThemeStore(storage: KeyValueStorage | null): StoreApi<ThemeState> {
    return createStore<ThemeState>((set, get) => ({
        theme: parseTheme(readItem(storage, THEME_STORAGE_KEY)),
        setTheme(theme) {
            writeItem(storage, THEME_STORAGE_KEY, theme);
            set({ theme });
        },
        toggleTheme() {
            get().setTheme(get().theme === "dark" ? "light" : "dark");
        },
    }));
}

/** The app's theme, persisted in `localStorage`. `UiRoot` mirrors it to `<html data-theme>`. */
export const themeStore = createThemeStore(browserStorage());

export function useTheme(): Theme {
    return useStore(themeStore, (state) => state.theme);
}

export function setTheme(theme: Theme): void {
    themeStore.getState().setTheme(theme);
}
