import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

/**
 * Toast service (DESIGN §4): reports the result of an explicit command and asynchronous
 * failures. Usable from any layer of the interface, inside or outside React; `ToastViewport`
 * renders the queue.
 */
export type ToastKind = "info" | "error";

export interface ToastItem {
    id: number;
    kind: ToastKind;
    message: string;
}

export interface ToastState {
    toasts: readonly ToastItem[];
}

export interface ToastService {
    /** Shown for 4 s. Returns the toast id. */
    info(message: string): number;
    /** Stays until dismissed. Returns the toast id. */
    error(message: string): number;
    dismiss(id: number): void;
    store: StoreApi<ToastState>;
}

/** DESIGN §4: an information toast stays for 4 s. */
export const INFO_TOAST_MS = 4000;

export function createToastService(): ToastService {
    const store = createStore<ToastState>(() => ({ toasts: [] }));
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    let nextId = 1;

    const dismiss = (id: number) => {
        clearTimeout(timers.get(id));
        timers.delete(id);
        store.setState({ toasts: store.getState().toasts.filter((item) => item.id !== id) });
    };
    const expire = (id: number) => {
        clearTimeout(timers.get(id));
        timers.set(
            id,
            setTimeout(() => dismiss(id), INFO_TOAST_MS),
        );
    };
    // A message that is already on screen is not stacked a second time.
    const show = (kind: ToastKind, message: string): number => {
        const { toasts } = store.getState();
        const shown = toasts.find((item) => item.kind === kind && item.message === message);
        const id = shown?.id ?? nextId++;
        if (!shown) store.setState({ toasts: [...toasts, { id, kind, message }] });
        if (kind === "info") expire(id);
        return id;
    };

    return {
        info: (message) => show("info", message),
        error: (message) => show("error", message),
        dismiss,
        store,
    };
}

/** The app's toast service: `toast.info("Saved")`, `toast.error("Import failed: …")`. */
export const toast = createToastService();
