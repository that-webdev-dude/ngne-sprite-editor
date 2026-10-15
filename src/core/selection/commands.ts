import type { Command } from "../history";
import type { BitMask, DocSession, Selection } from "../model";
import { selectionsEqual } from "./mask";
import { combineSelection, invertSelection, selectAll } from "./operations";
import type { SelectionMode } from "./operations";

// Selection changes as commands on `DocSession.selection` (SPEC §5.2, §7.2; SE-030): undoable,
// not persisted, and untouched by frame and layer switches, which do not look at it. A command
// keeps the selection before and after; both are values nobody changes (mask.ts), so undo puts
// back the very mask that was there. A change that would leave the same pixels selected makes
// no command (null), so it records no history entry, as a stroke that changes nothing.

/**
 * The command that makes `next` the session's selection, labelled `label`; null when `next`
 * selects the same pixels as the selection now. Throws `RangeError` for a mask that does not
 * have the document's size.
 */
export function setSelectionCommand(
    session: DocSession,
    next: Selection | null,
    label: string,
): Command | null {
    const { doc } = session;
    if (next && (next.mask.width !== doc.width || next.mask.height !== doc.height)) {
        throw new RangeError(
            `setSelectionCommand: the mask is ${next.mask.width}×${next.mask.height}, ` +
                `the document ${doc.width}×${doc.height}.`,
        );
    }
    const before = session.selection;
    if (selectionsEqual(before, next)) return null;
    return {
        label,
        bytes: (before?.mask.data.byteLength ?? 0) + (next?.mask.data.byteLength ?? 0),
        // No composite changes: no frame, no layer, no structure.
        touched: { frameIds: [], layerIds: [], structure: false },
        do(target) {
            target.selection = next;
        },
        undo(target) {
            target.selection = before;
        },
    };
}

/**
 * Combines the mask of a shape (rectangle, ellipse, polygon, flood mask) with the selection
 * by `mode` (`combineSelection`); null when the selection would not change.
 */
export function selectCommand(
    session: DocSession,
    shape: BitMask,
    mode: SelectionMode,
    label: string,
): Command | null {
    return setSelectionCommand(session, combineSelection(session.selection, shape, mode), label);
}

/** Select All: every pixel of the document; null when every pixel is selected already. */
export function selectAllCommand(session: DocSession): Command | null {
    const { width, height } = session.doc;
    return setSelectionCommand(session, selectAll(width, height), "Select All");
}

/** Deselect: no selection; null when there is none. */
export function deselectCommand(session: DocSession): Command | null {
    return setSelectionCommand(session, null, "Deselect");
}

/** Invert Selection (`invertSelection`): with no selection, every pixel. */
export function invertSelectionCommand(session: DocSession): Command | null {
    const { width, height } = session.doc;
    return setSelectionCommand(
        session,
        invertSelection(session.selection, width, height),
        "Invert Selection",
    );
}
