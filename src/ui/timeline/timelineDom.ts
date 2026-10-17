import type { ClickModifiers } from "../../app/timeline/selection";

// DOM helpers of the timeline panel.

/** Marks a cell of the grid; the active cell is the one with `tabindex="0"`. */
export const CELL_ATTRIBUTE = "data-timeline-cell";

/**
 * Marks a field of the panel (the duration, a name renamed in place): a press anywhere outside
 * it applies what it holds before the press does anything else.
 */
export const TIMELINE_FIELD_ATTRIBUTE = "data-timeline-field";

/** DESIGN §5.6: cells are 24 px wide, as timeline.css lays them out. */
export const CELL_WIDTH = 24;

/** The parts that stick to the top of the scroller while the grid scrolls under them. */
const STICKY_TOP = ".timeline__bar, .timeline__row--header";

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

/** The cell of `layerId` at `frameId`, if its row is rendered. */
export function cellOf(grid: HTMLElement | null, layerId: string, frameId: string) {
    for (const row of grid?.querySelectorAll<HTMLElement>('[role="row"][data-layer]') ?? []) {
        if (row.dataset.layer !== layerId) continue;
        for (const cell of row.querySelectorAll<HTMLElement>(`[${CELL_ATTRIBUTE}]`)) {
            if (cell.dataset.frame === frameId) return cell;
        }
    }
    return null;
}

/**
 * Scrolls `scroller` the least that shows `cell` beside the sticky layer column and below the
 * sticky rows on top, as they are laid out now (a tag bar makes the top taller). Only the
 * scroller moves: `scrollIntoView` would scroll the shell too.
 */
export function keepInView(scroller: HTMLElement, cell: HTMLElement): void {
    const box = scroller.getBoundingClientRect();
    const target = cell.getBoundingClientRect();
    const column = cell.closest('[role="row"]')?.querySelector('[role="rowheader"]');
    const inner = { left: box.left + scroller.clientLeft, top: box.top + scroller.clientTop };
    const left = column ? column.getBoundingClientRect().right : inner.left;
    let top = inner.top;
    for (const sticky of scroller.querySelectorAll(STICKY_TOP)) {
        top = Math.max(top, sticky.getBoundingClientRect().bottom);
    }
    const right = inner.left + scroller.clientWidth;
    const bottom = inner.top + scroller.clientHeight;
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

/** Gives the focus to a cell of the grid, keeping it in view. */
export function focusCell(cell: HTMLElement | null): void {
    if (!cell) return;
    cell.focus({ preventScroll: true });
    const scroller = cell.closest<HTMLElement>("[data-timeline]");
    if (scroller) keepInView(scroller, cell);
}
