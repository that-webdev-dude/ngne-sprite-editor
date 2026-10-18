import type { StoreApi } from "zustand/vanilla";
import { statusStore } from "../state/status";
import type { StatusState } from "../state/status";
import { FEEDBACK_MS } from "../tools/pipeline";

// Transient status-bar feedback of the selection's commands (DESIGN §5.7, in `--warn`): why a
// lift, a paste or an edit was refused, and what the clipboard could not do (SE-032). As the
// tools' feedback (SPEC §7.1), it clears after a while, and never clears a message set by
// someone else.

/** Shows `message` as feedback; it goes after `FEEDBACK_MS` if it is still there. */
export type Feedback = (message: string) => void;

export function createFeedback(
    status: StoreApi<StatusState>,
    later: (callback: () => void, ms: number) => () => void,
): Feedback {
    let shown: string | null = null;
    let cancel: (() => void) | null = null;
    return (message) => {
        cancel?.();
        shown = message;
        status.getState().setFeedback(message);
        cancel = later(() => {
            cancel = null;
            if (shown !== null && status.getState().feedback === shown) {
                status.getState().setFeedback(null);
            }
            shown = null;
        }, FEEDBACK_MS);
    };
}

/** The feedback of the app's status bar. */
export const selectionFeedback: Feedback = createFeedback(statusStore, (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
});
