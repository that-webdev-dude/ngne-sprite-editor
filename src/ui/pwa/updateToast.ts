import type { AppUpdates } from "../../app/pwa/updates";
import { toast } from "../toast/toast";
import type { ToastService } from "../toast/toast";

/** The update toast's message (SE-072). */
export const UPDATE_MESSAGE = "A new version of the editor is ready.";

/**
 * Shows the update toast whenever a new version becomes ready (SE-072): an information toast
 * with Reload, which stays until the user reloads or dismisses it. Dismissed, it comes back
 * with the next page (the new version still waits). Returns the function that stops it.
 */
export function showUpdateToast(updates: AppUpdates, service: ToastService = toast): () => void {
    const offer = () => {
        service.info(UPDATE_MESSAGE, { action: { label: "Reload", run: () => updates.apply() } });
    };
    if (updates.store.getState().ready) offer();
    return updates.store.subscribe((state, previous) => {
        if (state.ready && !previous.ready) offer();
    });
}
