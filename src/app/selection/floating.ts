import { keyContextStore } from "../keymap/contextState";
import { floatingState } from "./floatingState";

/**
 * Applies the floating selection of the active document, if there is one (SPEC §5.2): the
 * hook every command calls that must not run while pixels float. A sprite-wide command calls
 * it first (SE-034), Save and Save As do (SE-041), the timeline's switches and apply commands
 * do (SE-022); export and playback call it in their tickets. The float becomes one history
 * step, or none when it changed nothing (`floatingState.ts`, SE-032).
 */
export function applyFloating(): void {
    floatingState.apply();
}

/**
 * Whether the active document holds a floating selection: the transaction open in its history
 * is then the float's, which `applyFloating` commits, and not a stroke's (SPEC §5.2). A
 * command that applies the float first may run then (Save, SE-041). It reads the `floating`
 * keymap context, which `floatingState` switches on exactly while a float exists. The timeline
 * reads the same context (`app/timeline/timelineDocument`).
 */
export function isFloating(): boolean {
    return keyContextStore.getState().floating;
}
