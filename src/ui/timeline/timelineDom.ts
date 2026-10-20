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
export const STICKY_TOP = ".timeline__bar, .timeline__row--header";

/**
 * The client x of the left edge of frame column 0, wherever the grid is scrolled: the header
 * row's left (it scrolls across with the grid) plus the layer column's width. Column i starts
 * `i × CELL_WIDTH` further right; the frame numbers are virtualized (SE-026), so no number is
 * needed for it. Null while the header row is not laid out.
 */
export function columnZeroOf(grid: HTMLElement): number | null {
    const row = grid.querySelector<HTMLElement>(".timeline__row--header");
    const corner = row?.querySelector<HTMLElement>(".timeline__corner");
    if (!row || !corner) return null;
    return row.getBoundingClientRect().left + corner.offsetWidth;
}

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
 * scroller moves: `scrollIntoView` would scroll the shell too. Of a reference layer's cell,
 * which spans every frame column (SE-045), the column of the active frame is what is shown
 * (`data-frame-index`).
 */
export function keepInView(scroller: HTMLElement, cell: HTMLElement): void {
    const box = scroller.getBoundingClientRect();
    const whole = cell.getBoundingClientRect();
    const column = Number(cell.dataset.frameIndex);
    const target = Number.isInteger(column)
        ? {
              left: whole.left + column * CELL_WIDTH,
              right: whole.left + (column + 1) * CELL_WIDTH,
              top: whole.top,
              bottom: whole.bottom,
          }
        : whole;
    const header = cell.closest('[role="row"]')?.querySelector('[role="rowheader"]');
    const inner = { left: box.left + scroller.clientLeft, top: box.top + scroller.clientTop };
    const left = header ? header.getBoundingClientRect().right : inner.left;
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
