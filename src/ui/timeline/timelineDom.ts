import type { ClickModifiers } from "../../app/timeline/selection";

// DOM helpers of the timeline panel.

/** Marks a cell of the grid; the active cell is the one with `tabindex="0"`. */
export const CELL_ATTRIBUTE = "data-timeline-cell";

/** Metrics of DESIGN §5.6, as timeline.css lays them out: cells 24 px wide in 28 px rows. */
export const CELL_WIDTH = 24;
export const ROW_HEIGHT = 28;
/** What the layer column and the two header rows cover of the scroller. */
export const LAYER_COLUMN_WIDTH = 200;
export const HEADER_HEIGHT = 2 * ROW_HEIGHT;

/** Shift extends to a range; Ctrl (Cmd on a Mac) adds or removes one. */
export function modifiersOf(event: {
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
}): ClickModifiers {
    return { shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey };
}

/** The active cell of the grid, if one is rendered. */
export function activeCell(grid: HTMLElement | null): HTMLElement | null {
    return grid?.querySelector<HTMLElement>(`[${CELL_ATTRIBUTE}][tabindex="0"]`) ?? null;
}

/**
 * Scrolls `scroller` the least that shows `cell` beside the sticky layer column and below the
 * sticky header rows. Only the scroller moves: `scrollIntoView` would scroll the shell too.
 */
export function keepInView(scroller: HTMLElement, cell: HTMLElement): void {
    const box = scroller.getBoundingClientRect();
    const target = cell.getBoundingClientRect();
    const left = box.left + LAYER_COLUMN_WIDTH;
    const right = box.left + scroller.clientWidth;
    const top = box.top + HEADER_HEIGHT;
    const bottom = box.top + scroller.clientHeight;
    if (target.left < left) scroller.scrollLeft -= left - target.left;
    else if (target.right > right) scroller.scrollLeft += target.right - right;
    if (target.top < top) scroller.scrollTop -= top - target.top;
    else if (target.bottom > bottom) scroller.scrollTop += target.bottom - bottom;
}

/** The row header of a layer in the grid, if its row is rendered. */
export function layerHeaderOf(grid: HTMLElement | null, layerId: string): HTMLElement | null {
    for (const row of grid?.querySelectorAll<HTMLElement>('[role="row"][data-layer]') ?? []) {
        if (row.dataset.layer === layerId) return row.querySelector('[role="rowheader"]');
    }
    return null;
}

/** Gives the focus to the active cell of the grid, keeping it in view. */
export function focusActiveCell(grid: HTMLElement | null): void {
    const cell = activeCell(grid);
    if (!cell) return;
    cell.focus({ preventScroll: true });
    const scroller = grid?.closest<HTMLElement>("[data-timeline]");
    if (scroller) keepInView(scroller, cell);
}
