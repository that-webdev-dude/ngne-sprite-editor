// Tag expansion of SPEC §7.4: the sequence of frames a tag plays, shared by editor playback
// (SE-024) and by export (SE-051); and the clock of editor playback (SPEC §7.5, SE-024).

export { expandTag } from "./expandTag";
export type { AnimationEntry, TagPlayback } from "./expandTag";
export { entryAt, PlaybackClock, playbackSequence, sequenceDuration } from "./playbackClock";
export type { ClockSequence, PlaybackPosition, PlaybackSequence } from "./playbackClock";
