import { PALETTE_FORMATS } from "../../core/palettes";
import type { CommandSpec } from "../commands/types";
import { EXPORT_FORMATS, IMPORT_PALETTE, exportPaletteCommandId } from "./paletteActionIds";
import { PALETTE_MENU } from "./paletteCommandIds";
import { paletteFiles } from "./paletteFiles";

// Import Palette… and the three Export Palette commands (SE-066) in the palette's overflow menu,
// in the 200s DESIGN §5.4 leaves to them. They are file operations: the file workflows'
// `subscribe` refreshes the registry when one starts or ends (file.commands.ts).

export const commands: CommandSpec[] = [
    {
        id: IMPORT_PALETTE,
        title: "Import Palette…",
        enabled: () => paletteFiles.canImport(),
        run: async () => void (await paletteFiles.importPalette()),
        contextMenus: [{ menu: PALETTE_MENU, order: 200 }],
    },
    ...EXPORT_FORMATS.map((format, index): CommandSpec => ({
        id: exportPaletteCommandId(format),
        title: `Export Palette as ${PALETTE_FORMATS[format].extension}…`,
        enabled: () => paletteFiles.canExport(),
        run: async () => void (await paletteFiles.exportPalette(format)),
        contextMenus: [{ menu: PALETTE_MENU, order: 210 + 10 * index }],
    })),
];
