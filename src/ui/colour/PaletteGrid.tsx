import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { EDIT_COLOUR, MOVE_COLOUR } from "../../app/palette/palette.commands";
import {
    currentSwatch,
    paletteStore,
    setCurrentSwatch,
    setMoveTarget,
    usePaletteState,
} from "../../app/palette/paletteState";
import { editorStore, useEditor } from "../../app/state/editor";
import type { ColourSlot, EditorState } from "../../app/state/editor";
import { activeDocument, sessionsStore } from "../../app/state/sessions";
import { formatHex } from "../../core/color";
import { movedColours } from "../../core/palettes";
import { runCommand } from "../commands/runCommand";
import { cancelNextContextMenu } from "./cancelContextMenu";
import {
    PALETTE_GRID_ATTRIBUTE,
    openPaletteMenu,
    swatchElement,
    useActivePalette,
} from "./paletteUi";
import { cssColour } from "./pickerMath";
import "./paletteGrid.css";

// The palette grid (DESIGN §5.4, SE-060) of the active document. A left press on a swatch sets
// the foreground to its colour, a right press the background; the first swatch of the
// foreground's colour is marked. A left drag moves the swatch: the grid shows the order the
// drop would make, Escape or a release outside the grid leaves it as it was. A double click
// edits the swatch in the picker popover. From the keyboard the grid is one tab stop: arrow
// keys, Home and End move through it, Enter takes the colour into the foreground and
// Shift+Enter into the background, Ctrl+arrow keys move the swatch, and the Menu key (or
// Shift+F10) opens the palette's overflow menu (DESIGN §4). It is an ARIA grid, not a listbox:
// a listbox takes typed letters for typeahead, and the keymap would then keep the `canvas`
// letter and digit keys (X, B, 1…) from a focused swatch (SPEC §7.8). The keys the grid uses it
// takes itself, so the keymap leaves them alone.
//
// The swatch the keys and the presses reach is the current swatch of `app/palette`, which the
// overflow menu's commands act on. Every change of the palette is a registered command.

/** A swatch is 16 px; the grid has a 1 px border. */
const SWATCH = 16;
const BORDER = 1;
/** Rows shown before the grid scrolls. */
const VISIBLE_ROWS = 8;

/** The swatch indices of each row of a grid of `count` swatches, `columns` to a row. */
function rowsOf(count: number, columns: number): number[][] {
    const rows: number[][] = [];
    for (let start = 0; start < count; start += columns) {
        rows.push(Array.from({ length: Math.min(columns, count - start) }, (_, at) => start + at));
    }
    return rows;
}

/**
 * Columns of a grid of `count` swatches in `width` px: as many as fit, less the scroll bar's
 * `gutter` when there are more rows than the grid shows, so it never overflows sideways.
 */
function gridColumns(width: number, count: number, gutter: number): number {
    const inner = width - 2 * BORDER;
    const fit = (space: number) => Math.max(1, Math.min(count, Math.floor(space / SWATCH)));
    const columns = fit(inner);
    return Math.ceil(count / columns) > VISIBLE_ROWS ? fit(inner - gutter) : columns;
}

/**
 * The colour of the swatch at `index` in the document now, not as last rendered: a press that
 * ends a swatch edit first (SwatchEditor) reads the colour the edit gave it.
 */
function colourAt(index: number): number | undefined {
    return activeDocument(sessionsStore.getState())?.session.doc.palette.colors[index];
}

function pick(slot: ColourSlot, colour: number): void {
    const editor = editorStore.getState();
    if (editor[slot] !== colour) editor.setColour(slot, colour);
}

/** Read while no swatch is being edited. */
const NO_DRAFT: StoreApi<Pick<EditorState, "foreground">> = createStore(() => ({ foreground: 0 }));

interface Drag {
    pointerId: number;
    /** The swatch pressed, which the drag moves. */
    from: number;
    /** Escape ended the move; the release does nothing. */
    cancelled: boolean;
    stop(): void;
}

export function PaletteGrid() {
    const palette = useActivePalette();
    const foreground = useEditor((state) => state.foreground);
    const target = usePaletteState((state) => state.target);
    const edit = usePaletteState((state) => state.edit);
    const container = useRef<HTMLDivElement>(null);
    const grid = useRef<HTMLDivElement>(null);
    const probe = useRef<HTMLDivElement>(null);
    const drag = useRef<Drag | null>(null);
    const [width, setWidth] = useState(0);
    const [gutter, setGutter] = useState(0);

    useLayoutEffect(() => {
        const element = container.current;
        if (!element) return;
        // The width of a vertical scroll bar here: the grid gives it room when it scrolls.
        const scroller = probe.current;
        if (scroller) setGutter(scroller.offsetWidth - scroller.clientWidth);
        const observer = new ResizeObserver(() => setWidth(element.clientWidth));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // A drag that the panel outlives (the document closed) leaves nothing behind.
    useEffect(() => () => drag.current?.stop(), []);

    const stored = palette?.colors ?? [];
    const count = stored.length;
    const current = usePaletteState((state) => currentSwatch(count, state));
    // While a drag or a Ctrl+arrow key sets a target, the grid shows the order the move makes.
    const showsMove = target !== null && current >= 0 && target >= 0 && target < count;
    const colors = showsMove ? movedColours(stored, current, target) : stored;
    const columns = gridColumns(width, count, gutter);
    const rows = Math.ceil(count / columns);
    const scrolls = rows > VISIBLE_ROWS;
    const selected = colors.indexOf(foreground);
    const editing =
        edit && palette && edit.documentId === palette.documentId && !showsMove ? edit : null;
    // The swatch being edited shows the picker's colour. Only its fill's colour changes, never
    // the element: a press that ends the edit (SwatchEditor) must still reach the swatch.
    const draft = useStore(editing?.draft ?? NO_DRAFT, (state) => state.foreground);

    const focusSwatch = (index: number) => {
        setCurrentSwatch(index);
        swatchElement(index)?.focus({ preventScroll: false });
    };

    /** The swatch under client `x, y`, or null outside the grid. */
    const swatchAt = (x: number, y: number): number | null => {
        const element = grid.current;
        if (!element) return null;
        const box = element.getBoundingClientRect();
        if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) return null;
        const column = Math.floor((x - box.left - element.clientLeft) / SWATCH);
        const row = Math.floor((y - box.top - element.clientTop + element.scrollTop) / SWATCH);
        if (column < 0 || column >= columns || row < 0) return null;
        return Math.min(count - 1, row * columns + column);
    };

    /** Moves the current swatch to `to` in one undo step and keeps the focus on it. */
    const moveTo = (from: number, to: number, focus: boolean) => {
        setCurrentSwatch(from);
        setMoveTarget(to);
        const moved = runCommand(MOVE_COLOUR);
        setMoveTarget(null);
        if (moved && focus) focusSwatch(to);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
        const last = count - 1;
        if (
            event.key === "ContextMenu" ||
            (event.key === "F10" && event.shiftKey && !event.ctrlKey && !event.altKey)
        ) {
            event.preventDefault();
            setCurrentSwatch(index);
            openPaletteMenu(index);
            return;
        }
        if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
            const to = {
                ArrowLeft: index - 1,
                ArrowRight: index + 1,
                ArrowUp: index - columns,
                ArrowDown: index + columns,
            }[event.key];
            if (to === undefined) return;
            event.preventDefault();
            if (to >= 0 && to <= last) moveTo(index, to, true);
            return;
        }
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        let next: number;
        switch (event.key) {
            case "ArrowRight":
                next = Math.min(last, index + 1);
                break;
            case "ArrowLeft":
                next = Math.max(0, index - 1);
                break;
            case "ArrowDown":
                next = index + columns <= last ? index + columns : index;
                break;
            case "ArrowUp":
                next = index - columns >= 0 ? index - columns : index;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = last;
                break;
            case "Enter": {
                event.preventDefault();
                const colour = colourAt(index);
                if (colour !== undefined) {
                    pick(event.shiftKey ? "background" : "foreground", colour);
                }
                return;
            }
            default:
                return;
        }
        event.preventDefault();
        focusSwatch(next);
    };

    const onPointerDown = (event: PointerEvent<HTMLElement>, index: number) => {
        const colour = colourAt(index);
        if (colour === undefined || drag.current || (event.button !== 0 && event.button !== 2)) {
            return;
        }
        setCurrentSwatch(index);
        if (event.button === 2) {
            cancelNextContextMenu();
            pick("background", colour);
            return;
        }
        pick("foreground", colour);
        // The press may become a drag that moves the swatch.
        const pointerId = event.pointerId;
        try {
            event.currentTarget.setPointerCapture(pointerId);
        } catch {
            // The pointer is gone already: no drag follows.
            return;
        }
        const onKey = (key: globalThis.KeyboardEvent) => {
            if (key.key !== "Escape" || !drag.current) return;
            key.preventDefault();
            drag.current.cancelled = true;
            setMoveTarget(null);
        };
        window.addEventListener("keydown", onKey, true);
        drag.current = {
            pointerId,
            from: index,
            cancelled: false,
            stop: () => {
                window.removeEventListener("keydown", onKey, true);
                drag.current = null;
                setMoveTarget(null);
            },
        };
    };

    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId || current.cancelled) return;
        if ((event.buttons & 1) === 0) {
            current.stop();
            return;
        }
        const over = swatchAt(event.clientX, event.clientY);
        setMoveTarget(over === null || over === current.from ? null : over);
    };

    const onPointerUp = (event: PointerEvent<HTMLElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const to = paletteStore.getState().target;
        current.stop();
        if (!current.cancelled && to !== null) moveTo(current.from, to, false);
    };

    const endDrag = (event: PointerEvent<HTMLElement>) => {
        if (drag.current?.pointerId === event.pointerId) drag.current.stop();
    };

    const swatch = (index: number) => {
        const colour = colors[index] ?? 0;
        const fill = editing?.index === index ? draft : colour;
        return (
            <div
                key={index}
                role="gridcell"
                aria-selected={index === selected}
                aria-label={formatHex(colour)}
                title={formatHex(colour)}
                tabIndex={index === current ? 0 : -1}
                className="palette-grid__swatch"
                data-swatch={index}
                data-colour={formatHex(colour, true)}
                data-current={index === current ? "" : undefined}
                onPointerDown={(event) => onPointerDown(event, index)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onDoubleClick={(event) => {
                    if (event.button !== 0) return;
                    setCurrentSwatch(index);
                    runCommand(EDIT_COLOUR);
                }}
                onContextMenu={(event) => event.preventDefault()}
                onFocus={() => setCurrentSwatch(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
            >
                <span className="palette-grid__fill" style={{ background: cssColour(fill) }} />
            </div>
        );
    };

    return (
        <div ref={container} className="palette-panel" data-palette-panel="">
            <div ref={probe} className="palette-panel__probe" aria-hidden="true" />
            {palette && count > 0 ? (
                <div
                    ref={grid}
                    role="grid"
                    aria-label={`Palette ${palette.name}`}
                    className="palette-grid"
                    data-moving={showsMove ? "" : undefined}
                    style={{ width: columns * SWATCH + 2 * BORDER + (scrolls ? gutter : 0) }}
                    {...{ [PALETTE_GRID_ATTRIBUTE]: "" }}
                >
                    {rowsOf(count, columns).map((row) => (
                        <div key={row[0]} role="row" className="palette-grid__row">
                            {row.map(swatch)}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
