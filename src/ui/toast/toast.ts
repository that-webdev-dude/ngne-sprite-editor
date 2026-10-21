import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

/**
 * Toast service (DESIGN §4): reports the result of an explicit command and asynchronous
 * failures. Usable from any layer of the interface, inside or outside React; `ToastViewport`
 * renders the queue.
 */
export type ToastKind = "info" | "error";

/** A button on a toast (SE-072: Reload on the update toast); running it dismisses the toast. */
export interface ToastAction {
    label: string;
    run(): void;
}

export interface ToastItem {
    id: number;
    kind: ToastKind;
    message: string;
    action?: ToastAction;
}

export interface ToastOptions {
    /**
     * A button beside the message. An information toast with an action stays until it is
     * dismissed or its action runs, so the action does not vanish while the user reaches it.
     */
    action?: ToastAction;
}

export interface ToastState {
    toasts: readonly ToastItem[];
}

export interface ToastService {
    /** Shown for 4 s, or until dismissed when it has an action. Returns the toast id. */
    info(message: string, options?: ToastOptions): number;
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
    const show = (kind: ToastKind, message: string, options: ToastOptions = {}): number => {
        const { toasts } = store.getState();
        const shown = toasts.find((item) => item.kind === kind && item.message === message);
        const id = shown?.id ?? nextId++;
        const { action } = options;
        if (!shown) {
            store.setState({
                toasts: [...toasts, { id, kind, message, ...(action && { action }) }],
            });
        }
        if (kind === "info" && !action && !shown?.action) expire(id);
        return id;
    };

    return {
        info: (message, options) => show("info", message, options),
        error: (message) => show("error", message),
        dismiss,
        store,
    };
}

/** The app's toast service: `toast.info("Saved")`, `toast.error("Import failed: …")`. */
export const toast = createToastService();
