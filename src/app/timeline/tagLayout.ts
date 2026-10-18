// Layout of the tag bar (DESIGN §2, §5.6; SE-023), free of the DOM: the row each tag takes so
// that overlapping tags never share one, and the range a drag of a span's end gives.

/** A tag's frames by index, both included, `from` not after `to`. */
export interface FrameSpan {
    readonly from: number;
    readonly to: number;
}

/** Rows the tag bar shows before it scrolls (DESIGN §2). */
export const SHOWN_TAG_ROWS = 3;

export interface TagRows {
    /** The row of each span, in the order given; 0 is the top row. */
    readonly rows: readonly number[];
    /** How many rows the spans take: the most spans over one frame; 0 without spans. */
    readonly count: number;
}

/**
 * The rows of the tag bar. Spans are taken by their first frame, the longer first at an equal
 * first frame (so a tag sits above the tags nested in it), then in the order given (creation
 * order); each goes to the first row whose spans all end before it starts. Spans that share a
 * frame never share a row, and the rows are as few as the most spans over one frame.
 */
export function tagRows(spans: readonly FrameSpan[]): TagRows {
    const order = spans
        .map((_, index) => index)
        .sort((a, b) => {
            const left = spans[a]!;
            const right = spans[b]!;
            return left.from - right.from || right.to - left.to || a - b;
        });
    /** The last frame taken in each row so far. */
    const ends: number[] = [];
    const rows = new Array<number>(spans.length).fill(0);
    for (const index of order) {
        const span = spans[index]!;
        let row = ends.findIndex((end) => end < span.from);
        if (row === -1) row = ends.push(span.to) - 1;
        else ends[row] = span.to;
        rows[index] = row;
    }
    return { rows, count: ends.length };
}

/** Which end of a span a drag moves. */
export type SpanEnd = "from" | "to";

/**
 * The span after its `end` is dragged to the frame at `index`: the end stops at the first and
 * the last frame of the document (`frameCount` frames) and at the other end, so the span keeps
 * at least one frame and never leaves the document.
 */
export function resizedSpan(
    span: FrameSpan,
    end: SpanEnd,
    index: number,
    frameCount: number,
): FrameSpan {
    const frame = Math.min(Math.max(Math.trunc(index), 0), frameCount - 1);
    return end === "from"
        ? { from: Math.min(frame, span.to), to: span.to }
        : { from: span.from, to: Math.max(frame, span.from) };
}
