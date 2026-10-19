import { atlasFor, exportFrameIndices, PackError } from "../../core/export";
import type { AtlasAnimation, AtlasMeta } from "../../core/export";
import type { ExportSettings, FrameInfo, SpriteDoc, Tag } from "../../core/model";
import type { PixelBuffer } from "../../core/pixels";

// The packing of the preview panel (SPEC §6.5), as it runs in the worker
// (`previewPack.worker.ts`): `atlasFor` of SE-051 over frame composites the worker keeps, so
// only frames that changed are sent after the first pack. No file writer runs here. This
// module has no worker API of its own, so it runs under Vitest as well.

/** The most memory an atlas of the preview may take: 64 MB (SPEC §6.5). */
export const PREVIEW_ATLAS_BYTES = 64 * 1024 * 1024;

/** What `atlasFor` reads of a document: no cels, no images. */
export interface PackDocument {
    name: string;
    width: number;
    height: number;
    frames: readonly FrameInfo[];
    tags: readonly Tag[];
    pivot: { x: number; y: number };
}

/** One frame's composite, by its frame ID. */
export interface PackFrame {
    id: string;
    /** Straight RGBA8, the document's size. */
    data: Uint8ClampedArray;
}

export interface PackRequest {
    /** Echoed in the response. */
    id: number;
    /** Forget every composite kept: another document, or its size changed. */
    reset: boolean;
    doc: PackDocument;
    /** The export settings to pack with; `frames` is "all" (the preview shows every animation). */
    settings: ExportSettings;
    /**
     * The tag whose animation is selected, if any: when the whole atlas is too large, only
     * its frames are packed (SPEC §6.5).
     */
    fallbackTagId: string | null;
    /** Composites that changed since the last request, and every one the worker lacks. */
    frames: PackFrame[];
}

export type PackResponse =
    | {
          id: number;
          kind: "packed";
          /** "tag": only the fallback tag's frames and animation are in the atlas. */
          scope: "all" | "tag";
          atlas: PixelBuffer;
          meta: AtlasMeta;
          /**
           * Every frame of the atlas in frame order, each for its duration, looping: what
           * "All frames" plays. Null when the atlas holds one tag only.
           */
          allFrames: AtlasAnimation | null;
      }
    | { id: number; kind: "too-large"; message: string }
    | { id: number; kind: "failed"; message: string };

/** The composites a worker keeps, by frame ID. */
export interface PackState {
    frames: Map<string, Uint8ClampedArray>;
}

export function createPackState(): PackState {
    return { frames: new Map() };
}

/** Thrown when an atlas packs within the side limit but over `PREVIEW_ATLAS_BYTES`. */
class PreviewSizeError extends Error {}

/** True for the failures that the fallback to one tag, then "Too large to preview", answer. */
function isTooLarge(error: unknown): boolean {
    return (
        error instanceof PreviewSizeError ||
        (error instanceof PackError && (error.code === "atlas-size" || error.code === "memory"))
    );
}

function messageOf(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/** `atlasFor` of the kept composites with `settings`; throws as it does. */
function packWith(state: PackState, doc: SpriteDoc, settings: ExportSettings) {
    const indices = exportFrameIndices(doc, settings);
    const frames = indices.map((index): PixelBuffer => {
        const id = doc.frames[index].id;
        const data = state.frames.get(id);
        if (!data) throw new Error(`The preview has no composite of frame ${index + 1}.`);
        return { width: doc.width, height: doc.height, data };
    });
    const result = atlasFor(frames, doc, settings);
    const bytes = result.atlas.data.byteLength;
    if (bytes > PREVIEW_ATLAS_BYTES) {
        const mb = (n: number) => Math.round(n / (1024 * 1024));
        throw new PreviewSizeError(
            `The atlas would be ${result.atlas.width} × ${result.atlas.height} px ` +
                `(${mb(bytes)} MB); the preview holds at most ${mb(PREVIEW_ATLAS_BYTES)} MB.`,
        );
    }
    return { ...result, indices };
}

/** Packs the preview's atlas for `request` and keeps its composites for the next one. */
export function handlePack(state: PackState, request: PackRequest): PackResponse {
    const { id } = request;
    if (request.reset) state.frames.clear();
    for (const frame of request.frames) state.frames.set(frame.id, frame.data);
    const known = new Set(request.doc.frames.map((frame) => frame.id));
    for (const frameId of [...state.frames.keys()]) {
        if (!known.has(frameId)) state.frames.delete(frameId);
    }
    // `atlasFor` reads the name, frames, tags and pivot of a document (SE-051).
    const doc = {
        ...request.doc,
        frames: [...request.doc.frames],
        tags: [...request.doc.tags],
        layers: [],
        cels: new Map(),
        images: new Map(),
    } as unknown as SpriteDoc;
    const settings: ExportSettings = { ...request.settings, frames: "all" };

    let full: unknown;
    try {
        const { atlas, meta, indices } = packWith(state, doc, settings);
        const ids = Object.keys(meta.frames);
        const entries = indices.map((index, at) => ({
            frame: ids[at],
            ms: doc.frames[index].durationMs,
        }));
        const durationMs = entries.reduce((sum, entry) => sum + entry.ms, 0);
        const allFrames: AtlasAnimation = { playback: "loop", durationMs, entries };
        return { id, kind: "packed", scope: "all", atlas, meta, allFrames };
    } catch (error) {
        if (!isTooLarge(error)) return { id, kind: "failed", message: messageOf(error) };
        full = error;
    }
    const tagId = request.fallbackTagId;
    if (tagId !== null && doc.tags.some((tag) => tag.id === tagId)) {
        try {
            const { atlas, meta } = packWith(state, doc, { ...settings, frames: { tagId } });
            return { id, kind: "packed", scope: "tag", atlas, meta, allFrames: null };
        } catch (error) {
            if (!isTooLarge(error)) return { id, kind: "failed", message: messageOf(error) };
            return { id, kind: "too-large", message: messageOf(error) };
        }
    }
    return { id, kind: "too-large", message: messageOf(full) };
}
