import type { CommandSpec } from "../commands/types";
import { activeOnion, onionEdit, setOnionSettings } from "./onion";

// The onion skin commands (SPEC §7.5, §7.8; SE-025).
//
// View → Show/Hide Onion Skin, F3 (global), and the transport's toggle. It takes the View item
// planned for it. A menu item of the registry has no checked state, so the title says what
// choosing it does, as the grid toggles' do (REVIEW E37). A `view.` command: it leaves playback
// running (SPEC §7.5), and since `DocSettings` are not undoable it is enabled while a stroke or
// a floating selection is open.
//
// Apply Onion Skin Settings: what the settings popover runs for each change, with the change in
// `onionEdit` (`withOnionPatch`). Outside the menus and without a key, as the timeline's apply
// commands (REVIEW F8); enabled only while a change is handed to it.

/** The id of the toggle; the transport's button runs it. */
export const ONION_SKIN_COMMAND = "view.onionSkin";
/** The id of the command the settings popover runs. */
export const ONION_SETTINGS_COMMAND = "view.applyOnionSettings";

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
    {
        id: ONION_SETTINGS_COMMAND,
        title: "Apply Onion Skin Settings",
        enabled: () => onionEdit.getState().patch !== null && activeOnion() !== null,
        run: () => {
            const { patch } = onionEdit.getState();
            if (patch) setOnionSettings(patch);
        },
    },
];
