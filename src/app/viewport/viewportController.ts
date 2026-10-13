import type { StoreApi } from "zustand/vanilla";
import { CompositeCache } from "../../core/composite";
import { frameIndex } from "../../core/model";
import type { DocSession } from "../../core/model";
import { frameKey, parseFrameKey } from "../../engine/viewport/types";
import type { ViewportPort } from "../../engine/viewport/types";
import { preferences as appPreferences } from "../preferences/preferences";
import type { PreferenceStore } from "../preferences/preferences";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState, ViewState } from "../state/sessions";

// The wiring of SE-011 between the stores and the viewport: which document and frame it
// shows, with which view and checkerboard, and when the pixels behind a frame changed.
//
//   history change (touched) → composite cache invalidated → viewport told which frame keys
//   are out of date → it uploads the current one again and draws.
//
// Nothing here touches the DOM or NGNE: the viewport is the `ViewportPort` it is given.

/** The colours the theme supplies, as 0xRRGGBB (DESIGN §3.1). */
export interface ViewportTheme {
    /** The two checkerboard colours, used while the preference says "theme". */
    checkerA: number;
    checkerB: number;
    /** The workspace colour around the document. */
    workspace: number;
}

/** The dark theme of DESIGN §3.1, until the interface reports the theme in use. */
export const DEFAULT_VIEWPORT_THEME: ViewportTheme = {
    checkerA: 0x3a3a3a,
    checkerB: 0x4a4a4a,
    workspace: 0x0f0f10,
};

export interface ViewportSources {
    sessions: StoreApi<SessionsState>;
    preferences: PreferenceStore;
}

export interface ViewportConnection {
    /** The interface's theme changed. */
    setTheme(theme: ViewportTheme): void;
    /**
     * The composite cache of the active document, which the viewport reads its frames from;
     * null while no document is open. It belongs to the active document only (SPEC §5.3).
     */
    readonly composites: CompositeCache | null;
    /** Stops following the stores. The viewport itself is not disposed. */
    dispose(): void;
}

interface Attached {
    session: DocSession;
    cache: CompositeCache;
    /** Stops the history subscription. */
    stop(): void;
}

/**
 * Keeps `viewport` in step with the stores: the active session and its active frame and view,
 * every step of the active document's history, and the checkerboard preference.
 */
export function connectViewport(
    viewport: ViewportPort,
    sources: ViewportSources = { sessions: sessionsStore, preferences: appPreferences },
): ViewportConnection {
    const { sessions, preferences } = sources;
    let theme = DEFAULT_VIEWPORT_THEME;
    let attached: Attached | null = null;
    let frameId: string | null = null;
    let view: ViewState | null = null;

    const pushChecker = () => {
        const { colors, size } = preferences.get("checkerboard");
        viewport.setChecker(
            colors === "theme"
                ? { a: theme.checkerA, b: theme.checkerB, size }
                : { a: colors.a, b: colors.b, size },
        );
    };

    const attach = (document: OpenDocument | null) => {
        attached?.stop();
        attached = null;
        frameId = null;
        view = null;
        if (!document) {
            viewport.setDocument(null);
            viewport.setCurrent(null);
            return;
        }
        const { session, history } = document;
        const { doc } = session;
        // A cache per active document: one that stops being active loses its composites.
        const cache = new CompositeCache(doc);
        const stop = history.subscribe(({ touched }) => {
            cache.invalidate(touched);
            viewport.invalidate(
                touched.structure ? "all" : touched.frameIds.map((id) => frameKey(id)),
            );
        });
        attached = { session, cache, stop };
        viewport.setDocument({
            get width() {
                return doc.width;
            },
            get height() {
                return doc.height;
            },
            pixels(key) {
                const { frameId: id, variant } = parseFrameKey(key);
                if (variant !== "plain" || frameIndex(doc, id) === -1) return null;
                return cache.get(id);
            },
        });
    };

    const follow = () => {
        const document = activeDocument(sessions.getState());
        // The session object, not the id: the same file opened again is another session.
        if ((document?.session ?? null) !== (attached?.session ?? null)) attach(document);
        if (!document) return;
        const active = document.session.activeFrameId;
        if (active !== frameId) {
            frameId = active;
            viewport.setCurrent(frameKey(active));
        }
        if (document.view !== view) {
            view = document.view;
            viewport.setView(view);
        }
    };

    viewport.setBackground(theme.workspace);
    pushChecker();
    follow();
    const stopSessions = sessions.subscribe(follow);
    const stopPreferences = preferences.subscribe((key) => {
        if (key === "checkerboard") pushChecker();
    });

    return {
        setTheme(next) {
            theme = { ...next };
            viewport.setBackground(theme.workspace);
            pushChecker();
        },
        get composites() {
            return attached?.cache ?? null;
        },
        dispose() {
            stopSessions();
            stopPreferences();
            attached?.stop();
            attached = null;
        },
    };
}
