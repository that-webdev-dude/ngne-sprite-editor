// What `se-024-playback.perf.ts` makes of a recording of editor playback (SE-024 review B):
// pure, so it is unit-tested on synthetic recordings (`tests/unit/se-024-analyse.test.ts`).

/** What the page records while playback runs. */
export interface PlaybackRecording {
    /** Each change of the active frame that playback made: its frame and when. */
    entries: readonly { frameId: string; at: number }[];
    /**
     * Each frame the viewport submitted (`onDrawn`: handed to NGNE, not known to be presented on
     * screen): the frame key it drew and when.
     */
    drawn: readonly { key: string | null; at: number }[];
}

/** An entry of the sequence that was not shown. */
export interface SkippedEntry {
    frameId: string;
    /** When it was, or would have been, the active frame (ms, as in the recording). */
    at: number;
    /** "jumped": the clock went past it; "not drawn": no submitted frame showed it. */
    reason: "jumped" | "not drawn";
}

export interface PlaybackAnalysis {
    /** Entries the window covers: the recorded ones and those the clock jumped over. */
    entries: number;
    skipped: SkippedEntry[];
    /** For each entry drawn, the time from its start to its first submitted frame. */
    lateness: number[];
    /** The gaps between submitted frames that changed the picture. */
    changes: number[];
}

/**
 * The entries of a forward loop over `order` (frame ids, in playing order) that were skipped.
 * Each recorded entry must be the successor of the one before it (the next frame of `order`,
 * the first after the last); every frame between two that are not is an entry the clock jumped
 * over. A recorded entry, other than the first and the last (which the window cuts), is skipped
 * as well when no submitted frame showed it while it was the active one.
 */
export function analysePlayback(
    recording: PlaybackRecording,
    order: readonly string[],
): PlaybackAnalysis {
    const { entries, drawn } = recording;
    const position = new Map(order.map((frameId, index) => [frameId, index]));
    const skipped: SkippedEntry[] = [];
    const lateness: number[] = [];
    let covered = entries.length;
    for (let index = 1; index < entries.length; index++) {
        const before = entries[index - 1]!;
        const entry = entries[index]!;
        const from = position.get(before.frameId);
        const to = position.get(entry.frameId);
        if (from === undefined || to === undefined) {
            throw new Error(`se-024: frame ${entry.frameId} or ${before.frameId} is not playing`);
        }
        const gap = (to - from + order.length) % order.length || order.length;
        for (let missing = 1; missing < gap; missing++) {
            skipped.push({
                frameId: order[(from + missing) % order.length]!,
                at: entry.at,
                reason: "jumped",
            });
            covered++;
        }
    }
    for (let index = 1; index < entries.length - 1; index++) {
        const entry = entries[index]!;
        const next = entries[index + 1]!;
        const key = `${entry.frameId}:plain`;
        const first = drawn.find(
            (frame) => frame.key === key && frame.at >= entry.at && frame.at < next.at,
        );
        if (first) lateness.push(first.at - entry.at);
        else skipped.push({ frameId: entry.frameId, at: entry.at, reason: "not drawn" });
    }
    const changes: number[] = [];
    let last: { key: string | null; at: number } | null = null;
    for (const frame of drawn) {
        if (last && frame.key !== last.key) changes.push(frame.at - last.at);
        if (!last || frame.key !== last.key) last = frame;
    }
    return { entries: covered, skipped, lateness, changes };
}
