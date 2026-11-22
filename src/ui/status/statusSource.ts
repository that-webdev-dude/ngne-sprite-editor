import type { StatusBarSource } from "@ngne/editor-ui/shell";
import { activeDocument, sessionsStore } from "../../app/state/sessions";
import { statusStore } from "../../app/state/status";
import { statusFields } from "./statusFields";
import type { StatusFields } from "./statusFields";

/**
 * What the status bar reads (DESIGN §5.7): the texts of the active document (or none) and the
 * transient status values, and the message at the right, feedback in the warning colour. The
 * fields themselves are `status.status.ts`.
 */
export const statusSource: StatusBarSource<StatusFields> = {
    read: () => statusFields(activeDocument(sessionsStore.getState()), statusStore.getState()),
    hint() {
        const { message, messageKind } = statusFields(null, statusStore.getState());
        return message ? { text: message, kind: messageKind } : null;
    },
    subscribe(listener) {
        const stopSessions = sessionsStore.subscribe(listener);
        const stopStatus = statusStore.subscribe(listener);
        return () => {
            stopSessions();
            stopStatus();
        };
    },
};
