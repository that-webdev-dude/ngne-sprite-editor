import type { StoreApi } from "zustand/vanilla";
import { OVERLAY_SELECTOR } from "../keymap/environment";
import { carriesFiles, droppedFiles } from "../platform/projectFiles";
import { isDirty, sessionsStore } from "../state/sessions";
import type { SessionsState } from "../state/sessions";
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
    /** What a dropped file is handed to; the default is the app's workflows. */
    workflows?: Pick<FileWorkflows, "busy" | "openFiles">;
    /** Whether a menu, dialog or popover is open; the default reads the page. */
    overlayOpen?(): boolean;
}

/** The part of a drag event the drop reads. */
interface DragLike extends Event {
    dataTransfer: DataTransfer | null;
}

/**
 * The page-wide parts of the file workflows (SPEC §10):
 *
 * - While any open document is dirty, a `beforeunload` listener asks the browser to confirm
 *   before the page is left (closing the tab, reloading). Without one, no listener is there.
 * - A drop of files on the window opens the first project file among them (`openFiles`).
 *   Every file drag has its default prevented, so a dropped file never replaces the app; a
 *   drop while a menu or dialog is open, or while a file operation runs, does nothing.
 *
 * Returns the function that removes the listeners.
 */
export function installFileWorkflows(install: FileWorkflowInstall = {}): () => void {
    const target: FileEventTarget = install.target ?? window;
    const sessions = install.sessions ?? sessionsStore;
    const workflows = install.workflows ?? fileWorkflows;
    const overlayOpen =
        install.overlayOpen ?? (() => document.querySelector(OVERLAY_SELECTOR) !== null);

    const onBeforeUnload = (event: Event) => {
        event.preventDefault();
        // Chrome before 119 asks only when `returnValue` is set.
        (event as Event & { returnValue: unknown }).returnValue = true;
    };
    let guarded = false;
    const guard = ({ documents }: SessionsState) => {
        const dirty = documents.some(isDirty);
        if (dirty === guarded) return;
        guarded = dirty;
        if (dirty) target.addEventListener("beforeunload", onBeforeUnload);
        else target.removeEventListener("beforeunload", onBeforeUnload);
    };
    guard(sessions.getState());
    const stopGuard = sessions.subscribe(guard);

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
        void workflows.openFiles(droppedFiles(dataTransfer));
    };
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("drop", onDrop);

    return () => {
        stopGuard();
        if (guarded) target.removeEventListener("beforeunload", onBeforeUnload);
        guarded = false;
        target.removeEventListener("dragover", onDragOver);
        target.removeEventListener("drop", onDrop);
    };
}
