import { Menubar } from "radix-ui";
import { MENU_BAR } from "../../../app/commands/types";
import { CommandPaletteTrigger } from "../../commandPalette/CommandPaletteTrigger";
import { MenubarItems } from "../../menubar/MenubarItems";
import { DocumentName } from "../../sprite/DocumentName";
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
 * Menu bar content: the menus, the name of the active document in the centre (SE-008) and the
 * command palette trigger at the right (SE-064). The document tabs are added by SE-047.
 * The dialogs the menus open are shown by the dialog host at the root of the app (SE-034).
 */
export function MenuBar() {
    return (
        <>
            <Menus />
            <DocumentName />
            <CommandPaletteTrigger />
        </>
    );
}
