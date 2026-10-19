import type { StoreApi } from "zustand/vanilla";
import type { Command } from "../../core/history";
import type { SpriteDoc } from "../../core/model";
import type { SessionsState } from "../state/sessions";
import { referenceImages } from "./referenceImages";
import type { ReferenceImages } from "./referenceImages";

// Who holds the bytes of a reference source (SPEC §7.6, SE-045 review C). The document's store
// (`OpenDocument.referenceSources`) holds exactly the sources some layer of the document names.
// A command that adds or removes reference layers owns the bytes it adds or takes away, in its
// closure: when it is done or undone, the sources the layers name come back into the store from
// it, and those no layer names any more go out of the store into it. Its `bytes` count them, so
// the history's budget sees them, and an entry the history drops lets them go.

/** The sources the reference layers of a document name. */
export function namedSources(doc: Pick<SpriteDoc, "layers">): Set<string> {
    const named = new Set<string>();
    for (const layer of doc.layers) if (layer.kind === "reference") named.add(layer.sourceId);
    return named;
}

/**
 * The bytes of the sources a removal of `layerIds` leaves unnamed: what a delete takes out of
 * the store, by source ID.
 */
export function sourcesFreedBy(
    doc: Pick<SpriteDoc, "layers">,
    layerIds: readonly string[],
    sources: ReadonlyMap<string, Uint8Array>,
): Map<string, Uint8Array> {
    const removed = new Set(layerIds);
    const staying = namedSources({ layers: doc.layers.filter((layer) => !removed.has(layer.id)) });
    const freed = new Map<string, Uint8Array>();
    for (const layer of doc.layers) {
        if (layer.kind !== "reference" || !removed.has(layer.id)) continue;
        const bytes = sources.get(layer.sourceId);
        if (bytes && !staying.has(layer.sourceId)) freed.set(layer.sourceId, bytes);
    }
    return freed;
}

export interface SourceOwnership {
    /** The store of the document's record. */
    sessions: StoreApi<SessionsState>;
    documentId: string;
    /**
     * The sources the command adds or takes away, which it owns from now on: counted in its
     * `bytes`.
     */
    owned: ReadonlyMap<string, Uint8Array>;
    /** Where decoded images are kept; a source taken out of the store loses its image. */
    images?: ReferenceImages;
}

/**
 * `command` with the reference sources it adds or removes held by it: after its `do` and its
 * `undo`, the store of `documentId` holds the sources the document's layers name, taken from
 * the command where the store lacks them, and gives up the others to the command (their decoded
 * images are dropped: a redo decodes again before the reference is drawn).
 */
export function withReferenceSources(command: Command, ownership: SourceOwnership): Command {
    const { sessions, documentId, images = referenceImages } = ownership;
    const held = new Map(ownership.owned);
    const sourceBytes = [...held.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
    const reconcile = (doc: SpriteDoc) => {
        const record = sessions.getState().documents.find((entry) => entry.id === documentId);
        if (!record) return;
        const named = namedSources(doc);
        for (const sourceId of named) {
            const bytes = held.get(sourceId);
            if (bytes && !record.referenceSources.has(sourceId)) {
                sessions.getState().setReferenceSource(documentId, sourceId, bytes);
            }
        }
        for (const [sourceId, bytes] of record.referenceSources) {
            if (named.has(sourceId)) continue;
            held.set(sourceId, bytes);
            sessions.getState().deleteReferenceSource(documentId, sourceId);
            images.forget(bytes);
        }
    };
    return {
        label: command.label,
        bytes: command.bytes + sourceBytes,
        touched: command.touched,
        do(session) {
            command.do(session);
            reconcile(session.doc);
        },
        undo(session) {
            command.undo(session);
            reconcile(session.doc);
        },
    };
}
