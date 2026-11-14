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

/**
 * A value read from the commands of a registry, such as whether one command is enabled. It is
 * read again whenever `useCommands` would render, but the component renders again only when
 * the value changes (`Object.is`): the registry is told of every change to the open documents,
 * so a component that shows one command's state should not render at each of them. `read`
 * must be cheap and return a primitive, or the same object for the same state.
 */
export function useCommandValue<Value>(
    read: (registry: CommandRegistry) => Value,
    registry: CommandRegistry = appCommands,
): Value {
    return useSyncExternalStore(registry.subscribe, () => read(registry));
}
