import type { StoreApi } from "zustand/vanilla";
import { compositeFrame } from "../../core/composite";
import type { History } from "../../core/history";
import { celKey, randomId } from "../../core/model";
import type { DocSession, PixelBuffer, Touched } from "../../core/model";
import { resizeNearest } from "../../core/pixels";
import { PROJECT_VERSION, THUMBNAIL_MAX_SIDE, docToJson } from "../../core/project";
import type { Notices } from "../notices/notices";
import type { PreferenceStore } from "../preferences/preferences";
import type { ActiveComposites } from "../state/composites";
import { isDirty } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import type { SnapshotKey, SnapshotStorage, StoredSnapshot } from "./snapshotStorage";

// Autosave (SPEC §10, SE-042): each dirty document is written to IndexedDB 2 s after its last
// change, as `doc.json` plus raw image buffers keyed by image ID. Only the images changed since
// the snapshot the storage holds are written again; reference sources are written once. A
// snapshot goes when its document is no longer dirty (a successful save, an undo back to the
// saved state) and when the document is closed (the active tab's Close and `closeBackground`
// both end in `sessions.close`; Revert replaces the session). A reload or a crash leaves the
// snapshots, which the next launch offers for recovery (`recovery.ts`).
//
// What changed is learned from the document's history (each step's `touched`, SPEC §5.2) and,
// for pixels an open transaction writes, from the active composites' `invalidate` (the same
// `touched`): the cels at the frames and layers touched name the images to write again. An image
// whose buffer is not the one written (a command replaced it) or that is new is written too.
//
// A change is anything that can make the document differ from its snapshot: a history step,
// pixels of an open transaction, the export settings, the reference sources. A change of
// `DocSettings` alone (onion skin, grid) is none: it never makes a document dirty (SPEC §5.2),
// and its values reach the next snapshot written for another reason.
//
// Snapshots are keyed by a key of their own, given to each open document: not by the
// document's id. Save As to another file gives a document a new id (`sessions.changeId`), and
// the snapshot follows it without being moved; two pages with the same file open, or a
// snapshot not recovered and the same file opened again, never write over each other.
//
// A floating selection holds its document's transaction open for as long as it floats, and
// its pixels are in the cel's image meanwhile (SPEC §5.2, §5.3), so the snapshot does not wait
// for it: it holds the float where it is, as applied. A stroke's transaction ends soon; the
// snapshot waits for it, so that no half stroke is kept.
//
// Writes run one at a time. A write that finds the document changed between two of its images
// gives up (the snapshot before it stays whole) and the change's own timer writes again.

/** The delay from a document's last change to its snapshot (SPEC §10). */
export const AUTOSAVE_DELAY_MS = 2000;

/** User Timing marks around each snapshot written; tests and the benchmark read them. */
export const AUTOSAVE_MARK_START = "ngne-autosave:start";
export const AUTOSAVE_MEASURE = "ngne-autosave";

/** The toast of a full storage, shown once; autosave is then off for the session. */
export const AUTOSAVE_QUOTA_MESSAGE =
    "Autosave is off until the editor is reloaded: the browser's storage for this site is full.";

export interface AutosaveOptions {
    sessions: StoreApi<SessionsState>;
    /** Where snapshots are kept; null: nowhere (no IndexedDB), autosave does nothing. */
    storage: SnapshotStorage | null;
    /** The autosave preference (SE-007 store). */
    preferences: Pick<PreferenceStore, "get" | "subscribe">;
    notices: Pick<Notices, "error">;
    /**
     * The active document's composites: pixels written by an open transaction are reported
     * there, and the thumbnail is taken from its cache when it holds the first frame. Without
     * it only history steps count.
     */
    composites?: Pick<ActiveComposites, "subscribe" | "cacheOf">;
    /** Whether a selection floats in the active document (SE-032). */
    isFloating(): boolean;
    /** The page writing the snapshots (`recovery.ts`). */
    owner: string;
    delayMs?: number;
    now?(): number;
    /** A new snapshot key. */
    newKey?(): SnapshotKey;
}

export interface Autosave {
    /**
     * Makes `snapshot` the snapshot of the open document of `session`, which recovery opened
     * from it and made dirty: its key, images and sources are kept, and later snapshots write
     * only what changes. The snapshot is claimed by this page.
     */
    adopt(session: DocSession, snapshot: StoredSnapshot): void;
    /** Resolves once every storage operation queued so far has finished. */
    idle(): Promise<void>;
    /** True after a storage-full error: no snapshot is written for the rest of the session. */
    readonly disabled: boolean;
    /** Stops following the documents; pending snapshots are not written. */
    stop(): void;
}

/** What autosave keeps of one open document. */
interface Tracker {
    readonly session: DocSession;
    readonly history: History;
    readonly key: SnapshotKey;
    record: OpenDocument;
    stopHistory(): void;
    timer: ReturnType<typeof setTimeout> | null;
    /** A snapshot of it is queued and has not started. */
    queued: boolean;
    /** Increases with every change: a write gives up when it moved meanwhile. */
    changes: number;
    /** Increases with every removal: a write that ends after one records nothing. */
    generation: number;
    /** Images changed since the snapshot the storage holds. */
    changed: Set<string>;
    /** The first frame changed since the thumbnail was taken. */
    thumbnailStale: boolean;
    /** The first frame's id when the thumbnail was taken. */
    thumbnailFrame: string | null;
    thumbnail: PixelBuffer | null;
    exportJson: string;
    /** The storage may hold records of `key` (a write was started since the last removal). */
    mayExist: boolean;
    /** The storage holds exactly what `images` and `sources` say. */
    known: boolean;
    /** The images the snapshot holds: the data written, by image ID. */
    images: Map<string, WeakRef<Uint8ClampedArray>>;
    /** The reference sources the snapshot holds. */
    sources: Set<string>;
}

/** The images of the cels at `touched`'s frames and layers. */
function imagesTouched(session: DocSession, touched: Touched, into: Set<string>): void {
    const { cels } = session.doc;
    const { frameIds, layerIds } = touched;
    if (frameIds.length === 0 || layerIds.length === 0) return;
    // The smaller of the two walks: every pair, or every cel.
    if (frameIds.length * layerIds.length <= cels.size) {
        for (const frameId of frameIds) {
            for (const layerId of layerIds) {
                const cel = cels.get(celKey(layerId, frameId));
                if (cel) into.add(cel.imageId);
            }
        }
        return;
    }
    const frames = new Set(frameIds);
    const layers = new Set(layerIds);
    for (const [key, cel] of cels) {
        const colon = key.indexOf(":");
        if (layers.has(key.slice(0, colon)) && frames.has(key.slice(colon + 1))) {
            into.add(cel.imageId);
        }
    }
}

function isQuotaError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { name?: unknown }).name === "QuotaExceededError"
    );
}

function mark(name: string): void {
    if (typeof performance !== "undefined") performance.mark(name);
}

function measure(name: string, start: string): void {
    if (typeof performance === "undefined") return;
    try {
        performance.measure(name, start);
    } catch {
        // The start mark was cleared by someone else: nothing to measure.
    }
}

export function createAutosave(options: AutosaveOptions): Autosave {
    const { sessions, storage, preferences, notices, composites, owner } = options;
    const delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
    const now = options.now ?? (() => Date.now());
    const newKey = options.newKey ?? randomId;
    const trackers = new Map<DocSession, Tracker>();
    let disabled = false;
    let stopped = false;
    let tail: Promise<void> = Promise.resolve();

    const enabled = () =>
        !stopped && !disabled && storage !== null && preferences.get("autosave").enabled;

    /** Runs storage operations one after the other. */
    const queue = (task: () => Promise<void>): void => {
        tail = tail.then(task).catch((error: unknown) => {
            console.error("Autosave failed:", error);
        });
    };

    const recordOf = (tracker: Tracker): OpenDocument | null =>
        sessions.getState().documents.find((entry) => entry.session === tracker.session) ?? null;

    const cancel = (tracker: Tracker) => {
        if (tracker.timer !== null) clearTimeout(tracker.timer);
        tracker.timer = null;
    };

    const arm = (tracker: Tracker) => {
        cancel(tracker);
        if (stopped) return;
        tracker.timer = setTimeout(() => fire(tracker), delayMs);
    };

    const fire = (tracker: Tracker) => {
        tracker.timer = null;
        if (!enabled() || tracker.queued || trackers.get(tracker.session) !== tracker) return;
        tracker.queued = true;
        queue(() => snapshot(tracker));
    };

    /** The document can differ from its snapshot now: it is written after the delay. */
    const changed = (tracker: Tracker) => {
        tracker.changes++;
        arm(tracker);
    };

    const noteTouched = (tracker: Tracker, touched: Touched) => {
        imagesTouched(tracker.session, touched, tracker.changed);
        const first = tracker.session.doc.frames[0]?.id ?? null;
        if (touched.structure || first === null || touched.frameIds.includes(first)) {
            tracker.thumbnailStale = true;
        }
    };

    /** Forgets what the storage holds of the tracker's snapshot and removes it there. */
    const removeSnapshot = (tracker: Tracker) => {
        if (!tracker.mayExist) return;
        tracker.mayExist = false;
        tracker.known = false;
        tracker.generation++;
        tracker.images.clear();
        tracker.sources.clear();
        tracker.thumbnail = null;
        const { key } = tracker;
        queue(async () => {
            try {
                await storage?.remove(key);
            } catch (error) {
                console.warn("Autosave could not remove a snapshot:", error);
            }
        });
    };

    const thumbnailOf = (record: OpenDocument): PixelBuffer => {
        const { doc } = record.session;
        const first = doc.frames[0];
        if (!first) throw new RangeError("The document has no frame.");
        // A composite the cache holds already is taken from it; autosave fills no cache entry.
        const cache = composites?.cacheOf(record.session) ?? null;
        const composite = cache?.has(first.id)
            ? cache.get(first.id)
            : compositeFrame(doc, first.id);
        const longer = Math.max(doc.width, doc.height);
        if (longer <= THUMBNAIL_MAX_SIDE) {
            // The cache's buffer is the cache's: the thumbnail is a copy.
            return {
                width: composite.width,
                height: composite.height,
                data: composite.data.slice(),
            };
        }
        const scaled = (side: number) =>
            Math.max(1, Math.round((side * THUMBNAIL_MAX_SIDE) / longer));
        return resizeNearest(composite, scaled(doc.width), scaled(doc.height));
    };

    /** Writes the snapshot of `tracker`'s document, if it is still due. */
    const snapshot = async (tracker: Tracker): Promise<void> => {
        tracker.queued = false;
        if (!enabled() || !storage || trackers.get(tracker.session) !== tracker) return;
        const record = recordOf(tracker);
        if (!record || !isDirty(record)) return;
        // A stroke ends soon: its snapshot waits for it. A float does not hold it up.
        const state = sessions.getState();
        const floating = state.activeId === record.id && options.isFloating();
        if (record.history.transaction && !floating) {
            arm(tracker);
            return;
        }
        mark(AUTOSAVE_MARK_START);
        const { doc } = record.session;
        const docJson = docToJson(doc);
        const used = new Set(docJson.cels.map((cel) => cel.imageId));
        const putImages = new Map<string, PixelBuffer>();
        const written = new Map<string, WeakRef<Uint8ClampedArray>>();
        for (const id of used) {
            const image = doc.images.get(id);
            if (!image) throw new Error(`Autosave: the document has no image "${id}".`);
            written.set(id, new WeakRef(image.data));
            const held = tracker.known ? tracker.images.get(id)?.deref() : undefined;
            if (held !== image.data || tracker.changed.has(id)) putImages.set(id, image);
        }
        const deleteImages = tracker.known
            ? [...tracker.images.keys()].filter((id) => !used.has(id))
            : [];
        const sources = record.referenceSources;
        const putSources = new Map(
            [...sources].filter(([id]) => !tracker.known || !tracker.sources.has(id)),
        );
        const deleteSources = tracker.known
            ? [...tracker.sources].filter((id) => !sources.has(id))
            : [];
        const firstFrame = doc.frames[0]?.id ?? null;
        const freshThumbnail =
            tracker.thumbnailStale || !tracker.thumbnail || tracker.thumbnailFrame !== firstFrame;
        const thumbnail =
            !freshThumbnail && tracker.thumbnail ? tracker.thumbnail : thumbnailOf(record);

        // What this write covers; given back when it does not land.
        const changes = tracker.changes;
        const generation = tracker.generation;
        const changedBefore = tracker.changed;
        const staleBefore = tracker.thumbnailStale;
        tracker.changed = new Set();
        tracker.thumbnailStale = false;
        const giveBack = () => {
            for (const id of changedBefore) tracker.changed.add(id);
            tracker.thumbnailStale ||= staleBefore || freshThumbnail;
        };
        const replace = !tracker.known;
        tracker.mayExist = true;
        let result: "written" | "aborted";
        try {
            result = await storage.write({
                record: {
                    key: tracker.key,
                    name: doc.name,
                    savedAt: now(),
                    owner,
                    version: PROJECT_VERSION,
                    docJson,
                    imageIds: [...used],
                    sourceIds: [...sources.keys()],
                    thumbnail,
                },
                replace,
                putImages,
                deleteImages,
                putSources,
                deleteSources,
                shouldAbort: () =>
                    stopped ||
                    tracker.changes !== changes ||
                    tracker.generation !== generation ||
                    trackers.get(tracker.session) !== tracker,
            });
        } catch (error) {
            giveBack();
            if (isQuotaError(error)) {
                if (!disabled) {
                    disabled = true;
                    for (const each of trackers.values()) cancel(each);
                    notices.error(AUTOSAVE_QUOTA_MESSAGE);
                }
                return;
            }
            console.warn("Autosave could not write a snapshot:", error);
            return;
        } finally {
            measure(AUTOSAVE_MEASURE, AUTOSAVE_MARK_START);
        }
        if (result === "aborted") {
            giveBack();
            return;
        }
        // Removed meanwhile (saved, closed): the removal queued after this write empties it.
        if (tracker.generation !== generation) return;
        tracker.known = true;
        tracker.images = written;
        tracker.sources = new Set(sources.keys());
        tracker.thumbnail = thumbnail;
        tracker.thumbnailFrame = firstFrame;
    };

    /** Follows an open document; `recovered`: the snapshot recovery opened it from. */
    const track = (record: OpenDocument, recovered: StoredSnapshot | null = null): Tracker => {
        const tracker: Tracker = {
            session: record.session,
            history: record.history,
            key: recovered?.record.key ?? newKey(),
            record,
            stopHistory: () => {},
            timer: null,
            queued: false,
            changes: 0,
            generation: 0,
            changed: new Set(),
            thumbnailStale: true,
            thumbnailFrame: null,
            thumbnail: null,
            exportJson: JSON.stringify(record.session.doc.exportSettings),
            mayExist: false,
            known: false,
            images: new Map(),
            sources: new Set(),
        };
        tracker.stopHistory = record.history.subscribe((change) => {
            noteTouched(tracker, change.touched);
            changed(tracker);
        });
        trackers.set(record.session, tracker);
        if (recovered) takeOver(tracker, recovered);
        // A document dirty already when autosave first sees it is written after the delay.
        else if (isDirty(record)) changed(tracker);
        return tracker;
    };

    /** Makes the tracker's snapshot the one recovery opened its document from. */
    const takeOver = (tracker: Tracker, recovered: StoredSnapshot) => {
        const { doc } = tracker.session;
        tracker.mayExist = true;
        tracker.known = true;
        tracker.images = new Map();
        for (const id of recovered.record.imageIds) {
            const image = doc.images.get(id);
            if (image) tracker.images.set(id, new WeakRef(image.data));
        }
        tracker.sources = new Set(recovered.sources.keys());
        tracker.thumbnail = recovered.record.thumbnail;
        tracker.thumbnailFrame = doc.frames[0]?.id ?? null;
        tracker.thumbnailStale = false;
        const { key } = tracker;
        queue(async () => {
            try {
                await storage?.claim(key, owner);
            } catch (error) {
                console.warn("Autosave could not claim a recovered snapshot:", error);
            }
        });
    };

    const untrack = (tracker: Tracker) => {
        tracker.stopHistory();
        cancel(tracker);
        trackers.delete(tracker.session);
        removeSnapshot(tracker);
    };

    const follow = (state: SessionsState) => {
        const open = new Set<DocSession>();
        for (const record of state.documents) {
            open.add(record.session);
            const tracker = trackers.get(record.session) ?? track(record);
            if (record !== tracker.record) {
                const exportJson = JSON.stringify(record.session.doc.exportSettings);
                if (exportJson !== tracker.exportJson) {
                    tracker.exportJson = exportJson;
                    changed(tracker);
                }
                if (record.referenceSources !== tracker.record.referenceSources) changed(tracker);
                tracker.record = record;
            }
            // Saved, or back at the saved state: its file holds it, the snapshot goes.
            if (!isDirty(record)) {
                cancel(tracker);
                removeSnapshot(tracker);
            }
        }
        for (const tracker of [...trackers.values()]) {
            if (!open.has(tracker.session)) untrack(tracker);
        }
    };

    follow(sessions.getState());
    const stopSessions = sessions.subscribe((state) => follow(state));
    const stopComposites = composites?.subscribe((touched, session) => {
        const tracker = trackers.get(session);
        if (!tracker) return;
        noteTouched(tracker, touched);
        changed(tracker);
    });
    const stopPreferences = preferences.subscribe((key, values) => {
        if (key !== "autosave") return;
        for (const tracker of trackers.values()) {
            if (!values.autosave.enabled) cancel(tracker);
            else if (isDirty(tracker.record)) arm(tracker);
        }
    });

    return {
        adopt(session, snapshot) {
            const tracker = trackers.get(session);
            if (!tracker) return;
            // Tracked under a key of its own since it opened, with nothing written yet.
            untrack(tracker);
            const record = recordOf(tracker);
            if (record) track(record, snapshot);
        },
        idle: () => tail,
        get disabled() {
            return disabled;
        },
        stop() {
            stopped = true;
            stopSessions();
            stopComposites?.();
            stopPreferences();
            for (const tracker of trackers.values()) {
                tracker.stopHistory();
                cancel(tracker);
            }
            trackers.clear();
        },
    };
}
