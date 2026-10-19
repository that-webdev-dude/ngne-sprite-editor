import { vi } from "vitest";
import { createExportDialogs } from "../../src/app/export/dialogs";
import type {
    ExportDialogRequest,
    ExportDialogRequestKind,
    ExportDialogs,
    ExportOverwriteRequest,
    FramePngRequest,
} from "../../src/app/export/dialogs";
import type { ExportFolderStorage, StoredExportFolder } from "../../src/app/export/exportFolders";
import { createExportWorkflows } from "../../src/app/export/exportWorkflows";
import type { ExportWorkflows } from "../../src/app/export/exportWorkflows";
import type {
    ExportFileHandle,
    ExportFolderHandle,
    ExportPlatform,
} from "../../src/app/platform/exportFiles";
import { harness as fileHarness } from "./se-041-support";
import type { Harness as FileHarness, HarnessOptions } from "./se-041-support";

// Shared by the SE-052 unit tests: the export workflows over the SE-041 harness (a store of
// their own and the file workflows over a disk in memory), folders in memory behind fake
// File System Access handles, a storage in memory, and the export dialogs answered by the
// test as the dialog host.

/** A folder in memory, which counts what is asked of it. */
export interface FakeFolder extends ExportFolderHandle {
    readonly files: Map<string, Uint8Array>;
    /** Whether write permission is granted now (without a prompt). */
    granted: boolean;
    /** Whether the user grants it when asked. */
    grants: boolean;
    /** How often write permission was asked for (a prompt). */
    requests: number;
    /** Every file written, in order. */
    readonly writes: string[];
    /** When set, every write fails with it. */
    failWrite: Error | null;
    /** When set, the write of this file fails with `failWrite` (the others succeed). */
    failOn: string | null;
    /** False once the folder was removed from the disk. */
    present: boolean;
    /** Runs inside `canWrite`, before it answers: what the user does meanwhile. */
    duringCanWrite: (() => void) | null;
    /** Runs inside each `write`, before it completes. */
    duringWrite: (() => void) | null;
}

export function fakeFolder(name: string, files: Record<string, Uint8Array> = {}): FakeFolder {
    const folder: FakeFolder = {
        name,
        stored: null,
        files: new Map(Object.entries(files)),
        granted: true,
        grants: true,
        requests: 0,
        writes: [],
        failWrite: null,
        failOn: null,
        present: true,
        duringCanWrite: null,
        duringWrite: null,
        async canWrite() {
            folder.duringCanWrite?.();
            return folder.granted;
        },
        async requestWrite() {
            folder.requests++;
            folder.granted = folder.grants;
            return folder.granted;
        },
        existing: async (names) => names.filter((entry) => folder.files.has(entry)),
        async write(file, bytes) {
            folder.duringWrite?.();
            if (!folder.present) throw new DOMException("No folder.", "NotFoundError");
            if (folder.failWrite && (folder.failOn === null || folder.failOn === file)) {
                throw folder.failWrite;
            }
            folder.files.set(file, bytes.slice());
            folder.writes.push(file);
        },
        isSame: async (other) => other.stored === folder.stored,
        exists: async () => folder.present,
    };
    // What storage keeps: the folder itself, as a native handle would be kept.
    (folder as { stored: unknown }).stored = folder;
    return folder;
}

export interface FakeExportPlatform extends ExportPlatform {
    /** Whether File System Access is there; false: everything downloads. */
    access: boolean;
    /** Whether the user's gesture is still active (a permission prompt needs it). */
    active: boolean;
    /** What the folder picker returns, first to last; null is a cancel. */
    readonly toChoose: (FakeFolder | null)[];
    /** How often the folder picker was shown. */
    folderPickers: number;
    /** What the save picker returns, first to last; null is a cancel. */
    readonly toSave: (string | null)[];
    /** The names the save picker suggested. */
    readonly suggested: string[];
    /** Files saved through the save picker. */
    readonly saved: { name: string; bytes: Uint8Array }[];
    /** Each download, with the `kind` of its file type. */
    readonly downloads: { name: string; bytes: Uint8Array; kind: string }[];
}

export function fakeExportPlatform(): FakeExportPlatform {
    const platform: FakeExportPlatform = {
        access: true,
        active: true,
        toChoose: [],
        folderPickers: 0,
        toSave: [],
        suggested: [],
        saved: [],
        downloads: [],
        canChooseFolder: () => platform.access,
        async chooseFolder() {
            platform.folderPickers++;
            return platform.toChoose.shift() ?? null;
        },
        folderFrom: (stored) => (stored as FakeFolder | null) ?? null,
        canChooseFile: () => platform.access,
        async chooseFile(name) {
            platform.suggested.push(name);
            const chosen = platform.toSave.shift() ?? null;
            if (chosen === null) return null;
            const handle: ExportFileHandle = {
                name: chosen,
                async write(bytes) {
                    platform.saved.push({ name: chosen, bytes: bytes.slice() });
                },
            };
            return handle;
        },
        download(name, bytes, type) {
            platform.downloads.push({ name, bytes: bytes.slice(), kind: type.kind });
        },
        hasUserActivation: () => platform.active,
    };
    return platform;
}

/** IndexedDB in memory: what a reload finds. */
export class MemoryStorage implements ExportFolderStorage {
    readonly records = new Map<string, StoredExportFolder>();
    async load(id: string) {
        return this.records.get(id) ?? null;
    }
    async save(id: string, record: StoredExportFolder) {
        this.records.set(id, { ...record });
    }
}

export interface ExportHarness extends FileHarness {
    exportPlatform: FakeExportPlatform;
    storage: MemoryStorage;
    exportDialogs: ExportDialogs;
    /** Every export dialog shown, in order. */
    shown: ExportDialogRequestKind[];
    exports: ExportWorkflows;
}

/** The SE-041 harness with export workflows over it; `storage` stands for IndexedDB. */
export function exportHarness(
    options: HarnessOptions & { storage?: MemoryStorage } = {},
): ExportHarness {
    const test = fileHarness(options) as ExportHarness;
    test.exportPlatform = fakeExportPlatform();
    test.storage = options.storage ?? new MemoryStorage();
    test.exportDialogs = createExportDialogs();
    test.exportDialogs.attachHost();
    test.shown = [];
    test.exportDialogs.store.subscribe(({ request }) => {
        if (request) test.shown.push(request);
    });
    test.exports = createExportWorkflows({
        sessions: test.sessions,
        platform: test.exportPlatform,
        storage: test.storage,
        dialogs: test.exportDialogs,
        notices: {
            info: (message) => void test.notices.push({ kind: "info", message }),
            error: (message) => void test.notices.push({ kind: "error", message }),
        },
        files: test.workflows,
        applyFloating: () => {
            test.floatingApplied++;
            test.events.push("apply floating");
            options.applyFloating?.(test);
        },
    });
    test.workflows.onSaved((document) => test.exports.exportOnSave(document));
    return test;
}

/** Waits until an export dialog of `kind` is open; returns its request, unanswered. */
export function waitForDialog<Kind extends ExportDialogRequestKind["kind"]>(
    test: ExportHarness,
    kind: Kind,
): Promise<Extract<ExportDialogRequestKind, { kind: Kind }>> {
    return vi.waitFor(() => {
        const open = test.exportDialogs.store.getState().request;
        if (open?.kind !== kind) throw new Error(`no ${kind} dialog yet`);
        return open as Extract<ExportDialogRequestKind, { kind: Kind }>;
    });
}

export type { ExportDialogRequest, ExportOverwriteRequest, FramePngRequest };

/** The info notices. */
export function infos(test: ExportHarness): string[] {
    return test.notices.filter((notice) => notice.kind === "info").map((notice) => notice.message);
}
