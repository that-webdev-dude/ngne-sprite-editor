import type { CommandRefreshSource } from "@ngne/editor-ui";
import { createCommandRunner } from "@ngne/editor-ui/commands";
import { createBottomRegionStore } from "@ngne/editor-ui/shell";

// State the editor UI instance takes from the app (`sources` and `refreshOn`, SPEC §5 of
// @ngne/editor-ui), created in a module that imports no instance: the modules the instance's
// maps load (command, dialog, dock, tool and overlay modules, and everything they import) reach
// it here, while `src/app/editorUi.ts` imports them first. The state contexts are
// `keymap/contextState.ts`'s and the tools `tools/toolRegistry.ts`'s, each beside the feature
// that owns them.

/** Whether the timeline, the bottom region, is shown; shown at startup (SE-022). */
export const bottomRegion = createBottomRegionStore();

/** Runs a command of the app by its id, as a button or a row of the interface does. */
export const commandRunner = createCommandRunner();

const refreshListeners = new Set<() => void>();

/**
 * Refreshes the app's commands (`refreshOn` of the instance): a feature whose commands'
 * `enabled` or `title` read state of its own calls `refresh()` when that state changes, so an
 * open menu follows it.
 */
export const commandRefresh: CommandRefreshSource & { refresh(): void } = {
    subscribe(listener) {
        refreshListeners.add(listener);
        return () => {
            refreshListeners.delete(listener);
        };
    },
    refresh() {
        for (const listener of [...refreshListeners]) listener();
    },
};
