import { compositeFrame } from "../../core/composite";
import type { CelOverride } from "../../core/composite";
import { celAt } from "../../core/model";
import type { DocSession, PixelBuffer, Rect, SpriteDoc } from "../../core/model";
import type { ActiveComposites } from "../state/composites";
import { frameKey } from "../viewport/viewportLink";
import type { ViewportLink } from "../viewport/viewportLink";
import type { StrokeEcho } from "./strokeEcho";

// The live-stroke display path (SE-014). While a stroke's transaction is open, the frame it
// paints is composited with the in-progress image (`compositeFrame` overrides) into one live
// buffer, which the composite cache of the active document holds (`CompositeCache.adopt`): the
// viewport reads its frames from that cache, so it shows the stroke without a full composite.
// Each change is composited into the live buffer over its dirty rectangle only, the buffer is
// handed to the cache again (it may have been let go meanwhile), and the viewport is told with
// `viewportLink.invalidate` at most once per animation frame; it copies the pixels when the
// upload starts, so the buffer may be rewritten afterwards (SE-011).
//
//   pointer sample → tool writes the cel image → dirty rectangle
//     → composited into the live buffer → viewport told (≤ 1 per animation frame) → upload
//
// At the commit the history step drops the frame's composite; the live buffer, which is up to
// date, is then adopted again, so the frame is not composited in full after a stroke. A stroke
// that changed nothing in the end has no step: its buffer, as up to date, is adopted again and
// the viewport told, since its uploads may have shown a change. An aborted stroke drops the
// frame's composite instead: the cache composites the restored pixels when asked.
//
// The overlay stroke echo (SE-015, `strokeEcho.ts`) is told of every rectangle composited
// into the live buffer, and may composite what is pending before the overlay draws; what it
// composited is still shown to the viewport in the next animation frame.
//
// What is pending is kept as up to `MAX_PENDING` rectangles (SE-062): a dirty rectangle that
// overlaps or nearly touches one joins it, as the samples of a stroke do, and one apart from
// all of them starts another, so the copies a symmetric or tiled stroke writes near the four
// corners are composited each alone rather than as the canvas between them. Beyond that many,
// a rectangle joins the one it grows least.

export interface LiveCompositeSources {
    composites: Pick<ActiveComposites, "cacheOf" | "invalidate">;
    viewport: Pick<ViewportLink, "invalidate">;
    /** Calls `callback` in the next animation frame; returns the function that cancels it. */
    nextFrame(callback: () => void): () => void;
    /** The overlay stroke echo (SPEC §6.6, `strokeEcho.ts`); none in tests that omit it. */
    echo?: Pick<StrokeEcho, "start" | "changed" | "composited" | "release" | "clear">;
}

/** The display of one stroke. */
export interface LiveComposite {
    /** The frame's composite with the stroke as far as it was shown. */
    readonly buffer: PixelBuffer;
    /** Whether the composite cache holds `buffer` as the frame's composite. */
    readonly adopted: boolean;
    /**
     * Pixels of the image inside `rect` changed. They are composited and shown at once when
     * nothing was shown in this animation frame yet, otherwise in the next one.
     */
    dirty(rect: Rect): void;
    /** Composites what is pending without telling the viewport: done before a commit. */
    flush(): void;
    /**
     * The stroke was committed: `recorded` when it became a history entry, whose step has
     * dropped the frame's composite. The live buffer is adopted again in its place.
     */
    committed(recorded: boolean): void;
    /** The stroke was aborted and its pixels are back: the composites that showed them are dropped. */
    aborted(): void;
}

/** At most this many rectangles are pending at once. */
const MAX_PENDING = 4;
/** A dirty rectangle this close to a pending one (in either direction) joins it. */
const JOIN_GAP = 8;

function union(a: Rect | null, b: Rect): Rect {
    if (!a) return { ...b };
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: right - x, height: bottom - y };
}

/** Whether `a` and `b` overlap or lie within `JOIN_GAP` of each other. */
function near(a: Rect, b: Rect): boolean {
    return (
        a.x < b.x + b.width + JOIN_GAP &&
        b.x < a.x + a.width + JOIN_GAP &&
        a.y < b.y + b.height + JOIN_GAP &&
        b.y < a.y + a.height + JOIN_GAP
    );
}

/** Adds `rect` to the pending rectangles `pending` (see the module's comment). */
function addPending(pending: Rect[], rect: Rect): void {
    for (let index = 0; index < pending.length; index++) {
        if (near(pending[index]!, rect)) {
            pending[index] = union(pending[index]!, rect);
            return;
        }
    }
    if (pending.length < MAX_PENDING) {
        pending.push({ ...rect });
        return;
    }
    let best = 0;
    let bestGrowth = Infinity;
    for (let index = 0; index < pending.length; index++) {
        const now = pending[index]!;
        const joined = union(now, rect);
        const growth = joined.width * joined.height - now.width * now.height;
        if (growth < bestGrowth) {
            best = index;
            bestGrowth = growth;
        }
    }
    pending[best] = union(pending[best]!, rect);
}

/** The part of `rect` inside the document, or null. */
function clip(rect: Rect, doc: SpriteDoc): Rect | null {
    const x = Math.max(rect.x, 0);
    const y = Math.max(rect.y, 0);
    const right = Math.min(rect.x + rect.width, doc.width);
    const bottom = Math.min(rect.y + rect.height, doc.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** The frames other than `frameId` with a cel that shows the image `imageId` (linked cels). */
function otherFramesShowing(doc: SpriteDoc, imageId: string, frameId: string): string[] {
    return doc.frames
        .filter(
            (frame) =>
                frame.id !== frameId &&
                doc.layers.some((layer) => celAt(doc, layer.id, frame.id)?.imageId === imageId),
        )
        .map((frame) => frame.id);
}

/**
 * Starts the display of a stroke on `image`, the image of the cel of `layerId` at `frameId`
 * (`imageId`), which the stroke writes into: composites the frame with it and hands the
 * result to the active document's composite cache.
 */
export function startLiveComposite(
    session: DocSession,
    target: { layerId: string; frameId: string; imageId: string; image: PixelBuffer },
    sources: LiveCompositeSources,
): LiveComposite {
    const { doc } = session;
    const { layerId, frameId, imageId, image } = target;
    const overrides: CelOverride[] = [{ layerId, image }];
    const others = otherFramesShowing(doc, imageId, frameId);
    const buffer = compositeFrame(doc, frameId, { overrides });
    let adopted = sources.composites.cacheOf(session)?.adopt(frameId, buffer) ?? false;
    /** Written and not composited yet: at most `MAX_PENDING` rectangles. */
    const pending: Rect[] = [];
    /** Composited (for the echo, which draws from the buffer) and not shown to the viewport. */
    let unshown = false;
    /** Whether the viewport was told in the current animation frame. */
    let shownThisFrame = false;
    let cancelFrame: (() => void) | null = null;
    const { echo } = sources;

    const compositePending = () => {
        if (pending.length === 0) return;
        for (const rect of pending) {
            compositeFrame(doc, frameId, { rect, into: buffer, overrides });
            echo?.composited(rect);
        }
        pending.length = 0;
        unshown = true;
    };
    echo?.start({ session, frameId, buffer, prepare: compositePending });

    /** Hands the buffer to the cache and tells the viewport that the frame's pixels changed. */
    const present = () => {
        // Handed to the cache again each time: the cache may have let it go since (its least
        // recently used composite, or a frame reported changed), and a composite it made in
        // its place would not follow the stroke.
        adopted = sources.composites.cacheOf(session)?.adopt(frameId, buffer) ?? false;
        if (adopted) {
            sources.viewport.invalidate([frameKey(frameId)]);
        } else {
            // Not in the cache (over its budget, or the frame's layers are no longer those
            // the buffer was composited from): it composites the frame when asked.
            sources.composites.invalidate({
                frameIds: [frameId],
                layerIds: [layerId],
                structure: false,
            });
        }
        if (others.length > 0) {
            sources.composites.invalidate({
                frameIds: others,
                layerIds: [layerId],
                structure: false,
            });
        }
    };

    const show = () => {
        compositePending();
        unshown = false;
        present();
        shownThisFrame = true;
        cancelFrame ??= sources.nextFrame(onFrame);
    };

    const onFrame = () => {
        cancelFrame = null;
        shownThisFrame = false;
        if (pending.length > 0 || unshown) show();
    };

    const stop = () => {
        cancelFrame?.();
        cancelFrame = null;
    };

    return {
        buffer,
        get adopted() {
            return adopted;
        },
        dirty(rect) {
            const area = clip(rect, doc);
            if (!area) return;
            addPending(pending, area);
            echo?.changed();
            if (!shownThisFrame) show();
        },
        flush: compositePending,
        committed(recorded) {
            stop();
            compositePending();
            if (recorded) {
                // The history step dropped the composite this buffer replaced.
                adopted = sources.composites.cacheOf(session)?.adopt(frameId, buffer) ?? false;
            } else {
                // No step: the pixels are as they were, and so is the buffer, which followed
                // every write; but an upload made during the stroke may still be on screen.
                // The buffer is shown anew, as at an animation frame: not composited again.
                present();
            }
            // From here on, another change of the frame ends the echo (`strokeEcho.ts`).
            echo?.release();
        },
        aborted() {
            stop();
            pending.length = 0;
            unshown = false;
            adopted = false;
            echo?.clear();
            sources.composites.invalidate({
                frameIds: [frameId, ...others],
                layerIds: [layerId],
                structure: false,
            });
        },
    };
}
