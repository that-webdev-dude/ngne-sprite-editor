import type { StoreApi } from "zustand/vanilla";
import { exportName } from "../../core/export";
import {
    MAX_PALETTE_FILE_BYTES,
    PALETTE_FILE_TOO_LARGE,
    PALETTE_FORMATS,
    paletteFormatOf,
    paletteNameOfFile,
    readPaletteFile,
    setPaletteCommand,
    writePaletteFile,
} from "../../core/palettes";
import type { PaletteFile, PaletteTextFormat } from "../../core/palettes";
import { exportWorkflows as appExportWorkflows } from "../export/exportWorkflows";
import type { ExportWorkflows } from "../export/exportWorkflows";
import { fileWorkflows as appFileWorkflows } from "../file/workflows";
import type { FileWorkflows } from "../file/workflows";
import { notices as appNotices } from "../notices/notices";
import type { Notices } from "../notices/notices";
import { choosePaletteFile } from "../platform/paletteFiles";
import type { ChoosePaletteFile, ChosenPaletteFile } from "../platform/paletteFiles";
import { applyFloating as applyAppFloating } from "../selection/floating";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import { forgetPaletteOrder } from "./paletteOrder";

// Palette files of the active document (SPEC §7.1, Palette files; SE-066):
//
// - Import Palette… asks for a `.gpl`, `.hex`, `.pal` or `.png` file (its ending names the
//   format), reads it with `core/palettes`, and replaces the palette by its colours in one undo
//   step ("Import Palette"), named by the file (`.gpl`: its `Name:`; otherwise the file name
//   without its ending). A file that cannot be read is one error toast and changes nothing;
//   so is a file larger than `MAX_PALETTE_FILE_BYTES` (refused before it is read), and a file
//   read once another document became the active one. The import forgets the original order
//   a sort kept (`paletteOrder.ts`).
// - The export's file name is `exportName` of the palette's name, or of the document's name
//   when the palette's is blank.
// - Export Palette writes the palette as `<name>.gpl`, `.hex` or `.pal` through the save
//   picker, or downloads it, as the exports beside the bundle do (`otherExport`, SE-052).
//
// Both are file operations (`FileWorkflows.run`): one at a time, not during a stroke, and a
// floating selection is applied first, as for the other palette commands (SPEC §5.2).

export interface PaletteFileOptions {
    /** The store of open documents; the default is the app's. */
    sessions?: StoreApi<SessionsState>;
    /** How a palette file is chosen; the default is the page's picker. */
    choose?: ChoosePaletteFile;
    /** Where results and failures go; the default is the app's toasts. */
    notices?: Pick<Notices, "info" | "error">;
    /** The file operations an import is one of; the default is the app's. */
    files?: Pick<FileWorkflows, "run" | "canSave">;
    /** How an export is saved; the default is the app's. */
    exports?: Pick<ExportWorkflows, "otherExport" | "canExport">;
    /** Applies the floating selection; throws when it cannot. The default is the app's. */
    applyFloating?(): void;
}

export interface PaletteFiles {
    /** Whether Import Palette… can start: as `FileWorkflows.canSave`. */
    canImport(): boolean;
    /** Import Palette…; resolves true when the palette was replaced (or was that already). */
    importPalette(): Promise<boolean>;
    /** Whether an export can start: as `ExportWorkflows.canExport`, with a colour to write. */
    canExport(): boolean;
    /** Export Palette as `format`; resolves true when the file was saved or downloaded. */
    exportPalette(format: PaletteTextFormat): Promise<boolean>;
}

function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/** "1 colour", "32 colours". */
function colours(count: number): string {
    return count === 1 ? "1 colour" : `${count} colours`;
}

export function createPaletteFiles(options: PaletteFileOptions = {}): PaletteFiles {
    const sessions = options.sessions ?? sessionsStore;
    const choose = options.choose ?? choosePaletteFile;
    const notices = options.notices ?? appNotices;
    const files = options.files ?? appFileWorkflows;
    const exports = options.exports ?? appExportWorkflows;
    // Looked up when called: tests may replace the floating module.
    const applyFloating = options.applyFloating ?? (() => applyAppFloating());

    /** The palette of `read` for `document`, then one undo step that makes it the palette. */
    const replace = (document: OpenDocument, file: ChosenPaletteFile, read: PaletteFile) => {
        const name =
            read.name ?? (paletteNameOfFile(file.name) || document.session.doc.palette.name);
        const command = setPaletteCommand(
            document.session,
            { name, colors: read.colors },
            "Import Palette",
        );
        if (command) document.history.execute(command);
        // An imported palette is another palette: no original order is kept for it.
        forgetPaletteOrder(document.session);
        notices.info(`Imported ${colours(read.colors.length)} from “${file.name}”`);
    };

    const importPalette = (): Promise<boolean> =>
        files.run(async () => {
            const start = activeDocument(sessions.getState());
            if (!start) return false;
            try {
                applyFloating();
            } catch {
                // `applyFloating` has reported why.
                return false;
            }
            if (start.history.transaction) {
                notices.error("Could not import a palette. A stroke is in progress.");
                return false;
            }
            let file: ChosenPaletteFile | null;
            try {
                file = await choose();
            } catch (error) {
                notices.error(`Could not import a palette. ${reason(error)}`);
                return false;
            }
            if (!file) return false;
            const chosen = file;
            const fail = (why: string): false => {
                notices.error(`Could not import “${chosen.name}”. ${why}`);
                return false;
            };
            const format = paletteFormatOf(chosen.name);
            if (!format) return fail("It is not a palette file (.gpl, .hex, .pal or .png).");
            // Refused before it is read into memory.
            if (chosen.size > MAX_PALETTE_FILE_BYTES) return fail(PALETTE_FILE_TOO_LARGE);
            let read: PaletteFile;
            try {
                read = await readPaletteFile(format, await chosen.read());
            } catch (error) {
                return fail(reason(error));
            }
            // The document as it is now: the picker may have been open for a while. The
            // palette goes to the document the import started in, and only while it is the
            // active one (as `interruption` of the file workflows says).
            const state = sessions.getState();
            const document = activeDocument(state);
            if (!document || document.session !== start.session) {
                const open = state.documents.some((entry) => entry.session === start.session);
                return fail(
                    open
                        ? "Another document became the active one meanwhile."
                        : "The document was closed meanwhile.",
                );
            }
            if (document.history.transaction) return fail("A stroke is in progress.");
            try {
                replace(document, chosen, read);
            } catch (error) {
                return fail(reason(error));
            }
            return true;
        });

    const hasColours = () => {
        const document = activeDocument(sessions.getState());
        return (document?.session.doc.palette.colors.length ?? 0) > 0;
    };

    const exportPalette = (format: PaletteTextFormat): Promise<boolean> =>
        exports.otherExport(async (document) => {
            const { doc } = document.session;
            const { palette } = doc;
            if (palette.colors.length === 0) throw new Error("The palette holds no colours.");
            const info = PALETTE_FORMATS[format];
            const base = exportName(palette.name.trim() === "" ? doc.name : palette.name);
            return {
                file: {
                    name: `${base}${info.extension}`,
                    bytes: writePaletteFile(format, palette),
                },
                type: {
                    kind: format,
                    description: info.description,
                    mime: info.mime,
                    extension: info.extension,
                },
                count: 1,
            };
        });

    return {
        canImport: () => files.canSave(),
        importPalette,
        canExport: () => exports.canExport() && hasColours(),
        exportPalette,
    };
}

/** The palette files of the app. */
export const paletteFiles = createPaletteFiles();
