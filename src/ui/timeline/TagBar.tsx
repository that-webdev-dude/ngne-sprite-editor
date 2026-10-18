import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { BLACK, labelColourOn, WHITE } from "../../core/color/contrast";
import { sessionsStore } from "../../app/state/sessions";
import { TAG_COMMANDS } from "../../app/timeline/tagCommandIds";
import { tagRangeLabel } from "../../app/timeline/tagDialogs";
import { resizedSpan, SHOWN_TAG_ROWS } from "../../app/timeline/tagLayout";
import type { FrameSpan, SpanEnd } from "../../app/timeline/tagLayout";
import { withTagArguments } from "../../app/timeline/tagState";
import type { TimelineTag, TimelineTags } from "../../app/timeline/timelineModel";
import { cssColour } from "../colour/pickerMath";
import { runCommand } from "../commands/runCommand";
import { CELL_WIDTH } from "./timelineDom";
import "./tags.css";

/** DESIGN §5.6: a row of the tag bar is 18 px; its span is 16 px, 1 px in from each edge. */
export const TAG_ROW_HEIGHT = 18;
/** Space above the first row (DESIGN §5.6: one row fills the 28 px bar). */
const TAG_BAR_TOP = 5;
/** A span lies 1 px inside its row and its frame columns. */
const TAG_INSET = 1;

/** A drag of a span's end (DESIGN §5.6): the range it gives, drawn until the release. */
interface Drag {
    readonly pointerId: number;
    readonly element: HTMLElement;
    readonly tagId: string;
    readonly end: SpanEnd;
    /** The tag's frames at the press. */
    readonly start: FrameSpan;
    /** The frames the span shows now. */
    readonly span: FrameSpan;
    /**
     * The tags drawn when it began. The bar is drawn again only when they change (an undo,
     * the range a release set, another document): from then on the drag is over, also when
     * the same tags come back (a redo).
     */
    readonly tags: TimelineTags;
    /**
     * The button is up and Apply Tag Range set `span`: the span keeps showing it until the
     * panel draws the tags with it, so it does not snap back meanwhile.
     */
    readonly released: boolean;
}

export interface TagBarProps {
    documentId: string;
    tags: TimelineTags;
    /** The frames of the timeline, in order: what a span's frame numbers name. */
    frameIds: readonly string[];
    /**
     * A press on the bar: the focus goes to the active cell, which keeps the timeline where it
     * is scrolled (a span pressed stays under the pointer).
     */
    onPress(): void;
}

/** Runs a tag command on the tag of a span rather than on the active tag. */
function runOnTag(tagId: string, commandId: string): void {
    withTagArguments({ target: tagId }, () => void runCommand(commandId));
}

/** Lets a drag's pointer go: its handle no longer captures it. */
function releaseCapture(current: Drag | null): void {
    if (current?.element.hasPointerCapture(current.pointerId)) {
        current.element.releasePointerCapture(current.pointerId);
    }
}

/** Whether the tag of the open document `documentId` runs over these frames now. */
function hasRange(documentId: string, tagId: string, fromFrameId: string, toFrameId: string) {
    const document = sessionsStore.getState().documents.find((entry) => entry.id === documentId);
    const tag = document?.session.doc.tags.find((entry) => entry.id === tagId);
    return tag?.fromFrameId === fromFrameId && tag.toFrameId === toFrameId;
}

/** The press is the bar's: it keeps the focus where it is and selects no text. */
function keepFocus(event: MouseEvent): void {
    event.preventDefault();
}

/**
 * The tag bar (DESIGN §2, §5.6; SE-023): a span per tag over its frames, in the rows of
 * `tagRows`, coloured with the tag's colour and labelled in black or white, whichever has the
 * higher contrast with it (`labelColourOn`). The active tag at the active frame is marked.
 * Dragging either end of a span resizes the tag in one undo step at the release (Apply Tag
 * Range); Escape during the drag cancels it. A double-click opens Tag Properties… for the tag.
 * A press on the bar keeps the focus in the timeline (on the active cell) and selects nothing.
 */
function TagBarView({ documentId, tags, frameIds, onPress }: TagBarProps) {
    const bar = useRef<HTMLDivElement>(null);
    // The drag as the pointer events see it; `preview` is what is drawn of it.
    const drag = useRef<Drag | null>(null);
    const [preview, setPreview] = useState<Drag | null>(null);
    // Drawn over the tags it began on only: once the panel draws other tags (the range the
    // release set, an undo, another document), it is gone.
    const shown = preview?.tags === tags ? preview : null;
    const dragging = shown !== null && !shown.released;

    /** Ends the drag without applying it. */
    const cancel = useCallback(() => {
        const current = drag.current;
        drag.current = null;
        setPreview(null);
        releaseCapture(current);
    }, []);

    // Escape cancels the drag, before any other key handler sees it.
    useEffect(() => {
        if (!dragging) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [dragging, cancel]);

    // Other tags drawn while the button is held (an undo removed the tag, another document
    // is active): the drag is over. Its span may be gone, and the release with it.
    useEffect(() => {
        const current = drag.current;
        if (!current || current.tags === tags) return;
        drag.current = null;
        releaseCapture(current);
    }, [tags]);

    /** The frame under the pointer: by the frame columns the bar lies over. */
    const spanAt = (current: Drag, clientX: number): FrameSpan => {
        const left = bar.current?.getBoundingClientRect().left ?? 0;
        const index = Math.floor((clientX - left) / CELL_WIDTH);
        return resizedSpan(current.start, current.end, index, frameIds.length);
    };

    /** The drag of `event`'s pointer, while the tags it began on are those drawn. */
    const dragOf = (event: ReactPointerEvent): Drag | null => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return null;
        if (current.tags !== tags) {
            cancel();
            return null;
        }
        return current;
    };

    const onHandleDown = (tag: TimelineTag, which: SpanEnd) => (event: ReactPointerEvent) => {
        if (event.button !== 0) return;
        // A drag begun over other tags is over, whatever its pointer.
        const held = drag.current;
        if (held && held.tags === tags) return;
        drag.current = null;
        releaseCapture(held);
        const element = event.currentTarget as HTMLElement;
        element.setPointerCapture(event.pointerId);
        const start = { from: tag.from, to: tag.to };
        const next: Drag = {
            pointerId: event.pointerId,
            element,
            tagId: tag.id,
            end: which,
            start,
            span: start,
            tags,
            released: false,
        };
        drag.current = next;
        setPreview(next);
    };
    const onHandleMove = (event: ReactPointerEvent) => {
        const current = dragOf(event);
        if (!current) return;
        const span = spanAt(current, event.clientX);
        if (span.from === current.span.from && span.to === current.span.to) return;
        const next = { ...current, span };
        drag.current = next;
        setPreview(next);
    };
    const onHandleUp = (event: ReactPointerEvent) => {
        const current = dragOf(event);
        if (!current) return;
        const span = spanAt(current, event.clientX);
        drag.current = null;
        releaseCapture(current);
        const fromFrameId = frameIds[span.from];
        const toFrameId = frameIds[span.to];
        const changed = span.from !== current.start.from || span.to !== current.start.to;
        if (!changed || fromFrameId === undefined || toFrameId === undefined) {
            setPreview(null);
            return;
        }
        const { tagId } = current;
        const range = { documentId, tagId, fromFrameId, toFrameId };
        const ran = withTagArguments({ range }, () => runCommand(TAG_COMMANDS.applyTagRange));
        // The span keeps the new range until the panel draws it; it goes back at once when
        // the command set nothing (disabled, or the tag or its frames gone).
        const applied = ran && hasRange(documentId, tagId, fromFrameId, toFrameId);
        setPreview(applied ? { ...current, span, released: true } : null);
    };
    const onHandleCancel = (event: ReactPointerEvent) => {
        if (drag.current?.pointerId === event.pointerId) cancel();
    };

    const onBarDown = (event: ReactPointerEvent) => {
        if (event.button === 0) onPress();
    };

    const rows = Math.max(tags.rows, 1);
    return (
        <div
            ref={bar}
            className="timeline__tags"
            data-timeline-tags=""
            data-scrolls={tags.rows > SHOWN_TAG_ROWS || undefined}
            style={{ width: frameIds.length * CELL_WIDTH }}
            onMouseDown={keepFocus}
            onPointerDown={onBarDown}
        >
            <div
                className="timeline__tag-rows"
                role="list"
                aria-label="Tags"
                style={{ height: TAG_BAR_TOP + rows * TAG_ROW_HEIGHT + TAG_BAR_TOP - 1 }}
            >
                {tags.list.map((tag) => {
                    const resizing = shown?.tagId === tag.id ? shown : null;
                    const { from, to } = resizing ? resizing.span : tag;
                    const label = labelColourOn(tag.color) === "black" ? BLACK : WHITE;
                    return (
                        <div
                            key={tag.id}
                            className="timeline__tag"
                            role="listitem"
                            aria-label={tagRangeLabel(tag.name, from + 1, to + 1)}
                            aria-current={tag.id === tags.activeId ? "true" : undefined}
                            title={tag.name}
                            data-tag={tag.id}
                            data-row={tag.row}
                            data-resizing={
                                resizing && !resizing.released ? resizing.end : undefined
                            }
                            style={{
                                left: from * CELL_WIDTH + TAG_INSET,
                                width: (to - from + 1) * CELL_WIDTH - 2 * TAG_INSET,
                                top: TAG_BAR_TOP + tag.row * TAG_ROW_HEIGHT + TAG_INSET,
                                background: cssColour(tag.color, 1),
                                color: cssColour(label, 1),
                            }}
                            onDoubleClick={() => runOnTag(tag.id, TAG_COMMANDS.tagProperties)}
                        >
                            <span className="timeline__tag-name">{tag.name}</span>
                            {(["from", "to"] as const).map((which) => (
                                <span
                                    key={which}
                                    className="timeline__tag-handle"
                                    data-end={which}
                                    onPointerDown={onHandleDown(tag, which)}
                                    onPointerMove={onHandleMove}
                                    onPointerUp={onHandleUp}
                                    onPointerCancel={onHandleCancel}
                                    onLostPointerCapture={onHandleCancel}
                                />
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** Drawn again only when the tags, the frames or the document change. */
export const TagBar = memo(
    TagBarView,
    (before, after) =>
        before.tags.key === after.tags.key &&
        before.frameIds === after.frameIds &&
        before.documentId === after.documentId &&
        before.onPress === after.onPress,
);
