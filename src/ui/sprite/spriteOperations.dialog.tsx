import type { CanvasSizeRequest, SpriteSizeRequest } from "../../app/sprite/dialogs";
import { commandDialog } from "../dialogs/registry";
import { CanvasSizeDialog } from "./CanvasSizeDialog";
import { SpriteSizeDialog } from "./SpriteSizeDialog";

/** The dialogs of Canvas Size and Sprite Size (SE-034), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<CanvasSizeRequest>("canvas-size", "Canvas size", CanvasSizeDialog),
    commandDialog<SpriteSizeRequest>("sprite-size", "Sprite size", SpriteSizeDialog),
];
