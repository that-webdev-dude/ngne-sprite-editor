import { useEffect, useState } from "react";
import type { Dispatch, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from "react";
import { stopPlaybackForEdit } from "../../app/playback/playbackState";
import { activeDocument, sessionsStore } from "../../app/state/sessions";
import type { OpenDocument } from "../../app/state/sessions";
import { clampCelOffset, editableCels, landsOnLocked } from "../../app/timeline/celTargets";
import { effectiveSelection } from "../../app/timeline/selection";
import type { CelRef, ClickModifiers, ClickTarget } from "../../app/timeline/selection";
import { clickTimeline } from "../../app/timeline/timelineClicks";
import { availableDocument } from "../../app/timeline/timelineDocument";
import { withDrop } from "../../app/timeline/timelineDrop";
import type { DropArgument } from "../../app/timeline/timelineDrop";
import { TIMELINE_EDIT_COMMANDS } from "../../app/timeline/timelineEditIds";
import { timelineStore } from "../../app/timeline/timelineState";
import { runCommand } from "../commands/runCommand";
import { CELL_WIDTH, columnZeroOf, modifiersOf, STICKY_TOP } from "./timelineDom";

// Drags in the timeline grid (SE-026; DESIGN §5.6): a frame number or a layer row dragged
// reorders the frames or layers selected, a cel dragged moves the cels selected and a Ctrl-drag
// (Cmd on a Mac) copies them. While the button is held a drop indicator shows where the release
// lands them: a line between two columns or rows, or the rectangle the cels take (marked when a
// locked layer refuses it). The release runs one drop command (`withDrop`): one undo step.
// Escape cancels the drag.
//
// A press selects as a click does (DESIGN §5.6), except on an item that is selected already:
// that click waits for the release, so the selection can be dragged, and happens then if the
// pointer did not move far enough to drag.

/** How far the pointer moves, in CSS pixels, before a press becomes a drag. */
export const DRAG_THRESHOLD = 4;

/**
 * A drag held this close to an edge of the grid's part in view, or past it, scrolls the panel
 * that way, up to `SCROLL_STEP` pixels per animation frame (faster nearer the edge).
 */
export const SCROLL_EDGE = 24;
export const SCROLL_STEP = 16;

/** What the drop indicator shows, in pixels of the grid's box. */
export interface DropIndicator {
    readonly kind: "cels" | "frames" | "layers";
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    /** A Ctrl-drag of cels: the release copies them. */
    readonly copy: boolean;
    /** The cels would land on a locked layer: the release does nothing. */
    readonly refused: boolean;
}

type Drag =
    | {
          readonly kind: "cels";
          /** The selected cels of layers that are not locked: what the drop moves or copies. */
          readonly cels: readonly CelRef[];
          /** The pressed cel: its row (top first) and column. */
          readonly row: number;
          readonly column: number;
          readonly anchor: CelRef;
      }
    | { readonly kind: "frames"; readonly frameIds: readonly string[] }
    | {
          readonly kind: "layers";
          readonly layerIds: readonly string[];
          readonly reference: boolean;
      };

interface Press {
    readonly pointerId: number;
    readonly target: ClickTarget;
    readonly x: number;
    readonly y: number;
    readonly documentId: string;
    /** The click of a press on a selected item, made at the release unless it drags. */
    readonly deferred: ClickModifiers | null;
    drag: Drag | null;
    /** What the release drops, as the last pointer position gave it. */
    drop: DropArgument | null;
    copy: boolean;
    /** The pointer's last position. */
    pointer: { x: number; y: number };
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

const sameCel = (a: CelRef, b: CelRef) => a.layerId === b.layerId && a.frameId === b.frameId;

/** Whether the selection holds what a press is on, by the press's own kind. */
function selectionHolds(document: OpenDocument, target: ClickTarget): boolean {
    const selection = effectiveSelection(
        timelineStore.getState().selection,
        document.id,
        document.session,
    );
    if (selection?.kind !== target.kind) return false;
    switch (target.kind) {
        case "cels":
            return selection.kind === "cels" && selection.cels.some((c) => sameCel(c, target.cel));
        case "frames":
            return selection.kind === "frames" && selection.frameIds.includes(target.frameId);
        case "layers":
            return selection.kind === "layers" && selection.layerIds.includes(target.layerId);
    }
}

function pixelRowsOf(grid: HTMLElement): HTMLElement[] {
    return [
        ...grid.querySelectorAll<HTMLElement>(
            '[role="row"][data-layer]:not([data-reference-layer])',
        ),
    ];
}

function referenceRowsOf(grid: HTMLElement): HTMLElement[] {
    return [...grid.querySelectorAll<HTMLElement>('[role="row"][data-reference-layer]')];
}

/** The row (of `rows`, top first) at client `y`, the nearest one above or below the rows. */
function rowAt(rows: readonly HTMLElement[], y: number): number {
    for (let index = 0; index < rows.length; index++) {
        if (y < rows[index]!.getBoundingClientRect().bottom) return index;
    }
    return rows.length - 1;
}

interface TimelineDrag {
    onPress(event: ReactPointerEvent, target: ClickTarget): void;
    /** Ends a press or a drag without dropping. */
    end(): void;
}

/**
 * Pointer handling of the grid's drags. `onPress` is called by a press on a cel, a frame number
 * or a layer row (not on its controls); `focusActive` gives the focus to the active cell (a
 * stable function); `setIndicator` sets the drop indicator to draw.
 */
function createTimelineDrag(
    root: RefObject<HTMLElement | null>,
    grid: RefObject<HTMLElement | null>,
    focusActive: () => void,
    setIndicator: Dispatch<SetStateAction<DropIndicator | null>>,
): TimelineDrag {
    let press: Press | null = null;
    let stop: (() => void) | null = null;
    /** The animation frame of the scroll at an edge (`autoscroll`). */
    let frame: number | null = null;

    /** Ends the press: no drop, no click. */
    const end = () => {
        const current = press;
        press = null;
        stop?.();
        stop = null;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        setIndicator(null);
        const element = root.current;
        if (current && element?.hasPointerCapture(current.pointerId)) {
            element.releasePointerCapture(current.pointerId);
        }
    };

    /** What dragging the selection from the press's item drags; null when nothing can be. */
    const dragOf = (current: Press): Drag | null => {
        const document = availableDocument();
        const element = grid.current;
        if (!document || document.id !== current.documentId || !element) return null;
        const { session } = document;
        const { doc } = session;
        const selection = effectiveSelection(
            timelineStore.getState().selection,
            document.id,
            session,
        );
        const { target } = current;
        if (selection?.kind !== target.kind) return null;
        if (target.kind === "cels" && selection.kind === "cels") {
            const cels = editableCels(doc, selection.cels);
            const row = pixelRowsOf(element).findIndex(
                (entry) => entry.dataset.layer === target.cel.layerId,
            );
            const column = doc.frames.findIndex((frame) => frame.id === target.cel.frameId);
            if (cels.length === 0 || row === -1 || column === -1) return null;
            return { kind: "cels", cels, row, column, anchor: target.cel };
        }
        if (target.kind === "frames" && selection.kind === "frames") {
            const chosen = new Set(selection.frameIds);
            const frameIds = doc.frames.filter((f) => chosen.has(f.id)).map((f) => f.id);
            return frameIds.length > 0 ? { kind: "frames", frameIds } : null;
        }
        if (target.kind === "layers" && selection.kind === "layers") {
            const pressed = doc.layers.find((layer) => layer.id === target.layerId);
            if (!pressed) return null;
            const chosen = new Set(selection.layerIds);
            const layerIds = doc.layers
                .filter((layer) => chosen.has(layer.id) && layer.kind === pressed.kind)
                .map((layer) => layer.id);
            return { kind: "layers", layerIds, reference: pressed.kind === "reference" };
        }
        return null;
    };

    /** Where the drag would drop at client `x`, `y`, and the indicator of it. */
    const locate = (current: Press, drag: Drag, x: number, y: number, copy: boolean) => {
        const element = grid.current;
        const document = activeDocument(sessionsStore.getState());
        if (!element || !document || document.id !== current.documentId) return null;
        const box = element.getBoundingClientRect();
        const { doc } = document.session;
        // Column i starts at column 0's left + i cells: the frame numbers are virtualized.
        const columnZero = columnZeroOf(element);
        const headerRow = element.querySelector(".timeline__row--header")?.getBoundingClientRect();
        if (columnZero === null || !headerRow) return null;
        const frameCount = doc.frames.length;
        const { documentId } = current;
        if (drag.kind === "frames") {
            const gap = clamp(Math.round((x - columnZero) / CELL_WIDTH), 0, frameCount);
            const top = headerRow.top - box.top;
            const drop: DropArgument = {
                kind: "frames",
                documentId,
                frameIds: drag.frameIds,
                before: gap,
            };
            const shown: DropIndicator = {
                kind: "frames",
                left: columnZero + gap * CELL_WIDTH - box.left - 1,
                top,
                width: 2,
                height: box.height - top,
                copy: false,
                refused: false,
            };
            return { drop, shown };
        }
        if (drag.kind === "layers") {
            const rows = drag.reference ? referenceRowsOf(element) : pixelRowsOf(element);
            const boxes = rows.map((row) => row.getBoundingClientRect());
            const [first] = boxes;
            const last = boxes[boxes.length - 1];
            if (!first || !last) return null;
            const gap = boxes.filter((row) => (row.top + row.bottom) / 2 < y).length;
            const line = gap < boxes.length ? boxes[gap]!.top : last.bottom;
            const drop: DropArgument = {
                kind: "layers",
                documentId,
                layerIds: drag.layerIds,
                gap,
            };
            const shown: DropIndicator = {
                kind: "layers",
                left: first.left - box.left,
                top: line - box.top - 1,
                width: first.width,
                height: 2,
                copy: false,
                refused: false,
            };
            return { drop, shown };
        }
        const rows = pixelRowsOf(element);
        if (rows.length === 0) return null;
        const column = clamp(Math.floor((x - columnZero) / CELL_WIDTH), 0, frameCount - 1);
        const offset = clampCelOffset(doc, drag.cels, {
            layers: drag.row - rowAt(rows, y),
            frames: column - drag.column,
        });
        const rowsOf = drag.cels.map((cel) =>
            rows.findIndex((row) => row.dataset.layer === cel.layerId),
        );
        const columnsOf = drag.cels.map((cel) =>
            doc.frames.findIndex((frame) => frame.id === cel.frameId),
        );
        const top = rows[Math.min(...rowsOf) - offset.layers]?.getBoundingClientRect();
        const bottom = rows[Math.max(...rowsOf) - offset.layers]?.getBoundingClientRect();
        const left = columnZero + (Math.min(...columnsOf) + offset.frames) * CELL_WIDTH;
        const right = columnZero + (Math.max(...columnsOf) + offset.frames + 1) * CELL_WIDTH;
        if (!top || !bottom) return null;
        const refused = landsOnLocked(doc, drag.cels, offset);
        const still = offset.layers === 0 && offset.frames === 0;
        const drop: DropArgument | null =
            refused || still
                ? null
                : { kind: "cels", documentId, cels: drag.cels, offset, anchor: drag.anchor };
        const shown: DropIndicator = {
            kind: "cels",
            left: left - box.left,
            top: top.top - box.top,
            width: right - left,
            height: bottom.bottom - top.top,
            copy,
            refused,
        };
        return { drop, shown };
    };

    const update = (current: Press, x: number, y: number) => {
        if (!current.drag) return;
        const found = locate(current, current.drag, x, y, current.copy);
        current.drop = found?.drop ?? null;
        const shown = found?.shown ?? null;
        setIndicator((before) =>
            before &&
            shown &&
            before.kind === shown.kind &&
            before.left === shown.left &&
            before.top === shown.top &&
            before.width === shown.width &&
            before.height === shown.height &&
            before.copy === shown.copy &&
            before.refused === shown.refused
                ? before
                : shown,
        );
    };

    /** The release: the drop, or the click a press on a selected item waited with. */
    const release = (current: Press, copy: boolean) => {
        end();
        if (!current.drag) {
            if (current.deferred) {
                clickTimeline(current.target, current.deferred);
                if (current.target.kind !== "cels") focusActive();
            }
            return;
        }
        const { drop } = current;
        // Refused, dropped where it began, or nothing to drop: the focus goes back all the same.
        if (!drop) {
            focusActive();
            return;
        }
        const id =
            drop.kind === "frames"
                ? TIMELINE_EDIT_COMMANDS.moveFrames
                : drop.kind === "layers"
                  ? TIMELINE_EDIT_COMMANDS.moveLayers
                  : copy
                    ? TIMELINE_EDIT_COMMANDS.copyCels
                    : TIMELINE_EDIT_COMMANDS.moveCels;
        withDrop(drop, () => runCommand(id));
        focusActive();
    };

    /**
     * While a drag is held at an edge of the grid's part in view (right of the layer column,
     * below the parts that stick to the top), scrolls the panel that way, one step per
     * animation frame, and moves the drop with it: frames across, layers up and down, cels both.
     */
    const autoscroll = () => {
        frame = null;
        const current = press;
        const element = root.current;
        if (!current?.drag || !element) return;
        const box = element.getBoundingClientRect();
        const header = element.querySelector('[role="rowheader"]')?.getBoundingClientRect();
        const left = header ? header.right : box.left;
        let top = box.top + element.clientTop;
        for (const sticky of element.querySelectorAll(STICKY_TOP)) {
            top = Math.max(top, sticky.getBoundingClientRect().bottom);
        }
        const right = box.left + element.clientLeft + element.clientWidth;
        const bottom = box.top + element.clientTop + element.clientHeight;
        /** The step for a pointer `inside` px inside an edge (negative: past it). */
        const step = (inside: number) =>
            inside >= SCROLL_EDGE
                ? 0
                : Math.ceil(Math.min(1, (SCROLL_EDGE - inside) / SCROLL_EDGE) * SCROLL_STEP);
        const { x, y } = current.pointer;
        let dx = 0;
        let dy = 0;
        if (current.drag.kind !== "layers") dx = step(right - x) - step(x - left);
        if (current.drag.kind !== "frames") dy = step(bottom - y) - step(y - top);
        if (dx !== 0 || dy !== 0) {
            const before = { left: element.scrollLeft, top: element.scrollTop };
            element.scrollLeft += dx;
            element.scrollTop += dy;
            if (element.scrollLeft !== before.left || element.scrollTop !== before.top) {
                update(current, x, y);
            }
        }
        frame = requestAnimationFrame(autoscroll);
    };

    const onPress = (event: ReactPointerEvent, target: ClickTarget) => {
        if (event.button !== 0) return;
        // A press in the grid stops editor playback first, on the frame on screen (SE-024).
        stopPlaybackForEdit();
        end();
        const document = availableDocument();
        const modifiers = modifiersOf(event);
        const holds = document !== null && selectionHolds(document, target);
        if (!holds) {
            const done = clickTimeline(target, modifiers);
            if (target.kind !== "cels") focusActive();
            if (!done) return;
        } else if (target.kind !== "cels") {
            focusActive();
        }
        if (!document) return;
        const current: Press = {
            pointerId: event.pointerId,
            target,
            x: event.clientX,
            y: event.clientY,
            documentId: document.id,
            deferred: holds ? modifiers : null,
            drag: null,
            drop: null,
            copy: false,
            pointer: { x: event.clientX, y: event.clientY },
        };
        press = current;

        const onMove = (move: PointerEvent) => {
            if (press !== current || move.pointerId !== current.pointerId) return;
            current.copy = move.ctrlKey || move.metaKey;
            current.pointer = { x: move.clientX, y: move.clientY };
            if (!current.drag) {
                const distance = Math.hypot(move.clientX - current.x, move.clientY - current.y);
                if (distance < DRAG_THRESHOLD) return;
                const drag = dragOf(current);
                if (!drag) {
                    end();
                    return;
                }
                current.drag = drag;
                try {
                    root.current?.setPointerCapture(current.pointerId);
                } catch {
                    // The pointer is gone already; the release ends the drag anyway.
                }
                frame = requestAnimationFrame(autoscroll);
            }
            update(current, move.clientX, move.clientY);
        };
        const onUp = (up: PointerEvent) => {
            if (press !== current || up.pointerId !== current.pointerId) return;
            if (current.drag) update(current, up.clientX, up.clientY);
            release(current, up.ctrlKey || up.metaKey);
        };
        const onCancel = (cancel: PointerEvent) => {
            if (press === current && cancel.pointerId === current.pointerId) end();
        };
        /** Escape cancels a drag; Ctrl pressed or let go turns a move into a copy and back. */
        const onKey = (key: KeyboardEvent) => {
            if (press !== current || !current.drag) return;
            if (key.type === "keydown" && key.key === "Escape") {
                key.preventDefault();
                key.stopPropagation();
                end();
                focusActive();
                return;
            }
            if (key.key === "Control" || key.key === "Meta") {
                current.copy = key.ctrlKey || key.metaKey;
                update(current, current.pointer.x, current.pointer.y);
            }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("keyup", onKey, true);
        stop = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("keyup", onKey, true);
        };
    };

    return { onPress, end };
}

/**
 * Pointer handling of the grid's drags (`createTimelineDrag`), made once per panel. Returns the
 * press handler and the drop indicator to draw (null while nothing is dragged).
 */
export function useTimelineDrag(
    root: RefObject<HTMLElement | null>,
    grid: RefObject<HTMLElement | null>,
    focusActive: () => void,
): {
    onPress(event: ReactPointerEvent, target: ClickTarget): void;
    indicator: DropIndicator | null;
} {
    const [indicator, setIndicator] = useState<DropIndicator | null>(null);
    const [drag] = useState(() => createTimelineDrag(root, grid, focusActive, setIndicator));
    useEffect(() => () => drag.end(), [drag]);
    return { onPress: drag.onPress, indicator };
}
