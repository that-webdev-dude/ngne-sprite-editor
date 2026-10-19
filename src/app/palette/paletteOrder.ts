import { isPermutation } from "../../core/palettes";
import type { DocSession } from "../../core/model";

// "Original order" of the palette (SPEC §7.1, Palette; SE-066): the order of a document's
// palette before its first sort. It is editor state, kept per document session and not saved:
// a document opened again, reverted, or replaced by a new session of the same id starts
// without one, and a closed session's order goes with it (a `WeakMap`).
//
// A sort keeps the order it finds unless an order is kept already that holds the palette's
// colours (the same colours, each as often): then the palette was only sorted or moved since,
// and the order before the first sort stays. Original Order is available while the palette
// holds exactly the kept order's colours, each as often, in another order. A colour added,
// removed or edited, or another palette loaded, makes it unavailable; the next sort then keeps
// the order it finds. Undo is not followed: an undone sort leaves its kept order, so after an
// undo Original Order may put back the order from before that undone sort. Import forgets the
// kept order (`forgetPaletteOrder`).

let orders = new WeakMap<DocSession, readonly number[]>();

/** The original order of `session`'s palette, when it holds the palette's colours. */
export function originalOrderOf(session: DocSession): readonly number[] | null {
    const order = orders.get(session);
    return order && isPermutation(order, session.doc.palette.colors) ? order : null;
}

/** Called before a sort of `session`'s palette: keeps the order it has, unless one is kept. */
export function keepOrderBeforeSort(session: DocSession): void {
    if (originalOrderOf(session)) return;
    orders.set(session, [...session.doc.palette.colors]);
}

/** Forgets the kept order of `session`'s palette (an imported palette). */
export function forgetPaletteOrder(session: DocSession): void {
    orders.delete(session);
}

/** Forgets every kept order (tests). */
export function forgetPaletteOrders(): void {
    orders = new WeakMap();
}
