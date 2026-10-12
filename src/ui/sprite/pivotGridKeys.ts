import { PIVOT_PRESET_COLUMNS, PIVOT_PRESETS } from "../../core/sprite";

/**
 * Arrow keys in the pivot preset grid, kept free of the DOM for unit tests: the index of the
 * preset an arrow key moves to from `index`, staying inside the grid; null for any other key.
 */
export function movePivotPreset(index: number, key: string): number | null {
    const columns = PIVOT_PRESET_COLUMNS;
    const column = index % columns;
    switch (key) {
        case "ArrowLeft":
            return column > 0 ? index - 1 : index;
        case "ArrowRight":
            return column < columns - 1 ? index + 1 : index;
        case "ArrowUp":
            return index >= columns ? index - columns : index;
        case "ArrowDown":
            return index + columns < PIVOT_PRESETS.length ? index + columns : index;
        default:
            return null;
    }
}
