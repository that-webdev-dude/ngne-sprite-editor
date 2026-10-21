import { fileWorkflows } from "../file/workflows";
import { notices as appNotices } from "../notices/notices";
import { projectFileHandleFrom } from "../platform/projectFiles";
import type { ChosenFile } from "../platform/projectFiles";
import { sessionsStore } from "../state/sessions";

// SE-072: files the installed app is launched with (the manifest's `file_handlers`: a
// `.ngsprite` opened from the desktop, or "Open with"). The browser hands them to the page
// through `window.launchQueue`, once per launch, as File System Access handles; they are opened
// the way Open opens a file chosen in its picker (`openFiles`, SPEC §10): in a tab of their own,
// with the handle kept so Save writes back to that file.
//
// Every launched file is queued and the files are opened one after another, each once the file
// workflows are idle (no other operation runs, no stroke: `canAct`): a launch that comes while
// another launched file opens, a picker is open or an export runs waits for its turn instead of
// being dropped. Every project file of a launch opens, each in a tab; a file that cannot be read
// (moved or deleted since the launch) is reported by an error toast, as Open reports it.
//
// The browser keeps the launches until the page sets its consumer, and the consumer can be set
// once per page that matters; the app's install comes and goes with the component that runs
// it, so launches that come while none is installed wait here for the next one.

/** The parts of a launch the app reads (`LaunchParams`). */
export interface LaunchParamsLike {
    readonly files?: readonly unknown[];
}

/** The parts of `window.launchQueue` used here. */
export interface LaunchQueueLike {
    setConsumer(consumer: (params: LaunchParamsLike) => void): void;
}

/** What a launched file is opened by; the default is the app's file workflows and notices. */
export interface LaunchTarget {
    /** Whether a file can be opened now: no operation runs, no stroke (`FileWorkflows`). */
    canAct(): boolean;
    /** Calls `listener` when `canAct` may have changed; returns the function that stops it. */
    subscribe(listener: () => void): () => void;
    /** Opens one launched file (it reports its own failures); resolves when it is done. */
    openFiles(files: readonly ChosenFile[]): Promise<unknown>;
    /** Reports a launched file that cannot be read. */
    error(message: string): void;
}

/** A launched file handle as a file chosen to open; null for anything but a file handle. */
export async function launchedFile(handle: unknown): Promise<ChosenFile | null> {
    const wrapped = projectFileHandleFrom(handle);
    if (!wrapped) return null;
    // A wrapped native handle always has `size`.
    const size = (await wrapped.size?.()) ?? (await wrapped.read()).length;
    return {
        name: wrapped.name,
        size,
        read: () => wrapped.read(),
        handle: () => Promise.resolve(wrapped),
    };
}

/** The message for a launched file that cannot be read, in the words Open uses. */
export function unreadableMessage(handle: unknown, error: unknown): string {
    const name = projectFileHandleFrom(handle)?.name ?? "a launched file";
    const why = error instanceof Error && error.message !== "" ? error.message : String(error);
    return `Could not open “${name}”. ${why}`;
}

/** The app's file workflows, idle when they can act (their changes and the documents'). */
const appTarget: LaunchTarget = {
    canAct: () => fileWorkflows.canAct(),
    subscribe(listener) {
        const stopWorkflows = fileWorkflows.subscribe(listener);
        const stopSessions = sessionsStore.subscribe(listener);
        return () => {
            stopWorkflows();
            stopSessions();
        };
    },
    openFiles: (files) => fileWorkflows.openFiles(files),
    error: (message) => appNotices.error(message),
};

export interface LaunchQueueInstall {
    /** The page's launch queue; the default is `window.launchQueue`, absent outside Chrome. */
    queue?: LaunchQueueLike | null;
    target?: LaunchTarget;
}

let consumerSet: LaunchQueueLike | null = null;
/** The install that opens files now; null while none is installed. */
let current: LaunchTarget | null = null;
/** Launched file handles not opened yet, in the order they came. */
const pending: unknown[] = [];
let draining = false;

/** Resolves once `target` can act (at once when it can). */
function idle(target: LaunchTarget): Promise<void> {
    if (target.canAct()) return Promise.resolve();
    return new Promise((resolve) => {
        const stop = target.subscribe(() => {
            if (!target.canAct()) return;
            stop();
            resolve();
        });
    });
}

/** Opens the pending files one after another while an install is there. */
async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
        while (current && pending.length > 0) {
            const handle = pending.shift();
            const target = current;
            let file: ChosenFile | null;
            try {
                file = await launchedFile(handle);
            } catch (error) {
                target.error(unreadableMessage(handle, error));
                continue;
            }
            // A directory or anything but a file: the browser launches with files only.
            if (!file) continue;
            // Checked again right before the call: `openFiles` marks the workflows busy at
            // once, so nothing can start in between.
            while (!target.canAct()) await idle(target);
            await target.openFiles([file]).catch((error: unknown) => {
                target.error(unreadableMessage(handle, error));
            });
        }
    } finally {
        draining = false;
    }
}

/**
 * Opens the files of every launch of the page, from now on, until the returned function is
 * called: each in a tab of its own, one after another.
 */
export function installLaunchQueue(install: LaunchQueueInstall = {}): () => void {
    const queue =
        install.queue !== undefined
            ? install.queue
            : ((window as Window & { launchQueue?: LaunchQueueLike }).launchQueue ?? null);
    const target = install.target ?? appTarget;
    current = target;
    if (queue && consumerSet !== queue) {
        consumerSet = queue;
        queue.setConsumer((params) => {
            pending.push(...(params.files ?? []));
            void drain();
        });
    }
    void drain();
    return () => {
        if (current === target) current = null;
    };
}
