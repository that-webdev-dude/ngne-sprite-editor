import { Search } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useStore } from "zustand";
import { paletteEntries, runPaletteCommand } from "../../app/commandPalette/paletteModel";
import type { PaletteEntry } from "../../app/commandPalette/paletteModel";
import { recentCommands } from "../../app/commandPalette/recentCommands";
import { formatChord } from "../../app/commands/chord";
import type { Command } from "../../app/commands/types";
import { surfaces } from "../../app/surfaces/surfaces";
import { reportCommandError } from "../commands/runCommand";
import { useCommands } from "../commands/useCommands";
import { cx } from "../primitives/cx";
import { Icon } from "../primitives/Icon";
import "../primitives/dialog.css";
import "./commandPalette.css";

const close = () => surfaces.close("command-palette");

/**
 * Command palette (DESIGN §4): a search field over every command of the registry, with its
 * menu, its shortcut and its disabled state. Arrow keys move through the list, Enter or a
 * click runs the command; a disabled command stays listed and does nothing.
 *
 * A modal dialog holding a combobox whose list is always open. The chosen command runs after
 * the palette has closed and focus is back where it was, as if its key had been pressed there:
 * a dialog the command opens then returns focus to that place too.
 */
export function CommandPalette() {
    const commands = useCommands();
    const recent = useStore(recentCommands, (state) => state.ids);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const listId = useId();
    const list = useRef<HTMLDivElement | null>(null);
    const opener = useRef<HTMLElement | null>(null);
    const chosen = useRef<Command | null>(null);

    const entries = paletteEntries(commands, recent, query);
    // The list can get shorter under the active row when a command is removed.
    const current = Math.min(active, entries.length - 1);
    const optionId = (entry: PaletteEntry) => `${listId}-${entry.command.id}`;
    const activeEntry = entries[current];

    useEffect(() => {
        list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }, [current, query]);

    const choose = (entry: PaletteEntry | undefined) => {
        if (!entry?.command.enabled()) return;
        chosen.current = entry.command;
        close();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (entries.length === 0) return;
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((current + step + entries.length) % entries.length);
        } else if (event.key === "Enter") {
            event.preventDefault();
            choose(activeEntry);
        }
    };

    return (
        <RadixDialog.Root
            open
            onOpenChange={(open) => {
                if (!open) close();
            }}
        >
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="ui-dialog__overlay" />
                <RadixDialog.Content
                    className="command-palette"
                    aria-describedby={undefined}
                    onOpenAutoFocus={() => {
                        const focused = document.activeElement;
                        opener.current = focused instanceof HTMLElement ? focused : null;
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        if (opener.current?.isConnected) opener.current.focus();
                        opener.current = null;
                        const command = chosen.current;
                        chosen.current = null;
                        if (command) runPaletteCommand(command, reportCommandError);
                    }}
                >
                    <RadixDialog.Title className="ui-visually-hidden">
                        Command palette
                    </RadixDialog.Title>
                    <div className="command-palette__search">
                        <Icon icon={Search} />
                        <input
                            className="command-palette__input"
                            type="text"
                            role="combobox"
                            aria-label="Search commands"
                            aria-autocomplete="list"
                            aria-expanded={entries.length > 0}
                            aria-controls={entries.length > 0 ? listId : undefined}
                            aria-activedescendant={activeEntry ? optionId(activeEntry) : undefined}
                            placeholder="Search commands"
                            autoComplete="off"
                            spellCheck={false}
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setActive(0);
                            }}
                            onKeyDown={onKeyDown}
                        />
                    </div>
                    {entries.length > 0 ? (
                        <div
                            ref={list}
                            id={listId}
                            className="command-palette__list"
                            role="listbox"
                            aria-label="Commands"
                            // A press on a row must not take focus from the search field.
                            onMouseDown={(event) => event.preventDefault()}
                        >
                            {entries.map((entry, index) => {
                                const { command } = entry;
                                const shortcut = command.shortcuts[0];
                                const enabled = command.enabled();
                                return (
                                    <div
                                        key={command.id}
                                        id={optionId(entry)}
                                        className={cx(
                                            "command-palette__option",
                                            !enabled && "command-palette__option--disabled",
                                        )}
                                        role="option"
                                        aria-selected={index === current}
                                        aria-disabled={!enabled || undefined}
                                        data-command={command.id}
                                        onPointerMove={() => {
                                            if (index !== current) setActive(index);
                                        }}
                                        onClick={() => choose(entry)}
                                    >
                                        <span className="command-palette__title">
                                            {entry.title}
                                        </span>
                                        {entry.group ? (
                                            <span className="command-palette__group">
                                                {entry.group}
                                            </span>
                                        ) : null}
                                        {shortcut ? (
                                            <span className="command-palette__shortcut">
                                                {formatChord(shortcut)}
                                            </span>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}
                    <p className="command-palette__empty" role="status">
                        {entries.length === 0 ? "No matching commands" : null}
                    </p>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
