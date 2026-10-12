import type { Command } from "./types";

/** One entry of a generated menu. */
export type MenuNode =
    | { kind: "command"; command: Command }
    | { kind: "submenu"; title: string; children: MenuNode[] }
    | { kind: "separator" };

interface Placed {
    order: number;
    /** Breaks ties between equal orders, so the result does not depend on module order. */
    key: string;
    node: MenuNode;
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
    return prefix.every((name, index) => path[index] === name);
}

/** Sorts by order and puts a separator between items whose orders differ in the hundreds. */
function arrange(placed: Placed[]): MenuNode[] {
    placed.sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const nodes: MenuNode[] = [];
    let group: number | null = null;
    for (const { order, node } of placed) {
        const next = Math.floor(order / 100);
        if (group !== null && next !== group) nodes.push({ kind: "separator" });
        group = next;
        nodes.push(node);
    }
    return nodes;
}

/**
 * The menu at `path` of the menu bar, generated from the commands: `["Edit"]` is the Edit
 * menu, `["File", "Open Recent"]` a submenu. A submenu sits at the position of its first item.
 */
export function buildMenu(commands: readonly Command[], path: readonly string[]): MenuNode[] {
    const placed: Placed[] = [];
    const submenus = new Map<string, number>();
    for (const command of commands) {
        const menuPath = command.menuPath;
        if (!menuPath || !startsWith(menuPath, path)) continue;
        if (menuPath.length === path.length) {
            placed.push({
                order: command.menuOrder,
                key: command.id,
                node: { kind: "command", command },
            });
        } else {
            const title = menuPath[path.length] ?? "";
            submenus.set(title, Math.min(submenus.get(title) ?? Infinity, command.menuOrder));
        }
    }
    for (const [title, order] of submenus) {
        const children = buildMenu(commands, [...path, title]);
        placed.push({ order, key: title, node: { kind: "submenu", title, children } });
    }
    return arrange(placed);
}

/** The context menu named `menu`, generated from the commands that list it. */
export function buildContextMenu(commands: readonly Command[], menu: string): MenuNode[] {
    const placed: Placed[] = [];
    for (const command of commands) {
        const placement = command.contextMenus.find((entry) => entry.menu === menu);
        if (!placement) continue;
        placed.push({
            order: placement.order,
            key: command.id,
            node: { kind: "command", command },
        });
    }
    return arrange(placed);
}

/** The commands of a menu and of its submenus, in menu order. */
export function menuCommands(nodes: readonly MenuNode[]): Command[] {
    return nodes.flatMap((node) =>
        node.kind === "command"
            ? [node.command]
            : node.kind === "submenu"
              ? menuCommands(node.children)
              : [],
    );
}
