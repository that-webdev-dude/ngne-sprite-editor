import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { bundle, exportName } from "../../core/export";
import type { BundleFile } from "../../core/export";
import {
    framePngFile,
    maxFramePngScale,
    pngSequenceFiles,
    spriteSheetFile,
    zipFiles,
} from "../../core/imageExports";
import { setPivotCommand } from "../../core/sprite";
import type { Pivot } from "../../core/sprite";
import { fileWorkflows as appFileWorkflows } from "../file/workflows";
import type { FileWorkflows } from "../file/workflows";
import { notices as appNotices } from "../notices/notices";
import type { Notices } from "../notices/notices";
import { browserExportFiles } from "../platform/exportFiles";
import type { ExportFileKind, ExportFolderHandle, ExportPlatform } from "../platform/exportFiles";
import { applyFloating as applyAppFloating } from "../selection/floating";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import { exportDialogs as appExportDialogs } from "./dialogs";
import type { ExportDestination, ExportDialogs } from "./dialogs";
import { indexedDbExportFolders } from "./exportFolders";
import type { ExportFolderStorage } from "./exportFolders";
import { exportFailure } from "./exportPreview";

// The export workflows of SPEC §9.6 (SE-052), on the active document:
//
// - Export… shows the Export dialog; its Export button writes the bundle into the document's
//   export folder (File System Access: chosen once per document, kept in IndexedDB), or
//   downloads it as `<name>.zip` without that API.
// - Export Again writes the bundle again without the dialog. Without a folder, or when the
//   folder's write permission is refused at its one prompt, it shows the dialog instead.
// - With `exportOnSave`, a successful save writes the bundle the same way; it never shows the
//   dialog, and a failure is an error toast that leaves the save as it is.
// - Before replacing files in a folder for the first time, a document's export asks once,
//   naming the files the folder holds (DESIGN §7, Overwrite confirm).
// - The frame PNG (scaled 1–16×), the sprite sheet PNG alone and the PNG sequence as a zip
//   are saved through the save picker, or downloaded.
//
// Each is a file operation (`FileWorkflows.run`): one at a time, not during a stroke, and a
// floating selection is applied first (SPEC §5.2). Results are info toasts naming the number
// of files and where they went; each failed operation is one error toast; a picker or a
// question the user cancels is not reported.

export interface ExportWorkflowOptions {
    /** The store of open documents; the default is the app's. */
    sessions?: StoreApi<SessionsState>;
    /** Where exports go; the default is the page's. */
    platform?: ExportPlatform;
    /** Where the export folders are kept; the default is the page's IndexedDB. */
    storage?: ExportFolderStorage;
    /** Where the dialogs are shown; the default is the app's dialog host. */
    dialogs?: ExportDialogs;
    /** Where results and failures go; the default is the app's toasts. */
    notices?: Pick<Notices, "info" | "error">;
    /**
     * The file operations an export is one of; the default is the app's. Their `canSave`
     * is whether an export may start: it accepts a floating selection, which is applied first.
     */
    files?: Pick<FileWorkflows, "run" | "canSave">;
    /** Applies the floating selection; throws when it cannot. The default is the app's. */
    applyFloating?(): void;
}

export interface ExportWorkflows {
    /**
     * Whether an export can start now: a document is open, no file operation runs, and its
     * history is idle or holds a floating selection, which the export applies first.
     */
    canExport(): boolean;
    /** Export…: the Export dialog, then the bundle. */
    exportWithDialog(): Promise<boolean>;
    /** Export Again: the bundle without the dialog, unless it needs a folder. */
    exportAgain(): Promise<boolean>;
    /**
     * What a successful save runs (`FileWorkflows.onSaved`): the bundle, when the document's
     * `exportOnSave` is on. Never shows the Export dialog; reports a failure by error toast.
     */
    exportOnSave(document: OpenDocument): Promise<void>;
    /** The active frame as a PNG, at a scale the user chooses. */
    exportFramePng(): Promise<boolean>;
    /** The sprite sheet PNG alone: the bundle's `<name>.png`. */
    exportSpriteSheet(): Promise<boolean>;
    /** The PNG sequence of the exported frames, as a zip. */
    exportPngSequence(): Promise<boolean>;
    /** The name of a document's export folder, if one is known in this session. */
    folderOf(documentId: string): string | null;
}

/** A document's export folder in this session. */
interface FolderRecord {
    folder: ExportFolderHandle;
    /** The user has let this document's exports replace files in the folder. */
    confirmed: boolean;
}

/** How a bundle export was started: what it does when it lacks a folder or permission. */
type Mode = "dialog" | "again" | "save";

/** "1 file", "4 files". */
function filesCount(count: number): string {
    return count === 1 ? "1 file" : `${count} files`;
}

export function createExportWorkflows(options: ExportWorkflowOptions = {}): ExportWorkflows {
    const sessions = options.sessions ?? sessionsStore;
    const platform = options.platform ?? browserExportFiles();
    const storage = options.storage ?? indexedDbExportFolders();
    const dialogs = options.dialogs ?? appExportDialogs;
    const notices = options.notices ?? appNotices;
    const files = options.files ?? appFileWorkflows;
    // Looked up when called, as the file workflows do: tests may replace the floating module.
    const applyFloating = options.applyFloating ?? (() => applyAppFloating());

    /** Export folders by document id; `null`: looked up in storage, none there. */
    const folders = new Map<string, FolderRecord | null>();
    /** The scale the frame PNG dialog last answered with. */
    let lastScale = 1;

    const failed = (document: string, why: string): false => {
        notices.error(`Could not export “${document}”. ${why}`);
        return false;
    };
    const exported = (count: number, destination: string): true => {
        notices.info(`Exported ${filesCount(count)} to “${destination}”`);
        return true;
    };
    /** The record the store holds now for the document of this id, if it is open. */
    const current = (id: string): OpenDocument | null =>
        sessions.getState().documents.find((entry) => entry.id === id) ?? null;

    /** The document's folder: from this session, else from storage (once). */
    const folderOf = async (id: string): Promise<FolderRecord | null> => {
        if (folders.has(id)) return folders.get(id) ?? null;
        let record: FolderRecord | null = null;
        try {
            const stored = await storage.load(id);
            const folder = stored ? platform.folderFrom(stored.folder) : null;
            if (stored && folder) record = { folder, confirmed: stored.confirmed };
        } catch {
            record = null;
        }
        // A folder chosen while storage was read wins.
        if (!folders.has(id)) folders.set(id, record);
        return folders.get(id) ?? null;
    };
    const remember = (id: string, record: FolderRecord): FolderRecord => {
        folders.set(id, record);
        void storage
            .save(id, { folder: record.folder.stored, confirmed: record.confirmed })
            .catch(() => {});
        return record;
    };

    /**
     * Starts an operation on the active document: applies a floating selection first. Null
     * when there is no document, when the float could not be applied (that failure has been
     * reported), or during a stroke (reported).
     */
    const settled = (): OpenDocument | null => {
        const opened = activeDocument(sessions.getState());
        if (!opened) return null;
        try {
            applyFloating();
        } catch {
            // `applyFloating` has reported why: one toast for the operation.
            return null;
        }
        const document = current(opened.id);
        if (!document) return null;
        if (document.history.transaction) {
            failed(document.session.doc.name, "A stroke is in progress.");
            return null;
        }
        return document;
    };

    /** Saves one file through the save picker, or downloads it. */
    const saveFile = async (
        document: string,
        file: BundleFile,
        kind: ExportFileKind,
        count: number,
    ): Promise<boolean> => {
        if (!platform.canChooseFile()) {
            platform.download(file.name, file.bytes, kind);
            return exported(count, file.name);
        }
        try {
            const target = await platform.chooseFile(file.name, kind);
            if (!target) return false;
            await target.write(file.bytes);
            return exported(count, target.name);
        } catch (error) {
            return failed(document, exportFailure(error));
        }
    };

    /** Shows the Export dialog for the document; exports when the user says so. */
    const dialogExport = async (document: OpenDocument): Promise<boolean> => {
        const { id } = document;
        const known = platform.canChooseFolder() ? await folderOf(id) : null;
        const destination = createStore<ExportDestination>(() => ({
            mode: platform.canChooseFolder() ? "folder" : "download",
            folder: known?.folder.name ?? null,
            choosing: false,
        }));
        const answer = await dialogs.exportBundle({
            documentId: id,
            destination,
            setSettings(update) {
                if (current(id)) sessions.getState().updateExportSettings(id, update);
            },
            setPivot(pivot: Pivot) {
                const target = current(id);
                if (!target || target.history.transaction) return;
                const { x, y } = target.session.doc.pivot;
                if (pivot.x === x && pivot.y === y) return;
                try {
                    target.history.execute(setPivotCommand(pivot));
                } catch (error) {
                    notices.error(exportFailure(error));
                }
            },
            chooseFolder() {
                if (destination.getState().choosing) return;
                destination.setState({ choosing: true });
                void (async () => {
                    try {
                        const folder = await platform.chooseFolder();
                        if (folder) {
                            // The same folder picked again keeps its confirmation.
                            const before = folders.get(id) ?? null;
                            const keep =
                                before !== null &&
                                before.confirmed &&
                                (await before.folder.isSame(folder));
                            remember(id, { folder, confirmed: keep });
                            destination.setState({ folder: folder.name });
                        }
                    } catch (error) {
                        failed(document.session.doc.name, exportFailure(error));
                    } finally {
                        destination.setState({ choosing: false });
                    }
                })();
            },
        });
        if (!answer) return false;
        return deliver(id, "dialog");
    };

    /**
     * Writes the bundle of the document: into its folder with File System Access, or as a zip
     * download. `mode` says what happens without a folder or permission.
     */
    const deliver = async (id: string, mode: Mode): Promise<boolean> => {
        const start = current(id);
        if (!start) return false;
        const documentName = start.session.doc.name;

        if (!platform.canChooseFolder()) {
            let made;
            try {
                made = bundle(start.session.doc);
            } catch (error) {
                return failed(documentName, exportFailure(error));
            }
            const zipName = `${exportName(documentName)}.zip`;
            platform.download(zipName, zipFiles(made.files), "zip");
            return exported(made.files.length, zipName);
        }

        let record = await folderOf(id);
        if (!record) {
            if (mode === "again") return dialogExport(start);
            if (mode === "save") {
                return failed(documentName, "No export folder is chosen yet. Use Export….");
            }
            let folder: ExportFolderHandle | null;
            try {
                folder = await platform.chooseFolder();
            } catch (error) {
                return failed(documentName, exportFailure(error));
            }
            if (!folder) return false;
            record = remember(id, { folder, confirmed: false });
        }
        const { folder } = record;

        // Permission first: the browser prompts only within the user's gesture. One prompt.
        let allowed: boolean;
        try {
            allowed = (await folder.canWrite()) || (await folder.requestWrite());
        } catch {
            allowed = false;
        }
        if (!allowed) {
            if (mode === "again") {
                const document = current(id);
                return document ? dialogExport(document) : false;
            }
            return failed(documentName, `No permission to write to the folder “${folder.name}”.`);
        }

        // The document as it is now: a prompt may have been open for a while.
        const document = current(id);
        if (!document) return failed(documentName, "The document was closed meanwhile.");
        let made;
        try {
            made = bundle(document.session.doc);
        } catch (error) {
            return failed(documentName, exportFailure(error));
        }
        const names = made.files.map((file) => file.name);
        try {
            if (!record.confirmed) {
                const existing = await folder.existing(names);
                if (existing.length > 0) {
                    const replace = await dialogs.confirmOverwrite({
                        document: documentName,
                        folder: folder.name,
                        files: existing,
                    });
                    if (!replace) return false;
                }
            }
            for (const file of made.files) await folder.write(file.name, file.bytes);
        } catch (error) {
            return failed(documentName, exportFailure(error));
        }
        // The folder of this document from now on, its files ours to replace.
        if (folders.get(id)?.folder === folder) remember(id, { folder, confirmed: true });
        return exported(made.files.length, folder.name);
    };

    const workflows: ExportWorkflows = {
        canExport: () => files.canSave(),

        exportWithDialog: () =>
            files.run(async () => {
                const document = settled();
                return document ? dialogExport(document) : false;
            }),

        exportAgain: () =>
            files.run(async () => {
                const document = settled();
                return document ? deliver(document.id, "again") : false;
            }),

        async exportOnSave(document) {
            if (!document.session.doc.exportSettings.exportOnSave) return;
            try {
                await deliver(document.id, "save");
            } catch (error) {
                failed(document.session.doc.name, exportFailure(error));
            }
        },

        exportFramePng: () =>
            files.run(async () => {
                const document = settled();
                if (!document) return false;
                const { doc, activeFrameId } = document.session;
                const name = exportName(doc.name);
                const maxScale = maxFramePngScale(doc);
                const scale = await dialogs.framePng({
                    name,
                    frameIndex: doc.frames.findIndex((frame) => frame.id === activeFrameId),
                    width: doc.width,
                    height: doc.height,
                    initialScale: Math.min(lastScale, maxScale),
                    maxScale,
                });
                if (scale === null) return false;
                lastScale = scale;
                // The frame as it is once the dialog is answered.
                const now = current(document.id);
                if (!now) return failed(doc.name, "The document was closed meanwhile.");
                let file: BundleFile;
                try {
                    file = framePngFile(now.session.doc, name, now.session.activeFrameId, scale);
                } catch (error) {
                    return failed(doc.name, exportFailure(error));
                }
                return saveFile(doc.name, file, "png", 1);
            }),

        exportSpriteSheet: () =>
            files.run(async () => {
                const document = settled();
                if (!document) return false;
                const { doc } = document.session;
                let file: BundleFile;
                try {
                    file = spriteSheetFile(doc);
                } catch (error) {
                    return failed(doc.name, exportFailure(error));
                }
                return saveFile(doc.name, file, "png", 1);
            }),

        exportPngSequence: () =>
            files.run(async () => {
                const document = settled();
                if (!document) return false;
                const { doc } = document.session;
                let frames: BundleFile[];
                try {
                    frames = pngSequenceFiles(doc);
                } catch (error) {
                    return failed(doc.name, exportFailure(error));
                }
                const zip = { name: `${exportName(doc.name)}-frames.zip`, bytes: zipFiles(frames) };
                return saveFile(doc.name, zip, "zip", frames.length);
            }),

        folderOf: (id) => folders.get(id)?.folder.name ?? null,
    };
    return workflows;
}

/** The export workflows of the app. */
export const exportWorkflows = createExportWorkflows();
