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
//
// A snapshot names its owner, the page that wrote it or recovered it. Several pages may share
// the database (two tabs restored after a crash both offer recovery): a write leaves a snapshot
// of another owner alone, and recovering or discarding a snapshot checks, in the same
// transaction, that its owner is still the one the page saw (SE-042 review B).

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
     * The page that wrote it or recovered it (`recovery.ts`): a snapshot of a page that is still
     * open is not offered for recovery by another page.
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

/**
 * What `take` found: the snapshot, now the taking page's; "taken" when its owner is no longer
 * the one expected (another page recovered it); "gone" when it is no longer stored.
 */
export type TakeResult = StoredSnapshot | "taken" | "gone";

export interface SnapshotStorage {
    /**
     * Writes a snapshot. Resolves "written" once the transaction committed; "aborted" when
     * `shouldAbort` gave it up; "taken" when the stored snapshot of the key names another owner
     * than the record written (another page recovered it): nothing is written then. Rejects
     * with the transaction's error (a `QuotaExceededError` when storage is full), leaving the
     * snapshot before it.
     */
    write(write: SnapshotWrite): Promise<"written" | "aborted" | "taken">;
    /** Removes every record of a snapshot. */
    remove(key: SnapshotKey): Promise<void>;
    /** Every snapshot's record, newest first. */
    list(): Promise<SnapshotRecord[]>;
    /**
     * Reads a snapshot and makes it `owner`'s, in one transaction, if its stored owner is still
     * `expectedOwner`: two pages cannot both recover it.
     */
    take(key: SnapshotKey, expectedOwner: string, owner: string): Promise<TakeResult>;
    /**
     * Removes a snapshot, in one transaction, if its stored owner is still `expectedOwner`: a
     * snapshot another page recovered meanwhile is not removed.
     */
    discard(key: SnapshotKey, expectedOwner: string): Promise<"removed" | "taken" | "gone">;
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

/** Deletes every record of the snapshot `key` within `transaction`. */
function removeAll(transaction: IDBTransaction, key: SnapshotKey): void {
    transaction.objectStore(SNAPSHOT_STORE).delete(key);
    transaction.objectStore(IMAGE_STORE).delete(rangeOf(key));
    transaction.objectStore(SOURCE_STORE).delete(rangeOf(key));
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

/** The second part of a key `[snapshot key, id]`, or null. */
function idOf(key: IDBValidKey): string | null {
    const id = Array.isArray(key) ? key[1] : undefined;
    return typeof id === "string" ? id : null;
}

export interface IndexedDbSnapshotOptions {
    /** The IndexedDB to use; the default is the page's (`indexedDB`). */
    factory?: Pick<IDBFactory, "open">;
    timeoutMs?: number;
}

/**
 * The snapshots in the page's IndexedDB, or null where there is none (Node). An open that
 * another tab blocks, or that does not answer within the timeout, fails the operation that
 * asked, and a connection that opens after that is closed at once; the next operation tries
 * again. A connection the browser closes, or that a newer version elsewhere asks to close, is
 * let go, and the next operation opens another.
 */
export function indexedDbSnapshots(options: IndexedDbSnapshotOptions = {}): SnapshotStorage | null {
    const factory = options.factory ?? (typeof indexedDB === "undefined" ? null : indexedDB);
    if (!factory) return null;
    const timeoutMs = options.timeoutMs ?? AUTOSAVE_OPEN_TIMEOUT_MS;
    let opened: Promise<IDBDatabase> | null = null;

    const openDatabase = async (): Promise<IDBDatabase> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const open = factory.open(AUTOSAVE_DATABASE, 1);
        open.onupgradeneeded = () => {
            const db = open.result;
            for (const name of STORES) {
                if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
            }
        };
        return new Promise<IDBDatabase>((resolve, reject) => {
            /** Given up: a connection that opens later is closed at once. */
            const giveUp = (error: Error) => {
                open.onsuccess = () => open.result.close();
                reject(error);
            };
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error ?? new Error("Not opened."));
            open.onblocked = () => giveUp(new Error("The database is blocked."));
            timer = setTimeout(() => giveUp(new Error("IndexedDB did not answer.")), timeoutMs);
        }).finally(() => clearTimeout(timer));
    };

    const database = (): Promise<IDBDatabase> => {
        if (opened) return opened;
        const opening = openDatabase().then((db) => {
            /** The connection is no longer usable: the next operation opens another. */
            const forget = () => {
                if (opened === opening) opened = null;
            };
            db.onversionchange = () => {
                db.close();
                forget();
            };
            db.onclose = forget;
            return db;
        });
        opened = opening;
        // A failed open is tried again by the next operation.
        opening.catch(() => {
            if (opened === opening) opened = null;
        });
        return opening;
    };

    return {
        async write(write) {
            const db = await database();
            const transaction = db.transaction(STORES, "readwrite");
            const finished = done(transaction);
            const snapshots = transaction.objectStore(SNAPSHOT_STORE);
            const images = transaction.objectStore(IMAGE_STORE);
            const sources = transaction.objectStore(SOURCE_STORE);
            const { key, owner } = write.record;
            let outcome: "aborted" | "taken" | null = null;
            /** An error thrown by a request itself (a value that cannot be cloned). */
            let failure: unknown = null;
            const abort = (why: "aborted" | "taken") => {
                outcome = why;
                transaction.abort();
            };
            const guarded = (step: () => void) => () => {
                try {
                    step();
                } catch (error) {
                    failure = error;
                    transaction.abort();
                }
            };
            // One image per task: each is put once the one before was stored.
            const pending = [...write.putImages];
            const next = guarded(() => {
                if (write.shouldAbort()) return abort("aborted");
                const entry = pending.shift();
                if (!entry) {
                    snapshots.put(write.record, key);
                    return;
                }
                const [id, image] = entry;
                images.put(storedImage(image), [key, id]).onsuccess = next;
            });
            // Only a snapshot of this owner is written over: one another page took is left.
            const check = snapshots.get(key);
            check.onsuccess = guarded(() => {
                const stored = check.result as SnapshotRecord | undefined;
                if (stored && stored.owner !== owner) return abort("taken");
                if (write.replace) {
                    images.delete(rangeOf(key));
                    sources.delete(rangeOf(key));
                }
                for (const id of write.deleteImages) images.delete([key, id]);
                for (const id of write.deleteSources) sources.delete([key, id]);
                for (const [id, bytes] of write.putSources) sources.put(bytes, [key, id]);
                next();
            });
            try {
                await finished;
            } catch (error) {
                if (failure !== null) throw failure;
                if (outcome !== null) return outcome;
                throw error;
            }
            return "written";
        },

        async remove(key) {
            const db = await database();
            const transaction = db.transaction(STORES, "readwrite");
            const finished = done(transaction);
            removeAll(transaction, key);
            await finished;
        },

        async list() {
            const db = await database();
            const all = await request(
                db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll(),
            );
            return (all as SnapshotRecord[]).sort((a, b) => b.savedAt - a.savedAt);
        },

        async take(key, expectedOwner, owner) {
            const db = await database();
            const transaction = db.transaction(STORES, "readwrite");
            const finished = done(transaction);
            const snapshots = transaction.objectStore(SNAPSHOT_STORE);
            let result: TakeResult = "gone";
            const check = snapshots.get(key);
            check.onsuccess = () => {
                const stored = check.result as SnapshotRecord | undefined;
                if (!stored) return;
                if (stored.owner !== expectedOwner) {
                    result = "taken";
                    return;
                }
                const record: SnapshotRecord = { ...stored, owner };
                snapshots.put(record, key);
                const range = rangeOf(key);
                const imageStore = transaction.objectStore(IMAGE_STORE);
                const sourceStore = transaction.objectStore(SOURCE_STORE);
                const imageKeys = imageStore.getAllKeys(range);
                const imageValues = imageStore.getAll(range);
                const sourceKeys = sourceStore.getAllKeys(range);
                const sourceValues = sourceStore.getAll(range);
                // The requests of a transaction answer in order: the last one answers last.
                sourceValues.onsuccess = () => {
                    const images = new Map<string, PixelBuffer>();
                    imageKeys.result.forEach((stored, index) => {
                        const image = imageFrom(imageValues.result[index]);
                        const id = idOf(stored);
                        if (image && id !== null) images.set(id, image);
                    });
                    const sources = new Map<string, Uint8Array>();
                    sourceKeys.result.forEach((stored, index) => {
                        const bytes: unknown = sourceValues.result[index];
                        const id = idOf(stored);
                        if (bytes instanceof Uint8Array && id !== null) sources.set(id, bytes);
                    });
                    result = { record, images, sources };
                };
            };
            await finished;
            return result;
        },

        async discard(key, expectedOwner) {
            const db = await database();
            const transaction = db.transaction(STORES, "readwrite");
            const finished = done(transaction);
            let result: "removed" | "taken" | "gone" = "gone";
            const check = transaction.objectStore(SNAPSHOT_STORE).get(key);
            check.onsuccess = () => {
                const stored = check.result as SnapshotRecord | undefined;
                if (stored && stored.owner !== expectedOwner) {
                    result = "taken";
                    return;
                }
                // Without a record, records of the key may still be left: they go too.
                removeAll(transaction, key);
                if (stored) result = "removed";
            };
            await finished;
            return result;
        },
    };
}
