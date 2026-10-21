import { fileWorkflows } from "../file/workflows";
import { projectFileHandleFrom } from "../platform/projectFiles";
import type { ChosenFile } from "../platform/projectFiles";

// SE-072: files the installed app is launched with (the manifest's `file_handlers`: a
// `.ngsprite` opened from the desktop, or "Open with"). The browser hands them to the page
// through `window.launchQueue`, once per launch, as File System Access handles; they are opened
// the way Open opens a file chosen in its picker (`openFiles`, SPEC §10): in a tab of their own,
// with the handle kept so Save writes back to that file.
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

/** What the launched files are handed to; the default is the app's file workflows. */
export type OpenLaunched = (files: readonly ChosenFile[]) => Promise<unknown>;

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

export interface LaunchQueueInstall {
    /** The page's launch queue; the default is `window.launchQueue`, absent outside Chrome. */
    queue?: LaunchQueueLike | null;
    open?: OpenLaunched;
}

let consumerSet: LaunchQueueLike | null = null;
let handler: ((params: LaunchParamsLike) => void) | null = null;
const pending: LaunchParamsLike[] = [];

async function openParams(params: LaunchParamsLike, open: OpenLaunched): Promise<void> {
    const files = (
        await Promise.all((params.files ?? []).map((file) => launchedFile(file).catch(() => null)))
    ).filter((file): file is ChosenFile => file !== null);
    if (files.length > 0) await open(files);
}

/**
 * Opens the files of every launch of the page, from now on, until the returned function is
 * called. A launch with several files opens the first project file among them, as a drop does.
 */
export function installLaunchQueue(install: LaunchQueueInstall = {}): () => void {
    const queue =
        install.queue !== undefined
            ? install.queue
            : ((window as Window & { launchQueue?: LaunchQueueLike }).launchQueue ?? null);
    const open = install.open ?? ((files) => fileWorkflows.openFiles(files));
    const own = (params: LaunchParamsLike) => void openParams(params, open);
    handler = own;
    if (queue && consumerSet !== queue) {
        consumerSet = queue;
        queue.setConsumer((params) => {
            if (handler) handler(params);
            else pending.push(params);
        });
    }
    for (const params of pending.splice(0)) own(params);
    return () => {
        if (handler === own) handler = null;
    };
}
