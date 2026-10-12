import { appCommands } from "../../app/commands/appCommands";
import { invokeCommand } from "../../app/commands/invoke";
import type { Command } from "../../app/commands/types";
import { toast } from "../toast/toast";

/** A command that fails is reported by an error toast (DESIGN §4) and in the console. */
export function reportCommandError(error: unknown, command: Command): void {
    console.error(`Command ${command.id} failed:`, error);
    const reason = error instanceof Error ? error.message : String(error);
    toast.error(`${command.title()} failed: ${reason}`);
}

/**
 * Runs a command of the app registry by id: how a button or a panel performs an action
 * (SPEC §5: the interface dispatches registered commands). Returns false when the command
 * does not exist or is disabled.
 */
export function runCommand(id: string): boolean {
    const command = appCommands.get(id);
    return command ? invokeCommand(command, reportCommandError) : false;
}
