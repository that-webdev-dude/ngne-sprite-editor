import { createStore } from "zustand/vanilla";
import type { FreeTransform } from "../../../core/floating";

// The values typed in the context bar's transform fields (SE-033; DESIGN §5.2), waiting for
// the command that sets them on the floating selection (`transform.commands.ts`): the
// interface changes a document only through registered commands (SPEC §5), so a field writes
// its whole transform here and runs Set Transform, which takes it.

export interface TransformDraftState {
    /** The transform to set, or null when none waits. */
    draft: FreeTransform | null;
}

export const transformDraft = createStore<TransformDraftState>(() => ({ draft: null }));

/** Puts `transform` in the draft, for Set Transform to take. */
export function draftTransform(transform: FreeTransform): void {
    transformDraft.setState({ draft: { ...transform } });
}

/** Takes the draft out: it is set once. */
export function takeTransformDraft(): FreeTransform | null {
    const { draft } = transformDraft.getState();
    if (draft) transformDraft.setState({ draft: null });
    return draft;
}
