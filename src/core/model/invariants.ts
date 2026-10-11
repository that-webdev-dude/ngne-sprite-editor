import { MAX_REFERENCE_LAYERS } from "./defaults";
import { frameIndex } from "./queries";
import type { DocSession, SpriteDoc } from "./types";

/**
 * The invariants of SPEC §5.1, followed by those of a session (SE-003). `assertInvariants`
 * checks them in this order.
 */
export const INVARIANTS = {
    "pixel-layer-required": "the document has at least one pixel layer",
    "frame-required": "the document has at least one frame",
    "reference-layer-limit": "the document has at most four reference layers",
    "unique-ids": "IDs are unique",
    "cel-image-exists": "every cel's image exists",
    "cel-image-size": "every cel's image has the document's dimensions",
    "no-orphan-image": "every image is referenced by a cel",
    "tag-endpoints-exist": "tag endpoints reference existing frames",
    "tag-order": "a tag's `from` frame is not after its `to` frame",
    "export-frames-tag-exists": '`exportSettings.frames` references an existing tag or is "all"',
    "active-layer-exists": "the active layer exists",
    "active-frame-exists": "the active frame exists",
    "selection-mask-size": "the selection mask has the document's dimensions",
} as const;

export type InvariantName = keyof typeof INVARIANTS;

/** Thrown by `assertInvariants`. The message names the invariant, as does `invariant`. */
export class InvariantError extends Error {
    override readonly name = "InvariantError";
    readonly invariant: InvariantName;
    readonly detail: string;

    constructor(invariant: InvariantName, detail: string) {
        super(`Invariant "${invariant}" violated (${INVARIANTS[invariant]}): ${detail}`);
        this.invariant = invariant;
        this.detail = detail;
    }
}

function fail(invariant: InvariantName, detail: string): never {
    throw new InvariantError(invariant, detail);
}

function assertDocument(doc: SpriteDoc): void {
    const referenceLayers = doc.layers.filter((layer) => layer.kind === "reference").length;
    if (referenceLayers === doc.layers.length) {
        fail("pixel-layer-required", `${doc.layers.length} layers, none of kind "pixel"`);
    }
    if (doc.frames.length === 0) fail("frame-required", "the frame list is empty");
    if (referenceLayers > MAX_REFERENCE_LAYERS) {
        fail("reference-layer-limit", `${referenceLayers} reference layers`);
    }

    // One namespace: the document, its layers, frames, tags and images.
    const owners = new Map<string, string>([[doc.id, "the document"]]);
    const claim = (id: string, owner: string) => {
        const other = owners.get(id);
        if (other !== undefined) fail("unique-ids", `ID "${id}" is used by ${other} and ${owner}`);
        owners.set(id, owner);
    };
    doc.layers.forEach((layer, index) => claim(layer.id, `layer ${index}`));
    doc.frames.forEach((frame, index) => claim(frame.id, `frame ${index}`));
    doc.tags.forEach((tag, index) => claim(tag.id, `tag ${index}`));
    for (const imageId of doc.images.keys()) claim(imageId, "an image");

    const referenced = new Set<string>();
    for (const [key, cel] of doc.cels) {
        const image = doc.images.get(cel.imageId);
        if (!image) fail("cel-image-exists", `cel ${key} names image "${cel.imageId}"`);
        referenced.add(cel.imageId);
        const sized =
            image.width === doc.width &&
            image.height === doc.height &&
            image.data.length === doc.width * doc.height * 4;
        if (!sized) {
            fail(
                "cel-image-size",
                `image "${cel.imageId}" of cel ${key} is ${image.width}×${image.height} with ` +
                    `${image.data.length} bytes; the document is ${doc.width}×${doc.height}`,
            );
        }
    }
    for (const imageId of doc.images.keys()) {
        if (!referenced.has(imageId)) fail("no-orphan-image", `image "${imageId}" has no cel`);
    }

    for (const tag of doc.tags) {
        const from = frameIndex(doc, tag.fromFrameId);
        const to = frameIndex(doc, tag.toFrameId);
        if (from === -1 || to === -1) {
            const missing = from === -1 ? tag.fromFrameId : tag.toFrameId;
            fail("tag-endpoints-exist", `tag "${tag.id}" names frame "${missing}"`);
        }
        if (from > to) {
            fail("tag-order", `tag "${tag.id}" runs from frame index ${from} to ${to}`);
        }
    }

    const exported = doc.exportSettings.frames;
    if (exported !== "all" && !doc.tags.some((tag) => tag.id === exported.tagId)) {
        fail("export-frames-tag-exists", `no tag has ID "${exported.tagId}"`);
    }
}

/**
 * Throws an `InvariantError` for the first violated invariant of `INVARIANTS`; returns
 * normally when the session satisfies all of them. Document invariants are checked before
 * the session's own.
 */
export function assertInvariants(session: DocSession): void {
    const { doc, selection, activeLayerId, activeFrameId } = session;
    assertDocument(doc);

    if (!doc.layers.some((layer) => layer.id === activeLayerId)) {
        fail("active-layer-exists", `no layer has ID "${activeLayerId}"`);
    }
    if (!doc.frames.some((frame) => frame.id === activeFrameId)) {
        fail("active-frame-exists", `no frame has ID "${activeFrameId}"`);
    }
    if (selection) {
        const { mask } = selection;
        const sized =
            mask.width === doc.width &&
            mask.height === doc.height &&
            mask.data.length === Math.ceil((doc.width * doc.height) / 8);
        if (!sized) {
            fail(
                "selection-mask-size",
                `the mask is ${mask.width}×${mask.height} with ${mask.data.length} bytes; ` +
                    `the document is ${doc.width}×${doc.height}`,
            );
        }
    }
}
