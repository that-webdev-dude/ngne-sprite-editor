import type { StoreApi } from "zustand/vanilla";
import { CompositeCache } from "../../core/composite";
import type { History } from "../../core/history";
import type { DocSession, Touched } from "../../core/model";
import { activeDocument, sessionsStore } from "./sessions";
import type { SessionsState } from "./sessions";

// The composite cache of the active document (SPEC §5.3): the one place the viewport, the
// preview, thumbnails, the eyedropper and exports get a frame's composited pixels from, and
// the one place that keeps it in step with the document.
//
//   history step (touched) → composites dropped here → listeners told (the viewport uploads)
//
// Each open document has a cache of its own (SPEC §5.3), but only the active document keeps
// composites: when another document becomes active, the cache of the one left is cleared, so
// the budget is not multiplied by the number of tabs (REVIEW.md D7, SE-047). It is filled
// again from the document when the document is active once more.

/**
 * Called after the composites a change made out of date were dropped: `touched` is what the
 * change touched (SPEC §5.2), `session` the active session it happened in.
 */
export type CompositeListener = (touched: Touched, session: DocSession) => void;

export interface ActiveComposites {
    /**
     * The composite cache of the active document, or null while no document is open.
     * `cache.get(frameId)` is the frame's composite; the buffer belongs to the cache.
     */
    readonly cache: CompositeCache | null;
    /** The active session, whose document `cache` composites; null while none is open. */
    readonly session: DocSession | null;
    /** `cache` when `session` is the active session, otherwise null. */
    cacheOf(session: DocSession): CompositeCache | null;
    /**
     * Pixel memory held by the composite cache of an open document's session, in bytes: 0 for
     * every document but the active one (SE-047).
     */
    bytesOf(session: DocSession): number;
    /**
     * Reports pixels written into the active document outside a command (by an open
     * transaction, or put back by its abort), with the frames that show them: their
     * composites are dropped and the listeners told, as after a history step. Does nothing
     * while no document is open.
     */
    invalidate(touched: Touched): void;
    /**
     * Calls `listener` after every change to the active document's composites: each step of
     * its history and each `invalidate`. A change of the active document itself is not
     * reported; follow the session store for that. To read composites in reaction to a
     * change, listen here and not to the history: the cache is up to date when this is
     * called. Returns the function that stops the listener.
     */
    subscribe(listener: CompositeListener): () => void;
    /** Stops following the session store. */
    dispose(): void;
}

interface Attached {
    session: DocSession;
    history: History;
    cache: CompositeCache;
    /** `history.position` when the cache was last brought up to date. */
    position: number;
    /** Stops the history subscription. */
    stop(): void;
}

/** The composites of the active document of `sessions`. The app has one: `activeComposites`. */
export function createActiveComposites(sessions: StoreApi<SessionsState>): ActiveComposites {
    const listeners = new Set<CompositeListener>();
    let attached: Attached | null = null;
    /** The cache of each open document's session; only the active one holds composites. */
    const caches = new Map<DocSession, CompositeCache>();

    const notify = (touched: Touched, session: DocSession) => {
        for (const listener of [...listeners]) listener(touched, session);
    };

    /** Brings `attached` in line with the active document of the store. */
    const follow = (): Attached | null => {
        const state = sessions.getState();
        // A closed document's cache goes with it.
        for (const session of [...caches.keys()]) {
            if (!state.documents.some((entry) => entry.session === session)) caches.delete(session);
        }
        const document = activeDocument(state);
        if ((document?.session ?? null) === (attached?.session ?? null)) return attached;
        // The document left keeps no composites (SE-047).
        attached?.stop();
        attached?.cache.clear();
        attached = null;
        if (!document) return null;
        const { session, history } = document;
        // The cache it had is empty, and its document may have changed meanwhile: a new one.
        const cache = new CompositeCache(session.doc);
        caches.set(session, cache);
        const entry: Attached = {
            session,
            history,
            cache,
            position: history.position,
            stop: history.subscribe(({ touched }) => {
                entry.cache.invalidate(touched);
                entry.position = history.position;
                notify(touched, session);
            }),
        };
        attached = entry;
        return entry;
    };

    /**
     * The cache to hand out. Between a step of the history and this module being told of it
     * another listener of the same step may ask: what the step touched is not known yet, so
     * nothing kept is trusted. Readers that wait for `subscribe` never get here.
     */
    const current = (): Attached | null => {
        const entry = follow();
        if (entry && entry.history.position !== entry.position) entry.cache.clear();
        return entry;
    };

    const stopSessions = sessions.subscribe(() => void follow());
    follow();

    return {
        get cache() {
            return current()?.cache ?? null;
        },
        get session() {
            return follow()?.session ?? null;
        },
        cacheOf(session) {
            const entry = current();
            return entry?.session === session ? entry.cache : null;
        },
        bytesOf(session) {
            follow();
            return caches.get(session)?.bytes ?? 0;
        },
        invalidate(touched) {
            const entry = follow();
            if (!entry) return;
            entry.cache.invalidate(touched);
            notify(touched, entry.session);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        dispose() {
            stopSessions();
            attached?.stop();
            attached = null;
            caches.clear();
            listeners.clear();
        },
    };
}

/** The composites of the app's active document. */
export const activeComposites = createActiveComposites(sessionsStore);
