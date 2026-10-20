import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { celAt } from "../../core/model";
import type { SpriteDoc } from "../../core/model";
import { sessionsStore } from "../state/sessions";

// The cel properties popover (DESIGN §7, SE-061): what it shows for one cel, applied when it
// closes, as the layer properties popover does (DESIGN §5.6). Editor state outside any
// document and not undoable; the commands that change the document from it are in
// `celProperties.commands.ts`.

/** The open cel properties popover: its cel and the opacity it shows. */
export interface CelPropertiesDraft {
    readonly documentId: string;
    readonly layerId: string;
    readonly frameId: string;
    /** 0..255. */
    readonly opacity: number;
}

export interface CelPropertiesState {
    draft: CelPropertiesDraft | null;
}

export const celPropertiesStore: StoreApi<CelPropertiesState> = createStore<CelPropertiesState>(
    () => ({ draft: null }),
);

export function useCelProperties<Slice>(selector: (state: CelPropertiesState) => Slice): Slice {
    return useStore(celPropertiesStore, selector);
}

/** Changes the opacity the open popover shows; the document changes when it closes. */
export function editCelOpacity(opacity: number): void {
    const { draft } = celPropertiesStore.getState();
    if (draft && draft.opacity !== opacity) {
        celPropertiesStore.setState({ draft: { ...draft, opacity } });
    }
}

/** What the popover tells of its cel besides the opacity. */
export interface CelFacts {
    /** How many other cels share its image (SPEC §7.4). */
    readonly linkedWith: number;
    /** Its layer is locked: the opacity cannot be changed nor the cel unlinked (SE-021 review). */
    readonly locked: boolean;
}

/** The facts of the cel of `layerId` at `frameId`; null when the cel is empty or gone. */
export function celFacts(doc: SpriteDoc, layerId: string, frameId: string): CelFacts | null {
    const layer = doc.layers.find((candidate) => candidate.id === layerId);
    const cel = layer?.kind === "pixel" ? celAt(doc, layerId, frameId) : undefined;
    if (!layer || !cel) return null;
    let linkedWith = -1;
    for (const other of doc.cels.values()) if (other.imageId === cel.imageId) linkedWith++;
    return { linkedWith, locked: layer.locked };
}

// The popover of a document that was closed is dropped: what it would change is gone.
sessionsStore.subscribe((state) => {
    const { draft } = celPropertiesStore.getState();
    if (draft && !state.documents.some((entry) => entry.id === draft.documentId)) {
        celPropertiesStore.setState({ draft: null });
    }
});
