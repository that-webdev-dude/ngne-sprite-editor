import type { NewSpriteRequest, SpritePropertiesRequest } from "../../app/sprite/dialogs";
import { commandDialog } from "../dialogs/registry";
import { NewSpriteDialog } from "./NewSpriteDialog";
import { SpritePropertiesDialog } from "./SpritePropertiesDialog";

/** The dialogs of New Sprite and Sprite Properties (SE-008), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<NewSpriteRequest>("new-sprite", "New sprite", NewSpriteDialog),
    commandDialog<SpritePropertiesRequest>(
        "sprite-properties",
        "Sprite properties",
        SpritePropertiesDialog,
    ),
];
