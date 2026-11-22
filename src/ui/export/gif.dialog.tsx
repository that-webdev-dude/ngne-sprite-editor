import type { GifRequest } from "../../app/export/gifDialog";
import { commandDialog } from "@ngne/editor-ui/messages";
import { GifDialog } from "./GifDialog";

/** The dialog of Export GIF… (SE-063), shown by the dialog host. */
export const commandDialogs = [commandDialog<GifRequest>("export-gif", "Export GIF", GifDialog)];
