import type { PixelBuffer } from "../../core/model";

// What the viewport is told to show (SPEC §6.4). Types and the key helpers only, with no DOM
// and no NGNE in them: `app` describes a document to the viewport with these.

/**
 * The variants of a frame in the slot cache: its composite, or the composite tinted for an
 * onion skin before or after the current frame (SE-025).
 */
export type FrameVariant = "plain" | "before" | "after";

/** The key of a frame in the slot cache: `frameId:variant` (SPEC §6.4). */
export function frameKey(frameId: string, variant: FrameVariant = "plain"): string {
    return `${frameId}:${variant}`;
}

/** The frame and the variant of a key made by `frameKey`. */
export function parseFrameKey(key: string): { frameId: string; variant: FrameVariant } {
    const at = key.lastIndexOf(":");
    return { frameId: key.slice(0, at), variant: key.slice(at + 1) as FrameVariant };
}

/** The document the viewport shows, as far as the viewport needs it. */
export interface ViewportDocument {
    /** Size in document pixels. Read whenever an image is built, so it may change. */
    readonly width: number;
    readonly height: number;
    /**
     * The pixels of a frame key, straight RGBA8, or null when the document has no such frame
     * (any more). Called when the upload of the key starts, never inside a setter. The
     * pixels are copied in that same task (`createImageBitmap` of an `ImageData`), so the
     * buffer may be written to again afterwards; the viewport shows the new pixels once it
     * is told with `invalidate`.
     */
    pixels(key: string): PixelBuffer | null;
    /**
     * A number the app gives the pixels of a key when they are read (SE-015): read in the
     * same task as `pixels`, kept with the texture they become, and reported with every frame
     * drawn from that texture (`NgneViewportOptions.onDrawn`), so the app can tell which of
     * its changes are on screen. Optional.
     */
    version?(key: string): number;
}

/**
 * A reference layer as the viewport draws it (SPEC §7.6, SE-045): only visible ones are
 * given. The viewport resamples `image` on the CPU to its size on screen and draws it at
 * `layer` 2 (behind) or 6 (front) with `opacity`, clipped to the document rectangle.
 */
export interface ViewportReference {
    /** The layer's ID: the viewport keeps a texture slot per layer. */
    readonly id: string;
    /**
     * The decoded source, straight RGBA8. The same object while the source is the same: the
     * viewport keeps what it made of it by identity and never writes to it.
     */
    readonly image: PixelBuffer;
    /** Top-left in document pixels (fractional allowed). */
    readonly x: number;
    readonly y: number;
    /** Document pixels per source pixel. */
    readonly scale: number;
    /** 0..255. */
    readonly opacity: number;
    readonly placement: "behind" | "front";
}

/**
 * An onion skin as the viewport draws it (SPEC §6.4, §7.5, SE-025): the frame key whose pixels
 * it shows (`frameId:plain`, or `before` / `after` when tinted), drawn from the frame cache
 * with `alpha` at layer 3 (behind) or 5 (in front). Its key is a key on screen: a change of its
 * pixels is uploaded into its slot in place, as the current frame's is.
 */
export interface ViewportGhost {
    readonly key: string;
    /** 0 to 1. */
    readonly alpha: number;
    readonly placement: "behind" | "front";
}

/** View state of SPEC §6.4, in device pixels. */
export interface ViewportView {
    /** Device pixels per document pixel. */
    scale: number;
    /** Left edge of the document rectangle. */
    originX: number;
    /** Top edge of the document rectangle. */
    originY: number;
}

/** The transparency checkerboard: two opaque colours as 0xRRGGBB. */
export interface ViewportChecker {
    a: number;
    b: number;
    /** Side of one square in document pixels, 1 or more. */
    size: number;
}

/** A size in device pixels. */
export interface DeviceSize {
    width: number;
    height: number;
}

/** The setters of `NgneViewport`: what the wiring in `app` drives. */
export interface ViewportPort {
    /**
     * The document on show, or null for none. Forgets every cached frame and the frame key,
     * which belonged to the document left: `setCurrent` names the new document's.
     */
    setDocument(document: ViewportDocument | null): void;
    /** The key of the frame to draw, or null for the checkerboard alone. */
    setCurrent(key: string | null): void;
    /**
     * The pixels behind these keys changed; "all" also covers the document's size. A frame's
     * plain key covers its tinted variants as well (SE-025): they are made from its pixels.
     */
    invalidate(keys: readonly string[] | "all"): void;
    setView(view: ViewportView): void;
    setChecker(checker: ViewportChecker): void;
    /** The workspace colour around the document, 0xRRGGBB. */
    setBackground(colour: number): void;
    /**
     * Editor playback (SE-024): the frame keys of the playing range, each once, or null when
     * nothing plays. While they fit the `ed:play` grid (SPEC §6.4) the current key is drawn from
     * it; otherwise from the frame cache, showing the newest ready frame. Optional, so a port
     * without playback (a test's) need not have it.
     */
    setPlayback?(keys: readonly string[] | null): void;
    /**
     * The visible reference layers of the document on show, bottom to top (SE-045). Optional,
     * so a port without references (a test's) need not have it.
     */
    setReferences?(references: readonly ViewportReference[]): void;
    /**
     * The onion skins of the shown document around its current frame, in draw order (SE-025);
     * empty for none. Optional, so a port without onion skin (a test's) need not have it.
     */
    setOnion?(ghosts: readonly ViewportGhost[]): void;
    /**
     * Tiled mode of the document on show (SE-062, `DocSettings.tiled`): the checkerboard and
     * the current frame are drawn again around the document on these axes, 3 × 3 for both.
     * Forgotten with the document (`setDocument`). Optional, so a port without tiled mode (a
     * test's) need not have it.
     */
    setTiled?(tiled: "none" | "x" | "y" | "both"): void;
}
