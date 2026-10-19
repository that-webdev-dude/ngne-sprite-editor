import type { StoreApi } from "zustand/vanilla";
import { frameIndex } from "../../core/model";
import type { DocSession } from "../../core/model";
import { tintOnion } from "../../core/onion";
import { frameKey, parseFrameKey } from "../../engine/viewport/types";
import type { ViewportChecker, ViewportPort, ViewportReference } from "../../engine/viewport/types";
import { viewportGhosts } from "../onion/onion";
import { playbackStore } from "../playback/playbackState";
import type { PlaybackState } from "../playback/playbackState";
import { preferences as appPreferences } from "../preferences/preferences";
import { referenceImages as appReferenceImages } from "../references/referenceImages";
import type { ReferenceImages } from "../references/referenceImages";
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
    /**
     * Told each checkerboard the viewport is told, after it (SE-015: the stroke echo draws
     * over the same one, through `ViewportLink.checker`); none when absent.
     */
    checker?(checker: ViewportChecker): void;
    /**
     * Editor playback (SE-024): while it plays the shown session, the viewport is told the
     * playing range (`ViewportPort.setPlayback`); none when absent.
     */
    playback?: StoreApi<PlaybackState>;
    /**
     * The decoded reference images (SE-045): the visible reference layers of the shown
     * document whose source is decoded are drawn (`ViewportPort.setReferences`); none when
     * absent.
     */
    referenceImages?: ReferenceImages;
}

/** The sources of the app's viewport: its stores, its composite cache and `viewportLink`. */
export function appViewportSources(): ViewportSources {
    return {
        sessions: sessionsStore,
        preferences: appPreferences,
        composites: activeComposites,
        version: () => viewportLink.version,
        playback: playbackStore,
        referenceImages: appReferenceImages,
    };
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
    sources: ViewportSources = appViewportSources(),
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
        const checker: ViewportChecker =
            colors === "theme"
                ? { a: theme.checkerA, b: theme.checkerB, size }
                : { a: colors.a, b: colors.b, size };
        viewport.setChecker(checker);
        sources.checker?.(checker);
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
                if (!cache || frameIndex(doc, id) === -1) return null;
                if (variant === "plain") return cache.get(id);
                // An onion skin with tint on (SE-025): a tinted copy, made on the CPU.
                if (variant === "before" || variant === "after") {
                    return tintOnion(cache.get(id), variant);
                }
                return null;
            },
            ...(version && { version: () => version() }),
        });
    };

    /** The frames the viewport was told are playing (one array per playback); null for none. */
    let playing: readonly string[] | null = null;
    const followPlayback = () => {
        const state = sources.playback?.getState();
        const frames = state?.playing && shown && state.session === shown ? state.frameIds : null;
        if (frames === playing) return;
        playing = frames;
        viewport.setPlayback?.(frames ? frames.map((id) => frameKey(id)) : null);
    };

    /**
     * The visible reference layers of the shown document with a decoded source, bottom to
     * top (SE-045). The viewport compares them with what it has, so an unchanged list costs a
     * comparison.
     */
    const images = sources.referenceImages;
    const pushReferences = () => {
        if (!images || !viewport.setReferences) return;
        const document = activeDocument(sessions.getState());
        const references: ViewportReference[] = [];
        if (document && document.session === shown) {
            for (const layer of document.session.doc.layers) {
                // Opacity 0 shows nothing: like a hidden layer, it takes no slot or texels.
                if (layer.kind !== "reference" || !layer.visible || layer.opacity === 0) {
                    continue;
                }
                const bytes = document.referenceSources.get(layer.sourceId);
                const image = bytes ? images.get(bytes) : null;
                if (!image) continue;
                const { id, x, y, scale, opacity, placement } = layer;
                references.push({ id, image, x, y, scale, opacity, placement });
            }
        }
        viewport.setReferences(references);
    };

    /**
     * The onion skins around the shown document's active frame (SE-025), told after its frame
     * key. The viewport compares them with what it has and hides them while playing.
     */
    const pushOnion = () => {
        if (!viewport.setOnion) return;
        viewport.setOnion(shown ? viewportGhosts(shown) : []);
    };

    const follow = () => {
        const document = activeDocument(sessions.getState());
        // The session object, not the id: the same file opened again is another session.
        if ((document?.session ?? null) !== shown) {
            show(document);
            followPlayback();
        }
        if (!document) {
            pushReferences();
            pushOnion();
            return;
        }
        const active = document.session.activeFrameId;
        if (active !== frameId) {
            frameId = active;
            viewport.setCurrent(frameKey(active));
        }
        if (document.view !== view) {
            view = document.view;
            viewport.setView(view);
        }
        pushReferences();
        pushOnion();
    };

    viewport.setBackground(theme.workspace);
    pushChecker();
    follow();
    const stopSessions = sessions.subscribe(follow);
    const stopPlayback = sources.playback?.subscribe(followPlayback) ?? (() => {});
    const stopImages = images?.subscribe(pushReferences) ?? (() => {});
    const stopPreferences = preferences.subscribe((key) => {
        if (key === "checkerboard") pushChecker();
    });
    // The cache has dropped what a history step (or a write reported to it) touched.
    // A frame's plain key stands for its tinted variants too (`ViewportPort.invalidate`).
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
            stopPlayback();
            stopImages();
            stopPreferences();
            stopComposites();
            shown = null;
        },
    };
}
