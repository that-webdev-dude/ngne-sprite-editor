import { vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { createFileDialogs } from "../../src/app/file/dialogs";
import type { DiscardChangesRequest, FileDialogs } from "../../src/app/file/dialogs";
import { createFileWorkflows } from "../../src/app/file/workflows";
import type { FileWorkflows } from "../../src/app/file/workflows";
import type {
    ChosenFile,
    ProjectFileHandle,
    ProjectFilePlatform,
} from "../../src/app/platform/projectFiles";
import { activeDocument, createSessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument, SessionsState } from "../../src/app/state/sessions";
import { compositeFrame } from "../../src/core/composite";
import { createDocument } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";

// Shared by the SE-041 tests: the file workflows over a store of their own, a disk in memory
// behind fake File System Access handles, a platform whose pickers the test answers, and the
// discard question answered by the test as the dialog host.

/** A file handle over `disk`, which counts what is asked of it. */
export interface FakeHandle extends ProjectFileHandle {
    /** Whether the user grants writing when asked. */
    grants: boolean;
    /** Every content written, in order. */
    readonly writes: Uint8Array[];
    /** How often write permission was asked for. */
    permissionRequests: number;
    /** When set, the next write waits for this promise before it completes. */
    hold: Promise<void> | null;
}

export class MemoryDisk {
    readonly files = new Map<string, Uint8Array>();

    handle(name: string, grants = true): FakeHandle {
        const disk = this.files;
        const handle: FakeHandle = {
            name,
            grants,
            writes: [],
            permissionRequests: 0,
            hold: null,
            async read() {
                const bytes = disk.get(name);
                if (!bytes) throw new Error(`No file ${name}`);
                return bytes.slice();
            },
            async requestWrite() {
                handle.permissionRequests++;
                return handle.grants;
            },
            async write(bytes) {
                const held = handle.hold;
                handle.hold = null;
                if (held) await held;
                handle.writes.push(bytes.slice());
                disk.set(name, bytes.slice());
            },
        };
        return handle;
    }
}

/** A file to open: from `disk` with a handle, or bytes alone (file input, drop). */
export function chosen(name: string, bytes: Uint8Array, handle: FakeHandle | null): ChosenFile {
    return {
        name,
        read: async () => (handle ? handle.read() : bytes.slice()),
        handle: async () => handle,
    };
}

export interface FakePlatform extends ProjectFilePlatform {
    /** Whether File System Access is there (a save picker); false: downloads. */
    access: boolean;
    /** What the open picker returns, first to last; null is a cancel. */
    readonly toOpen: (ChosenFile | null)[];
    /** What the save picker returns, first to last; null is a cancel. */
    readonly toSave: (FakeHandle | null)[];
    /** The names the save picker suggested, one per time it was shown. */
    readonly suggested: string[];
    readonly opened: number;
    readonly downloads: { name: string; bytes: Uint8Array }[];
}

export function fakePlatform(): FakePlatform {
    let opened = 0;
    const platform: FakePlatform = {
        access: true,
        toOpen: [],
        toSave: [],
        suggested: [],
        get opened() {
            return opened;
        },
        downloads: [],
        canChooseSaveTarget: () => platform.access,
        async chooseFileToOpen() {
            opened++;
            return platform.toOpen.shift() ?? null;
        },
        async chooseSaveTarget(name) {
            if (!platform.access) throw new Error("No save picker without File System Access");
            platform.suggested.push(name);
            return platform.toSave.shift() ?? null;
        },
        download(name, bytes) {
            platform.downloads.push({ name, bytes: bytes.slice() });
        },
    };
    return platform;
}

export interface Notice {
    kind: "info" | "error";
    message: string;
}

export interface Harness {
    sessions: StoreApi<SessionsState>;
    platform: FakePlatform;
    disk: MemoryDisk;
    dialogs: FileDialogs;
    /** Every discard question asked, in order. */
    questions: DiscardChangesRequest[];
    notices: Notice[];
    floatingApplied: number;
    workflows: FileWorkflows;
}

export function harness(): Harness {
    const sessions = createSessionsStore();
    const platform = fakePlatform();
    const dialogs = createFileDialogs();
    dialogs.attachHost();
    const questions: DiscardChangesRequest[] = [];
    dialogs.store.subscribe(({ request }) => {
        if (request) questions.push(request);
    });
    const notices: Notice[] = [];
    const state = {
        sessions,
        platform,
        disk: new MemoryDisk(),
        dialogs,
        questions,
        notices,
        floatingApplied: 0,
    };
    const workflows = createFileWorkflows({
        sessions,
        platform,
        dialogs,
        notices: {
            info: (message) => void notices.push({ kind: "info", message }),
            error: (message) => void notices.push({ kind: "error", message }),
        },
        applyFloating: () => void state.floatingApplied++,
    });
    return Object.assign(state, { workflows });
}

/** Answers the discard question once it is asked: true discards, null keeps the document. */
export async function answerDiscard(test: Harness, answer: true | null): Promise<void> {
    const request = await vi.waitFor(() => {
        const open = test.dialogs.store.getState().request;
        if (!open) throw new Error("no question yet");
        return open;
    });
    request.answer(answer);
}

/** A seed's opaque noise image of `width` × `height`, as RGBA bytes. */
export function noise(width: number, height: number, seed: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index++) {
        data[index] = index % 4 === 3 ? 255 : (index * 37 + seed * 101) & 255;
    }
    return data;
}

/** Writes noise into the active cel through a transaction: one undo step, as a stroke is. */
export function paint(document: OpenDocument, seed: number): void {
    const { session, history } = document;
    const transaction = history.begin({
        layerId: session.activeLayerId,
        frameId: session.activeFrameId,
    });
    const { width, height } = transaction.image;
    transaction.image.data.set(noise(width, height, seed));
    transaction.markDirty({ x: 0, y: 0, width, height });
    transaction.commit("Paint");
}

/** Opens a new document in the harness's store; returns it as the store holds it. */
export function openNew(test: Harness, name = "hero", width = 4, height = 3): OpenDocument {
    return test.sessions.getState().open(createDocument({ name, width, height }));
}

/** Opens `session` in the harness's store. */
export function openSession(
    test: Harness,
    session: DocSession,
    sources?: Map<string, Uint8Array>,
): OpenDocument {
    return test.sessions.getState().open(session, { referenceSources: sources });
}

/** The active document of the harness; fails when none is open. */
export function active(test: Harness): OpenDocument {
    const document = activeDocument(test.sessions.getState());
    if (!document) throw new Error("no document is open");
    return document;
}

/** The composite of every frame of the active document, in frame order. */
export function composites(test: Harness): Uint8ClampedArray[] {
    const { doc } = active(test).session;
    return doc.frames.map((frame) => compositeFrame(doc, frame.id).data);
}
