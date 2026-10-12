import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { browserStorage, readJson, writeItem } from "../../app/platform/storage";
import type { KeyValueStorage } from "../../app/platform/storage";
import { parseStoredLayout } from "./layout";
import type { StoredLayout } from "./layout";

export const LAYOUT_STORAGE_KEY = "ngne-sprite-editor.layout";

export interface LayoutState extends StoredLayout {
    /** Sets the dock width chosen by the user; null returns to the default. */
    setDockWidth(width: number | null): void;
    /** Sets the timeline height chosen by the user; null returns to the default. */
    setTimelineHeight(height: number | null): void;
}

/** Splitter sizes persisted in `storage`; limits are applied when rendering (layout.ts). */
export function createLayoutStore(storage: KeyValueStorage | null): StoreApi<LayoutState> {
    return createStore<LayoutState>((set, get) => {
        const update = (change: Partial<StoredLayout>) => {
            set(change);
            const { dockWidth, timelineHeight } = get();
            writeItem(storage, LAYOUT_STORAGE_KEY, JSON.stringify({ dockWidth, timelineHeight }));
        };
        return {
            ...parseStoredLayout(readJson(storage, LAYOUT_STORAGE_KEY)),
            setDockWidth: (dockWidth) => update({ dockWidth }),
            setTimelineHeight: (timelineHeight) => update({ timelineHeight }),
        };
    });
}

export const layoutStore = createLayoutStore(browserStorage());

export function useLayout<Slice>(selector: (state: LayoutState) => Slice): Slice {
    return useStore(layoutStore, selector);
}
