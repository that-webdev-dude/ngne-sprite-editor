import { useSyncExternalStore } from "react";
import { appCommands } from "../../app/commands/appCommands";
import type { CommandRegistry } from "../../app/commands/registry";
import type { Command } from "../../app/commands/types";

/**
 * The commands of a registry. The component renders again when a command is added or removed
 * and when state that `enabled` or `title` functions read has changed, so it calls those
 * functions while rendering.
 */
export function useCommands(registry: CommandRegistry = appCommands): readonly Command[] {
    useSyncExternalStore(registry.subscribe, registry.version);
    return registry.list();
}
