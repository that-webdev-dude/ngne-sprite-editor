// The layer commands of SPEC §7.3. Each function below makes a `Command` (SPEC §5.2) from a
// session and plain arguments; nothing changes until `History.execute` runs it. A request
// that cannot be met throws a `LayerError` while the command is made, with a `code` naming
// the reason and a message that can be shown as it is. A request that would take the document
// past one of its limits (SPEC §5.1: layers, cels, images, pixel memory, the length of a name)
// throws the `DocumentLimitError` of `core/model` instead; add, duplicate, merge down and
// flatten take the limits as an option, which a test lowers.
//
// A command that would change nothing is not made: the factory returns null, and there is
// then no step to undo and nothing that makes the document dirty. The five property
// factories return null when the layer has the value already, `reorderLayerCommand` when the
// layer is at that position already, and `flattenCommand` when the document has one pixel
// layer with nothing to bake (visible, opacity 255, blend mode normal, every cel at opacity
// 255). Add, delete, duplicate and merge down always change the document.
//
// Property commands (rename, visible, locked, opacity, blend mode) find their layer when they
// are done, so several of them can share one `compositeCommand`.
//
// Stack commands (add, delete, duplicate, reorder, merge down, flatten) are made for the
// structure the document has at that moment: its layers and frames in their order, which
// cels there are and which image each names, which images there are and how large. From it
// follow the guards, `bytes`, `touched` and the IDs a command creates. `do` throws, with the
// session unchanged, when the document has another structure by then. So execute a command
// before the session changes again, and do not put two of them into one `compositeCommand`.
//
// Everything else a stack command takes from the session at each `do`: the layer objects,
// the cels, the image buffers and their pixels, the properties of layers and cels, and the
// active layer. A redo finds the structure it was made for, but not the same objects (a
// command that creates an image creates it again when it is redone), and maybe another
// active layer, which is switched without a history entry.
//
// What every stack command guarantees:
// - `undo` restores the session exactly as its `do` found it: the stack, the cels, the images
//   (the very buffers that `do` removed, at their places in the maps) and the active layer.
// - `do` after `undo` gives the document of the first `do` again, with the same IDs.
// - Images left without a cel are removed with the cels and restored by undo (SPEC §5.1).
// - `bytes` is the pixel memory of the images the command removes. It keeps them while it is
//   done, and none while it is undone. The number is the same at every `do`.
// - `touched.structure` is true; `frameIds` are the frames at which an affected layer has a
//   cel, and `layerIds` the affected layers.
// - A command that creates images throws `AllocationError` from `do` when memory runs out,
//   with the session unchanged (SPEC §5.2).
//
// The active layer follows Aseprite: a new layer and a duplicate become active; deleting or
// merging down the active layer makes the layer below it active; flatten leaves the one
// pixel layer active; nothing else changes it. Each `do` applies this to the active layer it
// finds, and `undo` returns to that layer.
//
// Hidden layers:
// - Merge down merges the two layers whatever their `visible` flag, as Aseprite does: the
//   result is `compositeFrame` of the two, both taken as visible, so no pixel is lost. The
//   target keeps its own `visible` flag, with its name and lock.
// - Flatten leaves the composite of every frame byte-identical: a hidden layer adds nothing
//   and is deleted with the others, and the one layer that remains is visible.
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
export { flattenCommand, isFlat, mergeDownCommand } from "./merge";
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
