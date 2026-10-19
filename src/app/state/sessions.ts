import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { History } from "../../core/history";
import type { HistoryOptions } from "../../core/history";
import { assertInvariants } from "../../core/model";
import type { DocSession, DocSettings, ExportSettings } from "../../core/model";
import type {} from "../../import-meta";

/** View state of one document (SPEC §6.4). */
export interface ViewState {
    /** Device pixels per sprite pixel; 1 is "100%". */
    scale: number;
    /** Left edge of the document rectangle, in integer device pixels. */
    originX: number;
    /** Top edge of the document rectangle, in integer device pixels. */
    originY: number;
}

export const DEFAULT_VIEW: ViewState = { scale: 1, originX: 0, originY: 0 };

/**
 * One open document. `session` and `history` are the mutable objects of `core`; the record
 * itself is replaced (with a higher `revision`) on every change to the document or to its
 * state, so a subscriber that selects the record is told about each of them.
 */
export interface OpenDocument {
    /** The document's id (`session.doc.id`). */
    readonly id: string;
    readonly session: DocSession;
    /** The only way the session changes (SPEC §5.2). */
    readonly history: History;
    readonly view: ViewState;
    /**
     * Whether the view was ever given: by the `view` option of `open`, by `setView`, or by the
     * view policy when the document was opened. A document whose view was never set is fitted
     * and centred once the viewport knows its size (SPEC §6.4, `app/view/viewPolicy`); a view
     * that was set is never fitted again.
     */
    readonly viewSet: boolean;
    /** Original bytes of the reference images, by `ReferenceLayer.sourceId`. */
    readonly referenceSources: ReadonlyMap<string, Uint8Array>;
    /** `history.position` at the last save, or when the document was opened. */
    readonly savedPosition: number;
    /** `ExportSettings` at the last save, as JSON. */
    readonly savedExportSettings: string;
    /** Increases with every change of this document. */
    readonly revision: number;
}

/**
 * How a document gets a view it was not given (SPEC §6.4). View navigation supplies the
 * policy (`app/view/viewPolicy`); the store applies it while it opens or activates a
 * document, so the document is stored once, with its view, and subscribers are told once. A
 * store without a policy leaves every view as it is.
 */
export interface ViewPolicy {
    /**
     * The first view of a document opened without one (fitted and centred), or null while
     * that cannot be said: the size of the viewport is not known.
     */
    first(doc: { width: number; height: number }): ViewState | null;
    /**
     * The view of a document whose view was set, as the document becomes the active one:
     * `view` itself, or the view moved back inside the pan limits.
     */
    arrive(view: ViewState, doc: { width: number; height: number }): ViewState;
}

export interface OpenOptions {
    /** Make the document the active one; the default is true. */
    activate?: boolean;
    /** The view to open with; it is kept, apart from the pan limits of the view policy. */
    view?: Partial<ViewState>;
    /** Reference source bytes read from the project file (SE-041). */
    referenceSources?: Iterable<readonly [string, Uint8Array]>;
    history?: HistoryOptions;
}

export interface SessionsState {
    /**
     * Open documents, in the order of their tabs (SE-047): the order they were opened in,
     * until `move` changes it.
     */
    documents: readonly OpenDocument[];
    /** Id of the active document, or null when none is open. */
    activeId: string | null;

    /**
     * Opens a session with a new history and returns the document as the store holds it.
     * Throws when a document with its id is open.
     */
    open(session: DocSession, options?: OpenOptions): OpenDocument;
    /**
     * Closes the active document, if any, opens `session` in its place and returns the
     * document as the store holds it.
     */
    replaceActive(session: DocSession, options?: OpenOptions): OpenDocument;
    /** Closes a document; when it was active, its neighbour becomes active. */
    close(id: string): void;
    activate(id: string): void;
    /**
     * Moves an open document to `index` of `documents` (its tab, SE-047), clamped to the list;
     * the others keep their order. Throws for an unknown id.
     */
    move(id: string, index: number): void;
    /**
     * Records a state of the document as saved: by default the current one, which is then no
     * longer dirty. A save passes the state it wrote (`savedStateOf` when it made the bytes),
     * so a change made while the file was being written keeps the document dirty.
     */
    markSaved(id: string, state?: SavedState): void;
    /** Changes view preferences of the document: no history entry, never dirty (SPEC §5.2). */
    updateDocSettings(id: string, update: (settings: DocSettings) => void): void;
    /** Changes output preferences: no history entry, dirty until saved (SPEC §5.2). */
    updateExportSettings(id: string, update: (settings: ExportSettings) => void): void;
    setView(id: string, view: Partial<ViewState>): void;
    setReferenceSource(id: string, sourceId: string, bytes: Uint8Array): void;
    deleteReferenceSource(id: string, sourceId: string): void;
    /**
     * Tells subscribers that the session changed outside the history: a test hook that set a
     * field, or pixels written by an open transaction.
     */
    touch(id: string): void;
    /**
     * Makes `policy` the view policy of the store. Returns the function that removes it, if
     * it is still the one in use.
     */
    setViewPolicy(policy: ViewPolicy): () => void;
}

function snapshot(settings: ExportSettings): string {
    return JSON.stringify(settings);
}

/** What the dirty rule of SPEC §5.2 compares: a history position and the export settings. */
export interface SavedState {
    readonly position: number;
    /** `ExportSettings` as JSON. */
    readonly exportSettings: string;
}

/** The state of a document now, as `markSaved` records it. */
export function savedStateOf(document: OpenDocument): SavedState {
    return {
        position: document.history.position,
        exportSettings: snapshot(document.session.doc.exportSettings),
    };
}

/** The active document of a state, or null. */
export function activeDocument(state: SessionsState): OpenDocument | null {
    return state.documents.find((document) => document.id === state.activeId) ?? null;
}

/**
 * SPEC §5.2: a document is dirty when its history position differs from the saved position,
 * or its `ExportSettings` changed since the last save. `DocSettings` never make it dirty.
 */
export function isDirty(document: OpenDocument): boolean {
    return (
        document.history.position !== document.savedPosition ||
        snapshot(document.session.doc.exportSettings) !== document.savedExportSettings
    );
}

/** A store of open documents. The app has one (`sessionsStore`); tests create their own. */
export function createSessionsStore(): StoreApi<SessionsState> {
    /** Stops the history subscription of each open document. */
    const subscriptions = new Map<string, () => void>();
    /** The view policy in use (`setViewPolicy`). */
    let policy: ViewPolicy | null = null;

    return createStore<SessionsState>((set, get) => {
        const find = (id: string): OpenDocument => {
            const document = get().documents.find((entry) => entry.id === id);
            if (!document) throw new Error(`No open document "${id}".`);
            return document;
        };
        const change = (id: string, patch: Partial<OpenDocument> = {}) => {
            set({
                documents: get().documents.map((entry) =>
                    entry.id === id ? { ...entry, ...patch, revision: entry.revision + 1 } : entry,
                ),
            });
        };
        const assertNotOpen = (id: string, documents: readonly OpenDocument[]) => {
            if (documents.some((entry) => entry.id === id)) {
                throw new Error(`Document "${id}" is already open.`);
            }
        };
        const create = (session: DocSession, options: OpenOptions): OpenDocument => {
            const id = session.doc.id;
            const history = new History(session, options.history);
            // A throwing history subscriber would make `execute` throw after the change.
            subscriptions.set(
                id,
                history.subscribe(() => {
                    try {
                        change(id);
                    } catch (error) {
                        console.error("A subscriber of the session store failed:", error);
                    }
                    // SPEC §5.1: invariants are asserted after every command in development
                    // builds. This throws on purpose, once the store is up to date, so the
                    // command that broke the document fails where it was run.
                    if (import.meta.env.DEV) assertInvariants(session);
                }),
            );
            // Without a view of its own the document starts with the policy's first view.
            const first = options.view === undefined ? (policy?.first(session.doc) ?? null) : null;
            return {
                id,
                session,
                history,
                view: first ?? { ...DEFAULT_VIEW, ...options.view },
                viewSet: options.view !== undefined || first !== null,
                referenceSources: new Map(options.referenceSources),
                savedPosition: history.position,
                savedExportSettings: snapshot(session.doc.exportSettings),
                revision: 0,
            };
        };
        /**
         * `document` as it becomes the active one under the view policy: with its first view
         * if it never had one, otherwise with its view inside the pan limits. The record
         * itself when nothing changes. `created`: the record is not in the store yet.
         */
        const arriving = (document: OpenDocument, created = false): OpenDocument => {
            if (!policy) return document;
            const { doc } = document.session;
            const view = document.viewSet ? policy.arrive(document.view, doc) : policy.first(doc);
            if (!view || view === document.view) return document;
            const revision = document.revision + (created ? 0 : 1);
            return { ...document, view, viewSet: true, revision };
        };
        /** The record the store holds for a document just put there: what callers are given. */
        const stored = (document: OpenDocument): OpenDocument =>
            get().documents.find((entry) => entry.id === document.id) ?? document;
        const forget = (id: string) => {
            subscriptions.get(id)?.();
            subscriptions.delete(id);
        };

        return {
            documents: [],
            activeId: null,

            open(session, options = {}) {
                const { documents, activeId } = get();
                assertNotOpen(session.doc.id, documents);
                const created = create(session, options);
                const activates = options.activate !== false;
                const document = activates ? arriving(created, true) : created;
                set({
                    documents: [...documents, document],
                    activeId: activates ? document.id : activeId,
                });
                return stored(document);
            },

            replaceActive(session, options = {}) {
                const { documents, activeId } = get();
                const index = documents.findIndex((entry) => entry.id === activeId);
                const outgoing = documents[index];
                if (!outgoing) return get().open(session, { ...options, activate: true });
                // The outgoing document may be the same file opened again.
                const rest = documents.filter((entry) => entry !== outgoing);
                assertNotOpen(session.doc.id, rest);
                forget(outgoing.id);
                const document = arriving(create(session, options), true);
                set({
                    documents: [...rest.slice(0, index), document, ...rest.slice(index)],
                    activeId: document.id,
                });
                return stored(document);
            },

            close(id) {
                const { documents, activeId } = get();
                const index = documents.findIndex((entry) => entry.id === id);
                if (index === -1) return;
                forget(id);
                const rest = documents.filter((entry) => entry.id !== id);
                if (activeId !== id) {
                    set({ documents: rest });
                    return;
                }
                // The neighbour becomes the active document.
                const next = rest[index] ?? rest[index - 1] ?? null;
                set({
                    documents: rest.map((entry) => (entry === next ? arriving(entry) : entry)),
                    activeId: next?.id ?? null,
                });
            },

            activate(id) {
                const target = find(id);
                const arrived = get().activeId === id ? target : arriving(target);
                if (arrived === target) {
                    set({ activeId: id });
                    return;
                }
                set({
                    documents: get().documents.map((entry) => (entry === target ? arrived : entry)),
                    activeId: id,
                });
            },

            move(id, index) {
                const target = find(id);
                const rest = get().documents.filter((entry) => entry !== target);
                const at = Math.min(Math.max(0, Math.trunc(index)), rest.length);
                if (get().documents[at] === target) return;
                set({ documents: [...rest.slice(0, at), target, ...rest.slice(at)] });
            },

            markSaved(id, state) {
                const document = find(id);
                const { position, exportSettings } = state ?? savedStateOf(document);
                change(id, { savedPosition: position, savedExportSettings: exportSettings });
            },

            updateDocSettings(id, update) {
                update(find(id).session.doc.settings);
                change(id);
            },

            updateExportSettings(id, update) {
                update(find(id).session.doc.exportSettings);
                change(id);
            },

            setView(id, view) {
                change(id, { view: { ...find(id).view, ...view }, viewSet: true });
            },

            setReferenceSource(id, sourceId, bytes) {
                change(id, {
                    referenceSources: new Map(find(id).referenceSources).set(sourceId, bytes),
                });
            },

            deleteReferenceSource(id, sourceId) {
                const sources = new Map(find(id).referenceSources);
                if (sources.delete(sourceId)) change(id, { referenceSources: sources });
            },

            touch(id) {
                find(id);
                change(id);
            },

            setViewPolicy(next) {
                policy = next;
                return () => {
                    if (policy === next) policy = null;
                };
            },
        };
    });
}

/** The open documents of the app. */
export const sessionsStore = createSessionsStore();

export function useSessions<Slice>(selector: (state: SessionsState) => Slice): Slice {
    return useStore(sessionsStore, selector);
}

/** The active document; the component renders again on every change to it. */
export function useActiveDocument(): OpenDocument | null {
    return useSessions(activeDocument);
}
