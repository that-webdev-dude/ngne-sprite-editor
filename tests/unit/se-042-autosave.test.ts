import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import {
    AUTOSAVE_DELAY_MS,
    AUTOSAVE_QUOTA_MESSAGE,
    createAutosave,
} from "../../src/app/autosave/autosave";
import type { Autosave } from "../../src/app/autosave/autosave";
import { createRecoveryDialogs } from "../../src/app/autosave/dialogs";
import type { RecoveryRequest } from "../../src/app/autosave/dialogs";
import {
    RECOVERY_CHECKED_MARK,
    createRecovery,
    offerRecovery,
} from "../../src/app/autosave/recovery";
import type { Recovery } from "../../src/app/autosave/recovery";
import type {
    SnapshotRecord,
    SnapshotStorage,
    SnapshotWrite,
    StoredSnapshot,
} from "../../src/app/autosave/snapshotStorage";
import { createPreferenceStore } from "../../src/app/preferences/preferences";
import type { PreferenceStore } from "../../src/app/preferences/preferences";
import { createActiveComposites } from "../../src/app/state/composites";
import { activeDocument, createSessionsStore, isDirty } from "../../src/app/state/sessions";
import type { OpenDocument, SessionsState } from "../../src/app/state/sessions";
import { compositeFrame } from "../../src/core/composite";
import { celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { encodePng } from "../../src/core/png";
import { docToJson, projectThumbnail } from "../../src/core/project";
import { addReferenceLayerCommand } from "../../src/core/references";
import { noise } from "./se-041-support";

// SE-042: autosave and crash recovery. Snapshots go to a storage in memory here (IndexedDB in
// the page, `snapshotStorage.ts`; the E2E specs cover it), with the same contract: a write
// lands whole or not at all, and is given up when `shouldAbort` says so before an image.

/** A snapshot storage in memory that records every put. */
class MemorySnapshots implements SnapshotStorage {
    readonly records = new Map<string, SnapshotRecord>();
    readonly images = new Map<string, Map<string, PixelBuffer>>();
    readonly sources = new Map<string, Map<string, Uint8Array>>();
    /** Every image put, as `key/imageId`, in order. */
    readonly imagePuts: string[] = [];
    /** Every source put, as `key/sourceId`. */
    readonly sourcePuts: string[] = [];
    readonly removals: string[] = [];
    readonly claims: { key: string; owner: string }[] = [];
    /** The next write fails with it. */
    fail: Error | null = null;
    /** Runs before each image is put (after `shouldAbort` was asked for the one before). */
    beforePut: (() => void) | null = null;

    async write(write: SnapshotWrite): Promise<"written" | "aborted"> {
        await Promise.resolve();
        if (this.fail) {
            const failure = this.fail;
            this.fail = null;
            throw failure;
        }
        const { key } = write.record;
        const images = new Map(write.replace ? [] : (this.images.get(key) ?? []));
        const sources = new Map(write.replace ? [] : (this.sources.get(key) ?? []));
        for (const id of write.deleteImages) images.delete(id);
        for (const id of write.deleteSources) sources.delete(id);
        const puts: string[] = [];
        for (const [id, image] of write.putImages) {
            this.beforePut?.();
            if (write.shouldAbort()) return "aborted";
            images.set(id, { width: image.width, height: image.height, data: image.data.slice() });
            puts.push(`${key}/${id}`);
        }
        if (write.shouldAbort()) return "aborted";
        for (const [id, bytes] of write.putSources) {
            sources.set(id, bytes.slice());
            this.sourcePuts.push(`${key}/${id}`);
        }
        this.imagePuts.push(...puts);
        this.images.set(key, images);
        this.sources.set(key, sources);
        this.records.set(key, structuredClone(write.record));
        return "written";
    }

    async remove(key: string): Promise<void> {
        this.removals.push(key);
        this.records.delete(key);
        this.images.delete(key);
        this.sources.delete(key);
    }

    async list(): Promise<SnapshotRecord[]> {
        return [...this.records.values()].sort((a, b) => b.savedAt - a.savedAt);
    }

    async read(key: string): Promise<StoredSnapshot | null> {
        const record = this.records.get(key);
        if (!record) return null;
        const images = new Map(
            [...(this.images.get(key) ?? [])].map(([id, image]) => [
                id,
                { width: image.width, height: image.height, data: image.data.slice() },
            ]),
        );
        return {
            record: structuredClone(record),
            images,
            sources: new Map(this.sources.get(key) ?? []),
        };
    }

    async claim(key: string, owner: string): Promise<void> {
        this.claims.push({ key, owner });
        const record = this.records.get(key);
        if (record) this.records.set(key, { ...record, owner });
    }

    /** The only snapshot; fails unless there is exactly one. */
    only(): SnapshotRecord {
        expect(this.records.size).toBe(1);
        return [...this.records.values()][0]!;
    }
}

interface Setup {
    sessions: StoreApi<SessionsState>;
    storage: MemorySnapshots;
    preferences: PreferenceStore;
    errors: string[];
    infos: string[];
    floating: { value: boolean };
    composites: ReturnType<typeof createActiveComposites> | undefined;
    autosave: Autosave;
}

function setup(
    options: { storage?: MemorySnapshots; composites?: boolean; owner?: string } = {},
): Setup {
    const sessions = createSessionsStore();
    const storage = options.storage ?? new MemorySnapshots();
    const preferences = createPreferenceStore(null);
    const errors: string[] = [];
    const infos: string[] = [];
    const floating = { value: false };
    let time = 1_000;
    let keys = 0;
    const composites = options.composites ? createActiveComposites(sessions) : undefined;
    const autosave = createAutosave({
        sessions,
        storage,
        preferences,
        notices: { error: (message) => void errors.push(message) },
        composites,
        isFloating: () => floating.value,
        owner: options.owner ?? "page-a",
        now: () => ++time,
        newKey: () => `key-${++keys}`,
    });
    return { sessions, storage, preferences, errors, infos, floating, composites, autosave };
}

/** A document of `frames` frames, each with a cel of noise on its one layer. */
function framesDocument(name: string, frames: number, width = 4, height = 3): DocSession {
    const session = createDocument({ name, width, height }, sequentialIds(`${name}-`));
    const { doc } = session;
    const layerId = doc.layers[0]!.id;
    doc.frames = Array.from({ length: frames }, (_, index) => ({
        id: `${name}-frame-${index}`,
        durationMs: 100,
    }));
    doc.cels.clear();
    doc.images.clear();
    doc.frames.forEach((frame, index) => {
        const imageId = `${name}-image-${index}`;
        doc.images.set(imageId, { width, height, data: noise(width, height, 1000 + index) });
        doc.cels.set(celKey(layerId, frame.id), { imageId, opacity: 255 });
    });
    session.activeLayerId = layerId;
    session.activeFrameId = doc.frames[0]!.id;
    return session;
}

/** Writes noise into the cel of the active layer at `frameId` through a transaction. */
function paintAt(document: OpenDocument, frameId: string, seed: number): void {
    const { session, history } = document;
    const transaction = history.begin({ layerId: session.activeLayerId, frameId });
    const { width, height } = transaction.image;
    transaction.image.data.set(noise(width, height, seed));
    transaction.markDirty({ x: 0, y: 0, width, height });
    transaction.commit("Paint");
}

function current(test: Setup): OpenDocument {
    const document = activeDocument(test.sessions.getState());
    if (!document) throw new Error("no active document");
    return document;
}

/** Lets the delay pass and every storage operation it started finish. */
async function elapse(test: Setup, ms = AUTOSAVE_DELAY_MS): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await test.autosave.idle();
}

function composites(document: OpenDocument): Uint8ClampedArray[] {
    const { doc } = document.session;
    return doc.frames.map((frame) => compositeFrame(doc, frame.id).data);
}

function png(width: number, height: number): Uint8Array {
    return encodePng({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(90) });
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("autosave: when a snapshot is written", () => {
    it("writes doc.json and the images of a dirty document 2 s after its last change", async () => {
        const test = setup();
        const document = test.sessions.getState().open(framesDocument("hero", 2));
        paintAt(document, document.session.doc.frames[0]!.id, 9);
        await elapse(test, AUTOSAVE_DELAY_MS - 1);
        expect(test.storage.records.size).toBe(0);
        await elapse(test, 1);
        const record = test.storage.only();
        const { doc } = current(test).session;
        expect(record.docJson).toEqual(docToJson(doc));
        expect(record.name).toBe("hero");
        expect(record.owner).toBe("page-a");
        expect([...record.imageIds].sort()).toEqual([...doc.images.keys()].sort());
        const stored = test.storage.images.get(record.key)!;
        for (const [id, image] of doc.images) expect(stored.get(id)!.data).toEqual(image.data);
        expect(record.thumbnail).toEqual(projectThumbnail(doc));
    });

    it("restarts the delay with every change", async () => {
        const test = setup();
        const document = test.sessions.getState().open(framesDocument("hero", 1));
        const frameId = document.session.doc.frames[0]!.id;
        paintAt(document, frameId, 1);
        await elapse(test, 1500);
        paintAt(document, frameId, 2);
        await elapse(test, 1500);
        expect(test.storage.records.size).toBe(0);
        await elapse(test, 500);
        expect(test.storage.records.size).toBe(1);
    });

    it("writes nothing for a clean document, nor for a change of DocSettings alone (onion skin, grid)", async () => {
        const test = setup();
        const document = test.sessions.getState().open(framesDocument("hero", 1));
        test.sessions.getState().updateDocSettings(document.id, (settings) => {
            settings.onion.enabled = true;
            settings.grid.visible = true;
        });
        await elapse(test, 10 * AUTOSAVE_DELAY_MS);
        expect(isDirty(current(test))).toBe(false);
        expect(test.storage.records.size).toBe(0);
    });

    it("writes a change of the export settings, which makes the document dirty", async () => {
        const test = setup();
        const document = test.sessions.getState().open(framesDocument("hero", 1));
        test.sessions.getState().updateExportSettings(document.id, (settings) => {
            settings.padding = 3;
        });
        await elapse(test);
        expect(test.storage.only().docJson).toMatchObject({ exportSettings: { padding: 3 } });
    });

    it("waits for a stroke's transaction, but not for a floating selection's", async () => {
        const test = setup({ composites: true });
        const document = test.sessions.getState().open(framesDocument("hero", 1));
        const frameId = document.session.doc.frames[0]!.id;
        paintAt(document, frameId, 1);
        const stroke = document.history.begin({ layerId: document.session.activeLayerId, frameId });
        await elapse(test, 3 * AUTOSAVE_DELAY_MS);
        expect(test.storage.records.size).toBe(0);
        stroke.abort();
        await elapse(test);
        expect(test.storage.records.size).toBe(1);

        // A float: its pixels are in the cel's image, and the snapshot holds them.
        const float = document.history.begin({ layerId: document.session.activeLayerId, frameId });
        test.floating.value = true;
        float.image.data.set(noise(4, 3, 77));
        float.markDirty({ x: 0, y: 0, width: 4, height: 3 });
        // The app reports a transaction's pixels to the active composites.
        test.composites!.invalidate({
            frameIds: [frameId],
            layerIds: [document.session.activeLayerId],
            structure: false,
        });
        await elapse(test);
        const record = test.storage.only();
        const imageId = document.session.doc.cels.get(
            celKey(document.session.activeLayerId, frameId),
        )!.imageId;
        expect(test.storage.images.get(record.key)!.get(imageId)!.data).toEqual(noise(4, 3, 77));
        float.abort();
    });

    it("honours the autosave preference: nothing while it is off, a snapshot once it is on again", async () => {
        const test = setup();
        test.preferences.set("autosave", { enabled: false });
        const document = test.sessions.getState().open(framesDocument("hero", 1));
        paintAt(document, document.session.doc.frames[0]!.id, 1);
        await elapse(test, 5 * AUTOSAVE_DELAY_MS);
        expect(test.storage.records.size).toBe(0);
        test.preferences.set("autosave", { enabled: true });
        await elapse(test);
        expect(test.storage.records.size).toBe(1);
    });
});

describe("autosave: what a snapshot writes", () => {
    it("writes again only the images changed since the snapshot the storage holds", async () => {
        const test = setup();
        const document = test.sessions.getState().open(framesDocument("hero", 16, 8, 8));
        const frames = document.session.doc.frames;
        paintAt(document, frames[0]!.id, 100);
        await elapse(test);
        expect(test.storage.imagePuts).toHaveLength(16);

        test.storage.imagePuts.length = 0;
        paintAt(document, frames[5]!.id, 101);
        await elapse(test);
        const imageId = document.session.doc.cels.get(
            celKey(document.session.activeLayerId, frames[5]!.id),
        )!.imageId;
        expect(test.storage.imagePuts).toEqual([`${test.storage.only().key}/${imageId}`]);

        // Undo is a change of that image too.
        test.storage.imagePuts.length = 0;
        document.history.undo();
        await elapse(test);
        expect(test.storage.imagePuts).toEqual([`${test.storage.only().key}/${imageId}`]);
        expect(test.storage.images.get(test.storage.only().key)!.get(imageId)!.data).toEqual(
            document.session.doc.images.get(imageId)!.data,
        );
    });

    it("writes a new image, and removes the image of a cel that is gone", async () => {
        const test = setup();
        const session = framesDocument("hero", 2);
        const document = test.sessions.getState().open(session);
        const [first, second] = session.doc.frames;
        // An empty cel painted: a new image.
        const removed = session.doc.cels.get(celKey(session.activeLayerId, second!.id))!.imageId;
        session.doc.cels.delete(celKey(session.activeLayerId, second!.id));
        session.doc.images.delete(removed);
        paintAt(document, first!.id, 3);
        await elapse(test);
        expect(test.storage.only().imageIds).toHaveLength(1);
        test.storage.imagePuts.length = 0;
        paintAt(document, second!.id, 4);
        await elapse(test);
        expect(test.storage.imagePuts).toHaveLength(1);
        expect(test.storage.only().imageIds).toHaveLength(2);
        document.history.undo();
        await elapse(test);
        const key = test.storage.only().key;
        expect(test.storage.only().imageIds).toHaveLength(1);
        expect(test.storage.images.get(key)!.size).toBe(1);
    });

    it("writes each reference source once", async () => {
        const test = setup();
        const session = framesDocument("hero", 1);
        const bytes = png(2, 2);
        const document = test.sessions
            .getState()
            .open(session, { referenceSources: [["src-1", bytes]] });
        document.history.execute(
            addReferenceLayerCommand(session, {
                sourceId: "src-1",
                sourceWidth: 2,
                sourceHeight: 2,
                newId: () => "ref-1",
            }),
        );
        await elapse(test);
        paintAt(document, session.doc.frames[0]!.id, 5);
        await elapse(test);
        paintAt(document, session.doc.frames[0]!.id, 6);
        await elapse(test);
        const key = test.storage.only().key;
        expect(test.storage.sourcePuts).toEqual([`${key}/src-1`]);
        expect(test.storage.sources.get(key)!.get("src-1")).toEqual(bytes);
        expect(test.storage.only().sourceIds).toEqual(["src-1"]);
    });

    it("gives a write up when the document changes between two of its images, keeping the snapshot before it", async () => {
        const test = setup();
        const document = test.sessions.getState().open(framesDocument("hero", 3));
        const frames = document.session.doc.frames;
        paintAt(document, frames[0]!.id, 1);
        await elapse(test);
        const before = structuredClone(test.storage.only());

        // A full write is needed: the document is painted on two frames.
        paintAt(document, frames[1]!.id, 2);
        paintAt(document, frames[2]!.id, 3);
        let changedOnce = false;
        test.storage.beforePut = () => {
            if (changedOnce) return;
            changedOnce = true;
            paintAt(document, frames[0]!.id, 4);
        };
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
        await test.autosave.idle();
        expect(test.storage.only()).toEqual(before);
        test.storage.beforePut = null;
        await elapse(test);
        const key = test.storage.only().key;
        for (const frame of frames) {
            const id = document.session.doc.cels.get(
                celKey(document.session.activeLayerId, frame.id),
            )!.imageId;
            expect(test.storage.images.get(key)!.get(id)!.data).toEqual(
                document.session.doc.images.get(id)!.data,
            );
        }
    });
});

describe("autosave: when a snapshot goes", () => {
    it("removes the snapshot on a successful save (markSaved) and on an undo back to the saved state", async () => {
        const test = setup();
        const document = test.sessions.getState().open(framesDocument("hero", 1));
        const frameId = document.session.doc.frames[0]!.id;
        paintAt(document, frameId, 1);
        await elapse(test);
        expect(test.storage.records.size).toBe(1);
        test.sessions.getState().markSaved(document.id);
        await test.autosave.idle();
        expect(test.storage.records.size).toBe(0);
        expect(test.storage.images.size).toBe(0);

        paintAt(document, frameId, 2);
        await elapse(test);
        expect(test.storage.records.size).toBe(1);
        // The snapshot written after the save holds every image again.
        expect(test.storage.only().imageIds).toHaveLength(1);
        document.history.undo();
        await elapse(test);
        expect(test.storage.records.size).toBe(0);
    });

    it("removes the snapshot when the document closes, active or in the background", async () => {
        const test = setup();
        const a = test.sessions.getState().open(framesDocument("a", 1));
        const b = test.sessions.getState().open(framesDocument("b", 1));
        paintAt(a, a.session.doc.frames[0]!.id, 1);
        paintAt(b, b.session.doc.frames[0]!.id, 2);
        await elapse(test);
        expect(test.storage.records.size).toBe(2);
        // `closeBackground` and the active tab's Close both end in `sessions.close`.
        test.sessions.getState().close(a.id);
        await test.autosave.idle();
        expect([...test.storage.records.values()].map((record) => record.name)).toEqual(["b"]);
        test.sessions.getState().close(b.id);
        await test.autosave.idle();
        expect(test.storage.records.size).toBe(0);
        expect(test.storage.images.size).toBe(0);
    });

    it("follows a new id from Save As: the snapshot keeps its key and is removed by the save", async () => {
        const test = setup();
        const document = test.sessions.getState().open(framesDocument("hero", 1));
        paintAt(document, document.session.doc.frames[0]!.id, 1);
        await elapse(test);
        const { key } = test.storage.only();
        test.sessions.getState().changeId(document.id, "copy-id");
        paintAt(current(test), current(test).session.doc.frames[0]!.id, 2);
        await elapse(test);
        expect(test.storage.only().key).toBe(key);
        expect(test.storage.only().docJson).toMatchObject({ id: "copy-id" });
        test.sessions.getState().markSaved("copy-id");
        await test.autosave.idle();
        expect(test.storage.records.size).toBe(0);
    });

    it("removes the snapshot of a reverted document (its session is replaced)", async () => {
        const test = setup();
        const document = test.sessions.getState().open(framesDocument("hero", 1));
        paintAt(document, document.session.doc.frames[0]!.id, 1);
        await elapse(test);
        test.sessions.getState().replaceActive(framesDocument("hero", 1));
        await test.autosave.idle();
        expect(test.storage.records.size).toBe(0);
    });
});

describe("autosave: storage errors", () => {
    it("reports a full storage once by toast and writes nothing more for the session", async () => {
        const test = setup();
        const document = test.sessions.getState().open(framesDocument("hero", 1));
        const frameId = document.session.doc.frames[0]!.id;
        test.storage.fail = new DOMException("The quota has been exceeded.", "QuotaExceededError");
        paintAt(document, frameId, 1);
        await elapse(test);
        expect(test.errors).toEqual([AUTOSAVE_QUOTA_MESSAGE]);
        expect(test.autosave.disabled).toBe(true);
        for (let seed = 2; seed < 5; seed++) {
            paintAt(document, frameId, seed);
            await elapse(test);
        }
        expect(test.storage.records.size).toBe(0);
        expect(test.errors).toEqual([AUTOSAVE_QUOTA_MESSAGE]);
    });

    it("tries again at the next change after another error, with the changed images kept", async () => {
        const test = setup();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const document = test.sessions.getState().open(framesDocument("hero", 2));
        const [first, second] = document.session.doc.frames;
        paintAt(document, first!.id, 1);
        await elapse(test);
        test.storage.fail = new Error("Disk on fire");
        paintAt(document, second!.id, 2);
        await elapse(test);
        expect(warn).toHaveBeenCalled();
        test.storage.imagePuts.length = 0;
        paintAt(document, first!.id, 3);
        await elapse(test);
        expect(test.storage.imagePuts).toHaveLength(2);
        expect(test.errors).toEqual([]);
        warn.mockRestore();
    });
});

describe("recovery", () => {
    /** A page that wrote a snapshot of a painted document with a reference source, then went. */
    async function crashedPage(storage: MemorySnapshots) {
        const before = setup({ storage, owner: "page-gone" });
        const session = framesDocument("hero", 3);
        const document = before.sessions.getState().open(session, {
            referenceSources: [["src-1", png(2, 2)]],
        });
        document.history.execute(
            addReferenceLayerCommand(session, {
                sourceId: "src-1",
                sourceWidth: 2,
                sourceHeight: 2,
                newId: () => "ref-1",
            }),
        );
        paintAt(document, session.doc.frames[1]!.id, 42);
        await elapse(before);
        const expected = composites(current(before));
        before.autosave.stop();
        return { expected, document };
    }

    function recoveryOf(test: Setup, open: Set<string> = new Set()): Recovery {
        return createRecovery({
            storage: test.storage,
            sessions: test.sessions,
            autosave: test.autosave,
            notices: {
                info: (message) => void test.infos.push(message),
                error: (message) => void test.errors.push(message),
            },
            owner: "page-b",
            openOwners: async () => open,
        });
    }

    it("offers the snapshots of pages that are gone, and opens one byte-identical, dirty, with an empty history", async () => {
        const storage = new MemorySnapshots();
        const { expected } = await crashedPage(storage);
        const test = setup({ storage, owner: "page-b" });
        const recovery = recoveryOf(test);
        const offered = await recovery.offered();
        expect(offered.map((record) => record.name)).toEqual(["hero"]);
        expect(await recovery.recover(offered[0]!.key)).toBe(true);
        const document = current(test);
        expect(composites(document)).toEqual(expected);
        expect(document.history.undoCount).toBe(0);
        expect(isDirty(document)).toBe(true);
        expect([...document.referenceSources]).toEqual([["src-1", png(2, 2)]]);
        expect(test.infos).toEqual(["Recovered hero"]);
        await test.autosave.idle();
        // The snapshot is this page's now, and later snapshots write only what changes.
        expect(storage.only().owner).toBe("page-b");
        storage.imagePuts.length = 0;
        storage.sourcePuts.length = 0;
        paintAt(document, document.session.doc.frames[2]!.id, 43);
        await elapse(test);
        expect(storage.only().key).toBe(offered[0]!.key);
        expect(storage.imagePuts).toHaveLength(1);
        expect(storage.sourcePuts).toEqual([]);
        // Saved, its snapshot goes.
        test.sessions.getState().markSaved(document.id);
        await test.autosave.idle();
        expect(storage.records.size).toBe(0);
    });

    it("does not offer the snapshot of a page that is still open", async () => {
        const storage = new MemorySnapshots();
        await crashedPage(storage);
        const test = setup({ storage, owner: "page-b" });
        expect(await recoveryOf(test, new Set(["page-gone"])).offered()).toEqual([]);
    });

    it("discards a snapshot permanently", async () => {
        const storage = new MemorySnapshots();
        await crashedPage(storage);
        const test = setup({ storage, owner: "page-b" });
        const recovery = recoveryOf(test);
        const [record] = await recovery.offered();
        expect(await recovery.discard(record!.key, record!.name)).toBe(true);
        expect(storage.records.size).toBe(0);
        expect(storage.images.size).toBe(0);
        expect(storage.sources.size).toBe(0);
        expect(await recovery.offered()).toEqual([]);
    });

    it("reports a snapshot that cannot be opened and opens nothing", async () => {
        const storage = new MemorySnapshots();
        await crashedPage(storage);
        const [record] = await storage.list();
        // An image is missing.
        storage.images.get(record!.key)!.clear();
        const test = setup({ storage, owner: "page-b" });
        expect(await recoveryOf(test).recover(record!.key)).toBe(false);
        expect(test.sessions.getState().documents).toEqual([]);
        expect(test.errors).toHaveLength(1);
        expect(test.errors[0]).toMatch(/^Could not recover “hero”\. /);
    });

    it("gives a recovered document an id of its own when a document of its id is open", async () => {
        const storage = new MemorySnapshots();
        const { document } = await crashedPage(storage);
        const test = setup({ storage, owner: "page-b" });
        test.sessions.getState().open(framesDocument("hero", 1));
        const openId = test.sessions.getState().documents[0]!.id;
        expect(openId).toBe(document.id);
        const [record] = await recoveryOf(test).offered();
        expect(await recoveryOf(test).recover(record!.key)).toBe(true);
        const ids = test.sessions.getState().documents.map((entry) => entry.id);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
    });

    it("on launch, shows the offered snapshots newest first and marks the check with their count", async () => {
        vi.useRealTimers();
        const storage = new MemorySnapshots();
        await storage.write({
            record: { ...recordFor("old"), savedAt: 10 },
            replace: true,
            putImages: new Map(),
            deleteImages: [],
            putSources: new Map(),
            deleteSources: [],
            shouldAbort: () => false,
        });
        await storage.write({
            record: { ...recordFor("new"), savedAt: 20 },
            replace: true,
            putImages: new Map(),
            deleteImages: [],
            putSources: new Map(),
            deleteSources: [],
            shouldAbort: () => false,
        });
        const test = setup({ storage, owner: "page-b" });
        const dialogs = createRecoveryDialogs();
        dialogs.attachHost();
        const shown: RecoveryRequest[] = [];
        dialogs.store.subscribe(({ request }) => {
            if (request) shown.push(request);
        });
        performance.clearMarks(RECOVERY_CHECKED_MARK);
        expect(await offerRecovery(recoveryOf(test), dialogs, () => false)).toBe(2);
        expect(shown).toHaveLength(1);
        expect(shown[0]!.entries.map((entry) => entry.name)).toEqual(["new", "old"]);
        const marks = performance.getEntriesByName(RECOVERY_CHECKED_MARK) as PerformanceMark[];
        expect(marks.at(-1)?.detail).toEqual({ offered: 2 });
        // Discard through the request removes it.
        expect(await shown[0]!.discard("new")).toBe(true);
        expect([...storage.records.keys()]).toEqual(["old"]);
        shown[0]!.answer(null);
        expect(dialogs.store.getState().request).toBeNull();

        // Nothing left to offer: no dialog, and the mark says so.
        await storage.remove("old");
        expect(await offerRecovery(recoveryOf(test), dialogs, () => false)).toBe(0);
        expect(shown).toHaveLength(1);
        const last = performance.getEntriesByName(RECOVERY_CHECKED_MARK).at(-1) as PerformanceMark;
        expect(last.detail).toEqual({ offered: 0 });
    });
});

function recordFor(name: string): SnapshotRecord {
    const session = createDocument({ name, width: 2, height: 2 }, sequentialIds(`${name}-`));
    return {
        key: name,
        name,
        savedAt: 0,
        owner: "page-gone",
        version: 1,
        docJson: docToJson(session.doc),
        imageIds: [],
        sourceIds: [],
        thumbnail: projectThumbnail(session.doc),
    };
}
