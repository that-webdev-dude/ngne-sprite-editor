import type { StoreApi } from "zustand/vanilla";
import { errorMessage } from "../../engine/viewport/diagnostics";
import type { DeviceSize } from "../../engine/viewport/types";
import { activeDocument } from "../state/sessions";
import type { SessionsState } from "../state/sessions";
import type { Point, ViewMapping } from "../view/coordinates";
import { DEFAULT_OVERLAY_THEME } from "./types";
import type { OverlayCursor, OverlayFrame, OverlayLayer, OverlayTheme } from "./types";

// When and how the overlay redraws (SPEC §6.3, SE-013). No DOM here: the canvas, its size
// and the pointer are reported by `mountOverlay`, so the policy is unit-tested in Node.
//
// A redraw clears the canvas and runs every draw layer bottom to top. It happens only when
//
//   - the view changed: the active document, its size or its view (scale, origin);
//   - the cursor moved to another device pixel, or entered or left the viewport;
//   - a layer asked for it (`OverlayLayer.watch`), or the theme changed;
//
// and at most once per animation frame. A change of the canvas's size clears the canvas
// itself, so it is drawn again at once, in the same task. Nothing else draws: an idle editor
// redraws nothing, and a history step that changes pixels only does not reach the overlay.

/** Where the overlay draws. `HTMLCanvasElement` is one; tests pass a recording stand-in. */
export interface OverlayCanvas {
    width: number;
    height: number;
}

export interface OverlaySources {
    sessions: StoreApi<SessionsState>;
    /**
     * The mapping of the active document as it is on screen now, or null while the viewport
     * element is not on the page (`currentViewMapping`). Read at each redraw, never kept.
     */
    mapping(): ViewMapping | null;
    /** Device pixels per CSS pixel now. */
    ratio(): number;
    /** Calls `callback` in the next animation frame; returns the function that cancels it. */
    nextFrame(callback: () => void): () => void;
    /** A layer threw while drawing or watching; once per layer and message. */
    onError?(layer: string, error: unknown): void;
}

export interface OverlayController {
    /** Redraws so far: the counter of the test hook. */
    readonly redraws: number;
    /** True while a redraw is scheduled and has not run. */
    readonly pending: boolean;
    /** The canvas's backing size. */
    readonly size: Readonly<DeviceSize>;
    /** The canvas's element was measured: a new size is set and drawn at once. */
    resize(size: DeviceSize): void;
    /** The pointer moved over the viewport to `client` (CSS pixels), or left it (null). */
    setCursor(client: Point | null): void;
    setTheme(theme: OverlayTheme): void;
    /** Asks for a redraw in the next animation frame. */
    requestRedraw(): void;
    /** Stops following the stores and the layers. The canvas keeps what it shows. */
    dispose(): void;
}

/** What makes the view drawn differ: the document, its size and its view. */
function viewKey(state: SessionsState): string {
    const document = activeDocument(state);
    if (!document) return "";
    const { view, session } = document;
    const { width, height } = session.doc;
    return `${document.id}|${width}x${height}|${view.scale}@${view.originX},${view.originY}`;
}

/** The device pixel a client position lies in, as a key. */
function devicePixelKey(client: Point | null, ratio: number): string {
    if (!client) return "";
    return `${Math.floor(client.x * ratio)},${Math.floor(client.y * ratio)}`;
}

/**
 * The overlay's drawing: `layers` (bottom first) on `context`, which draws on `canvas`,
 * following `sources`. The first redraw is asked for here.
 */
export function createOverlayController(
    canvas: OverlayCanvas,
    context: CanvasRenderingContext2D,
    layers: readonly OverlayLayer[],
    sources: OverlaySources,
): OverlayController {
    const { sessions } = sources;
    let theme: OverlayTheme = { ...DEFAULT_OVERLAY_THEME };
    let cursor: Point | null = null;
    let cursorKey = "";
    let shownView = viewKey(sessions.getState());
    let cancelFrame: (() => void) | null = null;
    let redraws = 0;
    let disposed = false;

    const reported = new Set<string>();
    const report = (layer: OverlayLayer, error: unknown) => {
        const key = `${layer.id}\n${errorMessage(error)}`;
        if (reported.has(key)) return;
        reported.add(key);
        console.error(`Overlay layer "${layer.id}":`, error);
        try {
            sources.onError?.(layer.id, error);
        } catch {
            // Reporting is best effort.
        }
    };

    const cursorFor = (mapping: ViewMapping): OverlayCursor | null =>
        cursor
            ? {
                  client: { ...cursor },
                  device: mapping.clientToDevice(cursor.x, cursor.y),
                  pixel: mapping.clientToDoc(cursor.x, cursor.y),
              }
            : null;

    const draw = () => {
        cancelFrame?.();
        cancelFrame = null;
        redraws++;
        const size = { width: canvas.width, height: canvas.height };
        context.clearRect(0, 0, size.width, size.height);
        if (size.width === 0 || size.height === 0) return;
        const document = activeDocument(sessions.getState());
        const mapping = document ? sources.mapping() : null;
        if (!document || !mapping) return;
        const frame: OverlayFrame = {
            context,
            size,
            document,
            mapping,
            cursor: cursorFor(mapping),
            theme,
        };
        for (const layer of layers) {
            context.save();
            try {
                layer.draw(frame);
            } catch (error) {
                // One layer that fails leaves the others drawn.
                report(layer, error);
            } finally {
                context.restore();
            }
        }
    };

    const requestRedraw = () => {
        if (disposed || cancelFrame) return;
        cancelFrame = sources.nextFrame(() => {
            cancelFrame = null;
            if (!disposed) draw();
        });
    };

    const stopSessions = sessions.subscribe((state) => {
        const next = viewKey(state);
        if (next === shownView) return;
        shownView = next;
        requestRedraw();
    });
    const stopLayers = layers.map((layer) => {
        try {
            return layer.watch?.(requestRedraw) ?? (() => {});
        } catch (error) {
            report(layer, error);
            return () => {};
        }
    });
    requestRedraw();

    return {
        get redraws() {
            return redraws;
        },
        get pending() {
            return cancelFrame !== null;
        },
        get size() {
            return { width: canvas.width, height: canvas.height };
        },
        resize(size) {
            if (disposed || (size.width === canvas.width && size.height === canvas.height)) {
                return;
            }
            // Setting the size clears the canvas: drawn again before the browser paints it.
            canvas.width = size.width;
            canvas.height = size.height;
            draw();
        },
        setCursor(client) {
            cursor = client ? { x: client.x, y: client.y } : null;
            const key = devicePixelKey(cursor, sources.ratio());
            if (key === cursorKey) return;
            cursorKey = key;
            requestRedraw();
        },
        setTheme(next) {
            if (next.outline === theme.outline && next.ink === theme.ink) return;
            theme = { ...next };
            requestRedraw();
        },
        requestRedraw,
        dispose() {
            if (disposed) return;
            disposed = true;
            cancelFrame?.();
            cancelFrame = null;
            stopSessions();
            for (const stop of stopLayers) {
                try {
                    stop();
                } catch {
                    // A layer that cannot stop is gone with the overlay.
                }
            }
        },
    };
}
