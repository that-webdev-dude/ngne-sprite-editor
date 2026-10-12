import { Menubar } from "radix-ui";
import { MENU_BAR } from "../../../app/commands/types";
import { MenubarItems } from "../../menubar/MenubarItems";
import "../../primitives/menu.css";
import "../../menubar/menubar.css";

/**
 * Menu bar content: the seven menus (DESIGN §2, §4), each generated from the command registry.
 * The document tabs (centre) and the command palette trigger (right) are added by SE-047 and
 * SE-064; the document name by SE-008.
 */
export function MenuBar() {
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
