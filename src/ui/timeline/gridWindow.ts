import { useEffect, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { CELL_WIDTH, STICKY_TOP } from "./timelineDom";

// Virtualized rendering of the timeline grid (SE-026): of the cels' cells only those in view,
// with a margin around them, are in the DOM. A row header per layer and a frame number per frame
// stay rendered — they are what the pointer and the keyboard reach a row or a column by — so a
// document of L layers and F frames puts L + F headers in the DOM, plus the cells of the window,
// instead of L × F cells.

/** A run of rows or columns, both ends included; `last` may lie past the grid's end. */
export interface IndexRange {
    readonly first: number;
    readonly last: number;
}

/** The cells in the DOM: the pixel rows (top first) and the frame columns of the window. */
export interface GridWindow {
    readonly rows: IndexRange;
    readonly columns: IndexRange;
}

/**
 * The margin rendered beyond each edge of the part of the grid in view, as a fraction of its
 * size on that axis: the cells a scroll uncovers are there already. Columns are rendered in
 * blocks of `COLUMN_BLOCK` of the width, so a scroll across draws the rows again only once per
 * block, not at each column (each such draw costs a few milliseconds). The cells in the DOM
 * stay within the cells in view plus one screen of them: at most 1 + 2 × (0.1 + 0.1) = 1.4
 * times the columns in view and 1 + 2 × 0.15 = 1.3 times the rows, 1.82 screens, plus the
 * cells cut by the edges.
 */
export const OVERSCAN = { columns: 0.1, rows: 0.15 };
export const COLUMN_BLOCK = 0.1;

function sameRange(a: IndexRange, b: IndexRange): boolean {
    return a.first === b.first && a.last === b.last;
}

/**
 * The window of the grid in `scroller` as it is laid out and scrolled now: the cells right of
 * the layer column and below the parts that stick to the top, with `OVERSCAN` around them.
 * Null while no row or frame is laid out.
 */
export function gridWindowOf(scroller: HTMLElement, grid: HTMLElement): GridWindow | null {
    const row = grid.querySelector<HTMLElement>('[role="row"][data-layer]');
    const frame = grid.querySelector<HTMLElement>(".timeline__frame");
    const header = row?.querySelector<HTMLElement>('[role="rowheader"]');
    if (!row || !frame || !header) return null;
    const box = scroller.getBoundingClientRect();
    const innerLeft = box.left + scroller.clientLeft;
    const innerTop = box.top + scroller.clientTop;
    const right = innerLeft + scroller.clientWidth;
    const bottom = innerTop + scroller.clientHeight;
    let top = innerTop;
    for (const sticky of scroller.querySelectorAll(STICKY_TOP)) {
        top = Math.max(top, sticky.getBoundingClientRect().bottom);
    }
    const left = header.getBoundingClientRect().right;
    const rowBox = row.getBoundingClientRect();
    const rowHeight = rowBox.height > 0 ? rowBox.height : 28;
    // Column i lies at the first frame number's left + i cells, row i at the first row's top +
    // i rows, wherever they are scrolled to (the headers are always laid out).
    const columnZero = frame.getBoundingClientRect().left;
    const width = Math.max(0, right - left);
    const marginX = width * OVERSCAN.columns;
    const marginY = Math.max(0, bottom - top) * OVERSCAN.rows;
    const block = Math.max(1, Math.round((width * COLUMN_BLOCK) / CELL_WIDTH));
    const firstColumn = Math.floor((left - marginX - columnZero) / CELL_WIDTH);
    const lastColumn = Math.ceil((right + marginX - columnZero) / CELL_WIDTH) - 1;
    return {
        columns: {
            first: Math.max(0, Math.floor(firstColumn / block) * block),
            last: (Math.floor(lastColumn / block) + 1) * block - 1,
        },
        rows: {
            first: Math.max(0, Math.floor((top - marginY - rowBox.top) / rowHeight)),
            last: Math.ceil((bottom + marginY - rowBox.top) / rowHeight) - 1,
        },
    };
}

/** The window of a grid as it was last measured, for `useSyncExternalStore`. */
export interface GridWindowStore {
    subscribe(listener: () => void): () => void;
    current(): GridWindow | null;
    /** Measures the window again; tells the listeners when it changed. */
    measure(): void;
}

/**
 * The window of the grid in `scroller`. Each range stays the same object while it is the same,
 * so rows render again only when the columns change or they enter or leave the window.
 */
export function createGridWindowStore(
    scroller: RefObject<HTMLElement | null>,
    grid: RefObject<HTMLElement | null>,
): GridWindowStore {
    const listeners = new Set<() => void>();
    let shown: GridWindow | null = null;
    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
        current: () => shown,
        measure() {
            const element = scroller.current;
            const content = grid.current;
            const next = element && content ? gridWindowOf(element, content) : null;
            let merged = next;
            if (next && shown) {
                const rows = sameRange(shown.rows, next.rows) ? shown.rows : next.rows;
                const columns = sameRange(shown.columns, next.columns)
                    ? shown.columns
                    : next.columns;
                merged =
                    rows === shown.rows && columns === shown.columns ? shown : { rows, columns };
            }
            if (merged === shown) return;
            shown = merged;
            for (const listener of [...listeners]) listener();
        },
    };
}

/**
 * The window of the grid, measured after each render of the panel, at each scroll of the panel
 * and when its size changes. `shown`: the panel is rendered (it is not while no document is
 * open), so the scroller can be watched. Returns the store of the window, which the rows follow
 * (`windowColumns`); the panel itself does not render again when it changes.
 */
export function useGridWindow(
    scroller: RefObject<HTMLElement | null>,
    grid: RefObject<HTMLElement | null>,
    shown: boolean,
): GridWindowStore {
    const [store] = useState(() => createGridWindowStore(scroller, grid));

    // After every render: rows and frames come and go, a tag bar row makes the top taller.
    useLayoutEffect(() => store.measure());

    useEffect(() => {
        const element = scroller.current;
        if (!shown || !element) return;
        const measure = () => store.measure();
        element.addEventListener("scroll", measure, { passive: true });
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => {
            element.removeEventListener("scroll", measure);
            observer.disconnect();
        };
    }, [scroller, store, shown]);

    return store;
}

/** The columns of the window for the pixel row `row` (top first), or null when it is out. */
export function windowColumns(gridWindow: GridWindow | null, row: number): IndexRange | null {
    if (!gridWindow || row < gridWindow.rows.first || row > gridWindow.rows.last) return null;
    return gridWindow.columns;
}

/**
 * The columns of a row whose cells are rendered: those of `columns` (none when the row is out
 * of the window) and the active cell's, ascending.
 */
export function renderedColumns(
    count: number,
    columns: IndexRange | null,
    focusIndex: number,
): number[] {
    const indices: number[] = [];
    const first = columns ? Math.max(0, columns.first) : 0;
    const last = columns ? Math.min(count - 1, columns.last) : -1;
    const focusInside = focusIndex >= first && focusIndex <= last;
    if (focusIndex >= 0 && focusIndex < count && !focusInside && focusIndex < first) {
        indices.push(focusIndex);
    }
    for (let index = first; index <= last; index++) indices.push(index);
    if (focusIndex >= 0 && focusIndex < count && !focusInside && focusIndex > last) {
        indices.push(focusIndex);
    }
    return indices;
}
