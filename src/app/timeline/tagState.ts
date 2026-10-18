import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

// What the tag bar hands the tag commands for one run (SE-023), as the timeline's rows do
// with `withArguments`: the tag a double-click on its span runs Tag Properties… for, and the
// range a drag of a span's end gives Apply Tag Range. Outside any document, not undoable, and
// set only while the command runs.

/** The new range of a tag, by frame ids, in the document it was dragged in. */
export interface TagRangeArgument {
    readonly documentId: string;
    readonly tagId: string;
    readonly fromFrameId: string;
    readonly toFrameId: string;
}

export interface TagState {
    /** The tag the next tag command acts on; null for the active tag at the active frame. */
    target: string | null;
    /** The range the next Apply Tag Range sets; null while no drag hands one. */
    range: TagRangeArgument | null;
}

export function initialTagState(): TagState {
    return { target: null, range: null };
}

export const tagStore: StoreApi<TagState> = createStore<TagState>(initialTagState);

/**
 * Runs `run` with `values` set in the store, and takes them out again afterwards whatever
 * `run` did. A command reads them before its first `await`.
 */
export function withTagArguments(values: Partial<TagState>, run: () => void): void {
    tagStore.setState(values);
    try {
        run();
    } finally {
        tagStore.setState(initialTagState());
    }
}
