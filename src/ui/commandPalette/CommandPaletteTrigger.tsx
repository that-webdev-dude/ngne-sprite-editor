import { Search } from "lucide-react";
import { chordKey, chordModifiers } from "../../app/commands/chord";
import { Chord } from "../commands/Chord";
import { runCommand } from "../commands/runCommand";
import { useCommandValue } from "../commands/useCommands";
import { Icon } from "../primitives/Icon";
import "./commandPalette.css";

export const COMMAND_PALETTE_COMMAND = "edit.commandPalette";

/** A canonical chord in the notation of `aria-keyshortcuts`: "Control+K". */
function ariaKeyShortcut(chord: string): string {
    const { ctrl, alt, shift, meta } = chordModifiers(chord);
    const names = [ctrl && "Control", alt && "Alt", shift && "Shift", meta && "Meta"];
    return [...names.filter(Boolean), chordKey(chord)].join("+");
}

/**
 * The command palette trigger at the right of the menu bar (DESIGN §2). It runs the palette
 * command and shows that command's shortcut, both read from the registry.
 */
export function CommandPaletteTrigger() {
    // The values it shows, not the command: it renders only when one of them changes.
    const shortcut = useCommandValue(
        (registry) => registry.get(COMMAND_PALETTE_COMMAND)?.shortcuts[0],
    );
    const enabled = useCommandValue(
        (registry) => registry.get(COMMAND_PALETTE_COMMAND)?.enabled() ?? false,
    );
    return (
        <button
            type="button"
            className="command-palette-trigger"
            aria-keyshortcuts={shortcut ? ariaKeyShortcut(shortcut) : undefined}
            disabled={!enabled}
            onClick={() => runCommand(COMMAND_PALETTE_COMMAND)}
        >
            <Icon icon={Search} />
            Commands
            {shortcut ? (
                // The key is announced through `aria-keyshortcuts`.
                <span aria-hidden="true">
                    <Chord chord={shortcut} />
                </span>
            ) : null}
        </button>
    );
}
