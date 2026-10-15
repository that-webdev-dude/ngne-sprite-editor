import type { StoreApi } from "zustand/vanilla";
import { frameIndex } from "../../core/model";
import type { DocSession } from "../../core/model";
import { frameKey, parseFrameKey } from "../../engine/viewport/types";
import type { ViewportPort } from "../../engine/viewport/types";
import { preferences as appPreferences } from "../preferences/preferences";
import type { PreferenceStore } from "../preferences/preferences";
import { activeComposites } from "../state/composites";
import type { ActiveComposites } from "../state/composites";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument, SessionsState, ViewState } from "../state/sessions";
import { viewportLink } from "./viewportLink";

// The wiring of SE-011 between the stores and the viewport: which document and frame it
// shows, with which view and checkerboard, and when the pixels behind a frame changed.
//
//   history change (touched) → composite cache invalidated (app/state/composites) → viewport
//   told which frame keys are out of date → it uploads the current one again and draws.
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
    /** The composite cache of the active document of `sessions`. */
    composites: ActiveComposites;
    /**
     * The version given the pixels of each upload (`ViewportLink.version`, SE-015); none
     * when absent.
     */
    version?(): number;
}

export interface ViewportConnection {
    /** The interface's theme changed. */
    setTheme(theme: ViewportTheme): void;
    /** Stops following the stores. The viewport itself is not disposed. */
    dispose(): void;
}

/**
 * Keeps `viewport` in step with the stores: the active session and its active frame and view,
 * every change to the active document's composites, and the checkerboard preference. The
 * frames it shows are read from `sources.composites`, the cache every other reader uses.
 */
export function connectViewport(
    viewport: ViewportPort,
    sources: ViewportSources = {
        sessions: sessionsStore,
        preferences: appPreferences,
        composites: activeComposites,
        version: () => viewportLink.version,
    },
): ViewportConnection {
    const { sessions, preferences, composites } = sources;
    const version = sources.version;
    let theme = DEFAULT_VIEWPORT_THEME;
    /** The session whose document the viewport shows. */
    let shown: DocSession | null = null;
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

    const show = (document: OpenDocument | null) => {
        shown = document?.session ?? null;
        // `setDocument` forgets the frame key as well: the new document's follows below.
        frameId = null;
        view = null;
        if (!document) {
            viewport.setDocument(null);
            return;
        }
        const { session } = document;
        const { doc } = session;
        viewport.setDocument({
            get width() {
                return doc.width;
            },
            get height() {
                return doc.height;
            },
            pixels(key) {
                const { frameId: id, variant } = parseFrameKey(key);
                // Null once the document is no longer the active one: it has no composites.
                const cache = composites.cacheOf(session);
                if (!cache || variant !== "plain" || frameIndex(doc, id) === -1) return null;
                return cache.get(id);
            },
            ...(version && { version: () => version() }),
        });
    };

    const follow = () => {
        const document = activeDocument(sessions.getState());
        // The session object, not the id: the same file opened again is another session.
        if ((document?.session ?? null) !== shown) show(document);
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
    // The cache has dropped what a history step (or a write reported to it) touched.
    const stopComposites = composites.subscribe((touched, session) => {
        if (session !== shown) return;
        viewport.invalidate(touched.structure ? "all" : touched.frameIds.map((id) => frameKey(id)));
    });

    return {
        setTheme(next) {
            theme = { ...next };
            viewport.setBackground(theme.workspace);
            pushChecker();
        },
        dispose() {
            stopSessions();
            stopPreferences();
            stopComposites();
            shown = null;
        },
    };
}
