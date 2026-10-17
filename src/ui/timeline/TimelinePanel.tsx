import { Popover as RadixPopover } from "radix-ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useSessions } from "../../app/state/sessions";
import { effectiveSelection, targetFrameIds } from "../../app/timeline/selection";
import { clickTimeline } from "../../app/timeline/timelineClicks";
import { TIMELINE_COMMANDS } from "../../app/timeline/timelineCommandIds";
import type { TimelineModel } from "../../app/timeline/timelineModel";
import { cancelRename, useTimelineState } from "../../app/timeline/timelineState";
import { runCommand } from "../commands/runCommand";
import { finishProperties, LayerProperties } from "./LayerProperties";
import { LayerRow } from "./LayerRow";
import {
    activeCell,
    CELL_ATTRIBUTE,
    CELL_WIDTH,
    focusActiveCell,
    keepInView,
    layerHeaderOf,
    modifiersOf,
} from "./timelineDom";
import { TimelineCorner, Transport } from "./Transport";
import { useShownTimeline } from "./useShownTimeline";
import "./timeline.css";

/**
 * The timeline panel (DESIGN §5.6, SE-022): the transport and the tag bar on top, the frame
 * header, and one row per pixel layer, top of the stack first — the layer's visibility, lock,
 * name and opacity, then its cels. The grid is one ARIA grid whose active cell is its only tab
 * stop; ← → ↑ ↓ Home End move the active cell through the registry's `timeline` bindings, and
 * the focus follows it. Nothing is shown while no document is open.
 *
 * Every change to a document runs a registered command; clicks and the arrow keys change the
 * active cel and the selection, which are session and editor state (SPEC §5.2).
 */
export function TimelinePanel() {
    // The document's timeline as one string, and the selection: shown once the canvas has had
    // its next two animation frames, and rendered again only when they changed.
    const { key, selection } = useShownTimeline();
    // The active document as the store has it now, which the shown timeline may trail.
    const liveId = useSessions((state) => state.activeId);
    const rename = useTimelineState((state) => state.rename);
    const properties = useTimelineState((state) => state.properties);
    const grid = useRef<HTMLDivElement>(null);

    const model = useMemo(() => (key === null ? null : (JSON.parse(key) as TimelineModel)), [key]);
    // The rows keep one array of frame ids while the ids stay the same.
    const frameKey = model ? model.frames.map((frame) => frame.id).join("\n") : "";
    const frameIds = useMemo(() => (frameKey === "" ? [] : frameKey.split("\n")), [frameKey]);
    const activeKey = model ? `${model.activeLayerId}\n${model.activeFrameId}` : "";

    // The active cell stays in view, and keeps the focus while the focus is on a cell.
    useLayoutEffect(() => {
        const cell = activeCell(grid.current);
        const scroller = grid.current?.closest<HTMLElement>("[data-timeline]");
        if (!cell || !scroller) return;
        const focused = window.document.activeElement;
        if (focused instanceof HTMLElement && focused.hasAttribute(CELL_ATTRIBUTE)) {
            if (focused !== cell) cell.focus({ preventScroll: true });
        }
        keepInView(scroller, cell);
    }, [activeKey]);

    // One function for every row, so that the rows' memo holds.
    const focusGrid = useCallback(() => focusActiveCell(grid.current), []);

    // An edit whose document stops being the active one (or closes) ends: applied when its
    // document can take it, dropped otherwise.
    useEffect(() => {
        if (properties && properties.documentId !== liveId) finishProperties();
        if (rename && rename.documentId !== liveId) {
            if (!runCommand(TIMELINE_COMMANDS.applyLayerName)) cancelRename();
        }
    }, [properties, rename, liveId]);
    const activeId = model?.documentId ?? null;

    // The layer properties popover points at the row header of its layer. A virtual anchor:
    // wrapping the header in an anchor element would rebuild the row when the popover opens
    // and closes, and lose the focus inside it.
    const editedLayer =
        properties && properties.documentId === activeId ? properties.layerId : null;
    const anchor = useMemo(
        () => ({
            current: {
                getBoundingClientRect: (): DOMRect => {
                    const header =
                        editedLayer === null ? null : layerHeaderOf(grid.current, editedLayer);
                    return (header ?? grid.current ?? window.document.body).getBoundingClientRect();
                },
            },
        }),
        [editedLayer],
    );

    if (!model) return null;

    const current = effectiveSelection(selection, model.documentId, model);
    const activeFrameIndex = frameIds.indexOf(model.activeFrameId);
    const targets = targetFrameIds({ doc: model, activeFrameId: model.activeFrameId }, current);
    const durationFrame =
        model.frames.find(
            (frame) => frame.id === model.activeFrameId && targets.includes(frame.id),
        ) ?? model.frames.find((frame) => frame.id === targets[0]);
    const renaming = rename?.documentId === model.documentId ? rename : null;
    const editing = properties?.documentId === model.documentId ? properties : null;

    /** A press on a frame of the header: select it, then give the focus to the active cell. */
    const onFramePress = (frameId: string) => (event: ReactPointerEvent) => {
        if (event.button !== 0) return;
        clickTimeline({ kind: "frames", frameId }, modifiersOf(event));
        focusActiveCell(grid.current);
    };

    return (
        <div className="timeline" data-timeline="">
            <div className="timeline__bar">
                <Transport />
                {/* The tag bar (SE-023) spans the frame columns. */}
                <div
                    className="timeline__tags"
                    data-timeline-tags=""
                    style={{ width: frameIds.length * CELL_WIDTH }}
                />
            </div>
            <RadixPopover.Root
                modal
                open={editing !== null}
                onOpenChange={(open) => {
                    if (!open) finishProperties();
                }}
            >
                <RadixPopover.Anchor virtualRef={anchor} />
                <div
                    ref={grid}
                    className="timeline__grid"
                    role="grid"
                    aria-label="Cels"
                    aria-multiselectable="true"
                >
                    <div className="timeline__row timeline__row--header" role="row">
                        <TimelineCorner durationMs={durationFrame?.durationMs ?? null} />
                        {model.frames.map((frame, index) => (
                            <div
                                key={frame.id}
                                className="timeline__frame"
                                role="columnheader"
                                aria-selected={
                                    current?.kind === "frames" &&
                                    current.frameIds.includes(frame.id)
                                }
                                data-frame={frame.id}
                                data-active-frame={index === activeFrameIndex || undefined}
                                // The press selects; the focus goes to the active cell.
                                onMouseDown={(event) => event.preventDefault()}
                                onPointerDown={onFramePress(frame.id)}
                            >
                                {index + 1}
                            </div>
                        ))}
                    </div>
                    {model.layers.map((layer) => (
                        <LayerRow
                            key={layer.id}
                            layer={layer}
                            frameIds={frameIds}
                            active={layer.id === model.activeLayerId}
                            activeFrameIndex={activeFrameIndex}
                            selection={current}
                            renaming={renaming?.layerId === layer.id ? renaming.name : null}
                            onHeaderPress={focusGrid}
                            onRenameEnd={focusGrid}
                        />
                    ))}
                </div>
                {editing ? <LayerProperties draft={editing} fallback={focusGrid} /> : null}
            </RadixPopover.Root>
        </div>
    );
}
