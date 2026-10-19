import { keyContextStore } from "../keymap/contextState";
import { stopPlaybackForEdit } from "../playback/playbackState";
import { floatingState } from "./floatingState";

/** Thrown by `applyFloating` when the floating selection could not be applied. */
export class FloatingApplyError extends Error {
    override readonly name = "FloatingApplyError";
}

/**
 * Applies the floating selection of the active document, if there is one (SPEC §5.2): the
 * hook every command calls that must not run while pixels float. A sprite-wide command calls
 * it first (SE-034), Save and Save As do (SE-041), the timeline's switches and apply commands
 * do (SE-022), and so does playback when it starts (SE-024); export calls it in its ticket. The
 * float becomes one history step, or none when it changed nothing (`floatingState.ts`, SE-032).
 * Editor playback stops first, on the frame on screen, so the command acts on the frame the
 * user sees (SE-024).
 *
 * When it cannot be applied, the failure has been reported (a toast) and the float taken
 * back, and this throws `FloatingApplyError`, so the caller does not go on as if it had been
 * applied: Save then reports that it could not save.
 */
export function applyFloating(): void {
    // A command that changes the document acts on the frame on screen (SE-024).
    stopPlaybackForEdit();
    if (floatingState.apply() === "failed") {
        throw new FloatingApplyError("The floating selection could not be applied.");
    }
}

/**
 * Whether the active document holds a floating selection: the transaction open in its history
 * is then the float's, which `applyFloating` commits, and not a stroke's (SPEC §5.2). A
 * command that applies the float first may run then (Save, SE-041). It reads the `floating`
 * keymap context, which `floatingState` switches on exactly while a float exists. The timeline
 * reads the same context (`app/timeline/timelineDocument`), and so does `settled.ts`.
 */
export function isFloating(): boolean {
    return keyContextStore.getState().floating;
}
