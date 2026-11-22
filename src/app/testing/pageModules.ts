import { setTheme as setInstanceTheme } from "@ngne/editor-ui";
import type { Theme } from "@ngne/editor-ui";
import { editorUi } from "../editorUi";

// What tests reach by one module path: the end-to-end specs import it in the page
// (`/src/app/testing/pageModules.ts`) and the unit tests from `src`. The editor UI instance's
// registries and services, under the names the app's own modules gave them before they moved
// to @ngne/editor-ui, and the package exports the specs call in the page, which the page cannot
// import by a package name.

export {
    appCommands,
    commandModulePaths,
    KEY_CONTEXTS,
    MENU_BAR,
    TIMELINE_SELECTOR,
} from "../editorUi";
export { applicableContexts, buildContextMenu, readKeyEnvironment } from "@ngne/editor-ui/commands";
export { commandDialogs, toast } from "@ngne/editor-ui/messages";
export { STORAGE_WRITE_FAILED_MESSAGE } from "@ngne/editor-ui/platform";
export { UPDATE_MESSAGE } from "@ngne/editor-ui/pwa";

/** The overlay layers of `*.overlay.ts(x)`, in draw order. */
export const overlayLayers = editorUi.overlayLayers;

/** The dock panels of `*.dock.tsx`, in dock order. */
export const dockPanels = editorUi.dockPanels;

/** The dialogs of `*.dialog.tsx` and the package's, by request kind. */
export const registeredDialogs = editorUi.dialogs;

/** The surfaces: the command palette, the shortcut sheet, About and Preferences. */
export const surfaces = editorUi.surfaces;

/** Every surface id. */
export const SURFACE_IDS = editorUi.surfaces.ids;

/** Sets and stores the theme, as the Preferences dialog does. */
export function setTheme(theme: Theme): void {
    setInstanceTheme(editorUi, theme);
}
