import type { DiscardChangesRequest } from "../../app/file/dialogs";
import { commandDialog } from "@ngne/editor-ui/messages";
import { DiscardChangesDialog } from "@ngne/editor-ui/messages";

/** The question of the file workflows (SE-041), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<DiscardChangesRequest>(
        "discard-changes",
        "Discard unsaved changes",
        DiscardChangesDialog,
    ),
];
