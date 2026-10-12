import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

/**
 * Transient values the status bar shows that no document holds (DESIGN §5.7). Each stays null
 * until a feature supplies it: the cursor position comes from the viewport, the hint and the
 * feedback from the active tool.
 */
export interface StatusState {
    /** Cursor position in document pixels, or null while it is outside the document. */
    cursor: { x: number; y: number } | null;
    /** One-line hint for the active tool's modifiers. */
    hint: string | null;
    /** Transient tool feedback ("Layer is locked"); shown instead of the hint. */
    feedback: string | null;

    setCursor(cursor: { x: number; y: number } | null): void;
    setHint(hint: string | null): void;
    setFeedback(feedback: string | null): void;
}

export function createStatusStore(): StoreApi<StatusState> {
    return createStore<StatusState>((set) => ({
        cursor: null,
        hint: null,
        feedback: null,
        setCursor: (cursor) => set({ cursor }),
        setHint: (hint) => set({ hint }),
        setFeedback: (feedback) => set({ feedback }),
    }));
}

/** The status values of the app. */
export const statusStore = createStatusStore();

export function useStatus<Slice>(selector: (state: StatusState) => Slice): Slice {
    return useStore(statusStore, selector);
}
