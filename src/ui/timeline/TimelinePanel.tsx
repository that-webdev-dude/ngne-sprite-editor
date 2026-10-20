import { Popover as RadixPopover } from "radix-ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { activeDocument, sessionsStore, useSessions } from "../../app/state/sessions";
import { effectiveSelection } from "../../app/timeline/selection";
import { SHOWN_TAG_ROWS } from "../../app/timeline/tagLayout";
import { TIMELINE_COMMANDS } from "../../app/timeline/timelineCommandIds";
import { useTimelineState } from "../../app/timeline/timelineState";
import { runCommand } from "../commands/runCommand";
import { useGridWindow } from "./gridWindow";
import { FrameHeaders } from "./FrameHeaders";
import { finishProperties, LayerProperties } from "./LayerProperties";
import { LayerRow, ReferenceRow } from "./LayerRow";
import { TagBar } from "./TagBar";
import { TimelineContextMenu } from "./TimelineContextMenu";
import {
    activeCell,
    CELL_ATTRIBUTE,
    cellOf,
    focusCell,
    keepInView,
    layerHeaderOf,
    TIMELINE_FIELD_ATTRIBUTE,
} from "./timelineDom";
import { TimelineCorner, Transport } from "./Transport";
import { useLiveCel, useShownTimeline } from "./useShownTimeline";
import { useTimelineDrag } from "./useTimelineDrag";
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
 *
 * SE-026: frames, layers and cels are dragged (`useTimelineDrag`), right-clicks open the
 * context menus of the registry (`TimelineContextMenu`), and of the cels' cells only those in
 * the grid's window and the active cell are rendered (`useGridWindow`).
 */
export function TimelinePanel() {
    const { model, selection } = useShownTimeline();
    const live = useLiveCel();
    const liveId = useSessions((state) => state.activeId);
    const rename = useTimelineState((state) => state.rename);
    const properties = useTimelineState((state) => state.properties);
    const root = useRef<HTMLDivElement>(null);
    const grid = useRef<HTMLDivElement>(null);
    const windowStore = useGridWindow(root, grid, model !== null);
    /** The active cell is to take the focus once it is rendered (`focusActive`). */
    const focusWanted = useRef(false);
    /**
     * A cell has the focus. A cell that leaves the DOM takes the focus with it without a blur
     * (SE-026: the old active cell, out of the window): the new active cell takes it then.
     */
    const cellFocused = useRef(false);

    // The rows keep one array of frame ids while the ids stay the same.
    const frameKey = model ? model.frames.map((frame) => frame.id).join("\n") : "";
    const frameIds = useMemo(() => (frameKey === "" ? [] : frameKey.split("\n")), [frameKey]);

    // A new active cell (in the session, or now drawn) is scrolled into view, and takes the
    // focus while the focus is on a cell. Checked at every render: the active cel of a new frame
    // or layer is drawn only once the panel draws the frame or the layer.
    // The cell and the frame it stands for: a reference layer's one cell stands for the active
    // frame, and is kept in view again at each frame (SE-045).
    const shownCell = useRef<{ cell: HTMLElement; frame: string | undefined } | null>(null);
    useLayoutEffect(() => {
        const cell = activeCell(grid.current);
        const scroller = root.current;
        if (!cell || !scroller) return;
        const lost = window.document.activeElement;
        if (focusWanted.current || (cellFocused.current && (!lost || lost === document.body))) {
            focusWanted.current = false;
            cell.focus({ preventScroll: true });
        }
        const frame = cell.dataset.frame;
        if (shownCell.current?.cell === cell && shownCell.current.frame === frame) return;
        shownCell.current = { cell, frame };
        const focused = window.document.activeElement;
        if (focused instanceof HTMLElement && focused.hasAttribute(CELL_ATTRIBUTE)) {
            if (focused !== cell) cell.focus({ preventScroll: true });
        }
        keepInView(scroller, cell);
        // The cells around it, before the scroll event says so.
        windowStore.measure();
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
    // A cell that is not rendered yet (out of the grid's window, SE-026) takes it once it is.
    const focusActive = useCallback(() => {
        const document = activeDocument(sessionsStore.getState());
        if (!document) return;
        const { activeLayerId, activeFrameId } = document.session;
        const cell = cellOf(grid.current, activeLayerId, activeFrameId);
        focusWanted.current = cell === null;
        focusCell(cell);
    }, []);

    const { onPress, indicator } = useTimelineDrag(root, grid, focusActive);

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

    // The bar grows by a row per overlap level of the tags, up to three (DESIGN §2).
    const tagRows = Math.min(model.tags.rows, SHOWN_TAG_ROWS);

    const rowCount = 1 + model.layers.length + model.references.length;
    return (
        <TimelineContextMenu panel={root} focusActive={focusActive}>
            <div
                ref={root}
                className="timeline"
                data-timeline=""
                data-tag-rows={tagRows > 1 ? tagRows : undefined}
                data-dragging={indicator ? indicator.kind : undefined}
                data-drag-copy={indicator?.copy || undefined}
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
                        onFocus={(event) => {
                            cellFocused.current = event.target.hasAttribute(CELL_ATTRIBUTE);
                        }}
                        onBlur={() => {
                            cellFocused.current = false;
                        }}
                        aria-rowcount={rowCount}
                        aria-colcount={frameIds.length + 1}
                    >
                        <div
                            className="timeline__row timeline__row--header"
                            role="row"
                            aria-rowindex={1}
                        >
                            <TimelineCorner />
                            <FrameHeaders
                                frameIds={frameIds}
                                selection={current}
                                activeFrameIndex={activeFrameIndex}
                                focusIndex={liveFrameIndex}
                                windowStore={windowStore}
                                onPress={onPress}
                            />
                        </div>
                        {model.layers.map((layer, row) => (
                            <LayerRow
                                key={layer.id}
                                layer={layer}
                                row={row}
                                windowStore={windowStore}
                                frameIds={frameIds}
                                tinted={layer.id === model.activeLayerId}
                                activeFrameIndex={activeFrameIndex}
                                focusRow={layer.id === liveLayerId}
                                focusIndex={layer.id === liveLayerId ? liveFrameIndex : -1}
                                selection={current}
                                renaming={renaming?.layerId === layer.id ? renaming.name : null}
                                onPress={onPress}
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
                                {model.references.map((layer, row) => (
                                    <ReferenceRow
                                        key={layer.id}
                                        layer={layer}
                                        rowIndex={model.layers.length + row + 2}
                                        frameCount={frameIds.length}
                                        frameIndex={
                                            layer.id === liveLayerId
                                                ? liveFrameIndex
                                                : activeFrameIndex
                                        }
                                        tinted={layer.id === model.activeLayerId}
                                        focusRow={layer.id === liveLayerId}
                                        frameId={
                                            live?.documentId === model.documentId
                                                ? live.frameId
                                                : model.activeFrameId
                                        }
                                        selection={current}
                                        renaming={
                                            renaming?.layerId === layer.id ? renaming.name : null
                                        }
                                        onPress={onPress}
                                        onRenameEnd={focusActive}
                                    />
                                ))}
                            </div>
                        ) : null}
                        {indicator ? (
                            // Where the drag drops (SE-026).
                            <div
                                className="timeline__drop"
                                aria-hidden="true"
                                data-drop={indicator.kind}
                                data-copy={indicator.copy || undefined}
                                data-refused={indicator.refused || undefined}
                                style={{
                                    left: indicator.left,
                                    top: indicator.top,
                                    width: indicator.width,
                                    height: indicator.height,
                                }}
                            />
                        ) : null}
                    </div>
                    {editing ? <LayerProperties draft={editing} fallback={focusActive} /> : null}
                </RadixPopover.Root>
            </div>
        </TimelineContextMenu>
    );
}
