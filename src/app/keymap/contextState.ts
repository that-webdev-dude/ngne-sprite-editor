import { createStore } from "zustand/vanilla";

/**
 * The two keymap contexts of SPEC §7.8 that follow editor state instead of focus. The feature
 * that owns the state switches its context on and off: the polygon lasso and the curve tool
 * for `gesture`, the floating selection for `floating`.
 */
export interface KeyContextState {
    /** A multi-click tool gesture is in progress. */
    gesture: boolean;
    /** A floating selection exists. */
    floating: boolean;
}

export const keyContextStore = createStore<KeyContextState>(() => ({
    gesture: false,
    floating: false,
}));

export function setKeyContext(context: keyof KeyContextState, active: boolean): void {
    if (keyContextStore.getState()[context] !== active) {
        keyContextStore.setState({ [context]: active });
    }
}
