/**
 * The browser's ways to read and write the user's files (SPEC §10): the File System Access API
 * where the browser has it (Chrome and Edge), otherwise a file input to open and a download to
 * save. Everything here touches the page only when it is called, so the modules that import it
 * also load in Node; the file workflows take a `ProjectFilePlatform`, and tests give them a fake.
 */
import { PROJECT_FILE_EXTENSION } from "../../core/project";

/** The files the pickers offer: projects, which are zip archives (docs/FORMAT.md §1.1). */
const PICKER_TYPES = [
    { description: "NGNE sprite project", accept: { "application/zip": [PROJECT_FILE_EXTENSION] } },
];
/** The pickers remember the last folder under this id. */
const PICKER_ID = "ngne-sprite-project";

/**
 * A file of the user's disk the app keeps and can read and write again: a File System Access
 * handle (SE-041 keeps one per document).
 */
export interface ProjectFileHandle {
    /** The file's name, "hero.ngsprite". */
    readonly name: string;
    read(): Promise<Uint8Array>;
    /**
     * Whether the app may read the file. Asks the user when the permission is not granted (any
     * more); false when it is refused. As for `requestWrite`, a prompt needs a user gesture.
     */
    requestRead(): Promise<boolean>;
    /**
     * Whether the app may write the file. Asks the user when the permission is not granted yet
     * (the browser shows its prompt only during a user gesture); false when it is refused.
     */
    requestWrite(): Promise<boolean>;
    /** Replaces the file's content; the file keeps its old content when this fails. */
    write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
    /**
     * What IndexedDB stores to give the file back after a reload (a native
     * `FileSystemFileHandle` is structured-cloneable): `projectFileHandleFrom` takes it back.
     * Absent where the handle cannot be kept (SE-047, recent files).
     */
    readonly stored?: unknown;
    /** Whether `other` is the same file of the disk (chosen again, say); SE-047. */
    isSame?(other: ProjectFileHandle): Promise<boolean>;
    /** The file's size in bytes, known before it is read; fails as `read` does. SE-047. */
    size?(): Promise<number>;
    /**
     * As `requestRead`, with the browser's answer: "granted"; "denied", refused; "prompt",
     * a prompt dismissed without an answer (SE-047 review: Open Recent keeps the entry).
     */
    requestReadPermission?(): Promise<PermissionAnswer>;
}

/** What the browser answers a permission request with. */
export type PermissionAnswer = "granted" | "denied" | "prompt";

/** A file the user chose to open: from a picker, a file input or a drop. */
export interface ChosenFile {
    readonly name: string;
    /** Its size in bytes, known before it is read. */
    readonly size: number;
    read(): Promise<Uint8Array>;
    /** The handle to save back to: from a picker or a drop with File System Access, or null. */
    handle(): Promise<ProjectFileHandle | null>;
}

export interface ProjectFilePlatform {
    /** True when a save asks where to write (a save picker); false when it downloads. */
    canChooseSaveTarget(): boolean;
    /** Asks for a project file to open; null when the user cancels. */
    chooseFileToOpen(): Promise<ChosenFile | null>;
    /** Asks where to save, with a save picker; null when the user cancels. */
    chooseSaveTarget(suggestedName: string): Promise<ProjectFileHandle | null>;
    /**
     * Hands the bytes to the browser as a download named `name`. The page learns nothing of
     * what follows: a save dialog of the browser that the user cancels leaves no file.
     */
    download(name: string, bytes: Uint8Array<ArrayBuffer>): void;
    /**
     * Whether the page still has the user's gesture (`navigator.userActivation.isActive`): a
     * picker or a permission prompt needs it, and it lapses a few seconds after the gesture.
     */
    hasUserActivation(): boolean;
}

// --- File System Access, as far as the app uses it (Chrome has it; lib.dom lacks part) --------

type PermissionMode = { mode: "read" | "readwrite" };

interface NativeWritable {
    write(data: Uint8Array<ArrayBuffer>): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
}

interface NativeFileHandle {
    readonly kind: string;
    readonly name: string;
    getFile(): Promise<File>;
    createWritable(): Promise<NativeWritable>;
    queryPermission?(descriptor: PermissionMode): Promise<PermissionState>;
    requestPermission?(descriptor: PermissionMode): Promise<PermissionState>;
    isSameEntry?(other: unknown): Promise<boolean>;
}

interface PickerOptions {
    id?: string;
    types?: typeof PICKER_TYPES;
    excludeAcceptAllOption?: boolean;
    multiple?: boolean;
    suggestedName?: string;
}

interface FileSystemAccessWindow {
    showOpenFilePicker?(options?: PickerOptions): Promise<NativeFileHandle[]>;
    showSaveFilePicker?(options?: PickerOptions): Promise<NativeFileHandle>;
}

interface HandleItem {
    getAsFileSystemHandle?(): Promise<NativeFileHandle | null>;
}

function pickers(): FileSystemAccessWindow {
    return window as unknown as FileSystemAccessWindow;
}

/** True when the user closed a picker without choosing: not a failure. */
function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

async function bytesOf(file: Blob): Promise<Uint8Array> {
    return new Uint8Array(await file.arrayBuffer());
}

/** The permission `native` has, asking the user when it is not granted. */
async function answer(
    native: NativeFileHandle,
    descriptor: PermissionMode,
): Promise<PermissionAnswer> {
    // A browser without the permission methods grants what the handle was given for.
    if (!native.queryPermission) return "granted";
    if ((await native.queryPermission(descriptor)) === "granted") return "granted";
    return (await native.requestPermission?.(descriptor)) ?? "granted";
}

/** Whether `native` has the permission, asking the user when it has not. */
async function request(native: NativeFileHandle, descriptor: PermissionMode): Promise<boolean> {
    return (await answer(native, descriptor)) === "granted";
}

function isFileHandle(value: unknown): value is NativeFileHandle {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<NativeFileHandle>;
    return (
        candidate.kind === "file" &&
        typeof candidate.name === "string" &&
        typeof candidate.getFile === "function"
    );
}

function wrapHandle(native: NativeFileHandle): ProjectFileHandle {
    return {
        name: native.name,
        stored: native,
        async isSame(other) {
            if (other.stored === native) return true;
            if (!native.isSameEntry || !isFileHandle(other.stored)) return false;
            try {
                return await native.isSameEntry(other.stored);
            } catch {
                return false;
            }
        },
        size: async () => (await native.getFile()).size,
        read: async () => bytesOf(await native.getFile()),
        requestRead: () => request(native, { mode: "read" }),
        requestReadPermission: () => answer(native, { mode: "read" }),
        requestWrite: () => request(native, { mode: "readwrite" }),
        async write(bytes) {
            const writable = await native.createWritable();
            try {
                await writable.write(bytes);
            } catch (error) {
                // The browser writes to a copy, so the file keeps its old content.
                await writable.abort?.().catch(() => {});
                throw error;
            }
            await writable.close();
        },
    };
}

function chosenFile(file: File, handle: Promise<ProjectFileHandle | null>): ChosenFile {
    return { name: file.name, size: file.size, read: () => bytesOf(file), handle: () => handle };
}

/** The open picker of File System Access. */
async function pickToOpen(
    show: NonNullable<FileSystemAccessWindow["showOpenFilePicker"]>,
): Promise<ChosenFile | null> {
    let handles: NativeFileHandle[];
    try {
        handles = await show({ id: PICKER_ID, types: PICKER_TYPES, multiple: false });
    } catch (error) {
        if (isAbort(error)) return null;
        throw error;
    }
    const [native] = handles;
    if (!native) return null;
    const handle = wrapHandle(native);
    return chosenFile(await native.getFile(), Promise.resolve(handle));
}

/**
 * A file input, clicked: the way to open a file without File System Access. Resolves null when
 * the user cancels (Chrome fires `cancel` on the input).
 */
function inputToOpen(): Promise<ChosenFile | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = PROJECT_FILE_EXTENSION;
        input.hidden = true;
        input.dataset.projectFileInput = "";
        const finish = (file: File | null) => {
            input.remove();
            resolve(file ? chosenFile(file, Promise.resolve(null)) : null);
        };
        input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
        input.addEventListener("cancel", () => finish(null), { once: true });
        document.body.append(input);
        input.click();
    });
}

/** The page's platform: File System Access where the browser has it, else input and download. */
export function browserProjectFiles(): ProjectFilePlatform {
    return {
        canChooseSaveTarget: () => typeof pickers().showSaveFilePicker === "function",

        chooseFileToOpen() {
            const show = pickers().showOpenFilePicker;
            return typeof show === "function" ? pickToOpen(show.bind(window)) : inputToOpen();
        },

        async chooseSaveTarget(suggestedName) {
            const show = pickers().showSaveFilePicker;
            if (typeof show !== "function") return null;
            try {
                const native = await show.call(window, {
                    id: PICKER_ID,
                    types: PICKER_TYPES,
                    suggestedName,
                });
                return wrapHandle(native);
            } catch (error) {
                if (isAbort(error)) return null;
                throw error;
            }
        },

        download(name, bytes) {
            const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
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

        hasUserActivation() {
            const { userActivation } = navigator as Navigator & {
                userActivation?: { isActive: boolean };
            };
            // Without the API the picker is tried, and a refusal reported.
            return userActivation?.isActive ?? true;
        },
    };
}

/**
 * A project file from what IndexedDB kept of it (`ProjectFileHandle.stored`, SE-047), or null
 * when it is not a file handle.
 */
export function projectFileHandleFrom(stored: unknown): ProjectFileHandle | null {
    return isFileHandle(stored) ? wrapHandle(stored) : null;
}

/**
 * The files of a drop, with the handle of each where File System Access gives one. Called
 * during the `drop` event: the items of a data transfer are empty once the event is over.
 */
export function droppedFiles(transfer: DataTransfer): ChosenFile[] {
    const chosen: ChosenFile[] = [];
    for (const item of Array.from(transfer.items)) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        const native = (item as DataTransferItem & HandleItem).getAsFileSystemHandle?.();
        const handle = (native ?? Promise.resolve(null)).then(
            (found) => (found?.kind === "file" ? wrapHandle(found) : null),
            () => null,
        );
        chosen.push(chosenFile(file, handle));
    }
    // A transfer made by a script may list its files only under `files`.
    if (chosen.length === 0) {
        for (const file of Array.from(transfer.files)) {
            chosen.push(chosenFile(file, Promise.resolve(null)));
        }
    }
    return chosen;
}

/** Whether a drag carries files (and not text or an element of the page). */
export function carriesFiles(transfer: DataTransfer | null): boolean {
    return transfer !== null && Array.from(transfer.types).includes("Files");
}
