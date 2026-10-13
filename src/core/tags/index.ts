// Tags of SPEC §7.4: the undoable commands that create, edit and delete a tag, and
// `followFrames`, the rule by which tags follow their frames when the frame list changes.
//
// A command factory plans its command against the document as it is at the call, so make the
// command and pass it to `History.execute` at once. `editTagCommand` returns null when it
// would change nothing; there is then no step to undo. A command whose document has other
// tags by the time it runs throws from `do` and changes nothing; `chainedCommand` of
// `core/history` makes one undo step of several such commands.

export { createTagCommand, deleteTagCommand, editTagCommand } from "./commands";
export type { TagProperties } from "./commands";
export { isTagRepeat, MAX_TAG_REPEAT, TagRangeError, TagRepeatError } from "./errors";
export { followFrames } from "./follow";
export type { FrameChange } from "./follow";
