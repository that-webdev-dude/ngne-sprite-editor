import { keyContextStore } from "../keymap/contextState";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";

// Commands that apply a floating selection first (SPEC §5.2; SE-032 review): while pixels
// float, the transaction open in the active document's history is the float's, which the
// command's `run` applies with `applyFloating()` before it acts. Their `enabled` therefore
// accepts that transaction, and refuses only a stroke's. The `floating` keymap context says
// which it is (`floating.ts`, `isFloating`); it is read here directly, so this module does
// not load `floating.ts`, which tests of other tickets replace with a hook of their own.

/**
 * Whether `document` can take a command that applies the floating selection first: its
 * history is idle, or it is the active document and the transaction open in it holds the
 * float. False during a stroke.
 */
export function canSettle(document: OpenDocument | null | undefined): document is OpenDocument {
    if (!document) return false;
    if (!document.history.transaction) return true;
    return keyContextStore.getState().floating && sessionsStore.getState().activeId === document.id;
}

/** The active document while `canSettle` holds for it, or null. */
export function settleableDocument(): OpenDocument | null {
    const document = activeDocument(sessionsStore.getState());
    return canSettle(document) ? document : null;
}
