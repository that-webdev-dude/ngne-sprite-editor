import type { PixelBuffer } from "../../core/model";
import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";

/**
 * The recovery dialog of DESIGN §7: shown on launch when snapshots of documents with unsaved
 * changes are left (SE-042). It lists them (name, time, thumbnail), each with Recover and
 * Discard; the dialog host shows it (ui/autosave/recovery.dialog.tsx). The work is done by the
 * request's functions, never by the dialog: Recover opens the document, Discard removes the
 * snapshot permanently. Closing the dialog keeps the snapshots left for the next launch.
 */

/** One snapshot as the dialog lists it. */
export interface RecoveryEntry {
    readonly key: string;
    readonly name: string;
    /** When it was written, in milliseconds since the epoch. */
    readonly savedAt: number;
    readonly thumbnail: PixelBuffer;
}

export interface RecoveryRequest {
    kind: "recovery";
    /** Newest first. */
    entries: readonly RecoveryEntry[];
    /** Opens the snapshot's document; resolves true when its row goes (`Recovery.recover`). */
    recover(key: string): Promise<boolean>;
    /** Removes the snapshot permanently; resolves true when its row goes (`Recovery.discard`). */
    discard(key: string): Promise<boolean>;
    /** Closes the dialog. */
    answer(values: null): void;
}

export interface RecoveryDialogs {
    readonly store: DialogView<RecoveryRequest>;
    /** Whether a dialog host shows the requests; until one does, a request is answered at once. */
    readonly hosted: boolean;
    attachHost(): () => void;
    /**
     * Shows the dialog and returns a promise that resolves when it closes; null when it cannot
     * be shown (another dialog is open, or no host).
     */
    show(options: Pick<RecoveryRequest, "entries" | "recover" | "discard">): Promise<void> | null;
    /** Resolves once no dialog is open (at once when none is). */
    free(): Promise<void>;
}

function isRecoveryRequest(request: DialogRequestBase): request is RecoveryRequest {
    return request.kind === "recovery";
}

export function createRecoveryDialogs(
    requests: DialogRequests = createDialogRequests(),
): RecoveryDialogs {
    return {
        store: dialogView(requests.store, isRecoveryRequest),
        get hosted() {
            return requests.hosted;
        },
        attachHost: () => requests.attachHost(),
        show(options) {
            if (!requests.hosted || requests.store.getState().request) return null;
            return requests
                .open<never>((answer): RecoveryRequest => ({
                    kind: "recovery",
                    ...options,
                    answer: () => answer(null),
                }))
                .then(() => {});
        },
        free() {
            if (!requests.store.getState().request) return Promise.resolve();
            return new Promise((resolve) => {
                const stop = requests.store.subscribe(({ request }) => {
                    if (request) return;
                    stop();
                    resolve();
                });
            });
        },
    };
}

/** The recovery dialog of the app, shown by the app's one dialog host. */
export const recoveryDialogs = createRecoveryDialogs(commandDialogs);
