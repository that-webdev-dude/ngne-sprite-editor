// Frame commands of SPEC §7.4: add an empty frame, duplicate, delete, move, reverse, and set
// the duration of one or many frames. The commands that add or delete a frame also set
// `activeFrameId`, the way Aseprite does.
//
// A command factory plans its command against the document as it is at the call, so make the
// command and pass it to `History.execute` at once. A factory returns null when the command
// would change nothing; there is then no step to undo. A command whose document has changed
// since it was made throws from `do` and changes nothing, so two commands made from one state
// do not go into one `compositeCommand`: make the second after the first has been done.

export {
    addFrameCommand,
    deleteFramesCommand,
    duplicateFramesCommand,
    moveFramesCommand,
    reverseFramesCommand,
    setFrameDurationCommand,
} from "./commands";
export {
    FrameDurationError,
    isFrameDuration,
    LastFrameError,
    MAX_FRAME_DURATION_MS,
    MIN_FRAME_DURATION_MS,
} from "./errors";
