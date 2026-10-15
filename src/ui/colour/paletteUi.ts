import { useMemo } from "react";
import { createStore } from "zustand/vanilla";
import { activeDocument, useSessions } from "../../app/state/sessions";

// What the parts of the palette panel (DESIGN §5.4, SE-060) share in the interface: the
// active palette as they render it, the overflow menu's open state — the header shows the
// menu, a swatch opens it with the Menu key — and how to find a swatch on the page.

export interface ActivePalette {
    documentId: string;
    name: string;
    colors: readonly number[];
}

/** The palette of the active document as text, so a component renders only when it changes. */
function paletteText(documentId: string, name: string, colors: readonly number[]): string {
    return JSON.stringify({ documentId, name, colors });
}

/** The active document's palette, or null while no document is open. */
export function useActivePalette(): ActivePalette | null {
    const text = useSessions((state) => {
        const document = activeDocument(state);
        if (!document) return null;
        const { palette } = document.session.doc;
        return paletteText(document.id, palette.name, palette.colors);
    });
    return useMemo(() => (text === null ? null : (JSON.parse(text) as ActivePalette)), [text]);
}

export interface PaletteMenuState {
    /** Whether the overflow menu is open. */
    open: boolean;
    /** The swatch whose Menu key opened it, which gets the focus back; null from the header. */
    from: number | null;
}

export const paletteMenuStore = createStore<PaletteMenuState>(() => ({ open: false, from: null }));

export function openPaletteMenu(from: number | null): void {
    paletteMenuStore.setState({ open: true, from });
}

export function closePaletteMenu(): void {
    paletteMenuStore.setState({ open: false });
}

/** The attribute that marks the palette grid. */
export const PALETTE_GRID_ATTRIBUTE = "data-palette-grid";

/** The element of the swatch at `index`, or null when it is not on the page. */
export function swatchElement(index: number): HTMLElement | null {
    return document.querySelector<HTMLElement>(
        `[${PALETTE_GRID_ATTRIBUTE}] [data-swatch="${index}"]`,
    );
}
