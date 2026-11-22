import { ChevronDown, Ellipsis, Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRef } from "react";
import { useStore } from "zustand";
import { formatChord } from "@ngne/editor-ui/commands";
import { invokeCommand } from "@ngne/editor-ui/commands";
import { buildContextMenu } from "@ngne/editor-ui/commands";
import type { MenuNode } from "@ngne/editor-ui/commands";
import type { Command } from "@ngne/editor-ui/commands";
import {
    ADD_COLOUR,
    PALETTE_MENU,
    PRESET_MENU,
    presetOfCommand,
} from "../../app/palette/paletteCommandIds";
import { currentSwatch, paletteStore } from "../../app/palette/paletteState";
import { activeDocument, sessionsStore } from "../../app/state/sessions";
import { reportCommandError } from "@ngne/editor-ui/commands";
import { runAppCommand } from "../../app/editorUiHandle";
import { useCommandValue, useCommands } from "@ngne/editor-ui/commands";
import { Icon } from "@ngne/editor-ui/primitives";
import { IconButton } from "@ngne/editor-ui/primitives";
import { Tooltip } from "@ngne/editor-ui/primitives";
import { SwatchEditor } from "./SwatchEditor";
import {
    closePaletteMenu,
    openPaletteMenu,
    paletteMenuStore,
    swatchElement,
    useActivePalette,
} from "./paletteUi";
import "./paletteHeader.css";

// The header of the palette section (DESIGN §5.4, SE-060), right of its title: the palette's
// name, which opens the menu of presets; the button that adds the current colour; and the
// overflow menu of the swatch actions, which a focused swatch also opens with the Menu key.
// Both menus are generated from the commands that list them (`app/palette`), so a later
// ticket adds an item without an edit here. The swatch editor popover lives here too, so it
// opens whether or not the section is expanded.

/**
 * Each node of a menu with a stable key: a command's id; a separator, which always follows an
 * item (`buildContextMenu`), the key of that item.
 */
function keyed(nodes: readonly MenuNode[]): [string, MenuNode][] {
    const result: [string, MenuNode][] = [];
    let previous = "";
    for (const node of nodes) {
        if (node.kind === "command") previous = node.command.id;
        else if (node.kind === "submenu") previous = `submenu-${node.title}`;
        result.push([node.kind === "separator" ? `separator-after-${previous}` : previous, node]);
    }
    return result;
}

/**
 * The items of the generated menu `menu`; `label` gives an item a text other than its title.
 * Rendered only while the menu is open, and then again at each change of the commands.
 */
function MenuItems({
    menu,
    label = (command) => command.title(),
}: {
    menu: string;
    label?(command: Command): string;
}) {
    return keyed(buildContextMenu(useCommands(), menu)).map(([key, node]) => {
        if (node.kind === "separator") {
            return <DropdownMenu.Separator key={key} className="ui-menu__separator" />;
        }
        if (node.kind !== "command") return null;
        const { command } = node;
        const shortcut = command.shortcuts[0];
        return (
            <DropdownMenu.Item
                key={command.id}
                className="ui-menu__item"
                data-command={command.id}
                disabled={!command.enabled()}
                onSelect={() => {
                    invokeCommand(command, reportCommandError);
                }}
            >
                {label(command)}
                {shortcut ? (
                    <span className="ui-menu__shortcut">{formatChord(shortcut)}</span>
                ) : null}
            </DropdownMenu.Item>
        );
    });
}

/** The number of colours of the active document's palette. */
function paletteSize(): number {
    return activeDocument(sessionsStore.getState())?.session.doc.palette.colors.length ?? 0;
}

export function PaletteHeader() {
    const palette = useActivePalette();
    // Only what the header itself shows: it renders again when that changes, not at every
    // change of the commands (the open menus follow those themselves).
    const canAdd = useCommandValue((registry) => registry.get(ADD_COLOUR)?.enabled() ?? false);
    const menu = useStore(paletteMenuStore);
    const overflow = useRef<HTMLButtonElement>(null);
    if (!palette) return null;

    return (
        <span className="palette-header" data-palette-header="">
            <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                    <button
                        type="button"
                        className="palette-header__presets"
                        aria-label={`Presets (${palette.name})`}
                        title={palette.name}
                    >
                        <span className="palette-header__name">{palette.name}</span>
                        <Icon icon={ChevronDown} />
                    </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.Content
                        className="ui-menu"
                        align="end"
                        sideOffset={4}
                        collisionPadding={8}
                        onContextMenu={(event) => event.preventDefault()}
                    >
                        <MenuItems
                            menu={PRESET_MENU}
                            label={(command) =>
                                presetOfCommand(command.id)?.name ?? command.title()
                            }
                        />
                    </DropdownMenu.Content>
                </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <IconButton
                label="Add current colour"
                disabled={!canAdd}
                data-palette-add=""
                onClick={() => runAppCommand(ADD_COLOUR)}
            >
                <Icon icon={Plus} />
            </IconButton>
            <DropdownMenu.Root
                open={menu.open}
                onOpenChange={(open) => (open ? openPaletteMenu(null) : closePaletteMenu())}
            >
                <Tooltip label="Swatch actions">
                    <DropdownMenu.Trigger asChild>
                        <button
                            ref={overflow}
                            type="button"
                            className="ui-icon-button"
                            aria-label="Swatch actions"
                        >
                            <Icon icon={Ellipsis} />
                        </button>
                    </DropdownMenu.Trigger>
                </Tooltip>
                <DropdownMenu.Portal>
                    <DropdownMenu.Content
                        className="ui-menu"
                        align="end"
                        sideOffset={4}
                        collisionPadding={8}
                        // The Menu key's own context menu event arrives here on Windows.
                        onContextMenu={(event) => event.preventDefault()}
                        onCloseAutoFocus={(event) => {
                            // The swatch editor an item opened keeps the focus.
                            if (paletteStore.getState().edit) {
                                event.preventDefault();
                                return;
                            }
                            // Opened from a swatch: the focus goes back to the grid.
                            if (paletteMenuStore.getState().from === null) return;
                            event.preventDefault();
                            const swatch = swatchElement(currentSwatch(paletteSize()));
                            (swatch ?? overflow.current)?.focus();
                        }}
                    >
                        <MenuItems menu={PALETTE_MENU} />
                    </DropdownMenu.Content>
                </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <SwatchEditor fallback={overflow} />
        </span>
    );
}
