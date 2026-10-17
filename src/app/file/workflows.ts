import type { StoreApi } from "zustand/vanilla";
import type { DocSession, SpriteDoc } from "../../core/model";
import { PROJECT_FILE_EXTENSION, deserialize, serialize } from "../../core/project";
import type { ProjectContents } from "../../core/project";
import { notices as appNotices } from "../notices/notices";
import type { Notices } from "../notices/notices";
import { browserProjectFiles } from "../platform/projectFiles";
import type { ChosenFile, ProjectFileHandle, ProjectFilePlatform } from "../platform/projectFiles";
import { applyFloating as applyAppFloating } from "../selection/floating";
import { activeDocument, isDirty, savedStateOf, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import { fileDialogs as appFileDialogs } from "./dialogs";
import type { DiscardAction, FileDialogs } from "./dialogs";
import { isProjectFileName, projectFileName } from "./fileName";

// The file workflows of SPEC §10 (SE-041): Open, Save, Save As, Close and Revert of the active
// document, and opening a dropped project file. A document remembers the file it was opened
// from or last saved to; with File System Access that is a handle Save writes to again.
//
// One operation at a time: while one runs (a picker, a question, a write), `busy` is true and
// the others do nothing. Results and failures are reported as notices (toasts); a failure
// leaves every open document as it was.

/** The file a document was opened from or last saved to. */
export interface DocumentFile {
    /** Its name: what messages call it and what the next save suggests. */
    readonly name: string;
    /** Where Save writes without asking: a File System Access handle; null without one. */
    readonly handle: ProjectFileHandle | null;
    /** Without a handle: the bytes last read or written, which Revert reads again. */
    readonly bytes: Uint8Array | null;
}

export interface FileWorkflowOptions {
    /** The store of open documents; the default is the app's. */
    sessions?: StoreApi<SessionsState>;
    /** How files are chosen, read and written; the default is the page's. */
    platform?: ProjectFilePlatform;
    /** Where the questions are asked; the default is the app's dialog host. */
    dialogs?: FileDialogs;
    /** Where results and failures go; the default is the app's toasts. */
    notices?: Pick<Notices, "info" | "error">;
    /** Applies the floating selection before a save (SPEC §5.2); the default is the app's. */
    applyFloating?(): void;
}

export interface FileWorkflows {
    /** True while an operation runs; the others do nothing until it ends. */
    readonly busy: boolean;
    /** Calls `listener` when `busy` or the file of a document changes. */
    subscribe(listener: () => void): () => void;
    /** The file of an open document, or null when it has none (never saved, not opened). */
    fileOf(id: string): DocumentFile | null;
    /** Asks for a project file and opens it in place of the active document. */
    open(): Promise<boolean>;
    /** Opens the first project file among `files` (a drop) in place of the active document. */
    openFiles(files: readonly ChosenFile[]): Promise<boolean>;
    /** Saves the active document to its file, or asks where when it has none. */
    save(): Promise<boolean>;
    /** Saves the active document to a file chosen now, which becomes its file. */
    saveAs(): Promise<boolean>;
    /** Closes the active document, asking first when it has unsaved changes. */
    close(): Promise<boolean>;
    /** Reads the active document's file again in its place, asking first when it is dirty. */
    revert(): Promise<boolean>;
}

/** What went wrong, for a message: an error's own message (ProjectError names the entry). */
function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/**
 * The session a document opens in: no selection, the first frame and the top pixel layer
 * (session state is not saved, docs/FORMAT.md §1).
 */
export function sessionOf(doc: SpriteDoc): DocSession {
    const pixelLayers = doc.layers.filter((layer) => layer.kind === "pixel");
    const layer = pixelLayers[pixelLayers.length - 1];
    const frame = doc.frames[0];
    // `deserialize` returns no document without them.
    if (!layer || !frame) throw new Error("The document has no pixel layer or no frame.");
    return { doc, selection: null, activeLayerId: layer.id, activeFrameId: frame.id };
}

export function createFileWorkflows(options: FileWorkflowOptions = {}): FileWorkflows {
    const sessions = options.sessions ?? sessionsStore;
    const platform = options.platform ?? browserProjectFiles();
    const dialogs = options.dialogs ?? appFileDialogs;
    const notices = options.notices ?? appNotices;
    const applyFloating = options.applyFloating ?? applyAppFloating;

    const files = new Map<string, DocumentFile>();
    const listeners = new Set<() => void>();
    let busy = false;

    const changed = () => {
        for (const listener of [...listeners]) listener();
    };
    const setFile = (id: string, file: DocumentFile) => {
        files.set(id, file);
        changed();
    };
    // A document that is no longer open has no file.
    sessions.subscribe(({ documents }) => {
        const open = new Set(documents.map((document) => document.id));
        const closed = [...files.keys()].filter((id) => !open.has(id));
        for (const id of closed) files.delete(id);
        if (closed.length > 0) changed();
    });

    /** Runs `task` unless another operation runs; `busy` meanwhile. */
    const exclusive = async (task: () => Promise<boolean>): Promise<boolean> => {
        if (busy) return false;
        busy = true;
        changed();
        try {
            return await task();
        } finally {
            busy = false;
            changed();
        }
    };

    /** The active document when an operation may act on it: not during a stroke. */
    const editable = (): OpenDocument | null => {
        const document = activeDocument(sessions.getState());
        return document && !document.history.transaction ? document : null;
    };
    /** `document` as the store holds it now, if it is still the active one and idle. */
    const stillActive = (document: OpenDocument): OpenDocument | null => {
        const current = editable();
        return current?.session === document.session ? current : null;
    };
    /** Asks before unsaved changes of `document` are lost; true when there are none. */
    const mayDiscard = (document: OpenDocument, action: DiscardAction, file: string | null) =>
        isDirty(document)
            ? dialogs.confirmDiscard({ document: document.session.doc.name, action, file })
            : Promise.resolve(true);

    /** Reads a project; reports what keeps it from opening and returns null then. */
    const read = async (
        name: string,
        bytesOf: () => Promise<Uint8Array>,
        verb: string,
    ): Promise<{ bytes: Uint8Array; contents: ProjectContents } | null> => {
        try {
            const bytes = await bytesOf();
            return { bytes, contents: await deserialize(bytes) };
        } catch (error) {
            notices.error(`Could not ${verb} “${name}”. ${reason(error)}`);
            return null;
        }
    };

    const openChosen = async (chosen: ChosenFile): Promise<boolean> => {
        // The file is read first: a file that cannot be opened asks nothing and changes nothing.
        const project = await read(chosen.name, () => chosen.read(), "open");
        if (!project) return false;
        const active = activeDocument(sessions.getState());
        if (active) {
            if (active.history.transaction) return false;
            if (!(await mayDiscard(active, "open", chosen.name))) return false;
            if (!stillActive(active)) return false;
        }
        const handle = await chosen.handle();
        const { doc, referenceSources } = project.contents;
        try {
            sessions.getState().replaceActive(sessionOf(doc), { referenceSources });
        } catch (error) {
            notices.error(`Could not open “${chosen.name}”. ${reason(error)}`);
            return false;
        }
        setFile(doc.id, { name: chosen.name, handle, bytes: handle ? null : project.bytes });
        notices.info(`Opened ${chosen.name}`);
        return true;
    };

    const saveActive = async (as: boolean): Promise<boolean> => {
        applyFloating();
        const document = editable();
        if (!document) return false;
        const known = files.get(document.id) ?? null;
        const suggested = known?.name ?? projectFileName(document.session.doc.name);
        let handle = as ? null : (known?.handle ?? null);
        try {
            // Permission is settled before the bytes are made: the browser prompts only
            // within the user's gesture. Refused, Save asks where to save, as Save As does.
            if (handle && !(await handle.requestWrite())) handle = null;
            if (!handle && platform.canChooseSaveTarget()) {
                handle = await platform.chooseSaveTarget(suggested);
                if (!handle) return false;
            }
        } catch (error) {
            notices.error(`Could not save “${suggested}”. ${reason(error)}`);
            return false;
        }
        // A picker may have been open for a while; the document is taken as it is now.
        const current = stillActive(document);
        if (!current) return false;
        const name = handle?.name ?? suggested;
        // The state the bytes hold: a change made while they are written keeps the document
        // dirty.
        const state = savedStateOf(current);
        try {
            const bytes = serialize(current.session.doc, current.referenceSources);
            if (handle) await handle.write(bytes);
            else platform.download(name, bytes);
            if (sessions.getState().documents.some((entry) => entry.session === current.session)) {
                sessions.getState().markSaved(current.id, state);
                setFile(current.id, { name, handle, bytes: handle ? null : bytes });
            }
        } catch (error) {
            notices.error(`Could not save “${name}”. ${reason(error)}`);
            return false;
        }
        notices.info(`Saved ${name}`);
        return true;
    };

    return {
        get busy() {
            return busy;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        fileOf: (id) => files.get(id) ?? null,

        open: () =>
            exclusive(async () => {
                if (activeDocument(sessions.getState())?.history.transaction) return false;
                let chosen: ChosenFile | null;
                try {
                    chosen = await platform.chooseFileToOpen();
                } catch (error) {
                    notices.error(`Could not open a file. ${reason(error)}`);
                    return false;
                }
                return chosen ? openChosen(chosen) : false;
            }),

        openFiles: (chosen) =>
            exclusive(async () => {
                const project = chosen.find((file) => isProjectFileName(file.name));
                if (project) return openChosen(project);
                const [first] = chosen;
                if (first) {
                    notices.error(
                        `“${first.name}” is not a sprite project (${PROJECT_FILE_EXTENSION}).`,
                    );
                }
                return false;
            }),

        save: () => exclusive(() => saveActive(false)),
        saveAs: () => exclusive(() => saveActive(true)),

        close: () =>
            exclusive(async () => {
                const document = editable();
                if (!document) return false;
                if (!(await mayDiscard(document, "close", null))) return false;
                if (!stillActive(document)) return false;
                sessions.getState().close(document.id);
                return true;
            }),

        revert: () =>
            exclusive(async () => {
                const document = editable();
                const file = document ? files.get(document.id) : undefined;
                if (!document || !file) return false;
                if (!(await mayDiscard(document, "revert", file.name))) return false;
                const { handle, bytes } = file;
                const project = await read(
                    file.name,
                    async () => (handle ? handle.read() : (bytes ?? new Uint8Array())),
                    "revert to",
                );
                const current = project && stillActive(document);
                if (!project || !current) return false;
                const { doc, referenceSources } = project.contents;
                try {
                    sessions.getState().replaceActive(sessionOf(doc), {
                        referenceSources,
                        view: { ...current.view },
                    });
                } catch (error) {
                    notices.error(`Could not revert to “${file.name}”. ${reason(error)}`);
                    return false;
                }
                setFile(doc.id, { name: file.name, handle, bytes: handle ? null : project.bytes });
                notices.info(`Reverted to ${file.name}`);
                return true;
            }),
    };
}

/** The file workflows of the app. */
export const fileWorkflows = createFileWorkflows();
