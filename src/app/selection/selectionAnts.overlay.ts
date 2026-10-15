import type { StoreApi } from "zustand/vanilla";
import type { BitMask, Selection } from "../../core/model";
import { selectionBoundary } from "../../core/selection";
import type { SelectionBoundary } from "../../core/selection";
import type { DeviceRect } from "../../engine/viewport/geometry";
import type {} from "../../import-meta";
import { axesOf } from "../overlay/gridLines";
import type { OverlayLayer } from "../overlay/types";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { SessionsState } from "../state/sessions";
import { ANTS_PERIOD, dashShift, dashTile, paintRing, ringArea } from "./antsGeometry";

// The marching ants (DESIGN §6, SE-030): the active document's selection drawn on the
// overlay as a 1 device pixel ring of black and white dashes just outside the selected
// texels (`antsGeometry.ts`). They march 8 steps per second: a timer moves the dashes one
// pixel and asks for a redraw. The timer exists only while the active document has a
// selection and motion is allowed; under `prefers-reduced-motion: reduce` the dashes stand
// still. With no selection nothing is drawn and nothing asks for a redraw, so an idle editor
// still redraws nothing (SE-013).
//
// What a redraw costs does not depend on the selection: the ring is painted once, for a
// selection, a view and a canvas size, onto a surface of its own that covers the bounding
// rectangle of the ring's pixels on the canvas (never more than the canvas; none when no
// pixel of the ring is on it). At a new phase the surface is
// recoloured in one fill: a repeated 4 × 4 tile of the dashes, composited `source-atop`, so it
// lands on the ring's pixels only. Each redraw then puts the surface on the overlay in one
// `drawImage`. The boundary of the selection is kept for one mask only.

/** Order in the overlay's stack: over the grids (100 to 300), under the brush cursor (900). */
export const SELECTION_ANTS_ORDER = 500;
/** DESIGN §6: 8 steps per second. */
export const ANTS_STEP_MS = 125;
/** The two colours of the dashes (0xRRGGBB). */
export const ANTS_DARK = 0x000000;
export const ANTS_LIGHT = 0xffffff;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether motion is allowed, and its changes. */
export interface MotionSource {
    allowed(): boolean;
    /** Calls `listener` when the answer may have changed; returns the function that stops it. */
    subscribe(listener: () => void): () => void;
}

/** The 2D calls the ants make on a surface of their own. */
export type AntsSurfaceContext = Pick<
    OffscreenCanvasRenderingContext2D,
    | "createImageData"
    | "putImageData"
    | "createPattern"
    | "save"
    | "restore"
    | "translate"
    | "fillRect"
    | "globalCompositeOperation"
    | "fillStyle"
    | "imageSmoothingEnabled"
>;

/** A surface of `width` × `height` pixels, transparent when made: an OffscreenCanvas in the app. */
export interface AntsSurface {
    readonly width: number;
    readonly height: number;
    /** What `drawImage` and `createPattern` take. */
    readonly image: CanvasImageSource;
    readonly context: AntsSurfaceContext;
}

export interface SelectionAntsSources {
    sessions: StoreApi<SessionsState>;
    motion: MotionSource;
    /** Calls `tick` every `ms` milliseconds until the returned function is called. */
    every(tick: () => void, ms: number): () => void;
    /** Makes a surface; called when the ring's area changes size, and once for the tile. */
    surface(width: number, height: number): AntsSurface;
}

/** What tests read of the ants (development builds). */
export interface SelectionAntsProbe {
    /** The dash phase now, 0 to 3. */
    readonly phase: number;
    /** Steps the ants have marched since the layer was made. */
    readonly steps: number;
    /** True while the timer runs. */
    readonly animating: boolean;
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

/** The ring as painted for one mask, view and canvas size. */
interface PaintedRing {
    readonly mask: BitMask;
    /** The view and the canvas size it was painted for. */
    readonly key: string;
    /** Where the surface lies on the canvas; null when the ring is off the canvas. */
    readonly area: DeviceRect | null;
    readonly surface: AntsSurface | null;
    readonly pixels: ImageData | null;
    /** The phase the surface is coloured for; -1 before its first colouring. */
    shown: number;
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

    /** The boundary of one mask, the selection's: the history's older masks keep none. */
    let boundary: { mask: BitMask; value: SelectionBoundary } | null = null;
    let ring: PaintedRing | null = null;
    /** The 4 × 4 tile of the dashes, and the pattern of it for the ring's surface. */
    let tile: AntsSurface | null = null;
    let pattern: CanvasPattern | null = null;

    const boundaryOf = (mask: BitMask): SelectionBoundary => {
        if (boundary?.mask !== mask) boundary = { mask, value: selectionBoundary(mask) };
        return boundary.value;
    };

    /** Lets go of what was kept for a selection. */
    const release = () => {
        boundary = null;
        ring = null;
        pattern = null;
    };

    const patternFor = (surface: AntsSurface): CanvasPattern => {
        if (!tile) {
            tile = sources.surface(ANTS_PERIOD, ANTS_PERIOD);
            const pixels = tile.context.createImageData(ANTS_PERIOD, ANTS_PERIOD);
            pixels.data.set(dashTile(ANTS_DARK, ANTS_LIGHT));
            tile.context.putImageData(pixels, 0, 0);
        }
        if (!pattern) {
            pattern = surface.context.createPattern(tile.image, "repeat");
            if (!pattern) throw new Error("The marching ants' pattern could not be made.");
        }
        return pattern;
    };

    /** Paints the ring of `selection` for this view and canvas size. */
    const paint = (
        selection: Selection,
        key: string,
        axes: Parameters<typeof paintRing>[1],
        size: { width: number; height: number },
    ): PaintedRing => {
        const boundary = boundaryOf(selection.mask);
        const area = ringArea(boundary, axes, size);
        if (!area) {
            return {
                mask: selection.mask,
                key,
                area: null,
                surface: null,
                pixels: null,
                shown: -1,
            };
        }
        let surface = ring?.surface ?? null;
        let pixels = ring?.pixels ?? null;
        if (!surface || !pixels || surface.width !== area.width || surface.height !== area.height) {
            surface = sources.surface(area.width, area.height);
            pixels = surface.context.createImageData(area.width, area.height);
            pattern = null;
        } else {
            pixels.data.fill(0);
        }
        paintRing(boundary, axes, size, area, pixels.data);
        surface.context.putImageData(pixels, 0, 0);
        return { mask: selection.mask, key, area, surface, pixels, shown: -1 };
    };

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
            const { rect } = mapping;
            const key = `${rect.x},${rect.y},${rect.width},${rect.height}|${size.width}x${size.height}`;
            if (ring?.mask !== selection.mask || ring.key !== key) {
                ring = paint(selection, key, axesOf(rect, doc, size), size);
            }
            const { area, surface } = ring;
            if (!area || !surface) return;
            if (ring.shown !== phase) {
                // The dashes of this phase, on the ring's pixels only.
                const target = surface.context;
                const shift = dashShift(phase, area.x, area.y);
                target.save();
                target.globalCompositeOperation = "source-atop";
                target.imageSmoothingEnabled = false;
                target.fillStyle = patternFor(surface);
                target.translate(shift, 0);
                target.fillRect(-shift, 0, area.width, area.height);
                target.restore();
                ring.shown = phase;
            }
            context.imageSmoothingEnabled = false;
            context.drawImage(surface.image, area.x, area.y);
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
