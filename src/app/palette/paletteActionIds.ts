import type { PaletteTextFormat } from "../../core/palettes";

// The ids of the palette commands of SE-066 (palette files, sort, replace colour), for the
// interface and the tests, apart from the modules that register them (as `paletteCommandIds.ts`
// is for SE-060). Each is an item of the palette's overflow menu (`PALETTE_MENU`): import and
// export in the 200s, sort and Replace Colour… in the 400s (DESIGN §5.4).

export const IMPORT_PALETTE = "palette.import";

/** The command that writes the palette as a file of `format`. */
export function exportPaletteCommandId(format: PaletteTextFormat): string {
    return `palette.export.${format}`;
}

export const EXPORT_FORMATS: readonly PaletteTextFormat[] = ["gpl", "hex", "pal"];

export const SORT_BY_HUE = "palette.sortByHue";
export const SORT_BY_LIGHTNESS = "palette.sortByLightness";
export const ORIGINAL_ORDER = "palette.originalOrder";

/** Replace Colour… takes the Edit menu item planned for it (`planned.commands.ts`). */
export const REPLACE_COLOUR = "edit.replaceColour";
