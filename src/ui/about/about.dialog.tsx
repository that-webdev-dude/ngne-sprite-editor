import type { AboutRequest } from "../../app/about/openAbout";
import { commandDialog } from "../dialogs/registry";
import { AboutDialog } from "./AboutDialog";

/** The dialog of About NGNE Sprite Editor…, shown by the dialog host. */
export const commandDialogs = [commandDialog<AboutRequest>("about", "About", AboutDialog)];
