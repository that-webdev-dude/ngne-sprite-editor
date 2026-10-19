import type {
    ExportDialogRequest,
    ExportOverwriteRequest,
    FramePngRequest,
} from "../../app/export/dialogs";
import { commandDialog } from "../dialogs/registry";
import { ExportDialog } from "./ExportDialog";
import { ExportOverwriteDialog } from "./ExportOverwriteDialog";
import { FramePngDialog } from "./FramePngDialog";

/** The dialogs of the export commands (SE-052), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<ExportDialogRequest>("export", "Export", ExportDialog),
    commandDialog<ExportOverwriteRequest>(
        "export-overwrite",
        "Replace files",
        ExportOverwriteDialog,
    ),
    commandDialog<FramePngRequest>("export-frame-png", "Export frame PNG", FramePngDialog),
];
