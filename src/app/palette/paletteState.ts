import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { EditorState } from "../state/editor";

// Editor state of the palette panel (DESIGN §5.4, SE-060), outside any document and not
// undoable: which swatch the palette commands act on, where Move Colour puts it, and the swatch
// being edited in the picker. The commands are in `palette.commands.ts`.

/** A swatch being edited in the colour picker popover. */
export interface SwatchEdit {
    /** The document whose palette holds the swatch. */
    readonly documentId: string;
    /** The swatch's index in that palette. */
    readonly index: number;
    /** The swatch's colour when the edit began, 0xRRGGBBAA. */
    readonly colour: number;
    /**
     * The colour the picker edits: the foreground of this store. The palette changes once,
     * when the edit finishes (`finishSwatchEdit`), so the edit is one undo step.
     */
    readonly draft: StoreApi<EditorState>;
}

export interface PaletteState {
    /**
     * The current swatch: the grid's tab stop, set by a press on a swatch and by the arrow
     * keys. Remove, Edit and Move act on it. Kept as an index and read within the palette
     * (`currentSwatch`), so it needs no update when the palette shrinks.
     */
    current: number;
    /** Where Move Colour puts the current swatch: set by a drag and by Ctrl+arrow keys. */
    target: number | null;
    /** The swatch being edited in the picker, or null. */
    edit: SwatchEdit | null;
}

export const paletteStore: StoreApi<PaletteState> = createStore<PaletteState>(() => ({
    current: 0,
    target: null,
    edit: null,
}));

export function usePaletteState<Slice>(selector: (state: PaletteState) => Slice): Slice {
    return useStore(paletteStore, selector);
}

/** The index of the current swatch within a palette of `count` colours; -1 when it is empty. */
export function currentSwatch(count: number, state: PaletteState = paletteStore.getState()) {
    return count === 0 ? -1 : Math.min(Math.max(0, state.current), count - 1);
}

/** Makes `index` the current swatch. */
export function setCurrentSwatch(index: number): void {
    if (paletteStore.getState().current !== index) paletteStore.setState({ current: index });
}

/**
 * Ends the swatch edit without applying it: for an edit that Apply Colour Edit cannot take,
 * its document closed or in a stroke. Changes no document.
 */
export function dropSwatchEdit(): void {
    if (paletteStore.getState().edit) paletteStore.setState({ edit: null });
}

/** Sets where Move Colour puts the current swatch; null for nowhere. */
export function setMoveTarget(target: number | null): void {
    if (paletteStore.getState().target !== target) paletteStore.setState({ target });
}
