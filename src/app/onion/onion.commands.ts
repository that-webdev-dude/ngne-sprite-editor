import type { CommandSpec } from "../commands/types";
import { activeOnion, setOnionSettings } from "./onion";

// The onion skin toggle (SPEC §7.5, §7.8; SE-025): View → Show/Hide Onion Skin, F3 (global),
// and the transport's toggle. It takes the View item planned for it. A menu item of the
// registry has no checked state, so the title says what choosing it does, as the grid toggles'
// do (REVIEW E37). A `view.` command: it leaves playback running (SPEC §7.5), and since
// `DocSettings` are not undoable it is enabled while a stroke or a floating selection is open.

/** The id of the toggle; the transport's button runs it. */
export const ONION_SKIN_COMMAND = "view.onionSkin";

export const commands: CommandSpec[] = [
    {
        id: ONION_SKIN_COMMAND,
        title: () => (activeOnion()?.enabled ? "Hide Onion Skin" : "Show Onion Skin"),
        shortcut: "F3",
        enabled: () => activeOnion() !== null,
        run: () => {
            const onion = activeOnion();
            if (onion) setOnionSettings({ enabled: !onion.enabled });
        },
    },
];
