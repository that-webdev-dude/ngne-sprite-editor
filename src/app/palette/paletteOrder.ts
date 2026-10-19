import { isPermutation } from "../../core/palettes";
import { sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";

// "Original order" of the palette (SPEC §7.1, Palette; SE-066): the order of a document's
// palette before its first sort. It is editor state, kept per open document for this session
// and not saved: a document opened again starts without one.
//
// A sort keeps the order it found unless an order is kept already that holds the palette's
// colours (the same colours, each as often): then the palette was only sorted or moved since,
// and the order before the first sort stays. A colour added, removed or edited, or another
// palette loaded or imported, makes the kept order one of other colours: Original Order is then
// unavailable, and the next sort keeps the order it finds.

const orders = new Map<string, readonly number[]>();

// A closed document's order goes with it.
sessionsStore.subscribe((state) => {
    for (const id of orders.keys()) {
        if (!state.documents.some((document) => document.id === id)) orders.delete(id);
    }
});

/** The original order of `document`'s palette, when it holds the palette's colours. */
export function originalOrderOf(document: OpenDocument): readonly number[] | null {
    const order = orders.get(document.id);
    return order && isPermutation(order, document.session.doc.palette.colors) ? order : null;
}

/** Called before a sort of `document`'s palette: keeps the order it has, unless one is kept. */
export function keepOrderBeforeSort(document: OpenDocument): void {
    if (originalOrderOf(document)) return;
    orders.set(document.id, [...document.session.doc.palette.colors]);
}

/** Forgets every kept order (tests). */
export function forgetPaletteOrders(): void {
    orders.clear();
}
