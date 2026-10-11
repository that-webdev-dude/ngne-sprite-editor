import type { Cel, SpriteDoc, Tag } from "./types";

// Pure read helpers over a document. None of them changes its argument.

/** Key of a cel in `SpriteDoc.cels`. */
export function celKey(layerId: string, frameId: string): string {
    return `${layerId}:${frameId}`;
}

/** The cel of a layer at a frame, or `undefined` when that cel is empty. */
export function celAt(doc: SpriteDoc, layerId: string, frameId: string): Cel | undefined {
    return doc.cels.get(celKey(layerId, frameId));
}

/** Position of a frame in playback order, or -1 when the document has no such frame. */
export function frameIndex(doc: SpriteDoc, id: string): number {
    return doc.frames.findIndex((frame) => frame.id === id);
}

/** Position of a layer from the bottom, or -1 when the document has no such layer. */
export function layerIndex(doc: SpriteDoc, id: string): number {
    return doc.layers.findIndex((layer) => layer.id === id);
}

/** Number of frames a tag spans when it contains the frame at `index`, otherwise 0. */
function spanContaining(doc: SpriteDoc, tag: Tag, index: number): number {
    const from = frameIndex(doc, tag.fromFrameId);
    const to = frameIndex(doc, tag.toFrameId);
    const contains = from !== -1 && to !== -1 && from <= index && index <= to;
    return contains ? to - from + 1 : 0;
}

/** Every tag whose range contains the frame at `index`, in creation order. */
export function tagsAtFrame(doc: SpriteDoc, index: number): Tag[] {
    return doc.tags.filter((tag) => spanContaining(doc, tag, index) > 0);
}

/**
 * The active tag at a frame (SPEC §7.4): the tag with the shortest range containing the
 * frame at `index`; among equal ranges the tag created last. `undefined` when no tag
 * contains the frame.
 */
export function activeTagAt(doc: SpriteDoc, index: number): Tag | undefined {
    let active: Tag | undefined;
    let shortest = Infinity;
    for (const tag of doc.tags) {
        const span = spanContaining(doc, tag, index);
        // `<=` lets a later tag replace an earlier one of the same length.
        if (span > 0 && span <= shortest) {
            active = tag;
            shortest = span;
        }
    }
    return active;
}

/** Bytes held by the document's cel images; an image shared by linked cels counts once. */
export function pixelMemoryBytes(doc: SpriteDoc): number {
    let bytes = 0;
    for (const image of doc.images.values()) bytes += image.data.byteLength;
    return bytes;
}
