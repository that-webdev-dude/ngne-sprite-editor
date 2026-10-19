import type { StoreApi } from "zustand/vanilla";
import { keyContextStore } from "../keymap/contextState";
import type { KeyContextState } from "../keymap/contextState";
import { OVERLAY_SELECTOR } from "../keymap/environment";
import { importDropped, isImageDrop } from "../import/importWorkflow";
import { carriesFiles, droppedFiles } from "../platform/projectFiles";
import type { ChosenFile } from "../platform/projectFiles";
import { isDirty, sessionsStore } from "../state/sessions";
import type { SessionsState } from "../state/sessions";
import { isProjectFileName } from "./fileName";
import { fileWorkflows } from "./workflows";
import type { FileWorkflows } from "./workflows";

/** The part of `window` the file workflows listen on; tests pass an `EventTarget`. */
export interface FileEventTarget {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface FileWorkflowInstall {
    /** Where the page's events arrive; the default is `window`. */
    target?: FileEventTarget;
    /** The store of open documents; the default is the app's. */
    sessions?: StoreApi<SessionsState>;
    /**
     * Whether a selection floats (the keymap's `floating` context, SE-032); the default is
     * the app's.
     */
    contexts?: Pick<StoreApi<KeyContextState>, "getState" | "subscribe">;
    /** What a dropped file is handed to; the default is the app's workflows. */
    workflows?: Pick<FileWorkflows, "busy" | "openFiles">;
    /** Whether a menu, dialog or popover is open; the default reads the page. */
    overlayOpen?(): boolean;
    /**
     * What a drop of image files without a project file is handed to, with the drop point
     * (SE-044); the default is the app's Import PNG.
     */
    importImages?(files: readonly ChosenFile[], point: { x: number; y: number }): void;
}

/** The part of a drag event the drop reads. */
interface DragLike extends Event {
    dataTransfer: DataTransfer | null;
}

/**
 * The page-wide parts of the file workflows (SPEC §10):
 *
 * - While any open document is dirty, or a selection floats (its pixels are not in the
 *   document's history yet), a `beforeunload` listener asks the browser to confirm before the
 *   page is left (closing the tab, reloading). Without either, no listener is there.
 * - A drop of files on the window opens the first project file among them (`openFiles`);
 *   without one, PNG files among them go to Import PNG (SE-044).
 *   Every file drag has its default prevented, so a dropped file never replaces the app; a
 *   drop while a menu or dialog is open, or while a file operation runs, does nothing.
 *
 * Returns the function that removes the listeners.
 */
export function installFileWorkflows(install: FileWorkflowInstall = {}): () => void {
    const target: FileEventTarget = install.target ?? window;
    const sessions = install.sessions ?? sessionsStore;
    const contexts = install.contexts ?? keyContextStore;
    const workflows = install.workflows ?? fileWorkflows;
    const overlayOpen =
        install.overlayOpen ?? (() => document.querySelector(OVERLAY_SELECTOR) !== null);
    const importImages =
        install.importImages ?? ((files, point) => void importDropped(files, point));

    const onBeforeUnload = (event: Event) => {
        event.preventDefault();
        // Chrome before 119 asks only when `returnValue` is set.
        (event as Event & { returnValue: unknown }).returnValue = true;
    };
    let guarded = false;
    const guard = () => {
        const unsaved = sessions.getState().documents.some(isDirty) || contexts.getState().floating;
        if (unsaved === guarded) return;
        guarded = unsaved;
        if (unsaved) target.addEventListener("beforeunload", onBeforeUnload);
        else target.removeEventListener("beforeunload", onBeforeUnload);
    };
    guard();
    const stopSessions = sessions.subscribe(guard);
    const stopContexts = contexts.subscribe(guard);

    const accepts = () => !overlayOpen() && !workflows.busy;
    const onDragOver = (event: Event) => {
        const { dataTransfer } = event as DragLike;
        if (!carriesFiles(dataTransfer) || !dataTransfer) return;
        event.preventDefault();
        dataTransfer.dropEffect = accepts() ? "copy" : "none";
    };
    const onDrop = (event: Event) => {
        const { dataTransfer } = event as DragLike;
        if (!carriesFiles(dataTransfer) || !dataTransfer) return;
        event.preventDefault();
        if (!accepts()) return;
        const files = droppedFiles(dataTransfer);
        const names = files.map((file) => file.name);
        if (!names.some(isProjectFileName) && isImageDrop(names)) {
            const { clientX: x, clientY: y } = event as DragEvent;
            importImages(files, { x: x ?? 0, y: y ?? 0 });
            return;
        }
        void workflows.openFiles(files);
    };
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("drop", onDrop);

    return () => {
        stopSessions();
        stopContexts();
        if (guarded) target.removeEventListener("beforeunload", onBeforeUnload);
        guarded = false;
        target.removeEventListener("dragover", onDragOver);
        target.removeEventListener("drop", onDrop);
    };
}
