import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

/**
 * The surfaces of DESIGN §4 and §7 that a command opens without asking for an answer: the
 * command palette, the Preferences dialog and the shortcut sheet. A command opens one; the
 * interface shows it (ui/surfaces/AppSurfaces.tsx) and closes it.
 */
export const SURFACE_IDS = ["command-palette", "preferences", "shortcut-sheet"] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];

export interface SurfaceState {
    /** The surface that is open, or null. */
    open: SurfaceId | null;
}

export interface Surfaces {
    readonly store: StoreApi<SurfaceState>;
    /** Opens a surface. One at a time: it takes the place of the one that is open. */
    open(id: SurfaceId): void;
    /** Closes the open surface; with an id, only when that one is open. */
    close(id?: SurfaceId): void;
}

export function createSurfaces(): Surfaces {
    const store = createStore<SurfaceState>(() => ({ open: null }));
    return {
        store,
        open(id) {
            if (store.getState().open !== id) store.setState({ open: id });
        },
        close(id) {
            const { open } = store.getState();
            if (open !== null && (id === undefined || id === open)) store.setState({ open: null });
        },
    };
}

/** The surfaces of the app. */
export const surfaces = createSurfaces();

/** The open surface, or null; the component renders again when it changes. */
export function useOpenSurface(): SurfaceId | null {
    return useStore(surfaces.store, (state) => state.open);
}
