import type { StoreApi } from "zustand/vanilla";
import { randomId } from "../../core/model";
import type { DocSession, SpriteDoc } from "../../core/model";
import {
    MAX_PROJECT_CONTENT_BYTES,
    MAX_PROJECT_ENTRIES,
    PROJECT_FILE_EXTENSION,
    deserialize,
    serialize,
} from "../../core/project";
import type { ProjectContents } from "../../core/project";
import { notices as appNotices } from "../notices/notices";
import type { Notices } from "../notices/notices";
import { browserProjectFiles } from "../platform/projectFiles";
import type {
    ChosenFile,
    PermissionAnswer,
    ProjectFileHandle,
    ProjectFilePlatform,
} from "../platform/projectFiles";
import {
    applyFloating as applyAppFloating,
    isFloating as isAppFloating,
} from "../selection/floating";
import { activeDocument, isDirty, savedStateOf, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import { fileDialogs as appFileDialogs } from "./dialogs";
import type { DiscardAction, FileDialogs } from "./dialogs";
import { isProjectFileName, projectFileName } from "./fileName";
import { recentFiles } from "./recentFiles";
import type { RecentEntry, RecentFiles } from "./recentFiles";

// The file workflows of SPEC §10 (SE-041): Open, Save, Save As, Close and Revert of the active
// document, and opening a dropped project file. A document remembers the file it was opened
// from or last saved to; with File System Access that is a handle Save writes to again.
//
// One operation at a time: while one runs (a picker, a question, a write), `busy` is true and
// the others do nothing. Exports run as file operations too (`run`, SE-052), and a successful
// save runs the steps added with `onSaved` (`exportOnSave`) before its operation ends. Results and failures are reported as notices (toasts): one for each
// operation that fails or is given up after it started, none when the user cancels. A failure
// leaves every open document as it was.
//
// A floating selection holds a transaction open (SPEC §5.2), as a stroke does, but unlike a
// stroke it does not keep an operation from running: Save, Save As, Close and Revert apply it
// first, and Open (and a drop) once the file has been read, so the question before unsaved
// changes are lost covers it (SE-032 review).
//
// Tabs (SE-047): Open, a drop and Open Recent add the document as a tab of its own and make
// it the active one; nothing is lost, so they ask nothing. A file whose document is open
// already makes that tab the active one. Close closes the active tab or the one it is given.
// A file opened or saved with File System Access goes first in the recent files.

/**
 * Zip framing and compression overhead allowed per entry on top of the content of a project
 * (local and central headers, names, data descriptors, deflate block headers).
 */
const ZIP_FRAMING_BYTES_PER_ENTRY = 1024;
/** The end-of-central-directory record with the longest comment a zip can hold. */
const MAX_END_RECORD_BYTES = 22 + 0xffff;

/**
 * The largest file Open reads (SPEC §10): the content a project may hold (docs/FORMAT.md
 * §1.8: 2 GiB) plus 1 KiB of zip framing for each of its at most 65 534 entries. A larger file
 * is refused before it is read into memory.
 */
export const MAX_PROJECT_FILE_BYTES =
    MAX_PROJECT_CONTENT_BYTES +
    MAX_PROJECT_ENTRIES * ZIP_FRAMING_BYTES_PER_ENTRY +
    MAX_END_RECORD_BYTES;

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
    /**
     * Applies the floating selection before a save, a close, an open or a revert (SPEC §5.2);
     * throws when it cannot. The default is the app's.
     */
    applyFloating?(): void;
    /** Whether the active document holds a floating selection; the default is the app's. */
    isFloating?(): boolean;
    /** The recent files (SE-047); the default is the app's. */
    recent?: Pick<RecentFiles, "add" | "remove">;
}

export interface FileWorkflows {
    /** True while an operation runs; the others do nothing until it ends. */
    readonly busy: boolean;
    /** Calls `listener` when `busy` or the file of a document changes. */
    subscribe(listener: () => void): () => void;
    /** The file of an open document, or null when it has none (never saved, not opened). */
    fileOf(id: string): DocumentFile | null;
    /**
     * Whether Save and Save As can run now: no operation runs, a document is open, and its
     * history is idle or holds a floating selection, which the save applies first (SPEC §5.2).
     */
    canSave(): boolean;
    /**
     * Whether Open, Close and Revert can act on the active document now: no operation runs,
     * and its history, if one is open, is idle or holds a floating selection, which they apply
     * first. Not during a stroke.
     */
    canAct(): boolean;
    /** Asks for a project file and opens it in a tab of its own, the active one (SE-047). */
    open(): Promise<boolean>;
    /** Opens the first project file among `files` (a drop), as `open` does. */
    openFiles(files: readonly ChosenFile[]): Promise<boolean>;
    /**
     * Opens the file of a recent entry, as `open` does (SE-047). Read permission is asked for
     * once when it is not granted; refused, or the file gone, the entry is taken off the list.
     */
    openRecent(entry: RecentEntry): Promise<boolean>;
    /** Saves the active document to its file, or asks where when it has none. */
    save(): Promise<boolean>;
    /** Saves the active document to a file chosen now, which becomes its file. */
    saveAs(): Promise<boolean>;
    /**
     * Closes the open document `id` (by default the active one), asking first when it has
     * unsaved changes. Not during a stroke of the active document.
     */
    close(id?: string): Promise<boolean>;
    /** Reads the active document's file again in its place, asking first when it is dirty. */
    revert(): Promise<boolean>;
    /**
     * Runs `task` as a file operation of its own (an export, SE-052): not while another one
     * runs (it resolves false then), and with `busy` true meanwhile.
     */
    run(task: () => Promise<boolean>): Promise<boolean>;
    /**
     * Adds a step that runs after every successful save, inside the save's operation, with the
     * document as the store holds it once saved: `exportOnSave` (SE-052). The save has
     * succeeded whatever the step does; it reports its own failures (one that throws is
     * reported by an error toast). Returns the function that removes it.
     */
    onSaved(step: (document: OpenDocument) => Promise<void>): () => void;
}

/** What went wrong, for a message: an error's own message (ProjectError names the entry). */
function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/** The file a handle names is gone: moved or deleted since it was chosen. */
function isNotFound(error: unknown): boolean {
    return error instanceof DOMException && error.name === "NotFoundError";
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
    // The app's hooks are looked up when they are called, not when the workflows are made: a
    // test that replaces the floating module with one of its own keeps working.
    const applyFloating = options.applyFloating ?? (() => applyAppFloating());
    const isFloating = options.isFloating ?? (() => isAppFloating());
    const recent = options.recent ?? recentFiles;
    /** Lists a file in the recent files; a failure there never fails the operation. */
    const remember = (handle: ProjectFileHandle | null) => {
        if (handle) void recent.add(handle).catch(() => {});
    };

    const files = new Map<string, DocumentFile>();
    const listeners = new Set<() => void>();
    const savedSteps = new Set<(document: OpenDocument) => Promise<void>>();
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
    /** Why `stillActive(document)` is null: for the message of an operation given up. */
    const interruption = (document: OpenDocument): string => {
        const state = sessions.getState();
        const active = activeDocument(state);
        if (active?.session === document.session) return "A stroke is in progress.";
        const open = state.documents.some((entry) => entry.session === document.session);
        return open
            ? "Another document became the active one meanwhile."
            : "The document was closed meanwhile.";
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

    /** The open document whose file is the file of `handle` (`isSameEntry`), or null. */
    const documentWithFile = async (handle: ProjectFileHandle): Promise<OpenDocument | null> => {
        for (const document of sessions.getState().documents) {
            const kept = files.get(document.id)?.handle ?? null;
            if (kept && (kept === handle || ((await kept.isSame?.(handle)) ?? false))) {
                return document;
            }
        }
        return null;
    };

    const openChosen = async (chosen: ChosenFile): Promise<boolean> => {
        const failed = (why: string) => {
            notices.error(`Could not open “${chosen.name}”. ${why}`);
            return false;
        };
        // A file no project can be is not read into memory at all.
        if (chosen.size > MAX_PROJECT_FILE_BYTES) {
            return failed(
                `The file is too large to be a sprite project: ${chosen.size} bytes; the ` +
                    `limit is ${MAX_PROJECT_FILE_BYTES} bytes.`,
            );
        }
        // The file is read first: a file that cannot be opened changes nothing.
        const project = await read(chosen.name, () => chosen.read(), "open");
        if (!project) return false;
        const handle = await chosen.handle();
        const { doc, referenceSources } = project.contents;
        // The same file opened again, whatever its document's id: that tab becomes the
        // active one.
        const same = handle ? await documentWithFile(handle) : null;
        const active = activeDocument(sessions.getState());
        const openAlready = () => {
            remember(handle);
            notices.info(`${chosen.name} is open already`);
            return true;
        };
        // The active tab's own file: nothing changes, its floating selection stays.
        if (same && same.session === active?.session) return openAlready();
        // The active document stops being the active one: its floating selection is applied
        // (SPEC §5.2), and nothing happens during its stroke. Nothing of it is lost, so
        // nothing is asked (SE-047).
        if (active) {
            try {
                applyFloating();
            } catch (error) {
                return failed(reason(error));
            }
            if (active.history.transaction) return failed(interruption(active));
        }
        const state = sessions.getState();
        if (same) {
            const found = state.documents.find((entry) => entry.session === same.session);
            if (!found) return failed("The document was closed meanwhile.");
            state.activate(found.id);
            return openAlready();
        }
        // Another file holding a document of an open id (a copy made without Save As, or one
        // opened without a handle): a document of its own, under a new id.
        if (state.documents.some((entry) => entry.id === doc.id)) doc.id = randomId();
        try {
            state.open(sessionOf(doc), { referenceSources });
        } catch (error) {
            return failed(reason(error));
        }
        setFile(doc.id, { name: chosen.name, handle, bytes: handle ? null : project.bytes });
        remember(handle);
        notices.info(`Opened ${chosen.name}`);
        return true;
    };

    const saveActive = async (as: boolean): Promise<boolean> => {
        const opened = activeDocument(sessions.getState());
        if (!opened) return false;
        const known = files.get(opened.id) ?? null;
        const suggested = known?.name ?? projectFileName(opened.session.doc.name);
        const failed = (name: string, why: string) => {
            notices.error(`Could not save “${name}”. ${why}`);
            return false;
        };
        try {
            applyFloating();
        } catch (error) {
            return failed(suggested, reason(error));
        }
        // A stroke, or a floating selection that applying did not end.
        const document = stillActive(opened);
        if (!document) return failed(suggested, interruption(opened));

        let target = as ? null : (known?.handle ?? null);
        try {
            // Permission is settled before the bytes are made: the browser prompts only
            // within the user's gesture. Refused, Save asks where to save, as Save As does,
            // while the gesture lasts; the picker needs it too.
            if (target && !(await target.requestWrite())) {
                if (!platform.hasUserActivation()) {
                    notices.error(`No permission to write “${target.name}”. Use Save As…`);
                    return false;
                }
                target = null;
            }
            if (!target && platform.canChooseSaveTarget()) {
                target = await platform.chooseSaveTarget(suggested);
                if (!target) return false;
            }
        } catch (error) {
            return failed(target?.name ?? suggested, reason(error));
        }
        // Save As to another file than the document's: the document becomes that file's,
        // under a new id written into it, so the copy shares nothing kept by id (its export
        // folder, SE-052) with the file it came from (SE-047 review).
        // Without File System Access Save As downloads as Save does, and the id stays.
        let nextId: string | null = null;
        if (as && known && target) {
            const own = known.handle;
            const sameFile =
                own !== null && (target === own || ((await own.isSame?.(target)) ?? false));
            if (!sameFile) nextId = randomId();
        }
        // A picker or a prompt may have been open for a while: the document is taken as it is
        // now, if it is still the active one and no stroke has begun.
        const current = stillActive(document);
        if (!current) return failed(target?.name ?? suggested, interruption(document));
        // The state the bytes hold: a change made while they are written keeps the document
        // dirty.
        const state = savedStateOf(current);
        let bytes: Uint8Array<ArrayBuffer>;
        try {
            const { doc } = current.session;
            bytes = serialize(nextId ? { ...doc, id: nextId } : doc, current.referenceSources);
        } catch (error) {
            return failed(target?.name ?? suggested, reason(error));
        }
        try {
            if (target) await target.write(bytes);
            else platform.download(suggested, bytes);
        } catch (error) {
            const kept = target !== null && target === known?.handle;
            if (!target || !kept || !isNotFound(error)) {
                return failed(target?.name ?? suggested, reason(error));
            }
            // The document's file was moved or deleted: ask where to save while the gesture
            // lasts, as Save As does.
            if (!platform.hasUserActivation()) {
                return failed(target.name, "The file no longer exists. Use Save As…");
            }
            try {
                target = await platform.chooseSaveTarget(suggested);
                if (!target) return false;
                await target.write(bytes);
            } catch (retry) {
                return failed(target?.name ?? suggested, reason(retry));
            }
        }
        const name = target?.name ?? suggested;
        const stillOpen = () =>
            sessions.getState().documents.find((entry) => entry.session === current.session);
        const written = stillOpen();
        if (written) {
            if (nextId) sessions.getState().changeId(written.id, nextId);
            const id = nextId ?? written.id;
            sessions.getState().markSaved(id, state);
            setFile(id, { name, handle: target, bytes: target ? null : bytes });
        }
        remember(target);
        notices.info(`Saved ${name}`);
        // What follows a save (`exportOnSave`) reports its own failures: the save stands.
        const saved = stillOpen();
        if (saved) {
            for (const step of [...savedSteps]) {
                try {
                    await step(saved);
                } catch (error) {
                    notices.error(reason(error));
                }
            }
        }
        return true;
    };

    /**
     * Closes a document that is not the active one (a tab's close, SE-047), asking first when
     * it has unsaved changes. Nothing closes during a stroke of the active document; a float
     * there stays as it is.
     */
    const closeBackground = async (opened: OpenDocument): Promise<boolean> => {
        const name = opened.session.doc.name;
        const inStroke = () => {
            const active = activeDocument(sessions.getState());
            return active?.history.transaction ? !isFloating() : false;
        };
        if (inStroke()) return false;
        if (!(await mayDiscard(opened, "close", null))) return false;
        const state = sessions.getState();
        const why = !state.documents.some((entry) => entry.session === opened.session)
            ? "The document was closed meanwhile."
            : inStroke()
              ? "A stroke is in progress."
              : null;
        if (why) {
            notices.error(`Could not close “${name}”. ${why}`);
            return false;
        }
        state.close(opened.id);
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
        canSave() {
            const document = activeDocument(sessions.getState());
            return !busy && document !== null && (!document.history.transaction || isFloating());
        },
        canAct() {
            const document = activeDocument(sessions.getState());
            return !busy && (!document?.history.transaction || isFloating());
        },

        open: () =>
            exclusive(async () => {
                const active = activeDocument(sessions.getState());
                // A floating selection is applied once the file has been read (`openChosen`).
                if (active?.history.transaction && !isFloating()) {
                    notices.error(`Could not open a file. ${interruption(active)}`);
                    return false;
                }
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

        run: (task) => exclusive(task),
        onSaved(step) {
            const own = (document: OpenDocument) => step(document);
            savedSteps.add(own);
            return () => {
                savedSteps.delete(own);
            };
        },

        save: () => exclusive(() => saveActive(false)),
        saveAs: () => exclusive(() => saveActive(true)),

        close: (id) =>
            exclusive(async () => {
                const state = sessions.getState();
                const active = activeDocument(state);
                const opened = id === undefined ? active : state.documents.find((d) => d.id === id);
                if (!opened) return false;
                if (opened !== active) return closeBackground(opened);
                try {
                    applyFloating();
                } catch (error) {
                    notices.error(`Could not close “${opened.session.doc.name}”. ${reason(error)}`);
                    return false;
                }
                const document = editable();
                if (!document) return false;
                if (!(await mayDiscard(document, "close", null))) return false;
                if (!stillActive(document)) {
                    const name = document.session.doc.name;
                    notices.error(`Could not close “${name}”. ${interruption(document)}`);
                    return false;
                }
                sessions.getState().close(document.id);
                return true;
            }),

        openRecent: (entry) =>
            exclusive(async () => {
                const { handle } = entry;
                const failed = (why: string) => {
                    notices.error(`Could not open “${entry.name}”. ${why}`);
                    return false;
                };
                // The list changes in the background: storage never holds up the operation.
                const forget = (why: string) => {
                    void recent.remove(entry.key).catch(() => {});
                    return failed(`${why} It was removed from the recent files.`);
                };
                const active = activeDocument(sessions.getState());
                // A floating selection is applied once the file has been read (`openChosen`).
                if (active?.history.transaction && !isFloating()) {
                    return failed(interruption(active));
                }
                // Asked once, within the gesture of the command. Refused ("denied"), the entry
                // goes; a prompt dismissed without an answer keeps it.
                let permission: PermissionAnswer;
                try {
                    permission = handle.requestReadPermission
                        ? await handle.requestReadPermission()
                        : (await handle.requestRead())
                          ? "granted"
                          : "denied";
                } catch (error) {
                    return failed(reason(error));
                }
                if (permission === "denied") return forget("No permission to read the file.");
                if (permission !== "granted") {
                    return failed(
                        "Read permission was not given. The file stays in the recent files.",
                    );
                }
                let size: number;
                try {
                    size = (await handle.size?.()) ?? 0;
                } catch (error) {
                    return isNotFound(error)
                        ? forget("The file no longer exists.")
                        : failed(reason(error));
                }
                return openChosen({
                    name: entry.name,
                    size,
                    read: () => handle.read(),
                    handle: async () => handle,
                });
            }),

        revert: () =>
            exclusive(async () => {
                const opened = activeDocument(sessions.getState());
                const file = opened ? files.get(opened.id) : undefined;
                if (!opened || !file) return false;
                const failed = (why: string) => {
                    notices.error(`Could not revert to “${file.name}”. ${why}`);
                    return false;
                };
                try {
                    applyFloating();
                } catch (error) {
                    return failed(reason(error));
                }
                const document = editable();
                if (!document) return false;
                if (!(await mayDiscard(document, "revert", file.name))) return false;
                const { handle, bytes } = file;
                // Read permission can lapse: asked again, within the gesture of the command or
                // of the question's Discard.
                try {
                    if (handle && !(await handle.requestRead())) {
                        notices.error(`No permission to read “${file.name}”.`);
                        return false;
                    }
                } catch (error) {
                    return failed(reason(error));
                }
                const project = await read(
                    file.name,
                    async () => (handle ? handle.read() : (bytes ?? new Uint8Array())),
                    "revert to",
                );
                if (!project) return false;
                const current = stillActive(document);
                if (!current) return failed(interruption(document));
                const { doc, referenceSources } = project.contents;
                // The tab keeps its id, whatever the file holds (a file opened under a new id
                // beside its original, SE-047 review).
                doc.id = current.id;
                try {
                    sessions.getState().replaceActive(sessionOf(doc), {
                        referenceSources,
                        view: { ...current.view },
                    });
                } catch (error) {
                    return failed(reason(error));
                }
                setFile(doc.id, { name: file.name, handle, bytes: handle ? null : project.bytes });
                notices.info(`Reverted to ${file.name}`);
                return true;
            }),
    };
}

/** The file workflows of the app. */
export const fileWorkflows = createFileWorkflows();
