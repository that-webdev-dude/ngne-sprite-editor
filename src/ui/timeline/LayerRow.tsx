import { Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import { memo } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { MAX_NAME_LENGTH } from "../../core/model";
import { isCelSelected } from "../../app/timeline/selection";
import type { TimelineSelection } from "../../app/timeline/selection";
import { clickTimeline } from "../../app/timeline/timelineClicks";
import { TIMELINE_COMMANDS } from "../../app/timeline/timelineCommandIds";
import type { TimelineLayer, TimelineReference } from "../../app/timeline/timelineModel";
import { cancelRename, setRenameText, withArguments } from "../../app/timeline/timelineState";
import { runCommand } from "../commands/runCommand";
import { Icon } from "../primitives/Icon";
import { Toggle } from "../primitives/Toggle";
import { CELL_ATTRIBUTE, CELL_WIDTH, modifiersOf, TIMELINE_FIELD_ATTRIBUTE } from "./timelineDom";

export interface LayerRowProps {
    layer: TimelineLayer;
    frameIds: readonly string[];
    /** The active layer's row as the panel draws it: tinted. */
    tinted: boolean;
    /** The active frame's column as the panel draws it: tinted. */
    activeFrameIndex: number;
    /**
     * The row of the active layer in the session now: its header's controls are the only ones
     * of the layer column in the tab order.
     */
    focusRow: boolean;
    /**
     * The column of the active cel in the session now when this is its row, otherwise -1: the
     * active cell, the grid's tab stop, with the accent outline.
     */
    focusIndex: number;
    selection: TimelineSelection | null;
    /** The text of the in-place rename of this layer, or null. */
    renaming: string | null;
    /** A press on the row header selected the layer: the focus goes to the active cell. */
    onHeaderPress(): void;
    /** The in-place rename ended from the keyboard: the focus goes to the active cell. */
    onRenameEnd(): void;
}

/** Runs a layer command on this row's layer rather than on the active one. */
function runOnLayer(layerId: string, commandId: string): void {
    withArguments({ layerTarget: layerId }, () => void runCommand(commandId));
}

/** A press on a control of the row header is the control's, not a selection of the layer. */
function onControl(event: { target: EventTarget | null }): boolean {
    return event.target instanceof Element && event.target.closest("button, input") !== null;
}

function RenameField({ name, onEnd }: { name: string; onEnd(): void }) {
    return (
        <input
            className="timeline__rename"
            type="text"
            aria-label="Layer name"
            autoComplete="off"
            spellCheck={false}
            // As the layer properties popover: a longer name would be refused (SPEC §5.1).
            maxLength={MAX_NAME_LENGTH}
            {...{ [TIMELINE_FIELD_ATTRIBUTE]: "" }}
            // The field appears where the name was, for typing at once.
            autoFocus
            value={name}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setRenameText(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    runCommand(TIMELINE_COMMANDS.applyLayerName);
                    onEnd();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                    onEnd();
                }
            }}
            // Leaving the field keeps what was typed, as Enter does.
            onBlur={() => void runCommand(TIMELINE_COMMANDS.applyLayerName)}
        />
    );
}

/** The controls of a row header: visibility, lock, name (or its rename field), opacity. */
function HeaderControls({
    layer,
    tabIndex,
    renaming,
    onRenameEnd,
}: {
    layer: Pick<TimelineLayer, "id" | "name" | "visible" | "locked" | "opacity">;
    tabIndex: number;
    renaming: string | null;
    onRenameEnd(): void;
}) {
    return (
        <>
            <Toggle
                label="Visible"
                tabIndex={tabIndex}
                pressed={layer.visible}
                onPressedChange={() => runOnLayer(layer.id, TIMELINE_COMMANDS.toggleVisible)}
            >
                <Icon icon={layer.visible ? Eye : EyeOff} />
            </Toggle>
            <Toggle
                label="Locked"
                tabIndex={tabIndex}
                pressed={layer.locked}
                onPressedChange={() => runOnLayer(layer.id, TIMELINE_COMMANDS.toggleLocked)}
            >
                <Icon icon={layer.locked ? Lock : LockOpen} />
            </Toggle>
            {renaming === null ? (
                <span
                    className="timeline__name"
                    title={layer.name}
                    onDoubleClick={() => runOnLayer(layer.id, TIMELINE_COMMANDS.renameLayer)}
                >
                    {layer.name}
                </span>
            ) : (
                <RenameField name={renaming} onEnd={onRenameEnd} />
            )}
            <button
                type="button"
                className="timeline__opacity"
                tabIndex={tabIndex}
                aria-label={`Opacity ${layer.opacity}`}
                aria-haspopup="dialog"
                data-partial={layer.opacity < 255 || undefined}
                onClick={() => runOnLayer(layer.id, TIMELINE_COMMANDS.layerProperties)}
            >
                {layer.opacity}
            </button>
        </>
    );
}

/** One layer of the timeline: its header in the layer column, then a cell per frame. */
function LayerRowView({
    layer,
    frameIds,
    tinted,
    activeFrameIndex,
    focusRow,
    focusIndex,
    selection,
    renaming,
    onHeaderPress,
    onRenameEnd,
}: LayerRowProps) {
    const selected = selection?.kind === "layers" && selection.layerIds.includes(layer.id);
    // The grid is one tab stop (DESIGN §5.6): of the row headers only the active row's
    // controls are in the tab order, right before the active cell.
    const tabIndex = focusRow ? 0 : -1;

    const onHeaderPointerDown = (event: ReactPointerEvent) => {
        if (event.button !== 0 || onControl(event)) return;
        clickTimeline({ kind: "layers", layerId: layer.id }, modifiersOf(event));
        onHeaderPress();
    };
    // The press selects; the focus goes to the active cell, not to the body.
    const onHeaderMouseDown = (event: MouseEvent) => {
        if (!onControl(event)) event.preventDefault();
    };

    const header = (
        <div
            className="timeline__layer"
            role="rowheader"
            aria-label={layer.name}
            aria-selected={selected}
            data-layer-header=""
            onMouseDown={onHeaderMouseDown}
            onPointerDown={onHeaderPointerDown}
        >
            <HeaderControls
                layer={layer}
                tabIndex={tabIndex}
                renaming={renaming}
                onRenameEnd={onRenameEnd}
            />
        </div>
    );
    return (
        <div
            className="timeline__row"
            role="row"
            data-layer={layer.id}
            data-active-layer={tinted || undefined}
        >
            {header}
            {frameIds.map((frameId, index) => {
                const state = layer.cels[index] ?? "empty";
                const isActive = index === focusIndex;
                return (
                    <div
                        key={frameId}
                        className="timeline__cell"
                        role="gridcell"
                        aria-selected={isCelSelected(selection, layer.id, frameId)}
                        aria-label={`Frame ${index + 1}, ${state}`}
                        tabIndex={isActive ? 0 : -1}
                        {...{ [CELL_ATTRIBUTE]: "" }}
                        // F6 enters the timeline at its active cell.
                        data-region-focus={isActive ? "" : undefined}
                        data-frame={frameId}
                        data-cel={state}
                        data-active-frame={index === activeFrameIndex || undefined}
                        data-active-cel={isActive || undefined}
                        data-link-next={layer.linkedToNext[index] || undefined}
                        onPointerDown={(event) => {
                            if (event.button !== 0) return;
                            clickTimeline(
                                { kind: "cels", cel: { layerId: layer.id, frameId } },
                                modifiersOf(event),
                            );
                        }}
                    >
                        <span className="timeline__dot" />
                    </div>
                );
            })}
        </div>
    );
}

/** Rows are drawn again only when what they show changes, not at every document revision. */
export const LayerRow = memo(
    LayerRowView,
    (before, after) =>
        before.layer.key === after.layer.key &&
        before.frameIds === after.frameIds &&
        before.tinted === after.tinted &&
        before.activeFrameIndex === after.activeFrameIndex &&
        before.focusRow === after.focusRow &&
        before.focusIndex === after.focusIndex &&
        before.selection === after.selection &&
        before.renaming === after.renaming &&
        before.onHeaderPress === after.onHeaderPress &&
        before.onRenameEnd === after.onRenameEnd,
);

export interface ReferenceRowProps {
    layer: TimelineReference;
    /** Number of frame columns the row spans. */
    frameCount: number;
    /** The column of `frameId`: the part of the cell kept in view (`keepInView`). */
    frameIndex: number;
    /** The active layer's row as the panel draws it: tinted. */
    tinted: boolean;
    /**
     * The row of the active layer in the session now: its header's controls and its cell are
     * in the tab order, the cell being the grid's tab stop.
     */
    focusRow: boolean;
    /** The active frame now: the frame the row's cell stands for while it is the active one. */
    frameId: string;
    selection: TimelineSelection | null;
    renaming: string | null;
    onHeaderPress(): void;
    onRenameEnd(): void;
}

/**
 * One reference layer of the Reference group (DESIGN §5.6, SE-045): its header as a pixel
 * layer's (visibility, lock, name, opacity), then one cell across the frame columns, since a
 * reference layer has no cels, which names its placement. A press on the header or the cell
 * makes the layer the active one; while it is, the cell is the grid's tab stop, so the
 * keyboard reaches the row as it reaches a pixel layer's (↑ ↓ walk into the group).
 */
function ReferenceRowView({
    layer,
    frameCount,
    frameIndex,
    tinted,
    focusRow,
    frameId,
    selection,
    renaming,
    onHeaderPress,
    onRenameEnd,
}: ReferenceRowProps) {
    const selected = selection?.kind === "layers" && selection.layerIds.includes(layer.id);
    const tabIndex = focusRow ? 0 : -1;
    const press = (event: ReactPointerEvent) => {
        if (event.button !== 0 || onControl(event)) return;
        clickTimeline({ kind: "layers", layerId: layer.id }, modifiersOf(event));
        onHeaderPress();
    };
    const keepFocus = (event: MouseEvent) => {
        if (!onControl(event)) event.preventDefault();
    };
    const placement = layer.placement === "front" ? "In front" : "Behind";
    return (
        <div
            className="timeline__row timeline__row--reference"
            role="row"
            data-layer={layer.id}
            data-reference-layer=""
            data-active-layer={tinted || undefined}
        >
            <div
                className="timeline__layer"
                role="rowheader"
                aria-label={layer.name}
                aria-selected={selected}
                data-layer-header=""
                onMouseDown={keepFocus}
                onPointerDown={press}
            >
                <HeaderControls
                    layer={layer}
                    tabIndex={tabIndex}
                    renaming={renaming}
                    onRenameEnd={onRenameEnd}
                />
            </div>
            <div
                className="timeline__cell timeline__reference-cell"
                role="gridcell"
                aria-selected={selected}
                aria-label={`Reference layer, ${placement.toLowerCase()}`}
                aria-colspan={frameCount}
                style={{ width: Math.max(1, frameCount) * CELL_WIDTH }}
                tabIndex={tabIndex}
                {...{ [CELL_ATTRIBUTE]: "" }}
                data-region-focus={focusRow ? "" : undefined}
                data-frame={frameId}
                data-frame-index={frameIndex}
                data-active-cel={focusRow || undefined}
                // As a cel's cell: the press makes it active and the click focuses it.
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    clickTimeline({ kind: "layers", layerId: layer.id }, modifiersOf(event));
                }}
            >
                <span className="timeline__placement">{placement}</span>
            </div>
        </div>
    );
}

/** Drawn again only when what the row shows changes. */
export const ReferenceRow = memo(
    ReferenceRowView,
    (before, after) =>
        before.layer.key === after.layer.key &&
        before.frameCount === after.frameCount &&
        before.frameIndex === after.frameIndex &&
        before.tinted === after.tinted &&
        before.focusRow === after.focusRow &&
        before.frameId === after.frameId &&
        before.selection === after.selection &&
        before.renaming === after.renaming &&
        before.onHeaderPress === after.onHeaderPress &&
        before.onRenameEnd === after.onRenameEnd,
);
