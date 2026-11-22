import type { ReplaceColourRequest } from "../../app/palette/replaceColour";
import { commandDialog } from "@ngne/editor-ui/messages";
import { ReplaceColourDialog } from "./ReplaceColourDialog";

/** The Replace colour dialog of SE-066, shown by the dialog host. */
export const commandDialogs = [
    commandDialog<ReplaceColourRequest>("replace-colour", "Replace colour", ReplaceColourDialog),
];
