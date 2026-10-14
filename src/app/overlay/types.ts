import type { DeviceSize } from "../../engine/viewport/types";
import type { OpenDocument } from "../state/sessions";
import type { Point, ViewMapping } from "../view/coordinates";

// The overlay of the viewport (SPEC §6.3, SE-013): a Canvas2D element stacked over the NGNE
// canvas that draws editor chrome. What it draws comes from draw layers; this file holds the
// types a feature needs to add one (see `overlayLayers.ts` for how a layer is registered).

/** The colours the overlay takes from the theme (DESIGN §3.1, §6), as 0xRRGGBB. */
export interface OverlayTheme {
    /** The document outline: `--border-strong`. */
    outline: number;
    /** The grid lines: white in the dark theme, black in the light one (DESIGN §6). */
    ink: number;
}

/** The dark theme, until the interface reports the theme in use. */
export const DEFAULT_OVERLAY_THEME: Readonly<OverlayTheme> = {
    outline: 0x3a3a40,
    ink: 0xffffff,
};

/** The pointer over the viewport, as a draw layer sees it. */
export interface OverlayCursor {
    /** Client position, CSS pixels, as the pointer event reported it. */
    client: Point;
    /** Device position in the overlay canvas, with its fraction. */
    device: Point;
    /** The document pixel under it: whole numbers, also outside the document. */
    pixel: Point;
}

/** Everything a draw layer draws from, made for one redraw and not kept. */
export interface OverlayFrame {
    /**
     * The overlay's context. Each layer draws between a `save()` and a `restore()`, so state
     * it sets does not reach the next layer. Coordinates are device pixels of the canvas.
     */
    readonly context: CanvasRenderingContext2D;
    /** The canvas backing size in device pixels: the NGNE canvas's size (SPEC §6.3). */
    readonly size: Readonly<DeviceSize>;
    /** The active document, as the session store holds it. */
    readonly document: OpenDocument;
    /**
     * Its mapping as it is on screen now (`currentViewMapping`, read at this redraw).
     * `mapping.rect` is the document rectangle in canvas pixels.
     */
    readonly mapping: ViewMapping;
    /** The pointer over the viewport; null when it is not over it. */
    readonly cursor: Readonly<OverlayCursor> | null;
    readonly theme: Readonly<OverlayTheme>;
}

/**
 * One draw layer of the overlay. The overlay clears its canvas and calls every layer in
 * ascending `order` at each redraw. A redraw happens only when the view or the cursor changed
 * or a layer asked for one (`watch`), at most once per animation frame.
 */
export interface OverlayLayer {
    /** Stable and unique: "pixel-grid". */
    id: string;
    /**
     * Position in the stack, ascending: drawn bottom to top. SE-013 uses 100 (document
     * outline), 200 (pixel grid) and 300 (tile grid); chrome drawn over the grids takes
     * higher values.
     */
    order: number;
    /** Draws the layer. Called only while a document is open and the viewport is on the page. */
    draw(frame: OverlayFrame): void;
    /**
     * Follows what the layer draws from, other than the view and the cursor: calls `redraw`
     * whenever that changed (a setting, a selection, the phase of an animation). Called when
     * the overlay is mounted; returns the function that stops following.
     */
    watch?(redraw: () => void): () => void;
}

/** What a `*.overlay.ts` module exports. */
export interface OverlayLayerModule {
    overlayLayers?: readonly OverlayLayer[];
}
