import { ChevronRight } from "lucide-react";
import { Menubar } from "radix-ui";
import { formatChord } from "../../app/commands/chord";
import { invokeCommand } from "../../app/commands/invoke";
import { buildMenu } from "../../app/commands/menuModel";
import type { MenuNode } from "../../app/commands/menuModel";
import { reportCommandError } from "../commands/runCommand";
import { useCommands } from "../commands/useCommands";
import { Icon } from "../primitives/Icon";

function Nodes({ nodes }: { nodes: readonly MenuNode[] }) {
    return nodes.map((node, index) => {
        if (node.kind === "separator") {
            return <Menubar.Separator key={`separator-${index}`} className="ui-menu__separator" />;
        }
        if (node.kind === "submenu") {
            return (
                <Menubar.Sub key={`submenu-${node.title}`}>
                    <Menubar.SubTrigger className="ui-menu__item" data-submenu={node.title}>
                        {node.title}
                        <span className="ui-menu__indicator">
                            <Icon icon={ChevronRight} />
                        </span>
                    </Menubar.SubTrigger>
                    <Menubar.Portal>
                        <Menubar.SubContent className="ui-menu" collisionPadding={8}>
                            <Nodes nodes={node.children} />
                        </Menubar.SubContent>
                    </Menubar.Portal>
                </Menubar.Sub>
            );
        }
        const { command } = node;
        const shortcut = command.shortcuts[0];
        return (
            <Menubar.Item
                key={command.id}
                className="ui-menu__item"
                data-command={command.id}
                disabled={!command.enabled()}
                onSelect={() => void invokeCommand(command, reportCommandError)}
            >
                {command.title()}
                {shortcut ? (
                    <span className="ui-menu__shortcut">{formatChord(shortcut)}</span>
                ) : null}
            </Menubar.Item>
        );
    });
}

/**
 * The items of one menu of the menu bar, generated from the command registry (DESIGN §4):
 * shortcut right-aligned and muted, disabled items visible. Rendered inside the open menu, so
 * titles and disabled states are read when the menu opens and follow the state while it is.
 */
export function MenubarItems({ menu }: { menu: string }) {
    return <Nodes nodes={buildMenu(useCommands(), [menu])} />;
}
