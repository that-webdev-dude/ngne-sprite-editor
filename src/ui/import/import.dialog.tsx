import type { DropChooserRequest, ImportRequest } from "../../app/import/importDialog";
import { commandDialog } from "../dialogs/registry";
import { DropChooser } from "./DropChooser";
import { ImportDialog } from "./ImportDialog";

/** The surfaces of Import PNG (SE-044), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<ImportRequest>("import-png", "Import PNG", ImportDialog),
    commandDialog<DropChooserRequest>("import-drop", "Drop chooser", DropChooser),
];
