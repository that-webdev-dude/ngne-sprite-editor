import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { CelOffset } from "../../core/cels";
import type { CelRef } from "./selection";

// What a drag in the timeline hands the drop commands for one run (SE-026), as the tag bar does
// with `withTagArguments`: the cels, frames or layers dragged and where they were dropped, in
// the document they were dragged in. Outside any document, not undoable, and set only while the
// command runs.

export type DropArgument =
    | {
          readonly kind: "cels";
          readonly documentId: string;
          /** The cels dragged (the timeline's selection when the drag began). */
          readonly cels: readonly CelRef[];
          /** How far they were dragged, in pixel layers up the stack and frames. */
          readonly offset: CelOffset;
          /** The cel the drag was begun on: where it lands becomes the active cel. */
          readonly anchor: CelRef;
      }
    | {
          readonly kind: "frames";
          readonly documentId: string;
          readonly frameIds: readonly string[];
          /** The frames land before the frame now at this index (`moveFramesCommand`). */
          readonly before: number;
      }
    | {
          readonly kind: "layers";
          readonly documentId: string;
          /** Layers of one kind (pixel or reference). */
          readonly layerIds: readonly string[];
          /** Rows of their group above the place they land (`droppedLayerOrder`). */
          readonly gap: number;
      };

export interface DropState {
    drop: DropArgument | null;
}

export const dropStore: StoreApi<DropState> = createStore<DropState>(() => ({ drop: null }));

/**
 * Runs `run` with `drop` set in the store, and takes it out again afterwards whatever `run`
 * did; returns what `run` returns.
 */
export function withDrop<Result>(drop: DropArgument, run: () => Result): Result {
    dropStore.setState({ drop });
    try {
        return run();
    } finally {
        dropStore.setState({ drop: null });
    }
}
