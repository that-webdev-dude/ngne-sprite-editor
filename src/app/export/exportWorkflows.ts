import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { exportName } from "../../core/export";
import type { Bundle, BundleFile } from "../../core/export";
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
import { PNG_FILE, ZIP_FILE, browserExportFiles } from "../platform/exportFiles";
import type { ExportFileType, ExportFolderHandle, ExportPlatform } from "../platform/exportFiles";
import { applyFloating as applyAppFloating } from "../selection/floating";
import { activeDocument, isDirty, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import { exportDialogs as appExportDialogs } from "./dialogs";
import type { ExportDestination, ExportDialogs } from "./dialogs";
import { FOLDER_LOAD_TIMEOUT_MS, indexedDbExportFolders } from "./exportFolders";
import type { ExportFolderStorage } from "./exportFolders";
import { exportFailure, previewOf } from "./exportPreview";
import { applyExportSettingsPatch, exportSettingsProblem } from "./settingsPatch";

// The export workflows of SPEC §9.6 (SE-052), on the active document:
//
// - Export… shows the Export dialog; its Export button writes the bundle into the document's
//   export folder (File System Access: chosen once per document, kept in IndexedDB), or
//   downloads it as `<name>.zip` without that API.
// - Export Again writes the bundle again without the dialog. Without a folder, when the
//   folder no longer exists, or when its write permission is not given (refused at the one
//   prompt, or no gesture to prompt in), it shows the dialog instead.
// - With `exportOnSave`, a successful save writes the bundle the same way, of the document as
//   it was saved; it never shows a dialog or asks a question, and a failure is one error toast
//   that leaves the save as it is.
// - Before replacing files in a folder for the first time, a document's export asks once,
//   naming the files the folder holds (DESIGN §7, Overwrite confirm).
// - The other exports (frame PNG, sprite sheet PNG, PNG sequence; GIF in SE-063) go through
//   `otherExport`: saved through the save picker, or downloaded.
//
// Each is a file operation (`FileWorkflows.run`): one at a time, not during a stroke, and a
// floating selection is applied first (SPEC §5.2). A stroke begun while an export waits (a
// prompt, a check of the folder) makes it stop before it bundles. Results are info toasts
// naming the number of files and where they went; each failed operation is one error toast; a
// picker or a question the user cancels is not reported.

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

/** What an export beside the bundle makes: one file to save, holding `count` files. */
export interface OtherExportResult {
    /** The file; with `produce`, only its name is read (its `bytes` may be empty). */
    file: BundleFile;
    type: ExportFileType;
    /** How many files the result toast names: 1, or the files a zip holds. */
    count: number;
    /**
     * Makes the file's bytes once it has a place to go: after the save picker (which then
     * opens within the user's gesture, before a long encode), before a download (SE-063
     * review). What it throws is reported as the export's failure (its message), and nothing
     * is written.
     */
    produce?(): Promise<Uint8Array<ArrayBuffer>>;
}

/** What `otherExport` hands the function that makes the file. */
export interface OtherExportContext {
    /** The document as the store holds it now; null once it is closed. */
    current(): OpenDocument | null;
}

/**
 * Makes the file of an export beside the bundle, from the document once a floating selection
 * is applied. It may ask the user first (its own dialog); null when the user cancels. What it
 * throws is reported as the export's failure (its message).
 */
export type OtherExportMaker = (
    document: OpenDocument,
    context: OtherExportContext,
) => Promise<OtherExportResult | null>;

export interface ExportWorkflows {
    /**
     * Whether an export can start now: a document is open, no file operation runs, and its
     * history is idle or holds a floating selection, which the export applies first.
     */
    canExport(): boolean;
    /** Export…: the Export dialog, then the bundle. */
    exportWithDialog(): Promise<boolean>;
    /** Export Again: the bundle without the dialog, unless it needs a folder or permission. */
    exportAgain(): Promise<boolean>;
    /**
     * What a successful save runs (`FileWorkflows.onSaved`): the bundle, when the document's
     * `exportOnSave` is on. Never shows a dialog; reports a failure by one error toast.
     */
    exportOnSave(document: OpenDocument): Promise<void>;
    /**
     * An export beside the bundle, as a file operation of its own: applies a floating
     * selection, has `make` make the file, saves it through the save picker or downloads it,
     * and reports the result or the failure in one toast. Frame PNG, sprite sheet and PNG
     * sequence use it; a later export (GIF, SE-063) registers a command that calls it. A
     * result with `produce` has its bytes made only once the file has a place to go.
     */
    otherExport(make: OtherExportMaker): Promise<boolean>;
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

/** A reason as the middle of a sentence: without its closing full stop. */
function clause(reason: string): string {
    return reason.replace(/\.$/, "");
}

/** Thrown when the stored folder of a document is not read in time. */
class StorageTimeout extends Error {
    override readonly name = "StorageTimeout";
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

    /**
     * The document's folder: from this session, else from storage (once). Throws
     * `StorageTimeout` when storage does not answer within `FOLDER_LOAD_TIMEOUT_MS`; nothing
     * is remembered then, so the next export reads storage again.
     */
    const folderOf = async (id: string): Promise<FolderRecord | null> => {
        if (folders.has(id)) return folders.get(id) ?? null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new StorageTimeout("The browser's storage did not answer in time.")),
                FOLDER_LOAD_TIMEOUT_MS,
            );
        });
        let record: FolderRecord | null = null;
        try {
            const stored = await Promise.race([storage.load(id), timeout]);
            const folder = stored ? platform.folderFrom(stored.folder) : null;
            if (stored && folder) record = { folder, confirmed: stored.confirmed };
        } catch (error) {
            if (error instanceof StorageTimeout) throw error;
            record = null;
        } finally {
            clearTimeout(timer);
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
    const saveFile = async (document: string, result: OtherExportResult): Promise<boolean> => {
        const { file, type, count, produce } = result;
        const bytesOf = () => (produce ? produce() : Promise.resolve(file.bytes));
        if (!platform.canChooseFile()) {
            let bytes: Uint8Array<ArrayBuffer>;
            try {
                bytes = await bytesOf();
            } catch (error) {
                return failed(document, exportFailure(error));
            }
            platform.download(file.name, bytes, type);
            return exported(count, file.name);
        }
        try {
            const target = await platform.chooseFile(file.name, type);
            if (!target) return false;
            await target.write(await bytesOf());
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
            setSettings(patch) {
                const target = current(id);
                if (!target) return false;
                const problem = exportSettingsProblem(target.session.doc, patch);
                if (problem) {
                    notices.error(problem);
                    return false;
                }
                sessions
                    .getState()
                    .updateExportSettings(id, (settings) =>
                        applyExportSettingsPatch(settings, patch),
                    );
                return true;
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
     * The document of this id when its bundle may be made now, or why not: it was closed, a
     * transaction is open in it (a stroke begun while the export waited), or, after a save, it
     * is no longer as it was saved (an edit made while the project was being written).
     */
    const ready = (id: string, mode: Mode): OpenDocument | string => {
        const document = current(id);
        if (!document) return "The document was closed meanwhile.";
        if (document.history.transaction) return "A stroke is in progress.";
        if (mode === "save" && isDirty(document)) {
            return "It changed after it was saved. Use Export Again.";
        }
        return document;
    };

    /** The bundle of the document now: the Export dialog's, when nothing has changed since. */
    const bundleOf = (document: OpenDocument): Bundle | string => {
        const preview = previewOf(document);
        return preview.bundle ?? preview.error ?? "The document cannot be exported.";
    };

    /**
     * Writes the bundle of the document: into its folder with File System Access, or as a zip
     * download. `mode` says what happens without a folder or permission.
     */
    const deliver = async (id: string, mode: Mode): Promise<boolean> => {
        const start = current(id);
        if (!start) return false;
        const documentName = start.session.doc.name;
        const fail = (why: string) => failed(documentName, why);

        if (!platform.canChooseFolder()) {
            const document = ready(id, mode);
            if (typeof document === "string") return fail(document);
            const made = bundleOf(document);
            if (typeof made === "string") return fail(made);
            const zipName = `${exportName(documentName)}.zip`;
            platform.download(zipName, zipFiles(made.files), ZIP_FILE);
            return exported(made.files.length, zipName);
        }

        let record: FolderRecord | null;
        try {
            record = await folderOf(id);
        } catch (error) {
            return fail(exportFailure(error));
        }
        if (!record) {
            if (mode === "again") return dialogExport(start);
            if (mode === "save") return fail("No export folder is chosen yet. Use Export….");
            let folder: ExportFolderHandle | null;
            try {
                folder = await platform.chooseFolder();
            } catch (error) {
                return fail(exportFailure(error));
            }
            if (!folder) return false;
            record = remember(id, { folder, confirmed: false });
        }
        const { folder } = record;
        const gone = `The folder “${folder.name}” no longer exists. Use Export….`;
        /** Export Again shows the dialog where the others report why they stop. */
        const orDialog = (why: string) => {
            if (mode !== "again") return fail(why);
            const document = current(id);
            return document ? dialogExport(document) : false;
        };

        if (!(await folder.exists())) return orDialog(gone);

        // Permission first: the browser prompts only within the user's gesture. One prompt;
        // without a gesture there is none, and Export Again (a key) gives one.
        let allowed: boolean;
        let lapsed = false;
        try {
            allowed = await folder.canWrite();
            if (!allowed) {
                if (platform.hasUserActivation()) allowed = await folder.requestWrite();
                else lapsed = true;
            }
        } catch {
            allowed = false;
        }
        if (!allowed) {
            const denied = `No permission to write to the folder “${folder.name}”.`;
            return orDialog(lapsed ? `${denied} Use Export Again.` : denied);
        }

        // The document as it is now: a prompt may have been open for a while.
        const document = ready(id, mode);
        if (typeof document === "string") return fail(document);
        const made = bundleOf(document);
        if (typeof made === "string") return fail(made);

        if (!record.confirmed) {
            let existing: string[];
            try {
                existing = await folder.existing(made.files.map((file) => file.name));
            } catch (error) {
                return fail(exportFailure(error));
            }
            if (existing.length > 0) {
                // A save asks nothing: the files are replaced only once Export… confirmed it.
                if (mode === "save") {
                    return fail(
                        `The folder “${folder.name}” holds files this export would replace ` +
                            `(${existing.join(", ")}). Use Export… to confirm replacing them.`,
                    );
                }
                const replace = await dialogs.confirmOverwrite({
                    document: documentName,
                    folder: folder.name,
                    files: existing,
                });
                if (!replace) return false;
            }
        }

        const written: string[] = [];
        for (const file of made.files) {
            try {
                await folder.write(file.name, file.bytes);
            } catch (error) {
                if (!(await folder.exists())) return fail(gone);
                const done = written.length > 0 ? ` Written: ${written.join(", ")}.` : "";
                notices.error(
                    `Could not write “${file.name}” to “${folder.name}”: ` +
                        `${clause(exportFailure(error))}.${done}`,
                );
                return false;
            }
            written.push(file.name);
            // Once a file of the bundle is there, the folder's files are this document's: a
            // later export does not ask about them, even when this one stops half way.
            if (!record.confirmed && folders.get(id)?.folder === folder) {
                record = remember(id, { folder, confirmed: true });
            }
        }
        return exported(made.files.length, folder.name);
    };

    const otherExport = (make: OtherExportMaker): Promise<boolean> =>
        files.run(async () => {
            const document = settled();
            if (!document) return false;
            const name = document.session.doc.name;
            let result: OtherExportResult | null;
            try {
                result = await make(document, { current: () => current(document.id) });
            } catch (error) {
                return failed(name, exportFailure(error));
            }
            return result ? saveFile(name, result) : false;
        });

    const workflows: ExportWorkflows = {
        canExport: () => files.canSave(),

        exportWithDialog: () =>
            files.run(async () => {
                const document = settled();
                if (!document) return false;
                try {
                    return await dialogExport(document);
                } catch (error) {
                    return failed(document.session.doc.name, exportFailure(error));
                }
            }),

        exportAgain: () =>
            files.run(async () => {
                const document = settled();
                if (!document) return false;
                try {
                    return await deliver(document.id, "again");
                } catch (error) {
                    return failed(document.session.doc.name, exportFailure(error));
                }
            }),

        async exportOnSave(document) {
            if (!document.session.doc.exportSettings.exportOnSave) return;
            try {
                await deliver(document.id, "save");
            } catch (error) {
                failed(document.session.doc.name, exportFailure(error));
            }
        },

        otherExport,

        exportFramePng: () =>
            otherExport(async (document, context) => {
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
                if (scale === null) return null;
                lastScale = scale;
                // The frame as it is once the dialog is answered.
                const now = context.current();
                if (!now) throw new Error("The document was closed meanwhile.");
                const file = framePngFile(now.session.doc, name, now.session.activeFrameId, scale);
                return { file, type: PNG_FILE, count: 1 };
            }),

        exportSpriteSheet: () =>
            otherExport(async (document) => ({
                file: spriteSheetFile(document.session.doc),
                type: PNG_FILE,
                count: 1,
            })),

        exportPngSequence: () =>
            otherExport(async (document) => {
                const { doc } = document.session;
                const frames = pngSequenceFiles(doc);
                const zip = { name: `${exportName(doc.name)}-frames.zip`, bytes: zipFiles(frames) };
                return { file: zip, type: ZIP_FILE, count: frames.length };
            }),

        folderOf: (id) => folders.get(id)?.folder.name ?? null,
    };
    return workflows;
}

/** The export workflows of the app. */
export const exportWorkflows = createExportWorkflows();
