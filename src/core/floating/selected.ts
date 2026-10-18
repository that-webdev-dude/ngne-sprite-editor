import type { Command, History } from "../history";
import { celAt } from "../model";
import type { Selection } from "../model";
import type { FloatTarget } from "./floating";

// Edits of the selected pixels of a cel (SPEC §7.2, §7.8; SE-032): Delete makes them
// transparent and Fill gives them a colour, each one undo step. Each is a transaction of the
// document's history with the selection as its clip, so the pixels outside the selection keep
// their bytes, an empty cel is created only when something is written into it, and an edit
// that changes nothing records nothing.

/**
 * Writes `colour` (0xRRGGBBAA, straight; written as 0, 0, 0, 0 when its alpha is 0) into
 * every pixel of the selection's bounds in the transaction of `target`, which the clip keeps
 * to the selection. Returns the command recorded, or null when nothing changed.
 */
function writeSelected(
    history: History,
    target: FloatTarget,
    selection: Selection,
    colour: number,
    label: string,
): Command | null {
    const transaction = history.begin({ ...target, clip: selection.mask });
    try {
        const alpha = colour & 0xff;
        const rgba =
            alpha === 0
                ? [0, 0, 0, 0]
                : [colour >>> 24, (colour >>> 16) & 0xff, (colour >>> 8) & 0xff, alpha];
        const { image } = transaction;
        const { x, y, width, height } = selection.bounds;
        for (let row = y; row < y + height; row++) {
            for (let column = x; column < x + width; column++) {
                image.data.set(rgba, (row * image.width + column) * 4);
            }
        }
        transaction.markDirty(selection.bounds);
    } catch (error) {
        if (transaction.open) transaction.abort();
        throw error;
    }
    return transaction.commit(label);
}

/**
 * Delete (SPEC §7.8): the selected pixels of the cel of `target` become transparent, as one
 * history entry labelled `label`. Returns its command, or null when nothing changed (an
 * empty cel, or selected pixels already transparent). Throws what `History.begin` throws.
 */
export function clearSelected(
    history: History,
    target: FloatTarget,
    selection: Selection,
    label = "Delete",
): Command | null {
    // An empty cel has nothing to clear: no cel is made for it.
    if (!celAt(history.session.doc, target.layerId, target.frameId)) return null;
    return writeSelected(history, target, selection, 0, label);
}

/**
 * Fill (SE-032): the selected pixels of the cel of `target` take `colour` (0xRRGGBBAA),
 * replaced and not blended, as one history entry labelled `label`. Returns its command, or
 * null when nothing changed. Throws what `History.begin` throws.
 */
export function fillSelected(
    history: History,
    target: FloatTarget,
    selection: Selection,
    colour: number,
    label = "Fill",
): Command | null {
    return writeSelected(history, target, selection, colour >>> 0, label);
}
