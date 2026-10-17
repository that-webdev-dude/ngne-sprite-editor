import { keyContextStore } from "../keymap/contextState";

/**
 * Applies the floating selection of the active document, if there is one (SPEC §5.2): the
 * hook every command calls that must not run while pixels float. A sprite-wide command calls
 * it first (SE-034); save and export call it in their tickets.
 *
 * Floating selections do not exist yet, so this does nothing. SE-032 (move, floating selection
 * and clipboard) implements it here, and its callers need no change.
 */
export function applyFloating(): void {
    // SE-032: commit the open floating selection of the active document.
}

/**
 * Whether the active document holds a floating selection: the transaction open in its history
 * is then the float's, which `applyFloating` commits, and not a stroke's (SPEC §5.2). A
 * command that applies the float first may run then (Save, SE-041). It reads the `floating`
 * keymap context, which SE-032 switches; until then it is false. The timeline reads the same
 * context (`app/timeline/timelineDocument`).
 */
export function isFloating(): boolean {
    return keyContextStore.getState().floating;
}
