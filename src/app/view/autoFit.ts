import type { StoreApi } from "zustand/vanilla";
import { sessionsStore } from "../state/sessions";
import type { SessionsState } from "../state/sessions";
import { fitView } from "./navigate";
import { viewportSize } from "./viewportSize";
import type { ViewportSize } from "./viewportSize";

// New and opened documents start fitted and centred (SPEC §6.4, SE-012).
//
// The fit applies to a document whose view was never set (`OpenDocument.viewSet`), and to
// that document once: a view given when the document was opened, or set through the store
// before the fit, is kept, and so is every view afterwards — a resize does not fit again.
//
// The fit needs the size of the viewport. While that is known (`viewportSize`), a document is
// fitted in the task that opens it. While it is not — the shell is not laid out yet, or is
// hidden — the fit waits for the first size that is reported.

export interface AutoFitSources {
    sessions: StoreApi<SessionsState>;
    viewport: ViewportSize;
}

/**
 * Fits every open document whose view was never set as soon as the viewport's size is known,
 * and every document opened after that at once. Returns the function that stops it.
 */
export function connectAutoFit(
    sources: AutoFitSources = { sessions: sessionsStore, viewport: viewportSize },
): () => void {
    const { sessions, viewport } = sources;
    /** Setting a view tells the subscribers below, this one among them. */
    let fitting = false;

    const fit = () => {
        if (fitting) return;
        const size = viewport.size;
        if (size.width <= 0 || size.height <= 0) return;
        fitting = true;
        try {
            for (;;) {
                const state = sessions.getState();
                const pending = state.documents.find((document) => !document.viewSet);
                if (!pending) break;
                const { width, height } = pending.session.doc;
                state.setView(pending.id, fitView({ width, height }, size));
            }
        } finally {
            fitting = false;
        }
    };

    fit();
    const stopSessions = sessions.subscribe(fit);
    const stopViewport = viewport.subscribe(fit);
    return () => {
        stopSessions();
        stopViewport();
    };
}
