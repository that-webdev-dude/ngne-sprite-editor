import { useEffect } from "react";
import { appCommands } from "../../app/commands/appCommands";
import { installKeymap } from "../../app/keymap/install";
import { reportCommandError } from "./runCommand";

/** Connects the keyboard to the app's commands (SPEC §7.8) while `active` holds. */
export function useEditorKeymap(active: boolean): void {
    useEffect(() => {
        if (!active) return;
        return installKeymap({ registry: appCommands, onError: reportCommandError });
    }, [active]);
}
