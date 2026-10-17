import type { StoreApi } from "zustand/vanilla";
import type { Selection } from "../../core/model";
import type {} from "../../import-meta";
import type { OverlayLayer } from "../overlay/types";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { SessionsState } from "../state/sessions";
import { ANTS_PERIOD } from "./antsGeometry";
import { boundaryOf } from "./boundaryCache";
import { ANTS_DARK, ANTS_LIGHT, createRingPainter } from "./ringPainter";
import type {
    AntsSurface,
    AntsSurfaceContext,
    RingPainter,
    RingWork,
    SurfaceFactory,
} from "./ringPainter";

// The marching ants (DESIGN §6, SE-030): the active document's selection drawn on the
// overlay as a 1 device pixel ring of black and white dashes just outside the selected
// texels (`antsGeometry.ts`). They march 8 steps per second: a timer moves the dashes one
// pixel and asks for a redraw. The timer exists only while the active document has a
// selection and motion is allowed; under `prefers-reduced-motion: reduce` the dashes stand
// still. With no selection nothing is drawn and nothing asks for a redraw, so an idle editor
// still redraws nothing (SE-013).
//
// What a redraw costs does not depend on the selection (`ringPainter.ts`, SE-031): the ring
// is painted once for a selection, a zoom and a canvas size, onto a surface of its own no
// larger than the canvas (none when no pixel of the ring is on it); a pan moves it and paints
// only the strips it uncovered; a new phase recolours it in one fill; each redraw is one
// `drawImage`. The boundary of the selection comes from the boundaries the overlay shares
// (`boundaryCache.ts`), so a magic-wand pick's is worked out once, for its preview.

/** Order in the overlay's stack: over the grids (100 to 300), under the brush cursor (900). */
export const SELECTION_ANTS_ORDER = 500;
/** DESIGN §6: 8 steps per second. */
export const ANTS_STEP_MS = 125;
export { ANTS_DARK, ANTS_LIGHT };
export type { AntsSurface, AntsSurfaceContext };

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether motion is allowed, and its changes. */
export interface MotionSource {
    allowed(): boolean;
    /** Calls `listener` when the answer may have changed; returns the function that stops it. */
    subscribe(listener: () => void): () => void;
}

export interface SelectionAntsSources {
    sessions: StoreApi<SessionsState>;
    motion: MotionSource;
    /** Calls `tick` every `ms` milliseconds until the returned function is called. */
    every(tick: () => void, ms: number): () => void;
    /** Makes a surface; called when the ring's area changes size, and once for the tile. */
    surface: SurfaceFactory;
}

/** What tests read of the ants (development builds). */
export interface SelectionAntsProbe {
    /** The dash phase now, 0 to 3. */
    readonly phase: number;
    /** Steps the ants have marched since the layer was made. */
    readonly steps: number;
    /** True while the timer runs. */
    readonly animating: boolean;
    /** What the last draw did to the ring's pixels: kept, moved by a pan, painted, none (SE-031). */
    readonly ringWork: RingWork;
}

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The marching ants (SE-030). */
        selectionAnts?: SelectionAntsProbe;
    }
}

/** The ants' draw layer and its probe. */
export interface SelectionAntsLayer {
    layer: OverlayLayer;
    probe: SelectionAntsProbe;
}

/** The selection of the active document; null without either. */
function shownSelection(state: SessionsState): Selection | null {
    return activeDocument(state)?.session.selection ?? null;
}

/** The draw layer of the ants on `sources`. The probe goes on the page with the overlay. */
export function createSelectionAntsLayer(sources: SelectionAntsSources): SelectionAntsLayer {
    let phase = 0;
    let steps = 0;
    let stopTimer: (() => void) | null = null;
    const painter: RingPainter = createRingPainter(sources.surface);

    /** Lets go of what was kept for a selection. */
    const release = () => painter.release();

    const probe: SelectionAntsProbe = {
        get phase() {
            return phase;
        },
        get steps() {
            return steps;
        },
        get animating() {
            return stopTimer !== null;
        },
        get ringWork() {
            return painter.last.work;
        },
    };

    const layer: OverlayLayer = {
        id: "selection-ants",
        order: SELECTION_ANTS_ORDER,
        draw({ context, document, mapping, size }) {
            const { selection, doc } = document.session;
            if (!selection) {
                release();
                return;
            }
            const { mask, bounds } = selection;
            painter.draw(
                context,
                { key: mask, bounds, boundary: () => boundaryOf(mask) },
                { rect: mapping.rect, doc, size },
                phase,
            );
        },
        watch(redraw) {
            const { sessions, motion } = sources;
            let shown = shownSelection(sessions.getState());
            // The timer runs while there is a selection and motion is allowed, and only then.
            const sync = () => {
                const wanted = shown !== null && motion.allowed();
                if (wanted && !stopTimer) {
                    stopTimer = sources.every(() => {
                        phase = (phase + 1) % ANTS_PERIOD;
                        steps++;
                        redraw();
                    }, ANTS_STEP_MS);
                } else if (!wanted && stopTimer) {
                    stopTimer();
                    stopTimer = null;
                }
            };
            // A pixel edit, a setting or a view change leaves the selection as it is: no redraw
            // from here (the overlay follows the view itself).
            const stopSessions = sessions.subscribe((state) => {
                const next = shownSelection(state);
                if (next === shown) return;
                shown = next;
                if (!shown) release();
                redraw();
                sync();
            });
            const stopMotion = motion.subscribe(sync);
            sync();
            const hooks =
                import.meta.env.DEV && typeof window !== "undefined"
                    ? window.__ngneTest
                    : undefined;
            if (hooks) hooks.selectionAnts = probe;
            return () => {
                stopSessions();
                stopMotion();
                stopTimer?.();
                stopTimer = null;
                release();
                if (hooks?.selectionAnts === probe) delete hooks.selectionAnts;
            };
        },
    };
    return { layer, probe };
}

/** `prefers-reduced-motion` of the page; motion is allowed where there is no page. */
const pageMotion: MotionSource = {
    allowed: () => typeof matchMedia !== "function" || !matchMedia(REDUCED_MOTION).matches,
    subscribe(listener) {
        if (typeof matchMedia !== "function") return () => {};
        const query = matchMedia(REDUCED_MOTION);
        query.addEventListener("change", listener);
        return () => query.removeEventListener("change", listener);
    },
};

export const overlayLayers: OverlayLayer[] = [
    createSelectionAntsLayer({
        sessions: sessionsStore,
        motion: pageMotion,
        every(tick, ms) {
            const timer = setInterval(tick, ms);
            return () => clearInterval(timer);
        },
        surface(width, height) {
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext("2d");
            if (!context) throw new Error("The marching ants have no 2D context.");
            return { width, height, image: canvas, context };
        },
    }).layer,
];
