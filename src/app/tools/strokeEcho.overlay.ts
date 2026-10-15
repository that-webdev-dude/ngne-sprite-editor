import type { PixelBuffer, Rect } from "../../core/model";
import type { ViewportChecker } from "../../engine/viewport/types";
import type {} from "../../import-meta";
import type { OverlayLayer } from "../overlay/types";
import { viewportLink } from "../viewport/viewportLink";
import { strokeEcho } from "./strokeEcho";
import type { StrokeEcho } from "./strokeEcho";

// The overlay stroke echo (SPEC §6.6, SE-015), drawn: the regions of the stroke not yet on
// screen through NGNE (`strokeEcho.ts`), from the stroke's live composite, as NGNE will show
// them — each document pixel over the checkerboard, opaque, scaled nearest-neighbour to the
// view the overlay draws with. The lowest layer of the overlay: under the document outline,
// the grids and the brush cursor. Nothing is drawn, and nothing asks for a redraw, while no
// stroke is echoed. Nothing is drawn either while NGNE shows another frame than the stroke's,
// or below 1×, where NGNE's nearest minification picks which texel a device pixel shows
// (SPEC §6.4) and the echo could not show the same one; a stroke goes on through a zoom.

/** Order in the overlay's stack: below the outline (100), the grids and the brush cursor. */
export const STROKE_ECHO_ORDER = 50;
/** The dark theme's checkerboard, while no viewport has reported one. */
const DEFAULT_CHECKER: ViewportChecker = { a: 0x3a3a3a, b: 0x4a4a4a, size: 8 };

/** What tests and the latency benchmark read of the echo (development builds). */
export interface StrokeEchoProbe {
    /** Off: no stroke is echoed. On by default. */
    enabled: boolean;
    /**
     * Regions waiting for NGNE: the rectangles composited and not yet on screen through it,
     * those merged into one bounding rectangle included (`StrokeEcho.waiting`).
     */
    readonly regions: number;
    /**
     * Called at the end of each draw of the echo with the document rectangles drawn and the
     * live composite they were drawn from.
     */
    onDraw: ((rects: readonly Rect[], buffer: PixelBuffer) => void) | null;
}

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The overlay stroke echo (SE-015). */
        strokeEcho?: StrokeEchoProbe;
    }
}

/**
 * What NGNE shows for the pixels of `rect` of a composite (straight RGBA8) drawn over the
 * checkerboard: opaque RGBA, one pixel per document pixel, row by row.
 */
export function echoPixels(
    buffer: PixelBuffer,
    rect: Rect,
    checker: ViewportChecker,
): Uint8ClampedArray<ArrayBuffer> {
    const out = new Uint8ClampedArray(rect.width * rect.height * 4);
    const { size } = checker;
    let at = 0;
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            const from = (y * buffer.width + x) * 4;
            const alpha = buffer.data[from + 3] ?? 0;
            const under =
                (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0 ? checker.a : checker.b;
            const backdrop = [(under >>> 16) & 255, (under >>> 8) & 255, under & 255];
            for (let channel = 0; channel < 3; channel++) {
                const colour = buffer.data[from + channel] ?? 0;
                out[at + channel] = Math.round(
                    (colour * alpha + (backdrop[channel] ?? 0) * (255 - alpha)) / 255,
                );
            }
            out[at + 3] = 255;
            at += 4;
        }
    }
    return out;
}

/** The echo's draw layer and its probe. */
export interface StrokeEchoLayer {
    layer: OverlayLayer;
    probe: StrokeEchoProbe;
}

/**
 * The draw layer of `echo`, drawing over the checkerboard `checker()` names (the one the
 * viewport draws; the dark theme's while there is none). The probe goes on the page with the
 * overlay in development builds.
 */
export function createStrokeEchoLayer(
    echo: StrokeEcho,
    checker: () => ViewportChecker | null,
): StrokeEchoLayer {
    /** Where a region is put before it is scaled onto the overlay; let go when the echo ends. */
    let scratch: OffscreenCanvas | null = null;

    const probe: StrokeEchoProbe = {
        get enabled() {
            return echo.enabled;
        },
        set enabled(value: boolean) {
            echo.enabled = value;
        },
        get regions() {
            return echo.waiting();
        },
        onDraw: null,
    };

    const layer: OverlayLayer = {
        id: "stroke-echo",
        order: STROKE_ECHO_ORDER,
        draw({ context, document, mapping }) {
            const target = echo.target;
            if (!echo.enabled || !target) {
                scratch = null;
                return;
            }
            const { session } = document;
            if (session !== target.session || session.activeFrameId !== target.frameId) return;
            if (!echo.showsTarget || mapping.frame.view.scale < 1) return;
            echo.prepare();
            const rects = echo.regions().map((region) => region.rect);
            if (rects.length === 0) return;
            const colours = checker() ?? DEFAULT_CHECKER;
            context.imageSmoothingEnabled = false;
            for (const rect of rects) {
                const { width, height } = rect;
                if (!scratch || scratch.width < width || scratch.height < height) {
                    scratch = new OffscreenCanvas(
                        Math.max(width, scratch?.width ?? 0),
                        Math.max(height, scratch?.height ?? 0),
                    );
                }
                const source = scratch.getContext("2d");
                if (!source) return;
                source.putImageData(
                    new ImageData(echoPixels(target.buffer, rect, colours), width, height),
                    0,
                    0,
                );
                const start = mapping.docToDevice(rect.x, rect.y);
                const end = mapping.docToDevice(rect.x + width, rect.y + height);
                const x = Math.round(start.x);
                const y = Math.round(start.y);
                const w = Math.round(end.x) - x;
                const h = Math.round(end.y) - y;
                if (w > 0 && h > 0) context.drawImage(scratch, 0, 0, width, height, x, y, w, h);
            }
            probe.onDraw?.(rects, target.buffer);
        },
        watch(redraw) {
            const stop = echo.subscribe(redraw);
            // The probe goes on the page with the overlay (development builds).
            const hooks =
                import.meta.env.DEV && typeof window !== "undefined"
                    ? window.__ngneTest
                    : undefined;
            if (hooks) hooks.strokeEcho = probe;
            return () => {
                stop();
                if (hooks?.strokeEcho === probe) delete hooks.strokeEcho;
            };
        },
    };
    return { layer, probe };
}

export const overlayLayers: OverlayLayer[] = [
    createStrokeEchoLayer(strokeEcho, () => viewportLink.checker).layer,
];
