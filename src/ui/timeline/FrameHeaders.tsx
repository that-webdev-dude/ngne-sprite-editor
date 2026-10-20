import { memo, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { isCelSelected } from "../../app/timeline/selection";
import type { ClickTarget, TimelineSelection } from "../../app/timeline/selection";
import { renderedColumns } from "./gridWindow";
import type { GridWindowStore } from "./gridWindow";
import { CELL_WIDTH } from "./timelineDom";

export interface FrameHeadersProps {
    frameIds: readonly string[];
    selection: TimelineSelection | null;
    /** The active frame's column as the panel draws it: tinted. */
    activeFrameIndex: number;
    /** The column of the active cel now: its number is rendered wherever the grid is scrolled. */
    focusIndex: number;
    windowStore: GridWindowStore;
    /** A press on a frame number: selects, and may begin a drag (`useTimelineDrag`). */
    onPress(event: ReactPointerEvent, target: ClickTarget): void;
}

/**
 * The frame numbers of the header row (DESIGN §5.6), virtualized as the cells are (SE-026
 * review C): those of the grid window's columns and the active cel's, with gaps of their width
 * between them, so each lies over its column. It follows the window itself, as the rows' cells do.
 */
function FrameHeadersView({
    frameIds,
    selection,
    activeFrameIndex,
    focusIndex,
    windowStore,
    onPress,
}: FrameHeadersProps) {
    const columns = useSyncExternalStore(
        windowStore.subscribe,
        () => windowStore.current()?.columns ?? null,
    );
    const nodes: ReactNode[] = [];
    let next = 0;
    const gap = (to: number) => {
        if (to > next) {
            nodes.push(
                <div
                    key={`gap-${next}`}
                    className="timeline__gap"
                    aria-hidden="true"
                    style={{ width: (to - next) * CELL_WIDTH }}
                />,
            );
        }
    };
    const kept = focusIndex >= 0 ? focusIndex : activeFrameIndex;
    for (const index of renderedColumns(frameIds.length, columns, kept)) {
        const frameId = frameIds[index]!;
        gap(index);
        next = index + 1;
        nodes.push(
            <div
                key={frameId}
                className="timeline__frame"
                role="columnheader"
                aria-colindex={index + 2}
                aria-selected={
                    selection?.kind === "frames" && isCelSelected(selection, "", frameId)
                }
                data-frame={frameId}
                data-active-frame={index === activeFrameIndex || undefined}
                // The press selects; the focus goes to the active cell.
                onMouseDown={(event) => event.preventDefault()}
                onPointerDown={(event) => onPress(event, { kind: "frames", frameId })}
            >
                {index + 1}
            </div>,
        );
    }
    gap(frameIds.length);
    return nodes;
}

/** Drawn again only when what it shows changes, or the window's columns do. */
export const FrameHeaders = memo(FrameHeadersView);
