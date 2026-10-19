import { keepsPlaying, stopPlaybackForEdit } from "../playback/playbackState";
import type { Command } from "./types";

/** Receives what a command threw, or what its promise was rejected with. */
export type CommandErrorHandler = (error: unknown, command: Command) => void;

/**
 * Runs a command the way every caller of the registry does (menu, shortcut, palette): not at
 * all while it is disabled, and with failures handed to `onError` instead of thrown. Returns
 * whether the command was run. Editor playback stops first, on the frame on screen, unless the
 * command is one that `keepsPlaying` names (SE-024): the command acts on the frame the user
 * sees.
 */
export function invokeCommand(command: Command, onError: CommandErrorHandler): boolean {
    if (!command.enabled()) return false;
    try {
        if (!keepsPlaying(command.id)) stopPlaybackForEdit();
        const result = command.run();
        if (result instanceof Promise) {
            result.catch((error: unknown) => onError(error, command));
        }
    } catch (error) {
        onError(error, command);
    }
    return true;
}
