import { useEffect } from "react";
import { spriteDialogs, useSpriteDialogRequest } from "../../app/sprite/dialogs";
import { focusMenuOpener } from "../focus/menuOpener";
import { NewSpriteDialog } from "./NewSpriteDialog";
import { SpritePropertiesDialog } from "./SpritePropertiesDialog";

/**
 * Shows the dialog a sprite command has asked for (app/sprite/dialogs.ts): New sprite or
 * Sprite properties. Each request mounts a new dialog, so its fields start from the request.
 */
export function SpriteDialogs() {
    const request = useSpriteDialogRequest();
    // A request made from a menu item arrives while that menu is still open. The listener runs
    // in the same call, before the dialog exists, so the dialog's opener is the menu's control.
    useEffect(
        () =>
            spriteDialogs.store.subscribe((state, previous) => {
                if (state.request && !previous.request) focusMenuOpener();
            }),
        [],
    );
    if (!request) return null;
    return request.kind === "new-sprite" ? (
        <NewSpriteDialog request={request} />
    ) : (
        <SpritePropertiesDialog request={request} />
    );
}
