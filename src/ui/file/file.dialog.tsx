import type { DiscardChangesRequest } from "../../app/file/dialogs";
import { commandDialog } from "../dialogs/registry";
import { DiscardChangesDialog } from "./DiscardChangesDialog";

/** The question of the file workflows (SE-041), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<DiscardChangesRequest>(
        "discard-changes",
        "Discard unsaved changes",
        DiscardChangesDialog,
    ),
];
