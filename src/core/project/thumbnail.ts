import { compositeFrame } from "../composite";
import type { PixelBuffer, SpriteDoc } from "../model";
import { resizeNearest } from "../pixels";
import { THUMBNAIL_MAX_SIDE } from "./format";

/**
 * The picture of a document that a project file carries as `thumb.png`: the composite of the
 * first frame (SPEC §5.3: visible pixel layers, no reference layer), at its own size when
 * neither side exceeds `THUMBNAIL_MAX_SIDE`. A larger composite is scaled down by nearest
 * neighbour so that its longer side is `THUMBNAIL_MAX_SIDE` and the other keeps the
 * proportion, rounded and at least 1. A small sprite is not enlarged.
 *
 * Throws `RangeError` when the document has no frame.
 */
export function projectThumbnail(doc: SpriteDoc): PixelBuffer {
    const first = doc.frames[0];
    if (!first) throw new RangeError("projectThumbnail: the document has no frame.");
    const composite = compositeFrame(doc, first.id);
    const longer = Math.max(doc.width, doc.height);
    if (longer <= THUMBNAIL_MAX_SIDE) return composite;
    const scaled = (side: number) => Math.max(1, Math.round((side * THUMBNAIL_MAX_SIDE) / longer));
    return resizeNearest(composite, scaled(doc.width), scaled(doc.height));
}
