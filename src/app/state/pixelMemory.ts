import type { StoreApi } from "zustand/vanilla";
import { PIXEL_MEMORY_WARNING_BYTES, pixelMemoryBytes } from "../../core/model";
import { sessionsStore } from "./sessions";
import type { OpenDocument, SessionsState } from "./sessions";

// The warning of SPEC §5.1: a document whose pixel memory passes 512 MB is reported once, so
// the user knows before the 1 GB limit refuses an operation. The interface decides how to show
// it (a toast); this module decides when.

export interface PixelMemoryWatch {
    /** The store whose documents are watched; the default is the app's. */
    sessions?: StoreApi<SessionsState>;
    /** The bytes a document must pass; the default is `PIXEL_MEMORY_WARNING_BYTES`. */
    thresholdBytes?: number;
    /** Shows the warning for a document, with its pixel memory in bytes. */
    warn(document: OpenDocument, bytes: number): void;
}

/**
 * Calls `warn` the first time each open document's pixel memory is above the threshold: once
 * per document while it is open, whatever it does afterwards. Documents that are above it when
 * the watch starts are warned about at once. Returns the function that stops the watch.
 */
export function watchPixelMemory(watch: PixelMemoryWatch): () => void {
    const sessions = watch.sessions ?? sessionsStore;
    const threshold = watch.thresholdBytes ?? PIXEL_MEMORY_WARNING_BYTES;
    /** The last revision looked at, by document; a document warned about is not looked at. */
    const seen = new Map<string, number>();
    const warned = new Set<string>();

    const check = (state: SessionsState) => {
        for (const document of state.documents) {
            if (warned.has(document.id) || seen.get(document.id) === document.revision) continue;
            seen.set(document.id, document.revision);
            const bytes = pixelMemoryBytes(document.session.doc);
            if (bytes <= threshold) continue;
            warned.add(document.id);
            watch.warn(document, bytes);
        }
        // A document closed and opened again is watched again.
        const open = new Set(state.documents.map((document) => document.id));
        for (const id of [...seen.keys()]) if (!open.has(id)) seen.delete(id);
        for (const id of [...warned]) if (!open.has(id)) warned.delete(id);
    };

    check(sessions.getState());
    return sessions.subscribe(check);
}
