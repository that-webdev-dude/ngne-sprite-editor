import type { ReferenceLayer, SpriteDoc } from "../model";

// Where a reference image lies on the canvas (SPEC §7.6): its top-left corner in document
// pixels and its uniform scale, document pixels per source pixel. Pure functions.

/** Position and scale of a reference layer. */
export interface ReferencePlacement {
    /** Top-left in document pixels; fractional values are allowed. */
    x: number;
    y: number;
    /** Document pixels per source pixel, above 0. */
    scale: number;
}

/** A rectangle in document pixels; fractional values are allowed. */
export interface ReferenceRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * The placement that fits a `sourceWidth` × `sourceHeight` image inside `rect` and centres it
 * there: the largest uniform scale at which the whole image lies inside (as "contain" fits,
 * SPEC §8). Used with the canvas for a new reference layer and for Reset to Fit, and with the
 * cropped region of an import (SE-044).
 */
export function fitPlacement(
    sourceWidth: number,
    sourceHeight: number,
    rect: ReferenceRect,
): ReferencePlacement {
    const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
    return {
        x: rect.x + (rect.width - sourceWidth * scale) / 2,
        y: rect.y + (rect.height - sourceHeight * scale) / 2,
        scale,
    };
}

/** The placement of a reference image fitted and centred on the document's canvas. */
export function fitToCanvas(
    doc: Pick<SpriteDoc, "width" | "height">,
    sourceWidth: number,
    sourceHeight: number,
): ReferencePlacement {
    return fitPlacement(sourceWidth, sourceHeight, {
        x: 0,
        y: 0,
        width: doc.width,
        height: doc.height,
    });
}

/**
 * The rectangle a reference layer covers, in document pixels, for a source of
 * `sourceWidth` × `sourceHeight` pixels.
 */
export function referenceRect(
    layer: Pick<ReferenceLayer, "x" | "y" | "scale">,
    sourceWidth: number,
    sourceHeight: number,
): ReferenceRect {
    return {
        x: layer.x,
        y: layer.y,
        width: sourceWidth * layer.scale,
        height: sourceHeight * layer.scale,
    };
}
