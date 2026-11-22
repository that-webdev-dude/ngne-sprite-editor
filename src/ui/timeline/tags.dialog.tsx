import type { TagRequest } from "../../app/timeline/tagDialogs";
import { commandDialog } from "@ngne/editor-ui/messages";
import { TagDialog } from "./TagDialog";

/** The Tag dialog of New Tag… and Tag Properties… (SE-023), shown by the dialog host. */
export const commandDialogs = [commandDialog<TagRequest>("tag", "Tag", TagDialog)];
