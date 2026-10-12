// The layer commands of SPEC §7.3. Each function below makes a `Command` (SPEC §5.2) from a
// session and plain arguments; nothing changes until `History.execute` runs it. A request
// that cannot be met throws a `LayerError` while the command is made, with a `code` naming
// the reason and a message that can be shown as it is.
//
// Property commands (rename, visible, locked, opacity, blend mode) find their layer when they
// are done, so several of them can share one `compositeCommand`.
//
// Stack commands (add, delete, duplicate, reorder, merge down, flatten) are planned from the
// session as it is when the command is made: execute the command before the session changes
// again, and do not put two of them into one `compositeCommand`. A stack command whose
// session has other layers, or another number of cels or images, than it was planned from
// throws instead of running.
//
// What every stack command guarantees:
// - `undo` restores the session exactly: the stack, the cels, the images (the same buffers,
//   so byte for byte) and the active layer. `do` after `undo` gives the state of the first
//   `do` again, with the same IDs.
// - Images left without a cel are removed with the cels and restored by undo (SPEC §5.1).
// - `bytes` is the pixel memory of the images the command removes and keeps for undo.
// - `touched.structure` is true; `frameIds` are the frames at which an affected layer has a
//   cel, and `layerIds` the affected layers.
// - A command that creates images throws `AllocationError` from `do` when memory runs out,
//   with the session unchanged (SPEC §5.2).
//
// The active layer follows Aseprite: a new layer and a duplicate become active; deleting or
// merging down the active layer makes the layer below it active; flatten leaves the one
// pixel layer active; nothing else changes it.
//
// Reference layers (SPEC §7.6) are in the stack but not in the composite:
// - Rename, visibility, lock, opacity, reorder and delete work on them as on pixel layers.
// - They do not count as the pixel layer every document keeps (`last-pixel-layer`).
// - Duplicate, blend mode and merge down refuse them (`not-a-pixel-layer`).
// - Merge down looks past them for its target; flatten leaves them in the stack.
// - A layer added while a reference layer is active goes on top of the stack.
// - Deleting the active layer activates the nearest layer of its own kind first.

export { LayerError } from "./errors";
export type { LayerErrorCode } from "./errors";
export {
    canDeleteLayer,
    isLayerName,
    mergeDownTarget,
    nextLayerName,
    normalizeLayerName,
} from "./lookup";
export { flattenCommand, mergeDownCommand } from "./merge";
export {
    renameLayerCommand,
    setLayerBlendModeCommand,
    setLayerLockedCommand,
    setLayerOpacityCommand,
    setLayerVisibleCommand,
} from "./properties";
export {
    addLayerCommand,
    deleteLayerCommand,
    duplicateLayerCommand,
    reorderLayerCommand,
} from "./stack";
export type { AddLayerOptions, LayerImageOptions } from "./stack";
