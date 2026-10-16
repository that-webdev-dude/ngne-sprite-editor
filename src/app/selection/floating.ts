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
