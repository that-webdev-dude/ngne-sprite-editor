// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";
import { keyContextStore } from "../keymap/contextState";
import { editorStore } from "../state/editor";
import { sessionsStore } from "../state/sessions";
import { createCommandRegistry, registerCommandModules } from "./registry";
import type { CommandRegistry } from "./registry";
import type { CommandModule } from "./types";

/**
 * The command registry of the app. It holds what every module named `*.commands.ts` or
 * `*.commands.tsx` under `src` exports as `commands` (and `plannedCommands`); the glob import
 * finds those modules, so a feature adds its commands, shortcuts and menu items without an
 * edit to a shared file (AGENTS.md, Parallel work). See `CommandSpec` in types.ts.
 *
 * A command module is evaluated while this one loads: it may import the registry, but must
 * not use it before a command runs.
 */
export const appCommands: CommandRegistry = createCommandRegistry();

const modules = import.meta.glob<CommandModule>("../../**/*.commands.{ts,tsx}", { eager: true });

/** The discovered command modules, by their path from this file. */
export const commandModulePaths: readonly string[] = Object.keys(modules).sort();

registerCommandModules(appCommands, modules);

// `enabled` and `title` functions read these stores; an open menu follows their changes. A
// feature whose commands depend on a store of its own calls `appCommands.refresh()` from it.
sessionsStore.subscribe(() => appCommands.refresh());
editorStore.subscribe(() => appCommands.refresh());
keyContextStore.subscribe(() => appCommands.refresh());
