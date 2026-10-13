import type { PixelBuffer } from "../../core/model";

// What the viewport is told to show (SPEC §6.4). Types and the key helpers only, with no DOM
// and no NGNE in them: `app` describes a document to the viewport with these.

/** The variants of a frame in the slot cache; the onion variants arrive with SE-025. */
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
     * (any more). Called when the upload of the key starts. The buffer must not be written
     * to afterwards: a changed frame is a new buffer.
     */
    pixels(key: string): PixelBuffer | null;
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
    /** The document on show, or null for none. Forgets every cached frame. */
    setDocument(document: ViewportDocument | null): void;
    /** The key of the frame to draw, or null for the checkerboard alone. */
    setCurrent(key: string | null): void;
    /** The pixels behind these keys changed; "all" also covers the document's size. */
    invalidate(keys: readonly string[] | "all"): void;
    setView(view: ViewportView): void;
    setChecker(checker: ViewportChecker): void;
    /** The workspace colour around the document, 0xRRGGBB. */
    setBackground(colour: number): void;
}
