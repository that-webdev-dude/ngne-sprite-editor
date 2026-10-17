import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";

/**
 * The question of the file workflows (DESIGN §7: closing or replacing an unsaved document is
 * confirmed once). A workflow asks and waits for the answer; the dialog host shows the dialog
 * registered for the kind (ui/file/file.dialog.tsx) and answers.
 */

/** What would take the unsaved changes away. */
export type DiscardAction = "close" | "open" | "revert";

export interface DiscardChangesRequest {
    kind: "discard-changes";
    /** Name of the document whose unsaved changes are lost. */
    document: string;
    action: DiscardAction;
    /** The file that takes the document's place ("open") or is read again ("revert"). */
    file: string | null;
    /** True to go on and lose the changes, null to keep the document. Closes the dialog. */
    answer(discard: true | null): void;
}

export interface FileDialogs {
    /** The open request when it is a file dialog, otherwise null. */
    readonly store: DialogView<DiscardChangesRequest>;
    /** Attaches a host; until one is, every request is answered with null at once. */
    attachHost(): () => void;
    /** Asks whether to lose the unsaved changes; resolves true to go on. */
    confirmDiscard(
        options: Pick<DiscardChangesRequest, "document" | "action" | "file">,
    ): Promise<boolean>;
}

function isFileDialogRequest(request: DialogRequestBase): request is DiscardChangesRequest {
    return request.kind === "discard-changes";
}

/** The file dialogs over `requests`: by default requests of their own, for a test to host. */
export function createFileDialogs(requests: DialogRequests = createDialogRequests()): FileDialogs {
    return {
        store: dialogView(requests.store, isFileDialogRequest),
        attachHost: () => requests.attachHost(),
        async confirmDiscard(options) {
            const answer = await requests.open<true>((answer): DiscardChangesRequest => ({
                kind: "discard-changes",
                ...options,
                answer,
            }));
            return answer === true;
        },
    };
}

/** The file dialogs of the app, shown by the app's one dialog host. */
export const fileDialogs = createFileDialogs(commandDialogs);
