import type { DocSettings } from "../../core/model";
import type { CommandSpec } from "../commands/types";
import { activeDocument, sessionsStore } from "../state/sessions";

// The grid toggles of the View menu (SE-013), bound to `DocSettings.grid.visible` and
// `DocSettings.pixelGrid` of the active document. They take the items planned for them
// (commands/planned.commands.ts). `DocSettings` are view preferences: a toggle makes no
// history entry and leaves the document clean (SPEC §5.2). The overlay follows the settings
// (grid.overlay.ts).
//
// A menu item of the registry has no checked state, so each title says what choosing it does
// ("Show Grid", "Hide Grid"); the registry's subscription to the session store keeps an open
// menu and the command palette in step.

function activeSettings(): DocSettings | null {
    return activeDocument(sessionsStore.getState())?.session.doc.settings ?? null;
}

function hasDocument(): boolean {
    return activeSettings() !== null;
}

function updateActive(update: (settings: DocSettings) => void): void {
    const state = sessionsStore.getState();
    if (state.activeId !== null) state.updateDocSettings(state.activeId, update);
}

export const commands: CommandSpec[] = [
    {
        id: "view.grid",
        title: () => (activeSettings()?.grid.visible ? "Hide Grid" : "Show Grid"),
        enabled: hasDocument,
        run: () =>
            updateActive((settings) => {
                settings.grid.visible = !settings.grid.visible;
            }),
    },
    {
        id: "view.pixelGrid",
        title: () => (activeSettings()?.pixelGrid ? "Hide Pixel Grid" : "Show Pixel Grid"),
        enabled: hasDocument,
        run: () =>
            updateActive((settings) => {
                settings.pixelGrid = !settings.pixelGrid;
            }),
    },
];
