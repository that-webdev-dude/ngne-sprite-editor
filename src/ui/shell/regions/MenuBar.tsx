import { Menubar } from "radix-ui";
import { MENU_BAR } from "../../../app/commands/types";
import { MenubarItems } from "../../menubar/MenubarItems";
import { DocumentName } from "../../sprite/DocumentName";
import { SpriteDialogs } from "../../sprite/SpriteDialogs";
import "../../primitives/menu.css";
import "../../menubar/menubar.css";

/** The seven menus (DESIGN §2, §4), each generated from the command registry. */
function Menus() {
    return (
        <Menubar.Root className="menubar" aria-label="Main menu" loop>
            {MENU_BAR.map((menu) => (
                <Menubar.Menu key={menu} value={menu}>
                    <Menubar.Trigger className="menubar__trigger">{menu}</Menubar.Trigger>
                    <Menubar.Portal>
                        <Menubar.Content
                            className="ui-menu"
                            align="start"
                            sideOffset={6}
                            collisionPadding={8}
                        >
                            <MenubarItems menu={menu} />
                        </Menubar.Content>
                    </Menubar.Portal>
                </Menubar.Menu>
            ))}
        </Menubar.Root>
    );
}

/**
 * Menu bar content: the menus, then the name of the active document in the centre (SE-008).
 * The document tabs and the command palette trigger (right) are added by SE-047 and SE-064.
 * The dialogs of the sprite commands are mounted here, next to the menus that open them.
 */
export function MenuBar() {
    return (
        <>
            <Menus />
            <DocumentName />
            <SpriteDialogs />
        </>
    );
}
