import type { StoreApi } from "zustand/vanilla";
import { sessionsStore } from "../state/sessions";
import type { SessionsState, ViewPolicy } from "../state/sessions";
import { clampView, fitView } from "./navigate";
import type { Size } from "./navigate";
import { viewportSize } from "./viewportSize";
import type { ViewportSize } from "./viewportSize";

// The views a document gets without the user navigating (SPEC §6.4, SE-012).
//
// Fit. New and opened documents start fitted and centred. The fit applies to a document whose
// view was never set (`OpenDocument.viewSet`), and to that document once: a view given when
// the document was opened, or set through the store before the fit, is kept, and no view is
// ever fitted again.
//
// Pan limit. At least 32 device pixels of the active document stay visible (`clampView`). The
// user cannot pan past that; the viewport can get there by changing its size, and a document
// can come back as the active one with a view that was set under a larger viewport. So the
// limit is applied again when the viewport's size changes and when a document becomes the
// active one. The view is moved, never fitted, and only when the limit asks for it.
//
// Both need the size of the viewport (`viewportSize`). While it is known, a document gets its
// view in the task that opens or activates it: the session store applies the policy itself,
// so the document is stored once and its subscribers are told once. While it is not — the
// shell is not laid out yet, or is hidden — both wait for the first size that is reported.

export interface ViewPolicySources {
    sessions: StoreApi<SessionsState>;
    viewport: ViewportSize;
}

/**
 * Gives `sources.sessions` its view policy and follows the viewport's size: every document
 * whose view was never set is fitted as soon as the size is known, and the active document's
 * view is kept inside the pan limits when the size changes. Returns the function that stops
 * both.
 */
export function connectViewPolicy(
    sources: ViewPolicySources = { sessions: sessionsStore, viewport: viewportSize },
): () => void {
    const { sessions, viewport } = sources;
    /** The viewport's size, or null while there is none to fit into. */
    const sized = (): Size | null => {
        const size = viewport.size;
        return size.width > 0 && size.height > 0 ? size : null;
    };

    const policy: ViewPolicy = {
        first(doc) {
            const size = sized();
            return size ? fitView(doc, size) : null;
        },
        arrive(view, doc) {
            const size = sized();
            return size ? clampView(view, doc, size) : view;
        },
    };

    /** A size was reported; this runs in a task of its own (`ViewportSize.subscribe`). */
    const resized = () => {
        const size = sized();
        if (!size) return;
        const state = sessions.getState();
        for (const document of state.documents) {
            const { width, height } = document.session.doc;
            if (!document.viewSet) {
                state.setView(document.id, fitView({ width, height }, size));
            } else if (document.id === state.activeId) {
                const view = clampView(document.view, { width, height }, size);
                if (view !== document.view) state.setView(document.id, view);
            }
        }
    };

    const removePolicy = sessions.getState().setViewPolicy(policy);
    // What is open already: opened before there was a policy or a size.
    resized();
    const stopViewport = viewport.subscribe(resized);
    return () => {
        stopViewport();
        removePolicy();
    };
}
