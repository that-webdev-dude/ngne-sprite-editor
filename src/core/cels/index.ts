// Cel commands of SPEC §7.4: clear, move, copy, link, unlink and set the opacity of the cels
// of a rectangular selection (layers × frames). The grid they work on has one row per pixel
// layer: a reference layer has no cels, is passed over in a selection and is not counted by
// the layer offset of a move or a copy.
//
// A command factory plans its command against the document as it is at the call, so make the
// command and pass it to `History.execute` at once. A factory returns null when the command
// would change nothing; there is then no step to undo. A command whose document has changed
// since it was made throws from `do` and changes nothing, so two commands made from one state
// do not go into one `compositeCommand`. For one undo step of several, `chainedCommand` of
// `core/history` makes each after the one before it was done.
//
// The commands change the cels they are given. Like `History.begin`, they do not look at
// `locked` or `visible`: SPEC §7.1 keeps paint off a locked layer, and whoever builds the
// selection decides whether a locked layer belongs to it.

export {
    clearCelsCommand,
    copyCelsCommand,
    linkCelsCommand,
    moveCelsCommand,
    setCelOpacityCommand,
    unlinkCelsCommand,
} from "./commands";
export type { CelOffset, CelSelection } from "./commands";
export {
    CelOpacityError,
    CelTargetError,
    isCelOpacity,
    MAX_CEL_OPACITY,
    MIN_CEL_OPACITY,
} from "./errors";
