// The layout arithmetic of the palette grid (DESIGN §5.4, SE-060), free of the DOM so the unit
// tests reach it: 16 px swatches with no gaps, a 1 px border, eight rows shown before the grid
// scrolls, and room for the scroll bar while it does.

/** A swatch is 16 px square. */
export const SWATCH = 16;
/** The grid's border, on each side. */
export const GRID_BORDER = 1;
/** Rows shown before the grid scrolls. */
export const VISIBLE_ROWS = 8;

/**
 * Columns of a grid of `count` swatches in a section `width` px wide: as many as fit beside
 * the border, less the scroll bar's `gutter` when there are more rows than the grid shows, so
 * the grid never overflows sideways. At least one; never more than `count`.
 */
export function gridColumns(width: number, count: number, gutter: number): number {
    const inner = width - 2 * GRID_BORDER;
    const fit = (space: number) => Math.max(1, Math.min(count, Math.floor(space / SWATCH)));
    const columns = fit(inner);
    return Math.ceil(count / columns) > VISIBLE_ROWS ? fit(inner - gutter) : columns;
}

/** Whether a grid of `count` swatches in `columns` columns has more rows than it shows. */
export function gridScrolls(count: number, columns: number): boolean {
    return Math.ceil(count / columns) > VISIBLE_ROWS;
}
