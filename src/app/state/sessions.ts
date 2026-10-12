import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { History } from "../../core/history";
import type { HistoryOptions } from "../../core/history";
import type { DocSession, DocSettings, ExportSettings } from "../../core/model";

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
    /** Original bytes of the reference images, by `ReferenceLayer.sourceId`. */
    readonly referenceSources: ReadonlyMap<string, Uint8Array>;
    /** `history.position` at the last save, or when the document was opened. */
    readonly savedPosition: number;
    /** `ExportSettings` at the last save, as JSON. */
    readonly savedExportSettings: string;
    /** Increases with every change of this document. */
    readonly revision: number;
}

export interface OpenOptions {
    /** Make the document the active one; the default is true. */
    activate?: boolean;
    view?: Partial<ViewState>;
    /** Reference source bytes read from the project file (SE-041). */
    referenceSources?: Iterable<readonly [string, Uint8Array]>;
    history?: HistoryOptions;
}

export interface SessionsState {
    /** Open documents, in the order they were opened. */
    documents: readonly OpenDocument[];
    /** Id of the active document, or null when none is open. */
    activeId: string | null;

    /** Opens a session with a new history. Throws when a document with its id is open. */
    open(session: DocSession, options?: OpenOptions): OpenDocument;
    /** Closes the active document, if any, and opens `session` in its place. */
    replaceActive(session: DocSession, options?: OpenOptions): OpenDocument;
    /** Closes a document; when it was active, its neighbour becomes active. */
    close(id: string): void;
    activate(id: string): void;
    /** Records the current state as saved: the document is no longer dirty. */
    markSaved(id: string): void;
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
}

function snapshot(settings: ExportSettings): string {
    return JSON.stringify(settings);
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
                }),
            );
            return {
                id,
                session,
                history,
                view: { ...DEFAULT_VIEW, ...options.view },
                referenceSources: new Map(options.referenceSources),
                savedPosition: history.position,
                savedExportSettings: snapshot(session.doc.exportSettings),
                revision: 0,
            };
        };
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
                const document = create(session, options);
                set({
                    documents: [...documents, document],
                    activeId: options.activate === false ? activeId : document.id,
                });
                return document;
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
                const document = create(session, options);
                set({
                    documents: [...rest.slice(0, index), document, ...rest.slice(index)],
                    activeId: document.id,
                });
                return document;
            },

            close(id) {
                const { documents, activeId } = get();
                const index = documents.findIndex((entry) => entry.id === id);
                if (index === -1) return;
                forget(id);
                const rest = documents.filter((entry) => entry.id !== id);
                set({
                    documents: rest,
                    activeId:
                        activeId === id
                            ? (rest[index]?.id ?? rest[index - 1]?.id ?? null)
                            : activeId,
                });
            },

            activate(id) {
                set({ activeId: find(id).id });
            },

            markSaved(id) {
                const { history, session } = find(id);
                change(id, {
                    savedPosition: history.position,
                    savedExportSettings: snapshot(session.doc.exportSettings),
                });
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
                change(id, { view: { ...find(id).view, ...view } });
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
