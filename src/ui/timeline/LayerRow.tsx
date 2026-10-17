import { Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import { memo } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { isCelSelected } from "../../app/timeline/selection";
import type { TimelineSelection } from "../../app/timeline/selection";
import { clickTimeline } from "../../app/timeline/timelineClicks";
import { TIMELINE_COMMANDS } from "../../app/timeline/timelineCommandIds";
import type { TimelineLayer } from "../../app/timeline/timelineModel";
import { cancelRename, setRenameText, withArguments } from "../../app/timeline/timelineState";
import { runCommand } from "../commands/runCommand";
import { Icon } from "../primitives/Icon";
import { Toggle } from "../primitives/Toggle";
import { CELL_ATTRIBUTE, modifiersOf } from "./timelineDom";

export interface LayerRowProps {
    layer: TimelineLayer;
    frameIds: readonly string[];
    /** The active layer's row: tinted, and its cel at the active frame is the active cell. */
    active: boolean;
    activeFrameIndex: number;
    selection: TimelineSelection | null;
    /** The text of the in-place rename of this layer, or null. */
    renaming: string | null;
    /** A press on the row header selected the layer. */
    onHeaderPress(): void;
    /** The in-place rename ended from the keyboard. */
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

/** One layer of the timeline: its header in the layer column, then a cell per frame. */
function LayerRowView({
    layer,
    frameIds,
    active,
    activeFrameIndex,
    selection,
    renaming,
    onHeaderPress,
    onRenameEnd,
}: LayerRowProps) {
    const selected = selection?.kind === "layers" && selection.layerIds.includes(layer.id);

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
            <Toggle
                label="Visible"
                pressed={layer.visible}
                onPressedChange={() => runOnLayer(layer.id, TIMELINE_COMMANDS.toggleVisible)}
            >
                <Icon icon={layer.visible ? Eye : EyeOff} />
            </Toggle>
            <Toggle
                label="Locked"
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
                aria-label={`Opacity ${layer.opacity}`}
                aria-haspopup="dialog"
                data-partial={layer.opacity < 255 || undefined}
                onClick={() => runOnLayer(layer.id, TIMELINE_COMMANDS.layerProperties)}
            >
                {layer.opacity}
            </button>
        </div>
    );
    return (
        <div
            className="timeline__row"
            role="row"
            data-layer={layer.id}
            data-active-layer={active || undefined}
        >
            {header}
            {frameIds.map((frameId, index) => {
                const state = layer.cels[index] ?? "empty";
                const isActive = active && index === activeFrameIndex;
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
        before.active === after.active &&
        before.activeFrameIndex === after.activeFrameIndex &&
        before.selection === after.selection &&
        before.renaming === after.renaming &&
        before.onHeaderPress === after.onHeaderPress &&
        before.onRenameEnd === after.onRenameEnd,
);
