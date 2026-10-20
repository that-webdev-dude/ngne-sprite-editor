// The tools that change only the view (SE-024, SE-062): a stroke of theirs does not stop
// editor playback, and chrome over the viewport (a symmetry axis's handle) does not take their
// presses, so the hand and the zoom work everywhere.

/** Ids of the hand and the zoom. */
export const VIEW_TOOLS: ReadonlySet<string> = new Set(["hand", "zoom"]);
