import { Popover as RadixPopover } from "radix-ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { activeDocument, sessionsStore, useSessions } from "../../app/state/sessions";
import { effectiveSelection } from "../../app/timeline/selection";
import { SHOWN_TAG_ROWS } from "../../app/timeline/tagLayout";
import { clickTimeline } from "../../app/timeline/timelineClicks";
import { TIMELINE_COMMANDS } from "../../app/timeline/timelineCommandIds";
import { useTimelineState } from "../../app/timeline/timelineState";
import { runCommand } from "../commands/runCommand";
import { finishProperties, LayerProperties } from "./LayerProperties";
import { LayerRow, ReferenceRow } from "./LayerRow";
import { TagBar } from "./TagBar";
import {
    activeCell,
    CELL_ATTRIBUTE,
    cellOf,
    focusCell,
    keepInView,
    layerHeaderOf,
    modifiersOf,
    TIMELINE_FIELD_ATTRIBUTE,
} from "./timelineDom";
import { TimelineCorner, Transport } from "./Transport";
import { useLiveCel, useShownTimeline } from "./useShownTimeline";
import "./timeline.css";

/**
 * The timeline panel (DESIGN §5.6, SE-022): the transport and the tag bar (SE-023) on top, the
 * frame header, and one row per pixel layer, top of the stack first — the layer's visibility,
 * lock, name and opacity, then its cels. The grid is one ARIA grid whose active cell is its only tab
 * stop besides the controls of the active row's header; ← → ↑ ↓ Home End move the active cell
 * through the registry's `timeline` bindings, and the focus follows it. Nothing is shown while
 * no document is open.
 *
 * Every change to a document runs a registered command; clicks and the arrow keys change the
 * active cel and the selection, which are session and editor state (SPEC §5.2). The panel
 * draws the timeline once the canvas has had its frame (`useShownTimeline`); the active cell's
 * tab stop and the focus follow the session at once (`useLiveCel`).
 */
export function TimelinePanel() {
    const { model, selection } = useShownTimeline();
    const live = useLiveCel();
    const liveId = useSessions((state) => state.activeId);
    const rename = useTimelineState((state) => state.rename);
    const properties = useTimelineState((state) => state.properties);
    const root = useRef<HTMLDivElement>(null);
    const grid = useRef<HTMLDivElement>(null);

    // The rows keep one array of frame ids while the ids stay the same.
    const frameKey = model ? model.frames.map((frame) => frame.id).join("\n") : "";
    const frameIds = useMemo(() => (frameKey === "" ? [] : frameKey.split("\n")), [frameKey]);

    // A new active cell (in the session, or now drawn) is scrolled into view, and takes the
    // focus while the focus is on a cell. Checked at every render: the active cel of a new frame
    // or layer is drawn only once the panel draws the frame or the layer.
    const shownCell = useRef<HTMLElement | null>(null);
    useLayoutEffect(() => {
        const cell = activeCell(grid.current);
        const scroller = root.current;
        if (!cell || !scroller || cell === shownCell.current) return;
        shownCell.current = cell;
        const focused = window.document.activeElement;
        if (focused instanceof HTMLElement && focused.hasAttribute(CELL_ATTRIBUTE)) {
            if (focused !== cell) cell.focus({ preventScroll: true });
        }
        keepInView(scroller, cell);
    });

    // A press anywhere outside a focused field of the panel applies what the field holds
    // before anything else acts on the press: before a click in the grid selects, and before
    // a press on the canvas begins a stroke (which would leave the history no room for it).
    useEffect(() => {
        const onPress = (event: PointerEvent) => {
            const focused = window.document.activeElement;
            if (!(focused instanceof HTMLElement) || !root.current?.contains(focused)) return;
            const field = focused.closest(`[${TIMELINE_FIELD_ATTRIBUTE}]`);
            if (!field) return;
            if (event.target instanceof Node && field.contains(event.target)) return;
            focused.blur();
        };
        window.addEventListener("pointerdown", onPress, true);
        return () => window.removeEventListener("pointerdown", onPress, true);
    }, []);

    // The focus goes to the cell that is active in the session now, which the rendered grid
    // may not show yet (a press is handled before the panel renders its result): the old
    // active cell never takes the focus on the way, nor scrolls into view.
    const focusActive = useCallback(() => {
        const document = activeDocument(sessionsStore.getState());
        if (!document) return;
        const { activeLayerId, activeFrameId } = document.session;
        focusCell(cellOf(grid.current, activeLayerId, activeFrameId));
    }, []);

    // A press on the tag bar keeps the focus in the timeline, on the active cell, without
    // scrolling it into view: the span pressed stays under the pointer.
    const focusActiveInPlace = useCallback(() => {
        const document = activeDocument(sessionsStore.getState());
        if (!document) return;
        const { activeLayerId, activeFrameId } = document.session;
        cellOf(grid.current, activeLayerId, activeFrameId)?.focus({ preventScroll: true });
    }, []);

    // An edit whose document stops being the active one ends: applied when its document can
    // take it (a closed document's edits are dropped by `timelineLifetime`).
    useEffect(() => {
        if (properties && properties.documentId !== liveId) finishProperties();
        if (rename && rename.documentId !== liveId) runCommand(TIMELINE_COMMANDS.applyLayerName);
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
    // Tints: the active row and column as drawn. Tab stop and outline: the active cel now.
    const activeFrameIndex = frameIds.indexOf(model.activeFrameId);
    const liveLayerId = live?.documentId === model.documentId ? live.layerId : null;
    const liveFrameIndex = live ? frameIds.indexOf(live.frameId) : -1;
    const renaming = rename?.documentId === model.documentId ? rename : null;
    const editing = properties?.documentId === model.documentId ? properties : null;

    /** A press on a frame of the header: select it, then give the focus to the active cell. */
    const onFramePress = (frameId: string) => (event: ReactPointerEvent) => {
        if (event.button !== 0) return;
        clickTimeline({ kind: "frames", frameId }, modifiersOf(event));
        focusActive();
    };

    // The bar grows by a row per overlap level of the tags, up to three (DESIGN §2).
    const tagRows = Math.min(model.tags.rows, SHOWN_TAG_ROWS);

    return (
        <div
            ref={root}
            className="timeline"
            data-timeline=""
            data-tag-rows={tagRows > 1 ? tagRows : undefined}
        >
            <div className="timeline__bar">
                <Transport />
                {/* The tag bar (SE-023) spans the frame columns. */}
                <TagBar
                    documentId={model.documentId}
                    tags={model.tags}
                    frameIds={frameIds}
                    onPress={focusActiveInPlace}
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
                        <TimelineCorner />
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
                            tinted={layer.id === model.activeLayerId}
                            activeFrameIndex={activeFrameIndex}
                            focusRow={layer.id === liveLayerId}
                            focusIndex={layer.id === liveLayerId ? liveFrameIndex : -1}
                            selection={current}
                            renaming={renaming?.layerId === layer.id ? renaming.name : null}
                            onHeaderPress={focusActive}
                            onRenameEnd={focusActive}
                        />
                    ))}
                    {model.references.length > 0 ? (
                        // The Reference group (SE-045): under the pixel layers, top first.
                        <div
                            className="timeline__references"
                            role="rowgroup"
                            aria-label="Reference"
                        >
                            <div className="timeline__group-label" aria-hidden="true">
                                Reference
                            </div>
                            {model.references.map((layer) => (
                                <ReferenceRow
                                    key={layer.id}
                                    layer={layer}
                                    frameCount={frameIds.length}
                                    tinted={layer.id === model.activeLayerId}
                                    focusRow={layer.id === liveLayerId}
                                    frameId={
                                        live?.documentId === model.documentId
                                            ? live.frameId
                                            : model.activeFrameId
                                    }
                                    selection={current}
                                    renaming={renaming?.layerId === layer.id ? renaming.name : null}
                                    onHeaderPress={focusActive}
                                    onRenameEnd={focusActive}
                                />
                            ))}
                        </div>
                    ) : null}
                </div>
                {editing ? <LayerProperties draft={editing} fallback={focusActive} /> : null}
            </RadixPopover.Root>
        </div>
    );
}
