import type { PixelBuffer, Rect } from "../../core/model";
import type { ViewportChecker } from "../../engine/viewport/types";
import type {} from "../../import-meta";
import type { OverlayLayer } from "../overlay/types";
import { viewportLink } from "../viewport/viewportLink";
import { strokeEcho } from "./strokeEcho";

// The overlay stroke echo (SPEC §6.6, SE-015), drawn: the regions of the stroke not yet on
// screen through NGNE (`strokeEcho.ts`), from the stroke's live composite, as NGNE will show
// them — each document pixel over the checkerboard, opaque, scaled nearest-neighbour to the
// view the overlay draws with. The lowest layer of the overlay: under the document outline,
// the grids and the brush cursor. Nothing is drawn, and nothing asks for a redraw, while no
// stroke is echoed.

/** Order in the overlay's stack: below the outline (100), the grids and the brush cursor. */
export const STROKE_ECHO_ORDER = 50;
/** Above this many regions, their bounding rectangle is drawn as one. */
const MAX_REGIONS = 16;
/** The dark theme's checkerboard, while no viewport has reported one. */
const DEFAULT_CHECKER: ViewportChecker = { a: 0x3a3a3a, b: 0x4a4a4a, size: 8 };

/** What tests and the latency benchmark read of the echo (development builds). */
export interface StrokeEchoProbe {
    /** Off: no stroke is echoed. On by default. */
    enabled: boolean;
    /** Regions waiting for NGNE. */
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

/** The bounding rectangle of `rects`. */
function bounds(rects: readonly Rect[]): Rect {
    const x = Math.min(...rects.map((rect) => rect.x));
    const y = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    return { x, y, width: right - x, height: bottom - y };
}

let scratch: OffscreenCanvas | null = null;

const probe: StrokeEchoProbe = {
    get enabled() {
        return strokeEcho.enabled;
    },
    set enabled(value: boolean) {
        strokeEcho.enabled = value;
    },
    get regions() {
        return strokeEcho.regions().length;
    },
    onDraw: null,
};

export const overlayLayers: OverlayLayer[] = [
    {
        id: "stroke-echo",
        order: STROKE_ECHO_ORDER,
        draw({ context, document, mapping }) {
            const target = strokeEcho.target;
            if (!strokeEcho.enabled || !target) return;
            const { session } = document;
            if (session !== target.session || session.activeFrameId !== target.frameId) return;
            strokeEcho.prepare();
            const regions = strokeEcho.regions();
            if (regions.length === 0) return;
            const all = regions.map((region) => region.rect);
            // Pixels of the box outside every region are on screen already, as drawn here.
            const rects = all.length > MAX_REGIONS ? [bounds(all)] : all;
            const checker = viewportLink.checker ?? DEFAULT_CHECKER;
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
                    new ImageData(echoPixels(target.buffer, rect, checker), width, height),
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
            const stop = strokeEcho.subscribe(redraw);
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
    },
];
