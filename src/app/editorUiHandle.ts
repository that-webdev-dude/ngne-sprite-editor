import type { AnyEditorUi } from "@ngne/editor-ui";
import { runCommand } from "@ngne/editor-ui/commands";

// The editor UI instance for the modules that `src/app/editorUi.ts` loads itself (command,
// dialog, dock, tool and overlay modules, and everything they import). They cannot import that
// module: it imports them first, through its module maps, so they would read the instance
// before it exists. They reach it here once `editorUi.ts` has bound it, after every module has
// loaded; until then a refresh does nothing and the other functions throw.

let bound: AnyEditorUi | null = null;

/** Binds the app's instance; `src/app/editorUi.ts` calls it once, right after creating it. */
export function bindEditorUi(editorUi: AnyEditorUi): void {
    bound = editorUi;
}

/** The app's editor UI instance; throws while `src/app/editorUi.ts` has not been loaded. */
export function boundEditorUi(): AnyEditorUi {
    if (!bound) throw new Error("The editor UI instance is not created yet (src/app/editorUi.ts).");
    return bound;
}

/** Tells the commands' readers that state read by `enabled` or `title` has changed. */
export function refreshAppCommands(): void {
    bound?.commands.refresh();
}

/** Runs the app command `id` (`runCommand` of the package with the app's registry). */
export function runAppCommand(id: string): boolean {
    return runCommand(boundEditorUi().commands, id);
}
