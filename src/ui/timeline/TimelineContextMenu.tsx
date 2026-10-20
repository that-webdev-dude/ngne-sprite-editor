import { ContextMenu as RadixContextMenu } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactElement } from "react";
import { formatChord } from "../../app/commands/chord";
import { invokeCommand } from "../../app/commands/invoke";
import { buildContextMenu } from "../../app/commands/menuModel";
import { closeContextTarget, menuOf, openContextTarget } from "../../app/timeline/contextTarget";
import type { ContextTarget } from "../../app/timeline/contextTarget";
import { TIMELINE_MENUS } from "../../app/timeline/timelineEditIds";
import type { TimelineMenu } from "../../app/timeline/timelineEditIds";
import { reportCommandError } from "../commands/runCommand";
import { useCommands } from "../commands/useCommands";
import { CELL_ATTRIBUTE } from "./timelineDom";
import "../primitives/menu.css";

// The timeline's context menus (SE-026; DESIGN §4): a right-click on a layer row, a frame
// number, a cel or a tag span opens the menu of that kind, generated from the command registry
// (the commands that list it in `contextMenus`). The Menu key and Shift+F10 open the menu of the
// focused cell. The target is selected first (`openContextTarget`).
//
// Chrome sends a right press's `contextmenu` at the press on Linux and macOS, and at the release
// on Windows, to the element under the pointer then. So the target is the one the right button
// was pressed on, wherever it is released; a release outside the timeline opens no menu there.

/** The accessible names of the menus. */
const MENU_NAMES: Record<TimelineMenu, string> = {
    [TIMELINE_MENUS.layer]: "Layer",
    [TIMELINE_MENUS.frame]: "Frame",
    [TIMELINE_MENUS.cel]: "Cel",
    [TIMELINE_MENUS.tag]: "Tag",
};

/** What the element (or one of its ancestors in the timeline) is a context target of. */
export function contextTargetOf(element: Element | null): ContextTarget | null {
    if (!element) return null;
    const tag = element.closest<HTMLElement>("[data-tag]");
    if (tag?.dataset.tag) return { kind: "tag", tagId: tag.dataset.tag };
    const row = element.closest<HTMLElement>('[role="row"][data-layer]');
    const layerId = row?.dataset.layer;
    const cell = element.closest<HTMLElement>(`[${CELL_ATTRIBUTE}]`);
    if (cell && layerId) {
        // A reference layer's one cell stands for its layer (SE-045).
        if (row.hasAttribute("data-reference-layer")) return { kind: "layer", layerId };
        const frameId = cell.dataset.frame;
        return frameId ? { kind: "cel", cel: { layerId, frameId } } : null;
    }
    if (layerId && element.closest("[data-layer-header]")) return { kind: "layer", layerId };
    const frame = element.closest<HTMLElement>(".timeline__frame");
    if (frame?.dataset.frame) return { kind: "frame", frameId: frame.dataset.frame };
    return null;
}

/** The items of a menu, as the registry has them while it is open. */
function MenuItems({ menu }: { menu: TimelineMenu }) {
    const commands = useCommands();
    return buildContextMenu(commands, menu).map((node, index) => {
        if (node.kind === "separator") {
            return (
                <RadixContextMenu.Separator
                    key={`separator-${index}`}
                    className="ui-menu__separator"
                />
            );
        }
        if (node.kind !== "command") return null;
        const { command } = node;
        const shortcut = command.shortcuts[0];
        return (
            <RadixContextMenu.Item
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
            </RadixContextMenu.Item>
        );
    });
}

export interface TimelineContextMenuProps {
    /** The panel's scroller: the right-click target. */
    children: ReactElement;
    /** The panel's element, which a right press must start in. */
    panel: { readonly current: HTMLElement | null };
    /** Gives the focus to the active cell. */
    focusActive(): void;
}

export function TimelineContextMenu({ children, panel, focusActive }: TimelineContextMenuProps) {
    const [menu, setMenu] = useState<TimelineMenu | null>(null);
    /** The target of the right press being handled, until its `contextmenu` arrives. */
    const pressed = useRef<ContextTarget | null>(null);

    useEffect(() => {
        const onPress = (event: PointerEvent) => {
            const element = panel.current;
            const inside =
                element !== null && event.target instanceof Node && element.contains(event.target);
            pressed.current =
                event.button === 2 && inside && event.target instanceof Element
                    ? contextTargetOf(event.target)
                    : null;
        };
        // The menu of a right press released outside the timeline (Windows) is not opened
        // there: the press was in the timeline.
        const onMenu = (event: MouseEvent) => {
            if (!pressed.current) return;
            const element = panel.current;
            if (element && event.target instanceof Node && element.contains(event.target)) return;
            pressed.current = null;
            event.preventDefault();
        };
        // A menu asked for from the keyboard is the focused cell's.
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
                pressed.current = null;
            }
        };
        window.addEventListener("pointerdown", onPress, true);
        window.addEventListener("contextmenu", onMenu, true);
        window.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("pointerdown", onPress, true);
            window.removeEventListener("contextmenu", onMenu, true);
            window.removeEventListener("keydown", onKey, true);
        };
    }, [panel]);

    const onContextMenu = (event: ReactMouseEvent) => {
        const target =
            pressed.current ??
            contextTargetOf(event.target instanceof Element ? event.target : null);
        pressed.current = null;
        // Nothing to open a menu on, or nothing can be done now (a stroke): neither this menu
        // nor the browser's.
        if (!target || !openContextTarget(target)) {
            event.preventDefault();
            return;
        }
        setMenu(menuOf(target));
    };

    return (
        <RadixContextMenu.Root
            onOpenChange={(open) => {
                if (!open) closeContextTarget();
            }}
        >
            <RadixContextMenu.Trigger asChild onContextMenu={onContextMenu}>
                {children}
            </RadixContextMenu.Trigger>
            <RadixContextMenu.Portal>
                <RadixContextMenu.Content
                    className="ui-menu"
                    collisionPadding={8}
                    aria-label={menu ? MENU_NAMES[menu] : undefined}
                    data-timeline-menu={menu ?? undefined}
                    // The Menu key's own context menu event arrives here on Windows.
                    onContextMenu={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => {
                        // An item may have opened a field, a popover or a dialog, which takes
                        // the focus; otherwise it goes to the active cell.
                        event.preventDefault();
                        requestAnimationFrame(() => {
                            const focused = document.activeElement;
                            if (!focused || focused === document.body) focusActive();
                        });
                    }}
                >
                    {menu ? <MenuItems menu={menu} /> : null}
                </RadixContextMenu.Content>
            </RadixContextMenu.Portal>
        </RadixContextMenu.Root>
    );
}
