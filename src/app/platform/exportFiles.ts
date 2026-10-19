/**
 * Where exports go (SPEC §9.6, SE-052): a folder chosen with the directory picker of the File
 * System Access API where the browser has it, otherwise a download. Single files (a frame
 * PNG, the sprite sheet, a zip) are saved through the save picker where there is one. Like
 * `projectFiles.ts`, everything here touches the page only when it is called, so the modules
 * that import it also load in Node; the export workflows take an `ExportPlatform`, and tests
 * give them a fake.
 */

/** A folder of the user's disk that exports are written to. */
export interface ExportFolderHandle {
    /** The folder's name, as the picker showed it. */
    readonly name: string;
    /**
     * What IndexedDB stores to give the folder back after a reload (a native
     * `FileSystemDirectoryHandle` is structured-cloneable): `ExportPlatform.folderFrom` takes
     * it back.
     */
    readonly stored: unknown;
    /** Whether the app may write into the folder now, without asking. */
    canWrite(): Promise<boolean>;
    /**
     * Asks the user for write permission (the browser shows its prompt only during a user
     * gesture); true when it is granted. A prompt the browser refuses to show counts as a
     * refusal.
     */
    requestWrite(): Promise<boolean>;
    /** Which of these file names exist in the folder already. */
    existing(names: readonly string[]): Promise<string[]>;
    /** Creates or replaces a file of the folder; the file keeps its old content on failure. */
    write(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
    /** Whether `other` is the same folder of the disk (picked again, say). */
    isSame(other: ExportFolderHandle): Promise<boolean>;
}

/** A file chosen with the save picker. */
export interface ExportFileHandle {
    readonly name: string;
    write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}

/** The kinds of single file an export saves. */
export type ExportFileKind = "png" | "zip";

export interface ExportPlatform {
    /** True when exports go to a folder (directory picker); false when they download. */
    canChooseFolder(): boolean;
    /** Asks for a folder; null when the user cancels. */
    chooseFolder(): Promise<ExportFolderHandle | null>;
    /** A folder from what IndexedDB kept of it (`stored`), or null when it is not one. */
    folderFrom(stored: unknown): ExportFolderHandle | null;
    /** True when a single file is saved through a save picker; false when it downloads. */
    canChooseFile(): boolean;
    /** Asks where to save a single file; null when the user cancels. */
    chooseFile(suggestedName: string, kind: ExportFileKind): Promise<ExportFileHandle | null>;
    /** Hands the bytes to the browser as a download named `name`. */
    download(name: string, bytes: Uint8Array<ArrayBuffer>, kind: ExportFileKind): void;
}

// --- File System Access, as far as exports use it ------------------------------------------------

type PermissionMode = { mode: "read" | "readwrite" };

interface NativeWritable {
    write(data: Uint8Array<ArrayBuffer>): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
}

interface NativeFileHandle {
    readonly kind: string;
    readonly name: string;
    createWritable(): Promise<NativeWritable>;
}

interface NativeDirectoryHandle {
    readonly kind: string;
    readonly name: string;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<NativeFileHandle>;
    queryPermission?(descriptor: PermissionMode): Promise<PermissionState>;
    requestPermission?(descriptor: PermissionMode): Promise<PermissionState>;
    isSameEntry?(other: unknown): Promise<boolean>;
}

interface PickerType {
    description: string;
    accept: Record<string, string[]>;
}

interface FileSystemAccessWindow {
    showDirectoryPicker?(options?: { id?: string; mode?: "read" | "readwrite" }): Promise<unknown>;
    showSaveFilePicker?(options?: {
        id?: string;
        types?: PickerType[];
        suggestedName?: string;
    }): Promise<NativeFileHandle>;
}

/** The pickers remember the last folder under these ids. */
const FOLDER_PICKER_ID = "ngne-sprite-export";
const FILE_PICKER_ID = "ngne-sprite-export-file";

const FILE_TYPES: Record<ExportFileKind, { mime: string; type: PickerType }> = {
    png: {
        mime: "image/png",
        type: { description: "PNG image", accept: { "image/png": [".png"] } },
    },
    zip: {
        mime: "application/zip",
        type: { description: "Zip archive", accept: { "application/zip": [".zip"] } },
    },
};

const WRITE: PermissionMode = { mode: "readwrite" };

function pickers(): FileSystemAccessWindow {
    return window as unknown as FileSystemAccessWindow;
}

/** True when the user closed a picker without choosing: not a failure. */
function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function isNotFound(error: unknown): boolean {
    return error instanceof DOMException && error.name === "NotFoundError";
}

function isTypeMismatch(error: unknown): boolean {
    return error instanceof DOMException && error.name === "TypeMismatchError";
}

function isDirectory(value: unknown): value is NativeDirectoryHandle {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<NativeDirectoryHandle>;
    return (
        candidate.kind === "directory" &&
        typeof candidate.name === "string" &&
        typeof candidate.getFileHandle === "function"
    );
}

/** Writes through a writable; the browser writes to a copy, which an abort throws away. */
async function writeTo(file: NativeFileHandle, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const writable = await file.createWritable();
    try {
        await writable.write(bytes);
    } catch (error) {
        await writable.abort?.().catch(() => {});
        throw error;
    }
    await writable.close();
}

function wrapFolder(native: NativeDirectoryHandle): ExportFolderHandle {
    return {
        name: native.name,
        stored: native,
        async canWrite() {
            // A browser without the permission methods grants what the handle was given for.
            if (!native.queryPermission) return true;
            return (await native.queryPermission(WRITE)) === "granted";
        },
        async requestWrite() {
            if (!native.requestPermission) return true;
            try {
                return (await native.requestPermission(WRITE)) === "granted";
            } catch {
                // Chrome throws when it may not prompt (no user gesture): no permission.
                return false;
            }
        },
        async existing(names) {
            const found: string[] = [];
            for (const name of names) {
                try {
                    await native.getFileHandle(name);
                    found.push(name);
                } catch (error) {
                    // A name taken by a folder is not a file this export replaces; the write
                    // fails on it and says so.
                    if (!isNotFound(error) && !isTypeMismatch(error)) throw error;
                }
            }
            return found;
        },
        async write(name, bytes) {
            await writeTo(await native.getFileHandle(name, { create: true }), bytes);
        },
        async isSame(other) {
            if (other.stored === native) return true;
            if (!native.isSameEntry || !isDirectory(other.stored)) return false;
            try {
                return await native.isSameEntry(other.stored);
            } catch {
                return false;
            }
        },
    };
}

/** The page's platform: File System Access where the browser has it, else downloads. */
export function browserExportFiles(): ExportPlatform {
    return {
        canChooseFolder: () => typeof pickers().showDirectoryPicker === "function",

        async chooseFolder() {
            const show = pickers().showDirectoryPicker;
            if (typeof show !== "function") return null;
            try {
                const native = await show.call(window, { id: FOLDER_PICKER_ID, mode: "readwrite" });
                return isDirectory(native) ? wrapFolder(native) : null;
            } catch (error) {
                if (isAbort(error)) return null;
                throw error;
            }
        },

        folderFrom: (stored) => (isDirectory(stored) ? wrapFolder(stored) : null),

        canChooseFile: () => typeof pickers().showSaveFilePicker === "function",

        async chooseFile(suggestedName, kind) {
            const show = pickers().showSaveFilePicker;
            if (typeof show !== "function") return null;
            try {
                const native = await show.call(window, {
                    id: FILE_PICKER_ID,
                    types: [FILE_TYPES[kind].type],
                    suggestedName,
                });
                return { name: native.name, write: (bytes) => writeTo(native, bytes) };
            } catch (error) {
                if (isAbort(error)) return null;
                throw error;
            }
        },

        download(name, bytes, kind) {
            const url = URL.createObjectURL(new Blob([bytes], { type: FILE_TYPES[kind].mime }));
            const link = document.createElement("a");
            link.href = url;
            link.download = name;
            link.hidden = true;
            document.body.append(link);
            link.click();
            link.remove();
            // The download has started from the URL; it is let go once the browser has it.
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
    };
}
