import type { PixelBuffer, Rect } from "../../core/model";
import type { TiledMode } from "../../core/model";
import { tiledCopyOffsets } from "../../core/raster";
import type { ViewportChecker } from "../../engine/viewport/types";
import type {} from "../../import-meta";
import type { OverlayLayer } from "../overlay/types";
import { activeEchoCover } from "../onion/onionCover";
import { activeDocument, sessionsStore } from "../state/sessions";
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
//
// In tiled mode NGNE draws the stroke's frame again around the document (SE-062), from the
// same slot: the echo draws each region in every copy as well, or the copies would lag the
// stroke by an upload. The copies have no references or onion skins, so there the echo
// gives way to nothing.

/** Order in the overlay's stack: below the outline (100), the grids and the brush cursor. */
export const STROKE_ECHO_ORDER = 50;
/**
 * Where reference layers lie on the canvas while the echo draws (SE-045), in document pixels:
 * the rectangles of the visible references placed behind the pixel layers and of those in
 * front. NGNE draws a reference behind under the composite's pixels that are not opaque, and
 * one in front over everything (SPEC §6.4, quad layers 2 and 6), while the echo is opaque: it
 * gives way to them. Over a reference in front it draws nothing; over one behind it draws only
 * opaque pixels, which hide the reference in NGNE as well. NGNE shows the pixels it leaves out
 * once their upload is drawn.
 */
export interface EchoCover {
    readonly behind: readonly Readonly<Rect>[];
    readonly front: readonly Readonly<Rect>[];
}

/** No reference on the canvas. */
export const NO_COVER: EchoCover = { behind: [], front: [] };

/**
 * The offsets of the copies tiled mode draws around the document, in document pixels, the
 * document's own (0, 0) left out (SE-062; `tiledCopies` of the viewport's geometry).
 */
export function tiledOffsets(
    tiled: TiledMode,
    width: number,
    height: number,
): { x: number; y: number }[] {
    return tiledCopyOffsets(tiled).map((offset) => ({
        x: offset.x * width,
        y: offset.y * height,
    }));
}

/** The texels a rectangle of document pixels touches, as whole-texel edges. */
function texelSpan(rect: Readonly<Rect>) {
    return {
        left: Math.floor(rect.x),
        top: Math.floor(rect.y),
        right: Math.ceil(rect.x + rect.width),
        bottom: Math.ceil(rect.y + rect.height),
    };
}

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
 * checkerboard: opaque RGBA, one pixel per document pixel, row by row. A pixel the echo leaves
 * to NGNE because a reference lies there (`cover`, SE-045) is transparent: any pixel a
 * reference in front touches, and a pixel that is not opaque where a reference behind touches
 * it.
 */
export function echoPixels(
    buffer: PixelBuffer,
    rect: Rect,
    checker: ViewportChecker,
    cover: EchoCover = NO_COVER,
): Uint8ClampedArray<ArrayBuffer> {
    const out = new Uint8ClampedArray(rect.width * rect.height * 4);
    const { size } = checker;
    const front = cover.front.map(texelSpan);
    const behind = cover.behind.map(texelSpan);
    const inside = (spans: typeof front, x: number, y: number) =>
        spans.some((span) => x >= span.left && x < span.right && y >= span.top && y < span.bottom);
    let at = 0;
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            const from = (y * buffer.width + x) * 4;
            const alpha = buffer.data[from + 3] ?? 0;
            if (inside(front, x, y) || (alpha < 255 && inside(behind, x, y))) {
                // Left transparent: NGNE's reference shows through the overlay.
                at += 4;
                continue;
            }
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
 * viewport draws; the dark theme's while there is none), and giving way to the references
 * `cover()` names (SE-045; none when absent), and drawing each region again in the copies of
 * the tiled mode `tiled()` names (SE-062; none when absent). The probe goes on the page with
 * the overlay in development builds.
 */
export function createStrokeEchoLayer(
    echo: StrokeEcho,
    checker: () => ViewportChecker | null,
    cover: () => EchoCover = () => NO_COVER,
    tiled: () => TiledMode = () => "none",
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
            const references = cover();
            const covered = references.front.length > 0 || references.behind.length > 0;
            const { docWidth, docHeight } = mapping.frame;
            const copies = tiledOffsets(tiled(), docWidth, docHeight);
            context.imageSmoothingEnabled = false;
            /** Draws the scratch's region at the document rectangle `rect` moved by `dx`, `dy`. */
            const place = (image: OffscreenCanvas, rect: Rect, dx: number, dy: number) => {
                const start = mapping.docToDevice(rect.x + dx, rect.y + dy);
                const end = mapping.docToDevice(
                    rect.x + dx + rect.width,
                    rect.y + dy + rect.height,
                );
                const x = Math.round(start.x);
                const y = Math.round(start.y);
                const w = Math.round(end.x) - x;
                const h = Math.round(end.y) - y;
                if (w > 0 && h > 0) {
                    context.drawImage(image, 0, 0, rect.width, rect.height, x, y, w, h);
                }
            };
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
                    new ImageData(
                        echoPixels(target.buffer, rect, colours, references),
                        width,
                        height,
                    ),
                    0,
                    0,
                );
                place(scratch, rect, 0, 0);
                if (copies.length === 0) continue;
                // The copies show the frame alone: drawn again without the cover.
                if (covered) {
                    source.putImageData(
                        new ImageData(echoPixels(target.buffer, rect, colours), width, height),
                        0,
                        0,
                    );
                }
                for (const offset of copies) place(scratch, rect, offset.x, offset.y);
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
    // It gives way to the references and the onion skins of the active document (SE-045, SE-025).
    // In tiled mode it draws the copies of the active document's frame too (SE-062).
    createStrokeEchoLayer(
        strokeEcho,
        () => viewportLink.checker,
        activeEchoCover,
        () => activeDocument(sessionsStore.getState())?.session.doc.settings.tiled ?? "none",
    ).layer,
];
