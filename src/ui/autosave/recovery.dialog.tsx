import type { RecoveryRequest } from "../../app/autosave/dialogs";
import { commandDialog } from "@ngne/editor-ui/messages";
import { RecoveryDialog } from "./RecoveryDialog";

/** The recovery dialog shown on launch (SE-042), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<RecoveryRequest>("recovery", "Recovery", RecoveryDialog),
];
