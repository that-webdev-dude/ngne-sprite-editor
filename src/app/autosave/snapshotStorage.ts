import type { PixelBuffer } from "../../core/model";

// Where the autosave snapshots of SPEC §10 (SE-042) are kept: IndexedDB, database
// `ngne-sprite-editor-autosave`. A snapshot is one document's `doc.json` with a thumbnail and
// what the recovery dialog lists (record in `snapshots`), its raw image buffers keyed by image
// ID (`images`) and the bytes of its reference sources (`sources`). Image and source records
// are keyed by `[snapshot key, id]`, so a snapshot rewrites one image without touching the
// others, and all of one snapshot's records are removed by one key range.
//
// Every write of a snapshot is one IndexedDB transaction: it lands whole or not at all, so a
// crash in the middle of a write leaves the snapshot before it. The images of a write are put
// one per task (each put in the success callback of the one before), so no task of autosave
// clones more than one image: a large document does not block the page for the time of all of
// its images (SE-042: no long task attributed to autosave).

/** The key of a snapshot: one per open document, kept while it is open (`autosave.ts`). */
export type SnapshotKey = string;

/** What the recovery dialog lists of a snapshot, and what recovery reads first. */
export interface SnapshotRecord {
    readonly key: SnapshotKey;
    /** The document's name when the snapshot was written. */
    readonly name: string;
    /** When the snapshot was written, in milliseconds since the epoch. */
    readonly savedAt: number;
    /**
     * The page that wrote it (`recovery.ts`): a snapshot of a page that is still open is not
     * offered for recovery by another page.
     */
    readonly owner: string;
    /** The schema version of `docJson` (`PROJECT_VERSION` when written). */
    readonly version: number;
    /** `docToJson` of the document: the model of SPEC §5.1 without pixels. */
    readonly docJson: unknown;
    /** The images the snapshot holds, by image ID: exactly those `docJson`'s cels name. */
    readonly imageIds: readonly string[];
    /** The reference sources it holds, by source ID. */
    readonly sourceIds: readonly string[];
    /** The composite of the first frame, at most 128 px (`projectThumbnail`). */
    readonly thumbnail: PixelBuffer;
}

/** One write of a snapshot: what changed since the snapshot the storage holds. */
export interface SnapshotWrite {
    readonly record: SnapshotRecord;
    /**
     * True when the storage may hold records of this key that the writer does not know of: they
     * are all removed first, in the same transaction.
     */
    readonly replace: boolean;
    /** Images to write: new ones and those whose pixels changed. */
    readonly putImages: ReadonlyMap<string, PixelBuffer>;
    /** Images the document no longer uses. */
    readonly deleteImages: readonly string[];
    /** Reference sources the storage does not hold yet: each is written once. */
    readonly putSources: ReadonlyMap<string, Uint8Array>;
    readonly deleteSources: readonly string[];
    /**
     * Asked before each image is put: true gives the write up (the transaction is aborted, the
     * snapshot before it stays). The document changed meanwhile, so what was read of it is no
     * longer one state.
     */
    shouldAbort(): boolean;
}

/** A snapshot as recovery reads it back. */
export interface StoredSnapshot {
    readonly record: SnapshotRecord;
    readonly images: ReadonlyMap<string, PixelBuffer>;
    readonly sources: ReadonlyMap<string, Uint8Array>;
}

export interface SnapshotStorage {
    /**
     * Writes a snapshot. Resolves "aborted" when `shouldAbort` gave it up, "written" once the
     * transaction committed; rejects with the transaction's error (a `QuotaExceededError` when
     * storage is full), leaving the snapshot before it.
     */
    write(write: SnapshotWrite): Promise<"written" | "aborted">;
    /** Removes every record of a snapshot. */
    remove(key: SnapshotKey): Promise<void>;
    /** Every snapshot's record, newest first. */
    list(): Promise<SnapshotRecord[]>;
    /** A snapshot with its images and sources, or null when there is none. */
    read(key: SnapshotKey): Promise<StoredSnapshot | null>;
    /** Gives the snapshot another owner (a page that recovered it). */
    claim(key: SnapshotKey, owner: string): Promise<void>;
}

export const AUTOSAVE_DATABASE = "ngne-sprite-editor-autosave";
export const SNAPSHOT_STORE = "snapshots";
export const IMAGE_STORE = "images";
export const SOURCE_STORE = "sources";
const STORES = [SNAPSHOT_STORE, IMAGE_STORE, SOURCE_STORE];

/** How long autosave waits for IndexedDB to open, in milliseconds; then it keeps nothing. */
export const AUTOSAVE_OPEN_TIMEOUT_MS = 3000;

/** Every key `[key, id]` of one snapshot: arrays sort after strings, so `[key, []]` ends it. */
function rangeOf(key: SnapshotKey): IDBKeyRange {
    return IDBKeyRange.bound([key], [key, []]);
}

function request<Result>(task: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        task.onsuccess = () => resolve(task.result);
        task.onerror = () => reject(task.error ?? new Error("IndexedDB request failed."));
    });
}

/** Resolves when `transaction` commits, rejects with its error when it fails. */
function done(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        // A request's error reaches the transaction before it aborts, with the request's error.
        transaction.onerror = (event) =>
            reject(
                (event.target as IDBRequest | null)?.error ??
                    transaction.error ??
                    new Error("IndexedDB transaction failed."),
            );
        transaction.onabort = () =>
            reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
}

/** The data of a buffer as a value of its own: a view into a larger buffer is copied. */
function ownData(data: Uint8ClampedArray): Uint8ClampedArray {
    return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? data
        : data.slice();
}

function storedImage(image: PixelBuffer): PixelBuffer {
    return { width: image.width, height: image.height, data: ownData(image.data) };
}

/** A stored image read back, or null when it is not one. */
function imageFrom(value: unknown): PixelBuffer | null {
    if (typeof value !== "object" || value === null) return null;
    const { width, height, data } = value as Partial<PixelBuffer>;
    if (typeof width !== "number" || typeof height !== "number") return null;
    return data instanceof Uint8ClampedArray ? { width, height, data } : null;
}

export interface IndexedDbSnapshotOptions {
    /** The IndexedDB to use; the default is the page's (`indexedDB`). */
    factory?: Pick<IDBFactory, "open">;
    timeoutMs?: number;
}

/**
 * The snapshots in the page's IndexedDB, or null where there is none (Node). An open that
 * another tab blocks, or that does not answer within the timeout, fails the operation that
 * asked; the next one tries again.
 */
export function indexedDbSnapshots(options: IndexedDbSnapshotOptions = {}): SnapshotStorage | null {
    const factory = options.factory ?? (typeof indexedDB === "undefined" ? null : indexedDB);
    if (!factory) return null;
    const timeoutMs = options.timeoutMs ?? AUTOSAVE_OPEN_TIMEOUT_MS;
    let opened: Promise<IDBDatabase> | null = null;

    const database = (): Promise<IDBDatabase> => {
        opened ??= (async () => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const opening = factory.open(AUTOSAVE_DATABASE, 1);
            opening.onupgradeneeded = () => {
                const db = opening.result;
                for (const name of STORES) {
                    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
                }
            };
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                opening.onsuccess = () => resolve(opening.result);
                opening.onerror = () => reject(opening.error ?? new Error("Not opened."));
                opening.onblocked = () => reject(new Error("The database is blocked."));
                timer = setTimeout(() => {
                    opening.onsuccess = () => opening.result.close();
                    reject(new Error("IndexedDB did not answer."));
                }, timeoutMs);
            }).finally(() => clearTimeout(timer));
            db.onversionchange = () => {
                db.close();
                opened = null;
            };
            return db;
        })();
        // A failed open is tried again by the next operation.
        opened.catch(() => {
            opened = null;
        });
        return opened;
    };

    return {
        async write(write) {
            const db = await database();
            const transaction = db.transaction(STORES, "readwrite");
            const finished = done(transaction);
            const snapshots = transaction.objectStore(SNAPSHOT_STORE);
            const images = transaction.objectStore(IMAGE_STORE);
            const sources = transaction.objectStore(SOURCE_STORE);
            const { key } = write.record;
            let aborted = false;
            /** An error thrown by a put itself (a value that cannot be cloned). */
            let failure: unknown = null;
            const abort = () => {
                aborted = true;
                transaction.abort();
            };
            if (write.replace) {
                images.delete(rangeOf(key));
                sources.delete(rangeOf(key));
            }
            for (const id of write.deleteImages) images.delete([key, id]);
            for (const id of write.deleteSources) sources.delete([key, id]);
            for (const [id, bytes] of write.putSources) sources.put(bytes, [key, id]);
            // One image per task: each is put once the one before was stored.
            const pending = [...write.putImages];
            const next = () => {
                try {
                    if (write.shouldAbort()) return abort();
                    const entry = pending.shift();
                    if (!entry) {
                        snapshots.put(write.record, key);
                        return;
                    }
                    const [id, image] = entry;
                    images.put(storedImage(image), [key, id]).onsuccess = next;
                } catch (error) {
                    failure = error;
                    transaction.abort();
                }
            };
            next();
            try {
                await finished;
            } catch (error) {
                if (failure !== null) throw failure;
                if (aborted) return "aborted";
                throw error;
            }
            return "written";
        },

        async remove(key) {
            const db = await database();
            const transaction = db.transaction(STORES, "readwrite");
            const finished = done(transaction);
            transaction.objectStore(SNAPSHOT_STORE).delete(key);
            transaction.objectStore(IMAGE_STORE).delete(rangeOf(key));
            transaction.objectStore(SOURCE_STORE).delete(rangeOf(key));
            await finished;
        },

        async list() {
            const db = await database();
            const all = await request(
                db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll(),
            );
            return (all as SnapshotRecord[]).sort((a, b) => b.savedAt - a.savedAt);
        },

        async read(key) {
            const db = await database();
            const transaction = db.transaction(STORES, "readonly");
            const record = (await request(transaction.objectStore(SNAPSHOT_STORE).get(key))) as
                SnapshotRecord | undefined;
            if (!record) return null;
            const range = rangeOf(key);
            const [imageKeys, imageValues, sourceKeys, sourceValues] = await Promise.all([
                request(transaction.objectStore(IMAGE_STORE).getAllKeys(range)),
                request(transaction.objectStore(IMAGE_STORE).getAll(range)),
                request(transaction.objectStore(SOURCE_STORE).getAllKeys(range)),
                request(transaction.objectStore(SOURCE_STORE).getAll(range)),
            ]);
            const images = new Map<string, PixelBuffer>();
            imageKeys.forEach((stored, index) => {
                const image = imageFrom(imageValues[index]);
                const id = (stored as [string, string])[1];
                if (image && typeof id === "string") images.set(id, image);
            });
            const sources = new Map<string, Uint8Array>();
            sourceKeys.forEach((stored, index) => {
                const bytes: unknown = sourceValues[index];
                const id = (stored as [string, string])[1];
                if (bytes instanceof Uint8Array && typeof id === "string") sources.set(id, bytes);
            });
            return { record, images, sources };
        },

        async claim(key, owner) {
            const db = await database();
            const transaction = db.transaction(SNAPSHOT_STORE, "readwrite");
            const finished = done(transaction);
            const store = transaction.objectStore(SNAPSHOT_STORE);
            const record = (await request(store.get(key))) as SnapshotRecord | undefined;
            if (record) store.put({ ...record, owner }, key);
            await finished;
        },
    };
}
