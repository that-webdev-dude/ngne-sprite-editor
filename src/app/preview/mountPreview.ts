import { NgnePreview } from "../../engine/NgnePreview";
import type { PreviewProbe, PreviewScheduler } from "../../engine/NgnePreview";
import type {} from "../../import-meta";
import { activeComposites } from "../state/composites";
import { activeDocument, sessionsStore } from "../state/sessions";
import { connectPreview } from "./previewController";
import type { PageVisibility } from "./previewController";
import { previewDisplay } from "./previewDisplay";
import { createWorkerPacker } from "./previewPacker";
import { previewState } from "./previewState";

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The preview panel's game while the panel is mounted (SE-054). */
        preview?: PreviewProbe;
        /** The preview panel's choices and status (SE-054). */
        previewState?: typeof previewState;
        /** When set, a preview game made from now on runs its frames on this scheduler. */
        previewScheduler?: PreviewScheduler;
    }
}

/** Diagnostics the panel lists at most; older ones give way. */
const SHOWN_DIAGNOSTICS = 5;

/** The page's visibility: the preview stops while the tab is hidden. */
const pageVisibility: PageVisibility = {
    visible: () => document.visibilityState === "visible",
    subscribe(listener) {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
    },
};

export interface MountedPreview {
    dispose(): void;
}

/**
 * Creates the preview's game inside `host` and connects it to the stores (SE-054). `stage` is
 * the element whose size the canvas is fitted to; `host` lies inside it and is left to the
 * game. The game runs while this is mounted, a document is open and the tab is visible; the
 * panel mounts it only while its section is expanded, so a collapse disposes it. In
 * development builds the game's probe and the panel's state are put on `window.__ngneTest`.
 */
export function mountPreview(stage: HTMLElement, host: HTMLElement): MountedPreview {
    const hooks = import.meta.env.DEV ? window.__ngneTest : undefined;
    previewState.setState({ diagnostics: [] });
    const preview = new NgnePreview(host, {
        onDiagnostic: (message) =>
            previewState.setState((state) => ({
                diagnostics: [...state.diagnostics, message].slice(-SHOWN_DIAGNOSTICS),
            })),
        scheduler: () => hooks?.previewScheduler,
    });
    const connection = connectPreview(preview, {
        sessions: sessionsStore,
        composites: activeComposites,
        state: previewState,
        packer: createWorkerPacker(),
        visibility: pageVisibility,
    });

    // The canvas is as large as fits the stage, a whole number of device pixels per texel.
    let stageSize = { width: 0, height: 0 };
    const fit = () => {
        const doc = activeDocument(sessionsStore.getState())?.session.doc;
        if (!doc) return;
        const display = previewDisplay(doc, stageSize, window.devicePixelRatio);
        preview.setDisplaySize(display);
    };
    const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const box = entry.devicePixelContentBoxSize?.[0];
        stageSize = box
            ? { width: box.inlineSize, height: box.blockSize }
            : {
                  width: Math.round(entry.contentRect.width * window.devicePixelRatio),
                  height: Math.round(entry.contentRect.height * window.devicePixelRatio),
              };
        fit();
    });
    try {
        observer.observe(stage, { box: "device-pixel-content-box" });
    } catch {
        observer.observe(stage);
    }
    const stopSessions = sessionsStore.subscribe(fit);
    fit();

    if (hooks) {
        hooks.preview = preview.probe;
        hooks.previewState = previewState;
    }

    return {
        dispose() {
            if (hooks?.preview === preview.probe) delete hooks.preview;
            observer.disconnect();
            stopSessions();
            connection.dispose();
            void preview.dispose();
        },
    };
}
